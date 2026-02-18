import * as path from "node:path";
import { Command } from "commander";
import { findOrCreateProjectRoot, ensureProcsiDir, getProcsiPaths } from "../../shared/project.js";
import { startDaemon } from "../../shared/daemon.js";
import { ControlClient } from "../../shared/control-client.js";
import { parseVerbosity } from "../../shared/logger.js";
import { getErrorMessage, getGlobalOptions } from "./helpers.js";
import { writeNodePreloadScript, getNodeEnvVars } from "../../overrides/node.js";
import { writePythonOverride } from "../../overrides/python.js";
import { writeRubyOverride } from "../../overrides/ruby.js";
import { writePhpOverride } from "../../overrides/php.js";

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
 * value on the first call, so repeated `procsi on` invocations are
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

/**
 * Generate shell statements that save the current PYTHONPATH and prepend
 * the override directory so Python auto-imports our sitecustomize.py.
 *
 * Same idempotency pattern as formatNodeOptionsExport.
 */
export function formatPythonPathExport(overrideDir: string): string {
  const escaped = escapeDoubleQuoted(overrideDir);
  return [
    `export PROCSI_ORIG_PYTHONPATH="\${PROCSI_ORIG_PYTHONPATH-\${PYTHONPATH:-}}"`,
    `export PYTHONPATH="${escaped}\${PROCSI_ORIG_PYTHONPATH:+:\${PROCSI_ORIG_PYTHONPATH}}"`,
  ].join("\n");
}

/**
 * Generate shell statements that restore PYTHONPATH to its original value.
 */
export function formatPythonPathRestore(): string {
  return [
    `test -n "\${PROCSI_ORIG_PYTHONPATH:-}" && export PYTHONPATH="\${PROCSI_ORIG_PYTHONPATH}" || unset PYTHONPATH 2>/dev/null`,
    "unset PROCSI_ORIG_PYTHONPATH 2>/dev/null",
  ].join("\n");
}

/**
 * Generate shell statements that save the current RUBYOPT and append
 * a -r flag for the procsi intercept script.
 *
 * Same idempotency pattern as formatNodeOptionsExport.
 */
export function formatRubyOptExport(overridePath: string): string {
  const escaped = escapeDoubleQuoted(overridePath);
  return [
    `export PROCSI_ORIG_RUBYOPT="\${PROCSI_ORIG_RUBYOPT-\${RUBYOPT:-}}"`,
    `export RUBYOPT="\${PROCSI_ORIG_RUBYOPT:+\${PROCSI_ORIG_RUBYOPT} }-r ${escaped}"`,
  ].join("\n");
}

/**
 * Generate shell statements that restore RUBYOPT to its original value.
 */
export function formatRubyOptRestore(): string {
  return [
    `test -n "\${PROCSI_ORIG_RUBYOPT:-}" && export RUBYOPT="\${PROCSI_ORIG_RUBYOPT}" || unset RUBYOPT 2>/dev/null`,
    "unset PROCSI_ORIG_RUBYOPT 2>/dev/null",
  ].join("\n");
}

/**
 * Generate shell statements that save the current PHP_INI_SCAN_DIR and
 * set it with a `:` prefix so PHP scans both default dirs and our override.
 *
 * Same idempotency pattern as formatNodeOptionsExport.
 */
export function formatPhpIniScanDirExport(overrideDir: string): string {
  const escaped = escapeDoubleQuoted(overrideDir);
  return [
    `export PROCSI_ORIG_PHP_INI_SCAN_DIR="\${PROCSI_ORIG_PHP_INI_SCAN_DIR-\${PHP_INI_SCAN_DIR:-}}"`,
    // The `:` prefix tells PHP to scan default dirs plus our override dir
    `export PHP_INI_SCAN_DIR=":\${PROCSI_ORIG_PHP_INI_SCAN_DIR:+\${PROCSI_ORIG_PHP_INI_SCAN_DIR}:}${escaped}"`,
  ].join("\n");
}

/**
 * Generate shell statements that restore PHP_INI_SCAN_DIR to its original value.
 */
export function formatPhpIniScanDirRestore(): string {
  return [
    `test -n "\${PROCSI_ORIG_PHP_INI_SCAN_DIR:-}" && export PHP_INI_SCAN_DIR="\${PROCSI_ORIG_PHP_INI_SCAN_DIR}" || unset PHP_INI_SCAN_DIR 2>/dev/null`,
    "unset PROCSI_ORIG_PHP_INI_SCAN_DIR 2>/dev/null",
  ].join("\n");
}

export const onCommand = new Command("on")
  .description("Output shell export statements to start intercepting HTTP traffic")
  .option("-l, --label <label>", "Label for this session")
  .option("-s, --source <name>", "Label the source process (auto-detected from PID if omitted)")
  .option("--no-restart", "Do not auto-restart daemon on version mismatch")
  .action(
    async (options: { label?: string; source?: string; restart: boolean }, command: Command) => {
      // If stdout is a TTY, user ran directly — show instructions instead
      if (process.stdout.isTTY) {
        console.log("To intercept HTTP traffic, run:");
        console.log("");
        console.log('  eval "$(procsi on)"');
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

        // Write runtime override scripts to .procsi/overrides/
        writeNodePreloadScript(paths.proxyPreloadFile);
        writePythonOverride(paths.pythonOverrideDir, paths.caCertFile);
        writeRubyOverride(path.dirname(paths.rubyOverrideFile), paths.caCertFile);
        writePhpOverride(paths.phpOverrideDir, paths.caCertFile);

        // Register session with daemon
        const client = new ControlClient(paths.controlSocketFile);
        try {
          const session = await client.registerSession(label, process.ppid, options.source);

          // Build environment variables
          const envVars: Record<string, string> = {
            HTTP_PROXY: proxyUrl,
            HTTPS_PROXY: proxyUrl,
            // Lowercase variants — many Unix tools check lowercase only
            http_proxy: proxyUrl,
            https_proxy: proxyUrl,
            // CA cert trust — covers Python requests, curl, OpenSSL-based clients
            SSL_CERT_FILE: paths.caCertFile,
            REQUESTS_CA_BUNDLE: paths.caCertFile,
            CURL_CA_BUNDLE: paths.caCertFile,
            // Node.js
            NODE_EXTRA_CA_CERTS: paths.caCertFile,
            // Deno
            DENO_CERT: paths.caCertFile,
            // Rust Cargo
            CARGO_HTTP_CAINFO: paths.caCertFile,
            // Git
            GIT_SSL_CAINFO: paths.caCertFile,
            // AWS CLI
            AWS_CA_BUNDLE: paths.caCertFile,
            // PHP HTTPoxy-safe proxy variable
            CGI_HTTP_PROXY: proxyUrl,
            // Node.js runtime overrides (global-agent + undici)
            ...getNodeEnvVars(proxyUrl),
            // procsi session tracking
            PROCSI_SESSION_ID: session.id,
            PROCSI_SESSION_TOKEN: session.token,
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

          // Runtime overrides require raw shell expansion, output separately
          console.log(formatNodeOptionsExport(paths.proxyPreloadFile));
          console.log(formatPythonPathExport(paths.pythonOverrideDir));
          console.log(formatRubyOptExport(paths.rubyOverrideFile));
          console.log(formatPhpIniScanDirExport(paths.phpOverrideDir));

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
