import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Command } from "commander";
import { getProcsiPaths, readDaemonPid, isProcessRunning } from "../../shared/project.js";
import { readProxyPort } from "../../shared/project.js";
import { getProcsiVersion } from "../../shared/version.js";
import { requireProjectRoot, getErrorMessage, getGlobalOptions } from "./helpers.js";

const DEBUG_LOG_LINES = 200;

interface DebugDump {
  timestamp: string;
  procsiVersion: string;
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
  procsiDir: {
    exists: boolean;
    files: string[];
  };
  recentLogs: string[];
}

/**
 * Collect debug information for a project.
 */
export function collectDebugInfo(projectRoot: string | undefined): DebugDump {
  const procsiVersion = getProcsiVersion();

  const dump: DebugDump = {
    timestamp: new Date().toISOString(),
    procsiVersion,
    system: {
      platform: os.platform(),
      release: os.release(),
      nodeVersion: process.version,
    },
    daemon: {
      running: false,
    },
    procsiDir: {
      exists: false,
      files: [],
    },
    recentLogs: [],
  };

  if (!projectRoot) {
    return dump;
  }

  const paths = getProcsiPaths(projectRoot);

  // Check .procsi directory
  if (fs.existsSync(paths.procsiDir)) {
    dump.procsiDir.exists = true;
    try {
      dump.procsiDir.files = fs.readdirSync(paths.procsiDir);
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
      dump.recentLogs = lines.slice(-DEBUG_LOG_LINES);
    } catch {
      // Ignore errors reading log file
    }
  }

  return dump;
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
  .action((_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);
    const paths = getProcsiPaths(projectRoot);
    const dump = collectDebugInfo(projectRoot);

    // Write dump to file
    const filename = generateDumpFilename();
    const filepath = path.join(paths.procsiDir, filename);

    try {
      // Ensure .procsi directory exists
      if (!fs.existsSync(paths.procsiDir)) {
        fs.mkdirSync(paths.procsiDir, { recursive: true });
      }

      fs.writeFileSync(filepath, JSON.stringify(dump, null, 2), "utf-8");
      console.log(`Debug dump written to: ${filepath}`);
    } catch (err) {
      console.error(`Failed to write debug dump: ${getErrorMessage(err)}`);
      process.exit(1);
    }
  });
