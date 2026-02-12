import * as fs from "node:fs";
import * as path from "node:path";

export type LogLevel = "error" | "warn" | "info" | "debug" | "trace" | "silent";
export type Component = "daemon" | "tui" | "cli" | "proxy" | "control" | "storage" | "interceptor";

interface LogEntry {
  ts: string;
  level: LogLevel;
  component: Component;
  msg: string;
  data?: Record<string, unknown>;
}

const LOG_LEVEL_PRIORITY: Record<LogLevel, number> = {
  silent: -1,
  error: 0,
  warn: 1,
  info: 2,
  debug: 3,
  trace: 4,
};

/** 10MB max file size before rotation */
const DEFAULT_MAX_LOG_SIZE = 10 * 1024 * 1024;

/** Flush buffered log lines after this delay */
const FLUSH_DELAY_MS = 100;

export interface LoggerOptions {
  maxLogSize?: number;
}

export class Logger {
  private stream: fs.WriteStream | null = null;
  private buffer: string[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private dirEnsured = false;
  private maxLogSize: number;

  constructor(
    private component: Component,
    private logFile: string,
    private level: LogLevel = "warn",
    options?: LoggerOptions
  ) {
    this.maxLogSize = options?.maxLogSize ?? DEFAULT_MAX_LOG_SIZE;
  }

  error(msg: string, data?: Record<string, unknown>): void {
    this.log("error", msg, data);
  }

  warn(msg: string, data?: Record<string, unknown>): void {
    this.log("warn", msg, data);
  }

  info(msg: string, data?: Record<string, unknown>): void {
    this.log("info", msg, data);
  }

  debug(msg: string, data?: Record<string, unknown>): void {
    this.log("debug", msg, data);
  }

  trace(msg: string, data?: Record<string, unknown>): void {
    this.log("trace", msg, data);
  }

  /**
   * Flush any buffered log lines and close the write stream.
   * Uses synchronous write for the final flush to avoid losing entries.
   */
  close(): void {
    if (this.flushTimer !== null) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    // Close the stream first so any pending async writes land on disk
    if (this.stream) {
      this.stream.end();
      this.stream = null;
    }

    // Synchronously flush remaining buffer to avoid losing final entries.
    // Write each line individually with rotation checks to maintain
    // correct rotation behaviour at shutdown.
    if (this.buffer.length > 0) {
      const lines = this.buffer;
      this.buffer = [];
      this.ensureDir();
      for (const line of lines) {
        this.rotateIfNeeded();
        try {
          fs.appendFileSync(this.logFile, line, "utf-8");
        } catch {
          // Silently fail if we can't write final entries
        }
      }
    }
  }

  private log(level: LogLevel, msg: string, data?: Record<string, unknown>): void {
    if (!this.shouldLog(level)) {
      return;
    }

    const entry: LogEntry = {
      ts: new Date().toISOString(),
      level,
      component: this.component,
      msg,
    };

    if (data !== undefined) {
      entry.data = data;
    }

    const line = JSON.stringify(entry) + "\n";

    this.buffer.push(line);
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer !== null) {
      return;
    }
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      this.flush();
    }, FLUSH_DELAY_MS);
  }

  private flush(): void {
    if (this.buffer.length === 0) {
      return;
    }

    const data = this.buffer.join("");
    this.buffer = [];

    this.rotateIfNeeded();

    try {
      const stream = this.ensureStream();
      stream.write(data);
    } catch {
      // Silently fail if we can't write to log file
    }
  }

  private ensureDir(): void {
    if (this.dirEnsured) {
      return;
    }
    const dir = path.dirname(this.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.dirEnsured = true;
  }

  private ensureStream(): fs.WriteStream {
    if (this.stream) {
      return this.stream;
    }

    this.ensureDir();
    this.stream = fs.createWriteStream(this.logFile, { flags: "a" });
    this.stream.on("error", () => {
      // Silently handle stream errors to avoid crashing
      this.stream = null;
    });
    return this.stream;
  }

  private shouldLog(level: LogLevel): boolean {
    return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[this.level];
  }

  private rotateIfNeeded(): void {
    try {
      if (!fs.existsSync(this.logFile)) {
        return;
      }

      const stats = fs.statSync(this.logFile);
      if (stats.size < this.maxLogSize) {
        return;
      }

      // Close the current stream before rotating
      if (this.stream) {
        this.stream.end();
        this.stream = null;
      }

      // Perform rotation
      const rotatedPath = this.logFile + ".1";

      // Delete old rotated file if it exists
      if (fs.existsSync(rotatedPath)) {
        fs.unlinkSync(rotatedPath);
      }

      // Rename current log to .1
      fs.renameSync(this.logFile, rotatedPath);
    } catch {
      // Ignore rotation errors to avoid breaking logging
    }
  }
}

/**
 * Create a logger for a specific component.
 */
export function createLogger(
  component: Component,
  projectRoot: string,
  level: LogLevel = "warn",
  options?: LoggerOptions
): Logger {
  const logFile = path.join(projectRoot, ".procsi", "procsi.log");
  return new Logger(component, logFile, level, options);
}

/**
 * Parse verbosity flag count to log level.
 * 0 = warn (default), 1 = info, 2 = debug, 3+ = trace
 */
export function parseVerbosity(verboseCount: number): LogLevel {
  switch (verboseCount) {
    case 0:
      return "warn";
    case 1:
      return "info";
    case 2:
      return "debug";
    default:
      return "trace";
  }
}

/**
 * Check if a string is a valid log level.
 */
export function isValidLogLevel(level: string): level is LogLevel {
  return ["error", "warn", "info", "debug", "trace", "silent"].includes(level);
}
