import * as fs from "node:fs";
import * as path from "node:path";

const HTPX_DIR = ".htpx";

/**
 * Find the project root by looking for .htpx directory or .git directory.
 * Walks up the directory tree from the current working directory.
 * Returns undefined if no project root is found.
 */
export function findProjectRoot(startDir: string = process.cwd()): string | undefined {
  let currentDir = path.resolve(startDir);
  const root = path.parse(currentDir).root;

  while (currentDir !== root) {
    // Check for .htpx directory first
    if (fs.existsSync(path.join(currentDir, HTPX_DIR))) {
      return currentDir;
    }

    // Check for .git directory as fallback
    if (fs.existsSync(path.join(currentDir, ".git"))) {
      return currentDir;
    }

    currentDir = path.dirname(currentDir);
  }

  return undefined;
}

/**
 * Get the .htpx directory path for a project root.
 */
export function getHtpxDir(projectRoot: string): string {
  return path.join(projectRoot, HTPX_DIR);
}

/**
 * Ensure the .htpx directory exists, creating it if necessary.
 * Returns the path to the .htpx directory.
 */
export function ensureHtpxDir(projectRoot: string): string {
  const htpxDir = getHtpxDir(projectRoot);

  if (!fs.existsSync(htpxDir)) {
    fs.mkdirSync(htpxDir, { recursive: true });
  }

  return htpxDir;
}

/**
 * Get paths to various files within the .htpx directory.
 */
export function getHtpxPaths(projectRoot: string) {
  const htpxDir = getHtpxDir(projectRoot);

  return {
    htpxDir,
    proxyPortFile: path.join(htpxDir, "proxy.port"),
    controlSocketFile: path.join(htpxDir, "control.sock"),
    databaseFile: path.join(htpxDir, "requests.db"),
    caKeyFile: path.join(htpxDir, "ca-key.pem"),
    caCertFile: path.join(htpxDir, "ca.pem"),
    pidFile: path.join(htpxDir, "daemon.pid"),
  };
}

/**
 * Read the proxy port from the .htpx directory.
 * Returns undefined if the file doesn't exist.
 */
export function readProxyPort(projectRoot: string): number | undefined {
  const { proxyPortFile } = getHtpxPaths(projectRoot);

  if (!fs.existsSync(proxyPortFile)) {
    return undefined;
  }

  const content = fs.readFileSync(proxyPortFile, "utf-8").trim();
  const port = parseInt(content, 10);

  return isNaN(port) ? undefined : port;
}

/**
 * Write the proxy port to the .htpx directory.
 */
export function writeProxyPort(projectRoot: string, port: number): void {
  const { proxyPortFile } = getHtpxPaths(projectRoot);
  fs.writeFileSync(proxyPortFile, port.toString(), "utf-8");
}

/**
 * Read the daemon PID from the .htpx directory.
 * Returns undefined if the file doesn't exist.
 */
export function readDaemonPid(projectRoot: string): number | undefined {
  const { pidFile } = getHtpxPaths(projectRoot);

  if (!fs.existsSync(pidFile)) {
    return undefined;
  }

  const content = fs.readFileSync(pidFile, "utf-8").trim();
  const pid = parseInt(content, 10);

  return isNaN(pid) ? undefined : pid;
}

/**
 * Write the daemon PID to the .htpx directory.
 */
export function writeDaemonPid(projectRoot: string, pid: number): void {
  const { pidFile } = getHtpxPaths(projectRoot);
  fs.writeFileSync(pidFile, pid.toString(), "utf-8");
}

/**
 * Remove the daemon PID file.
 */
export function removeDaemonPid(projectRoot: string): void {
  const { pidFile } = getHtpxPaths(projectRoot);

  if (fs.existsSync(pidFile)) {
    fs.unlinkSync(pidFile);
  }
}

/**
 * Check if a process with the given PID is running.
 */
export function isProcessRunning(pid: number): boolean {
  try {
    // Sending signal 0 checks if the process exists without actually sending a signal
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}
