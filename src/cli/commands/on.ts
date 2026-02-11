import { Command } from "commander";
import { findOrCreateProjectRoot, ensureHtpxDir, getHtpxPaths } from "../../shared/project.js";
import { startDaemon } from "../../shared/daemon.js";
import { ControlClient } from "../../shared/control-client.js";
import { parseVerbosity } from "../../shared/logger.js";
import { getErrorMessage, getGlobalOptions } from "./helpers.js";

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

export const onCommand = new Command("on")
  .description("Start intercepting HTTP traffic in this shell")
  .option("-l, --label <label>", "Label for this session")
  .option("--no-restart", "Do not auto-restart daemon on version mismatch")
  .action(async (options: { label?: string; restart: boolean }, command: Command) => {
    // If stdout is a TTY, user ran directly - show instructions instead
    if (process.stdout.isTTY) {
      console.log("To intercept HTTP traffic, run:");
      console.log("");
      console.log("  eval $(htpx on)");
      console.log("");
      console.log("This sets the required environment variables in your shell.");
      return;
    }

    const label = options.label;
    const autoRestart = options.restart;
    const globalOpts = getGlobalOptions(command);
    const verbosity = globalOpts.verbose;
    const logLevel = parseVerbosity(verbosity);

    // Find project root (auto-creates .htpx if needed)
    const projectRoot = findOrCreateProjectRoot(undefined, globalOpts.dir);
    ensureHtpxDir(projectRoot);

    const paths = getHtpxPaths(projectRoot);

    try {
      // Start daemon if not already running
      const proxyPort = await startDaemon(projectRoot, {
        logLevel,
        autoRestart,
        onVersionMismatch: (running, cli) => {
          if (autoRestart) {
            console.log(`# htpx: restarting daemon (version mismatch: ${running} -> ${cli})`);
          } else {
            console.log(
              `# htpx warning: daemon version mismatch (running: ${running}, CLI: ${cli})`
            );
            console.log(`# Use 'htpx daemon restart' to update.`);
          }
        },
      });
      const proxyUrl = `http://127.0.0.1:${proxyPort}`;

      // Register session with daemon
      const client = new ControlClient(paths.controlSocketFile);
      try {
        const session = await client.registerSession(label, process.ppid);

        // Build environment variables
        const envVars: Record<string, string> = {
          HTTP_PROXY: proxyUrl,
          HTTPS_PROXY: proxyUrl,
          // Python requests library
          SSL_CERT_FILE: paths.caCertFile,
          REQUESTS_CA_BUNDLE: paths.caCertFile,
          // Node.js
          NODE_EXTRA_CA_CERTS: paths.caCertFile,
          // htpx session tracking
          HTPX_SESSION_ID: session.id,
        };

        if (label) {
          envVars["HTPX_LABEL"] = label;
        }

        // Report interceptor status
        try {
          const interceptors = await client.listInterceptors();
          if (interceptors.length > 0) {
            const errorCount = interceptors.filter((i) => i.error).length;
            const loadedCount = interceptors.length - errorCount;
            if (errorCount > 0) {
              console.log(
                `# Loaded ${loadedCount} interceptors (${errorCount} failed) from .htpx/interceptors/`
              );
            } else {
              console.log(`# Loaded ${loadedCount} interceptors from .htpx/interceptors/`);
            }
          }
        } catch {
          // Interceptor info not available — not critical
        }

        // Output env vars for eval
        console.log(formatEnvVars(envVars));

        // Output confirmation as a comment (shown but not executed)
        const labelInfo = label ? ` (label: ${label})` : "";
        console.log(`# htpx: intercepting traffic${labelInfo}`);
        console.log(`# Proxy: ${proxyUrl}`);
        console.log(`# Session: ${session.id}`);
      } finally {
        client.close();
      }
    } catch (err) {
      console.error(`# htpx error: ${getErrorMessage(err)}`);
      process.exit(1);
    }
  });
