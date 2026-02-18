import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getProcsiPaths, readDaemonPid, isProcessRunning, ensureProcsiDir } from "./project.js";
import { ControlClient } from "./control-client.js";
import type { LogLevel } from "./logger.js";
import { getProcsiVersion } from "./version.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the path to the daemon entry point.
 */
function getDaemonPath(): string {
  // This is relative to dist/shared/daemon.js
  // The daemon entry point is at dist/daemon/index.js
  return path.resolve(__dirname, "..", "daemon", "index.js");
}

export interface StartDaemonOptions {
  logLevel?: LogLevel;
  autoRestart?: boolean;
  onVersionMismatch?: (running: string, cli: string) => void;
}

/**
 * Check if the daemon is running for a project.
 */
export async function isDaemonRunning(projectRoot: string): Promise<boolean> {
  const paths = getProcsiPaths(projectRoot);

  // Check PID file first
  const pid = readDaemonPid(projectRoot);
  if (!pid || !isProcessRunning(pid)) {
    return false;
  }

  // Verify the daemon is actually responding
  const client = new ControlClient(paths.controlSocketFile);
  try {
    return await client.ping();
  } finally {
    client.close();
  }
}

/**
 * Get the version of the running daemon.
 * Returns null if daemon is not running.
 */
export async function getDaemonVersion(projectRoot: string): Promise<string | null> {
  if (!(await isDaemonRunning(projectRoot))) {
    return null;
  }

  const paths = getProcsiPaths(projectRoot);
  const client = new ControlClient(paths.controlSocketFile);

  try {
    const status = await client.status();
    return status.version;
  } catch {
    return null;
  } finally {
    client.close();
  }
}

/**
 * Restart the daemon for a project.
 * Returns the new proxy port.
 */
export async function restartDaemon(
  projectRoot: string,
  logLevel: LogLevel = "warn"
): Promise<number> {
  await stopDaemon(projectRoot);
  return spawnDaemon(projectRoot, logLevel);
}

/**
 * Start the daemon for a project.
 * Returns the proxy port.
 *
 * When the daemon is already running and autoRestart is true (default),
 * restarts the daemon if there is a version mismatch between CLI and daemon.
 */
export async function startDaemon(
  projectRoot: string,
  options?: StartDaemonOptions | LogLevel
): Promise<number> {
  // Handle backward compatibility with old signature
  const opts: StartDaemonOptions =
    typeof options === "string" ? { logLevel: options } : (options ?? {});
  const { logLevel = "warn", autoRestart = true, onVersionMismatch } = opts;

  // Check if already running
  if (await isDaemonRunning(projectRoot)) {
    const paths = getProcsiPaths(projectRoot);

    // Check version
    const daemonVersion = await getDaemonVersion(projectRoot);
    const cliVersion = getProcsiVersion();

    if (daemonVersion && daemonVersion !== cliVersion) {
      // Version mismatch detected
      if (onVersionMismatch) {
        onVersionMismatch(daemonVersion, cliVersion);
      }

      if (autoRestart) {
        return restartDaemon(projectRoot, logLevel);
      }
    }

    const portContent = fs.readFileSync(paths.proxyPortFile, "utf-8").trim();
    return parseInt(portContent, 10);
  }

  return spawnDaemon(projectRoot, logLevel);
}

/**
 * Spawn a new daemon process.
 * Internal function used by startDaemon and restartDaemon.
 */
async function spawnDaemon(projectRoot: string, logLevel: LogLevel): Promise<number> {
  // Ensure .procsi directory exists
  ensureProcsiDir(projectRoot);

  const daemonPath = getDaemonPath();
  const paths = getProcsiPaths(projectRoot);

  // Spawn daemon as detached background process
  // Clear the log file first so we only see errors from this attempt
  const logFile = path.join(paths.procsiDir, "daemon.log");
  fs.writeFileSync(logFile, "");
  const out = fs.openSync(logFile, "a");
  const err = fs.openSync(logFile, "a");

  // The daemon is the proxy itself — it must not load its own preload script.
  // Strip NODE_OPTIONS (which contains --require for the preload) and the
  // guard variable so they don't leak into the child.
  const {
    NODE_OPTIONS: _nodeOpts,
    PROCSI_ORIG_NODE_OPTIONS: _origNodeOpts,
    ...cleanEnv
  } = process.env;

  const child = spawn("node", [daemonPath], {
    env: {
      ...cleanEnv,
      PROJECT_ROOT: projectRoot,
      PROCSI_LOG_LEVEL: logLevel,
    },
    detached: true,
    stdio: ["ignore", out, err],
  });

  // Detach from parent process
  child.unref();

  // Wait for daemon to start and write port file
  const port = await waitForDaemon(projectRoot, 10000);

  return port;
}

/**
 * Stop the daemon for a project.
 */
export async function stopDaemon(projectRoot: string): Promise<void> {
  const pid = readDaemonPid(projectRoot);

  if (!pid) {
    return; // Already stopped
  }

  if (!isProcessRunning(pid)) {
    // PID file exists but process is dead - clean up
    const paths = getProcsiPaths(projectRoot);
    cleanupDaemonFiles(paths);
    return;
  }

  // Send SIGTERM to daemon
  process.kill(pid, "SIGTERM");

  // Wait for daemon to stop
  await waitForDaemonStop(pid, 5000);

  // Clean up any remaining files
  const paths = getProcsiPaths(projectRoot);
  cleanupDaemonFiles(paths);
}

/**
 * Wait for the daemon to start and return the proxy port.
 */
async function waitForDaemon(projectRoot: string, timeoutMs: number): Promise<number> {
  const paths = getProcsiPaths(projectRoot);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Check if port file exists
    if (fs.existsSync(paths.proxyPortFile)) {
      const portContent = fs.readFileSync(paths.proxyPortFile, "utf-8").trim();
      const port = parseInt(portContent, 10);

      if (!isNaN(port)) {
        // Verify daemon is responding
        const client = new ControlClient(paths.controlSocketFile);
        try {
          if (await client.ping()) {
            return port;
          }
        } finally {
          client.close();
        }
      }
    }

    // Wait a bit before checking again
    await sleep(100);
  }

  // On timeout, check daemon.log for errors to surface to the user
  const logPath = path.join(paths.procsiDir, "daemon.log");
  let logTail = "";
  if (fs.existsSync(logPath)) {
    const content = fs.readFileSync(logPath, "utf-8");
    const lines = content.trim().split("\n");
    logTail = lines.slice(-20).join("\n"); // Last 20 lines
  }

  if (logTail) {
    throw new Error(`Daemon failed to start. Log output:\n${logTail}`);
  }
  throw new Error("Daemon failed to start within timeout (no log output)");
}

/**
 * Wait for daemon process to stop.
 */
async function waitForDaemonStop(pid: number, timeoutMs: number): Promise<void> {
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return;
    }
    await sleep(100);
  }

  // Force kill if still running
  try {
    process.kill(pid, "SIGKILL");
  } catch {
    // Process may have already exited
  }
}

/**
 * Clean up daemon files (socket, port file, pid file).
 * Note: preferredPortFile is intentionally not deleted so it persists across restarts.
 */
function cleanupDaemonFiles(paths: ReturnType<typeof getProcsiPaths>): void {
  const files = [paths.controlSocketFile, paths.proxyPortFile, paths.pidFile];

  for (const file of files) {
    if (fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
      } catch {
        // Ignore errors during cleanup
      }
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
