#!/usr/bin/env node

import * as fs from "node:fs";
import * as net from "node:net";
import { generateCACertificate } from "mockttp";
import { RequestRepository } from "./storage.js";
import { createProxy } from "./proxy.js";
import { createControlServer } from "./control.js";
import { createInterceptorLoader, type InterceptorLoader } from "./interceptor-loader.js";
import { createInterceptorRunner } from "./interceptor-runner.js";
import { createInterceptorEventLog } from "./interceptor-event-log.js";
import { createProcsiClient } from "./procsi-client.js";
import {
  getProcsiPaths,
  ensureProcsiDir,
  writeProxyPort,
  writeDaemonPid,
  removeDaemonPid,
} from "../shared/project.js";
import { createLogger, isValidLogLevel, type LogLevel } from "../shared/logger.js";
import { getProcsiVersion } from "../shared/version.js";
import { loadConfig } from "../shared/config.js";

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

  // Ensure .procsi directory exists
  ensureProcsiDir(projectRoot);

  // Parse log level from environment
  const envLogLevel = process.env["PROCSI_LOG_LEVEL"];
  const logLevel: LogLevel = envLogLevel && isValidLogLevel(envLogLevel) ? envLogLevel : "warn";

  // Load project configuration
  const config = loadConfig(projectRoot, logLevel);

  const logger = createLogger("daemon", projectRoot, logLevel, { maxLogSize: config.maxLogSize });

  const paths = getProcsiPaths(projectRoot);

  // Generate CA certificate if it doesn't exist
  if (!fs.existsSync(paths.caCertFile) || !fs.existsSync(paths.caKeyFile)) {
    logger.info("Generating CA certificate");
    const ca = await generateCACertificate({
      subject: { commonName: "procsi Local CA - DO NOT TRUST" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);
    // Restrict permissions on key file
    fs.chmodSync(paths.caKeyFile, 0o600);
  }

  // Initialise storage
  const storage = new RequestRepository(paths.databaseFile, projectRoot, logLevel, {
    maxStoredRequests: config.maxStoredRequests,
  });

  // Load interceptors if the directory exists (user opts in by creating it)
  let interceptorLoader: InterceptorLoader | undefined;
  let interceptorRunner: ReturnType<typeof createInterceptorRunner> | undefined;
  const interceptorEventLog = createInterceptorEventLog();

  if (fs.existsSync(paths.interceptorsDir)) {
    const procsiClient = createProcsiClient(storage);
    interceptorLoader = await createInterceptorLoader({
      interceptorsDir: paths.interceptorsDir,
      projectRoot,
      logLevel,
      eventLog: interceptorEventLog,
      onReload: () => {
        logger.info("Interceptors reloaded", {
          count: interceptorLoader?.getInterceptors().length ?? 0,
        });
      },
    });

    const loadedCount = interceptorLoader.getInterceptors().length;
    const errorCount = interceptorLoader
      .getInterceptorInfo()
      .filter((info) => info.error !== undefined).length;

    logger.info("Interceptors loaded", { count: loadedCount, errors: errorCount });

    interceptorRunner = createInterceptorRunner({
      loader: interceptorLoader,
      procsiClient,
      projectRoot,
      logLevel,
      eventLog: interceptorEventLog,
    });
  }

  // Find a port for the proxy, preferring the previously used one
  const preferred = fs.existsSync(paths.preferredPortFile)
    ? parseInt(fs.readFileSync(paths.preferredPortFile, "utf-8").trim(), 10) || undefined
    : undefined;
  const proxyPort = await findPreferredPort(preferred);

  // Ensure daemon session exists (handles restarts gracefully)
  const DAEMON_SESSION_ID = "daemon";
  storage.ensureSession(DAEMON_SESSION_ID, "daemon", process.pid, "daemon");

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
    maxBodySize: config.maxBodySize,
    interceptorRunner,
  });

  // Write proxy port to file
  writeProxyPort(projectRoot, proxy.port);

  // Write preferred port for next restart
  fs.writeFileSync(paths.preferredPortFile, proxy.port.toString(), "utf-8");

  // Start control server
  const daemonVersion = getProcsiVersion();
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
    interceptorLoader,
    interceptorEventLog,
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
      interceptorLoader?.close();
      await controlServer.close();
      await proxy.stop();

      try {
        storage.compactDatabase();
      } catch (compactErr) {
        logger.warn("Database compaction failed during shutdown", {
          error: compactErr instanceof Error ? compactErr.message : String(compactErr),
        });
      }

      storage.close();
      removeDaemonPid(projectRoot);

      // Clean up port file
      if (fs.existsSync(paths.proxyPortFile)) {
        fs.unlinkSync(paths.proxyPortFile);
      }

      logger.info("Shutdown complete");
      logger.close();
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
 * Try to bind to a specific port.
 * Returns true if successful, false otherwise.
 */
async function tryBindPort(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, "127.0.0.1", () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => {
      resolve(false);
    });
  });
}

/**
 * Find a port for the proxy, preferring the given port if available.
 * Falls back to finding a free port if the preferred port is not available.
 */
async function findPreferredPort(preferred?: number): Promise<number> {
  if (preferred !== undefined) {
    if (await tryBindPort(preferred)) {
      return preferred;
    }
  }
  return findFreePort();
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
