import { Command } from "commander";
import { findOrCreateProjectRoot, ensureHtpxDir, getHtpxPaths } from "../../shared/project.js";
import { startDaemon } from "../../shared/daemon.js";
import { ControlClient } from "../../daemon/control.js";
import { parseVerbosity } from "../../shared/logger.js";

/**
 * Format environment variable exports for shell evaluation.
 * Each line is a shell export statement.
 */
export function formatEnvVars(vars: Record<string, string>): string {
  return Object.entries(vars)
    .map(([key, value]) => `export ${key}="${value}"`)
    .join("\n");
}

export const interceptCommand = new Command("intercept")
  .description("Output environment variables to intercept HTTP traffic")
  .option("-l, --label <label>", "Label for this session")
  .action(async (options: { label?: string }, command: Command) => {
    const label = options.label;
    const globalOpts = command.optsWithGlobals() as { verbose?: number };
    const verbosity = globalOpts.verbose ?? 0;
    const logLevel = parseVerbosity(verbosity);

    // Find project root (auto-creates .htpx if needed)
    const projectRoot = findOrCreateProjectRoot();
    ensureHtpxDir(projectRoot);

    const paths = getHtpxPaths(projectRoot);

    try {
      // Start daemon if not already running
      const proxyPort = await startDaemon(projectRoot, logLevel);
      const proxyUrl = `http://127.0.0.1:${proxyPort}`;

      // Register session with daemon
      const client = new ControlClient(paths.controlSocketFile);
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

      // Output env vars for eval
      console.log(formatEnvVars(envVars));

      // Output confirmation as a comment (shown but not executed)
      const labelInfo = label ? ` (label: ${label})` : "";
      console.log(`# htpx: intercepting traffic${labelInfo}`);
      console.log(`# Proxy: ${proxyUrl}`);
      console.log(`# Session: ${session.id}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`# htpx error: ${message}`);
      process.exit(1);
    }
  });
