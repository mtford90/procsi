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

  const paths = getHtpxPaths(projectRoot);

  // Generate CA certificate if it doesn't exist
  if (!fs.existsSync(paths.caCertFile) || !fs.existsSync(paths.caKeyFile)) {
    console.log("Generating CA certificate...");
    const ca = await generateCACertificate({
      subject: { commonName: "htpx Local CA - DO NOT TRUST" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);
    // Restrict permissions on key file
    fs.chmodSync(paths.caKeyFile, 0o600);
  }

  // Initialise storage
  const storage = new RequestRepository(paths.databaseFile);

  // Find a free port for the proxy
  const proxyPort = await findFreePort();

  // Start the proxy server
  console.log(`Starting proxy on port ${proxyPort}...`);
  const proxy = await createProxy({
    port: proxyPort,
    caKeyPath: paths.caKeyFile,
    caCertPath: paths.caCertFile,
    storage,
    sessionId: "daemon", // Default session for unattributed requests
  });

  // Write proxy port to file
  writeProxyPort(projectRoot, proxy.port);

  // Start control server
  console.log("Starting control server...");
  const controlServer = createControlServer({
    socketPath: paths.controlSocketFile,
    storage,
    proxyPort: proxy.port,
  });

  // Write PID file
  writeDaemonPid(projectRoot, process.pid);

  console.log(`htpx daemon started (PID: ${process.pid})`);
  console.log(`  Proxy: http://127.0.0.1:${proxy.port}`);
  console.log(`  Control: ${paths.controlSocketFile}`);
  console.log(`  CA cert: ${paths.caCertFile}`);

  // Handle graceful shutdown
  const shutdown = async (signal: string) => {
    console.log(`\nReceived ${signal}, shutting down...`);

    try {
      await controlServer.close();
      await proxy.stop();
      storage.close();
      removeDaemonPid(projectRoot);

      // Clean up port file
      if (fs.existsSync(paths.proxyPortFile)) {
        fs.unlinkSync(paths.proxyPortFile);
      }

      console.log("Shutdown complete");
      process.exit(0);
    } catch (err) {
      console.error("Error during shutdown:", err);
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

main().catch((err) => {
  console.error("Daemon error:", err);
  process.exit(1);
});
