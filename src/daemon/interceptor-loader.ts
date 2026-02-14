import * as fs from "node:fs";
import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { createJiti } from "jiti";
import { createLogger, type LogLevel, type Logger } from "../shared/logger.js";
import type { Interceptor, InterceptorInfo } from "../shared/types.js";
import type { InterceptorEventLog } from "./interceptor-event-log.js";

/** Debounce delay for file-watcher reload triggers */
const WATCH_DEBOUNCE_MS = 300;

export interface LoadedInterceptor extends Interceptor {
  sourceFile: string;
}

export interface InterceptorLoader {
  getInterceptors(): LoadedInterceptor[];
  getInterceptorInfo(): InterceptorInfo[];
  reload(): Promise<void>;
  close(): void;
}

export interface InterceptorLoaderOptions {
  interceptorsDir: string;
  projectRoot: string;
  logLevel?: LogLevel;
  onReload?: () => void;
  /** Event log for structured interceptor debugging events */
  eventLog?: InterceptorEventLog;
}

/**
 * Runtime type guard for interceptor exports.
 * Validates that the value is an object with a `handler` function,
 * and that optional fields have the correct types if present.
 */
export function isValidInterceptor(value: unknown): value is Interceptor {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const obj = value as Record<string, unknown>;

  if (typeof obj["handler"] !== "function") {
    return false;
  }

  if ("name" in obj && typeof obj["name"] !== "string") {
    return false;
  }

  if ("match" in obj && typeof obj["match"] !== "function") {
    return false;
  }

  return true;
}

/**
 * Scan the interceptors directory for `.ts` files, sorted alphabetically.
 * Returns an empty array if the directory does not exist.
 */
async function listInterceptorFiles(dir: string): Promise<string[]> {
  try {
    const entries = await fsp.readdir(dir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
      .map((entry) => entry.name)
      .sort()
      .map((name) => path.join(dir, name));
  } catch {
    return [];
  }
}

/**
 * Extract loaded interceptors from a module's default export.
 * Handles both single interceptor objects and arrays of interceptors.
 */
function extractInterceptors(
  mod: unknown,
  filePath: string,
  logger: Logger
): { interceptors: LoadedInterceptor[]; errors: string[] } {
  const interceptors: LoadedInterceptor[] = [];
  const errors: string[] = [];

  // Unwrap `default` export if present
  const exported =
    typeof mod === "object" && mod !== null && "default" in mod
      ? (mod as Record<string, unknown>)["default"]
      : mod;

  const candidates = Array.isArray(exported) ? exported : [exported];

  for (const candidate of candidates) {
    if (isValidInterceptor(candidate)) {
      interceptors.push({ ...candidate, sourceFile: filePath });
    } else {
      const desc =
        typeof candidate === "object" && candidate !== null
          ? "object missing valid handler"
          : `unexpected export type: ${typeof candidate}`;
      const msg = `Invalid interceptor export in ${path.basename(filePath)}: ${desc}`;
      errors.push(msg);
      logger.warn(msg);
    }
  }

  return { interceptors, errors };
}

/**
 * Warn about duplicate interceptor names across all loaded interceptors.
 */
function warnDuplicateNames(interceptors: LoadedInterceptor[], logger: Logger): void {
  const seen = new Map<string, string>();

  for (const interceptor of interceptors) {
    if (interceptor.name === undefined) continue;

    const previousFile = seen.get(interceptor.name);
    if (previousFile !== undefined) {
      logger.warn(
        `Duplicate interceptor name "${interceptor.name}" in ${path.basename(interceptor.sourceFile)} ` +
          `(already defined in ${path.basename(previousFile)})`
      );
    } else {
      seen.set(interceptor.name, interceptor.sourceFile);
    }
  }
}

/**
 * Create an interceptor loader that loads TypeScript interceptor files
 * from the given directory using jiti, validates them, and watches
 * for changes to trigger hot reloads.
 */
export async function createInterceptorLoader(
  options: InterceptorLoaderOptions
): Promise<InterceptorLoader> {
  const { interceptorsDir, projectRoot, logLevel, onReload, eventLog } = options;
  const logger = createLogger("interceptor", projectRoot, logLevel);

  let interceptors: LoadedInterceptor[] = [];
  let infoEntries: InterceptorInfo[] = [];
  let watcher: fs.FSWatcher | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  let closed = false;

  /**
   * Load all interceptor files from the directory and replace the
   * current interceptor set atomically.
   */
  async function loadAll(): Promise<void> {
    const files = await listInterceptorFiles(interceptorsDir);

    if (files.length === 0) {
      interceptors = [];
      infoEntries = [];
      return;
    }

    logger.info(`Loading ${files.length} interceptor file(s) from ${interceptorsDir}`);

    // Fresh jiti instance each load to avoid serving stale cached modules on reload
    const jiti = createJiti(import.meta.url, { interopDefault: true });

    const nextInterceptors: LoadedInterceptor[] = [];
    const nextInfo: InterceptorInfo[] = [];

    for (const filePath of files) {
      const fileName = path.basename(filePath);

      try {
        const mod: unknown = await jiti.import(filePath);
        const { interceptors: extracted, errors } = extractInterceptors(mod, filePath, logger);

        if (extracted.length === 0) {
          // File loaded but produced no valid interceptors
          const errorMsg =
            errors.length > 0 ? errors.join("; ") : "No valid interceptor exports found";
          nextInfo.push({
            name: fileName,
            hasMatch: false,
            sourceFile: filePath,
            error: errorMsg,
          });
          eventLog?.append({
            type: "load_error",
            interceptor: fileName,
            message: errorMsg,
            error: errorMsg,
          });
          continue;
        }

        for (const interceptor of extracted) {
          const name = interceptor.name ?? fileName;
          nextInterceptors.push(interceptor);
          nextInfo.push({
            name,
            hasMatch: interceptor.match !== undefined,
            sourceFile: filePath,
          });
          logger.info(`Loaded interceptor "${name}" from ${fileName}`);
          eventLog?.append({
            type: "loaded",
            interceptor: name,
            message: `Loaded from ${fileName}`,
          });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? (err.stack ?? err.message) : String(err);
        logger.warn(`Failed to load interceptor file ${fileName}: ${errorMsg}`);
        nextInfo.push({
          name: fileName,
          hasMatch: false,
          sourceFile: filePath,
          error: errorMsg,
        });
        eventLog?.append({
          type: "load_error",
          interceptor: fileName,
          message: `Failed to load: ${errorMsg}`,
          error: errorMsg,
        });
      }
    }

    warnDuplicateNames(nextInterceptors, logger);

    // Atomic replacement
    interceptors = nextInterceptors;
    infoEntries = nextInfo;
  }

  /**
   * Start watching the interceptors directory for changes.
   */
  async function startWatching(): Promise<void> {
    try {
      await fsp.access(interceptorsDir);
    } catch {
      return;
    }

    try {
      watcher = fs.watch(interceptorsDir, (_eventType, filename) => {
        // Only react to TypeScript file changes
        if (typeof filename !== "string" || !filename.endsWith(".ts")) {
          return;
        }

        // Debounce rapid successive changes (e.g. atomic save-rename patterns)
        if (debounceTimer !== null) {
          clearTimeout(debounceTimer);
        }

        debounceTimer = setTimeout(() => {
          debounceTimer = null;

          if (closed) return;

          logger.info("Interceptor file change detected, reloading");
          loadAll()
            .then(() => {
              logger.info(`Hot-reload complete, ${interceptors.length} interceptor(s) active`);
              eventLog?.append({
                type: "reload",
                interceptor: "*",
                message: `Hot-reload complete, ${interceptors.length} interceptor(s) active`,
              });
              onReload?.();
            })
            .catch((err: unknown) => {
              logger.warn(`Hot-reload failed: ${err instanceof Error ? err.message : String(err)}`);
            });
        }, WATCH_DEBOUNCE_MS);
      });

      watcher.on("error", (err) => {
        logger.warn(`Interceptor directory watcher error: ${err.message}`);
        interceptors = [];
        infoEntries = [];
        stopWatching();
      });
    } catch (err) {
      logger.warn(
        `Failed to watch interceptors directory: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  function stopWatching(): void {
    if (debounceTimer !== null) {
      clearTimeout(debounceTimer);
      debounceTimer = null;
    }

    if (watcher !== null) {
      watcher.close();
      watcher = null;
    }
  }

  // Perform initial load
  try {
    await fsp.access(interceptorsDir);
    logger.info(`Interceptors directory found: ${interceptorsDir}`);
    await loadAll();
  } catch {
    // Directory does not exist — interceptors are opt-in
  }

  await startWatching();

  return {
    getInterceptors(): LoadedInterceptor[] {
      return interceptors;
    },

    getInterceptorInfo(): InterceptorInfo[] {
      return infoEntries;
    },

    async reload(): Promise<void> {
      logger.info("Manual reload triggered");
      await loadAll();
      logger.info(`Reload complete, ${interceptors.length} interceptor(s) active`);
      eventLog?.append({
        type: "reload",
        interceptor: "*",
        message: `Reload complete, ${interceptors.length} interceptor(s) active`,
      });
      onReload?.();
    },

    close(): void {
      closed = true;
      stopWatching();
      logger.close();
    },
  };
}
