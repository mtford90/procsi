import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { generateCACertificate } from "mockttp";
import { RequestRepository } from "../../src/daemon/storage.js";
import { createProxy } from "../../src/daemon/proxy.js";
import { createControlServer } from "../../src/daemon/control.js";
import { ensureHtpxDir, getHtpxPaths } from "../../src/shared/project.js";

describe("logging integration", () => {
  let tempDir: string;
  let paths: ReturnType<typeof getHtpxPaths>;
  let storage: RequestRepository;
  let cleanup: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "htpx-logging-test-"));
    ensureHtpxDir(tempDir);
    paths = getHtpxPaths(tempDir);

    // Generate CA certificate
    const ca = await generateCACertificate({
      subject: { commonName: "htpx Test CA" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);

    // Create storage with logging enabled
    storage = new RequestRepository(paths.databaseFile, tempDir, "debug");

    cleanup = [];
  });

  afterEach(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("daemon logging", () => {
    it("proxy logs requests at trace level", async () => {
      const session = storage.registerSession("test", process.pid);

      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
        projectRoot: tempDir,
        logLevel: "trace",
      });
      cleanup.push(proxy.stop);

      // Create test server
      const testServer = http.createServer((req, res) => {
        res.writeHead(200);
        res.end("ok");
      });
      await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
      const testServerAddress = testServer.address() as { port: number };
      cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

      // Make request through proxy
      await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testServerAddress.port}/test`);
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Check log file exists and contains trace entries
      expect(fs.existsSync(paths.logFile)).toBe(true);
      const logContent = fs.readFileSync(paths.logFile, "utf-8");
      expect(logContent).toContain('"component":"proxy"');
      expect(logContent).toContain('"level":"trace"');
      expect(logContent).toContain("Request received");
      expect(logContent).toContain("Response sent");
    });

    it("control server logs messages at debug level", async () => {
      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: "test",
        projectRoot: tempDir,
        logLevel: "debug",
      });
      cleanup.push(proxy.stop);

      const controlServer = createControlServer({
        socketPath: paths.controlSocketFile,
        storage,
        proxyPort: proxy.port,
        projectRoot: tempDir,
        logLevel: "debug",
      });
      cleanup.push(controlServer.close);

      // Import and use control client
      const { ControlClient } = await import("../../src/daemon/control.js");
      const client = new ControlClient(paths.controlSocketFile);
      await client.ping();

      // Wait for log to be written
      await new Promise((resolve) => setTimeout(resolve, 50));

      // Check log file exists and contains control messages
      expect(fs.existsSync(paths.logFile)).toBe(true);
      const logContent = fs.readFileSync(paths.logFile, "utf-8");
      expect(logContent).toContain('"component":"control"');
      expect(logContent).toContain("Control message received");
    });

    it("storage logs at debug level", async () => {
      const session = storage.registerSession("test", process.pid);

      storage.saveRequest({
        sessionId: session.id,
        timestamp: Date.now(),
        method: "GET",
        url: "https://example.com/test",
        host: "example.com",
        path: "/test",
        requestHeaders: {},
      });

      // Check log file contains storage entries
      expect(fs.existsSync(paths.logFile)).toBe(true);
      const logContent = fs.readFileSync(paths.logFile, "utf-8");
      expect(logContent).toContain('"component":"storage"');
      expect(logContent).toContain("Request saved");
    });
  });

  describe("log level respects configuration", () => {
    it("does not log debug messages at info level", async () => {
      // Create storage with info level
      const infoStorage = new RequestRepository(
        path.join(paths.htpxDir, "info-test.db"),
        tempDir,
        "info"
      );

      // Clear the log file
      fs.writeFileSync(paths.logFile, "");

      const session = infoStorage.registerSession("test", process.pid);
      infoStorage.saveRequest({
        sessionId: session.id,
        timestamp: Date.now(),
        method: "GET",
        url: "https://example.com/test",
        host: "example.com",
        path: "/test",
        requestHeaders: {},
      });

      infoStorage.close();

      // Log file should be empty (debug level filtered out)
      const logContent = fs.readFileSync(paths.logFile, "utf-8");
      expect(logContent).not.toContain("Request saved");
    });
  });
});

/**
 * Helper to make an HTTP request through a proxy.
 */
function makeProxiedRequest(
  proxyPort: number,
  url: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);

    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: proxyPort,
      path: url,
      method: "GET",
      headers: {
        Host: parsedUrl.host,
      },
    };

    const req = http.request(options, (res) => {
      let body = "";
      res.on("data", (chunk) => (body += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
    });

    req.on("error", reject);
    req.end();
  });
}
