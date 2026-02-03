import * as fs from "node:fs";
import * as path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { getHtpxPaths, readDaemonPid, isProcessRunning, ensureHtpxDir } from "./project.js";
import { ControlClient } from "../daemon/control.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Get the path to the daemon entry point.
 */
function getDaemonPath(): string {
  // In development, this is relative to dist/shared/daemon.js
  // The daemon entry point is at dist/daemon/index.js
  return path.resolve(__dirname, "..", "daemon", "index.js");
}

/**
 * Check if the daemon is running for a project.
 */
export async function isDaemonRunning(projectRoot: string): Promise<boolean> {
  const paths = getHtpxPaths(projectRoot);

  // Check PID file first
  const pid = readDaemonPid(projectRoot);
  if (!pid || !isProcessRunning(pid)) {
    return false;
  }

  // Verify the daemon is actually responding
  const client = new ControlClient(paths.controlSocketFile);
  return client.ping();
}

/**
 * Start the daemon for a project.
 * Returns the proxy port.
 */
export async function startDaemon(projectRoot: string): Promise<number> {
  // Check if already running
  if (await isDaemonRunning(projectRoot)) {
    const paths = getHtpxPaths(projectRoot);
    const portContent = fs.readFileSync(paths.proxyPortFile, "utf-8").trim();
    return parseInt(portContent, 10);
  }

  // Ensure .htpx directory exists
  ensureHtpxDir(projectRoot);

  const daemonPath = getDaemonPath();
  const paths = getHtpxPaths(projectRoot);

  // Spawn daemon as detached background process
  // Clear the log file first so we only see errors from this attempt
  const logFile = path.join(paths.htpxDir, "daemon.log");
  fs.writeFileSync(logFile, "");
  const out = fs.openSync(logFile, "a");
  const err = fs.openSync(logFile, "a");

  const child = spawn("node", [daemonPath], {
    env: {
      ...process.env,
      PROJECT_ROOT: projectRoot,
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
    const paths = getHtpxPaths(projectRoot);
    cleanupDaemonFiles(paths);
    return;
  }

  // Send SIGTERM to daemon
  process.kill(pid, "SIGTERM");

  // Wait for daemon to stop
  await waitForDaemonStop(pid, 5000);

  // Clean up any remaining files
  const paths = getHtpxPaths(projectRoot);
  cleanupDaemonFiles(paths);
}

/**
 * Wait for the daemon to start and return the proxy port.
 */
async function waitForDaemon(projectRoot: string, timeoutMs: number): Promise<number> {
  const paths = getHtpxPaths(projectRoot);
  const startTime = Date.now();

  while (Date.now() - startTime < timeoutMs) {
    // Check if port file exists
    if (fs.existsSync(paths.proxyPortFile)) {
      const portContent = fs.readFileSync(paths.proxyPortFile, "utf-8").trim();
      const port = parseInt(portContent, 10);

      if (!isNaN(port)) {
        // Verify daemon is responding
        const client = new ControlClient(paths.controlSocketFile);
        if (await client.ping()) {
          return port;
        }
      }
    }

    // Wait a bit before checking again
    await sleep(100);
  }

  // On timeout, check daemon.log for errors to surface to the user
  const logPath = path.join(paths.htpxDir, "daemon.log");
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
 */
function cleanupDaemonFiles(paths: ReturnType<typeof getHtpxPaths>): void {
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
