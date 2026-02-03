#!/usr/bin/env node

import * as fs from "node:fs";
import * as net from "node:net";
import { generateCACertificate } from "mockttp";
import { RequestRepository } from "./storage.js";
import { createProxy } from "./proxy.js";
import { createControlServer } from "./control.js";
import {
  getHtpxPaths,
  ensureHtpxDir,
  writeProxyPort,
  writeDaemonPid,
  removeDaemonPid,
} from "../shared/project.js";
import { createLogger, isValidLogLevel, type LogLevel } from "../shared/logger.js";
import { getHtpxVersion } from "../shared/version.js";

/**
 * Daemon entry point.
 * Expected to be spawned as a background process with PROJECT_ROOT env var set.
 */
async function main() {
  const projectRoot = process.env["PROJECT_ROOT"];
  if (!projectRoot) {
    console.error("PROJECT_ROOT environment variable is required");
    process.exit(1);
  }

  // Ensure .htpx directory exists
  ensureHtpxDir(projectRoot);

  // Parse log level from environment
  const envLogLevel = process.env["HTPX_LOG_LEVEL"];
  const logLevel: LogLevel = envLogLevel && isValidLogLevel(envLogLevel) ? envLogLevel : "warn";
  const logger = createLogger("daemon", projectRoot, logLevel);

  const paths = getHtpxPaths(projectRoot);

  // Generate CA certificate if it doesn't exist
  if (!fs.existsSync(paths.caCertFile) || !fs.existsSync(paths.caKeyFile)) {
    logger.info("Generating CA certificate");
    const ca = await generateCACertificate({
      subject: { commonName: "htpx Local CA - DO NOT TRUST" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);
    // Restrict permissions on key file
    fs.chmodSync(paths.caKeyFile, 0o600);
  }

  // Initialise storage
  const storage = new RequestRepository(paths.databaseFile, projectRoot, logLevel);

  // Find a free port for the proxy
  const proxyPort = await findFreePort();

  // Ensure daemon session exists (handles restarts gracefully)
  const DAEMON_SESSION_ID = "daemon";
  storage.ensureSession(DAEMON_SESSION_ID, "daemon", process.pid);

  // Start the proxy server
  logger.info("Starting proxy", { port: proxyPort });
  const proxy = await createProxy({
    port: proxyPort,
    caKeyPath: paths.caKeyFile,
    caCertPath: paths.caCertFile,
    storage,
    sessionId: DAEMON_SESSION_ID,
    projectRoot,
    logLevel,
  });

  // Write proxy port to file
  writeProxyPort(projectRoot, proxy.port);

  // Start control server
  const daemonVersion = getHtpxVersion();
  logger.info("Starting control server", {
    socketPath: paths.controlSocketFile,
    version: daemonVersion,
  });
  const controlServer = createControlServer({
    socketPath: paths.controlSocketFile,
    storage,
    proxyPort: proxy.port,
    version: daemonVersion,
    projectRoot,
    logLevel,
  });

  // Write PID file
  writeDaemonPid(projectRoot, process.pid);

  logger.info("Daemon started", {
    pid: process.pid,
    proxyPort: proxy.port,
    controlSocket: paths.controlSocketFile,
    caCert: paths.caCertFile,
  });

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    logger.info("Received shutdown signal", { signal });

    try {
      await controlServer.close();
      await proxy.stop();
      storage.close();
      removeDaemonPid(projectRoot);

      // Clean up port file
      if (fs.existsSync(paths.proxyPortFile)) {
        fs.unlinkSync(paths.proxyPortFile);
      }

      logger.info("Shutdown complete");
      process.exit(0);
    } catch (err) {
      logger.error("Error during shutdown", {
        error: err instanceof Error ? err.message : String(err),
      });
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

/**
 * Find a free port to use for the proxy.
 */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (address && typeof address === "object") {
        const port = address.port;
        server.close(() => resolve(port));
      } else {
        reject(new Error("Failed to get server address"));
      }
    });
    server.on("error", reject);
  });
}

main().catch((err: unknown) => {
  // Can't use logger here as we may not have initialised it yet
  console.error("Daemon error:", err);
  process.exit(1);
});
