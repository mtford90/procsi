import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import {
  findProjectRoot,
  getHtpxPaths,
  readDaemonPid,
  isProcessRunning,
} from "../../shared/project.js";
import { readProxyPort } from "../../shared/project.js";

interface DebugDump {
  timestamp: string;
  htpxVersion: string;
  system: {
    platform: string;
    release: string;
    nodeVersion: string;
  };
  daemon: {
    running: boolean;
    pid?: number;
    proxyPort?: number;
  };
  htpxDir: {
    exists: boolean;
    files: string[];
  };
  recentLogs: string[];
}

/**
 * Collect debug information for a project.
 */
export function collectDebugInfo(projectRoot: string | undefined): DebugDump {
  const htpxVersion = getHtpxVersion();

  const dump: DebugDump = {
    timestamp: new Date().toISOString(),
    htpxVersion,
    system: {
      platform: os.platform(),
      release: os.release(),
      nodeVersion: process.version,
    },
    daemon: {
      running: false,
    },
    htpxDir: {
      exists: false,
      files: [],
    },
    recentLogs: [],
  };

  if (!projectRoot) {
    return dump;
  }

  const paths = getHtpxPaths(projectRoot);

  // Check .htpx directory
  if (fs.existsSync(paths.htpxDir)) {
    dump.htpxDir.exists = true;
    try {
      dump.htpxDir.files = fs.readdirSync(paths.htpxDir);
    } catch {
      // Ignore errors reading directory
    }
  }

  // Check daemon status
  const pid = readDaemonPid(projectRoot);
  if (pid && isProcessRunning(pid)) {
    dump.daemon.running = true;
    dump.daemon.pid = pid;

    const proxyPort = readProxyPort(projectRoot);
    if (proxyPort) {
      dump.daemon.proxyPort = proxyPort;
    }
  }

  // Read recent logs
  if (fs.existsSync(paths.logFile)) {
    try {
      const content = fs.readFileSync(paths.logFile, "utf-8");
      const lines = content.trim().split("\n");
      dump.recentLogs = lines.slice(-200); // Last 200 lines
    } catch {
      // Ignore errors reading log file
    }
  }

  return dump;
}

/**
 * Get htpx version from package.json.
 */
function getHtpxVersion(): string {
  try {
    // Find package.json relative to this file
    const packageJsonPath = path.resolve(
      path.dirname(new URL(import.meta.url).pathname),
      "..",
      "..",
      "..",
      "package.json"
    );
    const content = fs.readFileSync(packageJsonPath, "utf-8");
    const pkg = JSON.parse(content) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

/**
 * Generate a filename for the debug dump.
 */
function generateDumpFilename(): string {
  const timestamp = new Date()
    .toISOString()
    .replace(/:/g, "-")
    .replace(/\.\d{3}Z$/, "");
  return `debug-dump-${timestamp}.json`;
}

export const debugDumpCommand = new Command("debug-dump")
  .description("Collect diagnostic information for debugging")
  .action(() => {
    const projectRoot = findProjectRoot();

    if (!projectRoot) {
      console.error("Not in a project directory (no .htpx or .git found)");
      process.exit(1);
    }

    const paths = getHtpxPaths(projectRoot);
    const dump = collectDebugInfo(projectRoot);

    // Write dump to file
    const filename = generateDumpFilename();
    const filepath = path.join(paths.htpxDir, filename);

    try {
      // Ensure .htpx directory exists
      if (!fs.existsSync(paths.htpxDir)) {
        fs.mkdirSync(paths.htpxDir, { recursive: true });
      }

      fs.writeFileSync(filepath, JSON.stringify(dump, null, 2), "utf-8");
      console.log(`Debug dump written to: ${filepath}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      console.error(`Failed to write debug dump: ${message}`);
      process.exit(1);
    }
  });
