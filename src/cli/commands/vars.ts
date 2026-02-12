import { Command } from "commander";
import { findOrCreateProjectRoot, ensureProcsiDir, getProcsiPaths } from "../../shared/project.js";
import { startDaemon } from "../../shared/daemon.js";
import { ControlClient } from "../../shared/control-client.js";
import { parseVerbosity } from "../../shared/logger.js";
import { getErrorMessage, getGlobalOptions } from "./helpers.js";
import { writeNodePreloadScript, getNodeEnvVars } from "../../overrides/node.js";

/**
 * Escape a string for safe use inside double-quoted shell context.
 * Within double quotes, `\`, `"`, `$`, `` ` ``, and `!` are interpreted by the shell.
 */
function escapeDoubleQuoted(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\$/g, "\\$")
    .replace(/`/g, "\\`")
    .replace(/!/g, "\\!");
}

/**
 * Format environment variable exports for shell evaluation.
 * Each line is a shell export statement. Values are escaped for
 * safe use in double-quoted context.
 */
export function formatEnvVars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `export ${key}="${escapeDoubleQuoted(value)}"`)
    .join("\n");
}

/**
 * Format environment variable unset statements for shell evaluation.
 * Each line is an unset statement for one variable.
 */
export function formatUnsetVars(vars: string[]): string {
  return vars.map((key) => `unset ${key}`).join("\n");
}

/**
 * Generate shell statements that save the current NODE_OPTIONS value
 * and append a --require flag for the preload script.
 *
 * Uses PROCSI_ORIG_NODE_OPTIONS as a guard — only saves the original
 * value on the first call, so repeated `procsi vars` invocations are
 * idempotent.
 *
 * This must be raw shell (not through formatEnvVars) because it needs
 * `${}` variable expansion.
 *
 * Uses `${param-word}` (without colon) for the guard: expands to
 * `word` only when `param` is truly unset, preserving an empty string
 * if the user had no NODE_OPTIONS originally. This avoids if/then/fi
 * which breaks inside `eval $(...)` in zsh.
 */
export function formatNodeOptionsExport(preloadPath: string): string {
  const escaped = escapeDoubleQuoted(preloadPath);
  return [
    // Save original NODE_OPTIONS on first invocation only (${param-word} keeps existing value when set)
    `export PROCSI_ORIG_NODE_OPTIONS="\${PROCSI_ORIG_NODE_OPTIONS-\${NODE_OPTIONS:-}}"`,
    // Append --require to NODE_OPTIONS, preserving any existing value
    // No inner quotes needed — the entire RHS is double-quoted so the shell won't word-split
    `export NODE_OPTIONS="\${PROCSI_ORIG_NODE_OPTIONS:+\${PROCSI_ORIG_NODE_OPTIONS} }--require ${escaped}"`,
  ].join("\n");
}

/**
 * Generate shell statements that restore NODE_OPTIONS to its original
 * value (or unset it if it was empty before procsi set it).
 */
export function formatNodeOptionsRestore(): string {
  return [
    // Restore to saved value; unset if the original was empty
    `test -n "\${PROCSI_ORIG_NODE_OPTIONS:-}" && export NODE_OPTIONS="\${PROCSI_ORIG_NODE_OPTIONS}" || unset NODE_OPTIONS 2>/dev/null`,
    "unset PROCSI_ORIG_NODE_OPTIONS 2>/dev/null",
  ].join("\n");
}

// Environment variables managed by procsi (used for --clear unset)
const PROCSI_ENV_VARS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "GLOBAL_AGENT_HTTP_PROXY",
  "GLOBAL_AGENT_HTTPS_PROXY",
  "NODE_USE_ENV_PROXY",
  "PROCSI_SESSION_ID",
  "PROCSI_LABEL",
];

export const varsCommand = new Command("vars")
  .description("Output shell statements to set (or unset with --clear) proxy environment variables")
  .option("-l, --label <label>", "Label for this session")
  .option("--no-restart", "Do not auto-restart daemon on version mismatch")
  .option("--clear", "Output unset statements to stop interception")
  .action(
    async (options: { label?: string; restart: boolean; clear?: boolean }, command: Command) => {
      if (options.clear) {
        // If stdout is a TTY, user ran directly — show instructions instead
        if (process.stdout.isTTY) {
          console.log("To stop intercepting HTTP traffic, run:");
          console.log("");
          console.log("  eval $(procsi vars --clear)");
          return;
        }

        // Restore NODE_OPTIONS before standard unsets
        console.log(formatNodeOptionsRestore());

        // Output unset statements for eval
        console.log(formatUnsetVars(PROCSI_ENV_VARS));

        // Output confirmation as a comment (shown but not executed)
        console.log("# procsi: interception stopped");
        return;
      }

      // If stdout is a TTY, user ran directly — show instructions instead
      if (process.stdout.isTTY) {
        console.log("To intercept HTTP traffic, run:");
        console.log("");
        console.log("  eval $(procsi vars)");
        console.log("");
        console.log("This sets the required environment variables in your shell.");
        return;
      }

      const label = options.label;
      const autoRestart = options.restart;
      const globalOpts = getGlobalOptions(command);
      const verbosity = globalOpts.verbose;
      const logLevel = parseVerbosity(verbosity);

      // Find project root (auto-creates .procsi if needed)
      const projectRoot = findOrCreateProjectRoot(undefined, globalOpts.dir);
      ensureProcsiDir(projectRoot);

      const paths = getProcsiPaths(projectRoot);

      try {
        // Start daemon if not already running
        const proxyPort = await startDaemon(projectRoot, {
          logLevel,
          autoRestart,
          onVersionMismatch: (running, cli) => {
            if (autoRestart) {
              console.log(`# procsi: restarting daemon (version mismatch: ${running} -> ${cli})`);
            } else {
              console.log(
                `# procsi warning: daemon version mismatch (running: ${running}, CLI: ${cli})`
              );
              console.log(`# Use 'procsi daemon restart' to update.`);
            }
          },
        });
        const proxyUrl = `http://127.0.0.1:${proxyPort}`;

        // Write the Node.js preload script to .procsi/
        writeNodePreloadScript(paths.proxyPreloadFile);

        // Register session with daemon
        const client = new ControlClient(paths.controlSocketFile);
        try {
          const session = await client.registerSession(label, process.ppid);

          // Build environment variables
          const envVars: Record<string, string> = {
            HTTP_PROXY: proxyUrl,
            HTTPS_PROXY: proxyUrl,
            // Lowercase variants — many Unix tools check lowercase only
            http_proxy: proxyUrl,
            https_proxy: proxyUrl,
            // Python requests library
            SSL_CERT_FILE: paths.caCertFile,
            REQUESTS_CA_BUNDLE: paths.caCertFile,
            // Node.js
            NODE_EXTRA_CA_CERTS: paths.caCertFile,
            // Node.js runtime overrides (global-agent + undici)
            ...getNodeEnvVars(proxyUrl),
            // procsi session tracking
            PROCSI_SESSION_ID: session.id,
          };

          if (label) {
            envVars["PROCSI_LABEL"] = label;
          }

          // Report interceptor status
          try {
            const interceptors = await client.listInterceptors();
            if (interceptors.length > 0) {
              const errorCount = interceptors.filter((i) => i.error).length;
              const loadedCount = interceptors.length - errorCount;
              if (errorCount > 0) {
                console.log(
                  `# Loaded ${loadedCount} interceptors (${errorCount} failed) from .procsi/interceptors/`
                );
              } else {
                console.log(`# Loaded ${loadedCount} interceptors from .procsi/interceptors/`);
              }
            }
          } catch {
            // Interceptor info not available — not critical
          }

          // Output env vars for eval
          console.log(formatEnvVars(envVars));

          // NODE_OPTIONS requires raw shell expansion, output separately
          console.log(formatNodeOptionsExport(paths.proxyPreloadFile));

          // Output confirmation as a comment (shown but not executed)
          const labelInfo = label ? ` (label: ${label})` : "";
          console.log(`# procsi: intercepting traffic${labelInfo}`);
          console.log(`# Proxy: ${proxyUrl}`);
          console.log(`# Session: ${session.id}`);
        } finally {
          client.close();
        }
      } catch (err) {
        console.error(`# procsi error: ${getErrorMessage(err)}`);
        process.exit(1);
      }
    }
  );
