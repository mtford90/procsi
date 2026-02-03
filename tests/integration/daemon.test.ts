import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { generateCACertificate } from "mockttp";
import { RequestRepository } from "../../src/daemon/storage.js";
import { createProxy } from "../../src/daemon/proxy.js";
import { createControlServer, ControlClient } from "../../src/daemon/control.js";
import { ensureHtpxDir, getHtpxPaths } from "../../src/shared/project.js";
import { getHtpxVersion } from "../../src/shared/version.js";

describe("daemon integration", () => {
  let tempDir: string;
  let paths: ReturnType<typeof getHtpxPaths>;
  let storage: RequestRepository;
  let cleanup: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "htpx-daemon-test-"));
    ensureHtpxDir(tempDir);
    paths = getHtpxPaths(tempDir);

    // Generate CA certificate
    const ca = await generateCACertificate({
      subject: { commonName: "htpx Test CA" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);

    // Create storage
    storage = new RequestRepository(paths.databaseFile);

    cleanup = [];
  });

  afterEach(async () => {
    // Run cleanup in reverse order
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("proxy", () => {
    it("starts and stops the proxy", async () => {
      const session = storage.registerSession("test", process.pid);

      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });

      cleanup.push(proxy.stop);

      expect(proxy.port).toBeGreaterThan(0);
      expect(proxy.url).toMatch(/^https?:\/\//);

      await proxy.stop();
      cleanup.pop(); // Remove from cleanup since we already stopped
    });

    it("captures requests using daemon default session", async () => {
      // This mimics the actual daemon startup in src/daemon/index.ts
      // which uses a fixed "daemon" session ID
      const DAEMON_SESSION_ID = "daemon";

      // Ensure the daemon session exists (this is what the fix adds)
      storage.ensureSession(DAEMON_SESSION_ID, "daemon", process.pid);

      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: DAEMON_SESSION_ID,
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

      // Verify request was captured
      const requests = storage.listRequests();
      expect(requests.length).toBeGreaterThanOrEqual(1);
      expect(requests.find((r) => r.sessionId === DAEMON_SESSION_ID)).toBeDefined();
    });

    it("captures HTTP requests through the proxy", async () => {
      // Create a simple test server
      const testServer = http.createServer((req, res) => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ message: "hello" }));
      });

      await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
      const testServerAddress = testServer.address() as { port: number };
      cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

      // Start proxy
      const session = storage.registerSession("test", process.pid);
      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
        label: "test-label",
      });
      cleanup.push(proxy.stop);

      // Make request through proxy
      const response = await makeProxiedRequest(
        proxy.port,
        `http://127.0.0.1:${testServerAddress.port}/api/test`
      );

      expect(response.statusCode).toBe(200);

      // Wait a bit for async storage
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify request was captured
      const requests = storage.listRequests();
      expect(requests.length).toBeGreaterThanOrEqual(1);

      const captured = requests.find((r) => r.path === "/api/test");
      expect(captured).toBeDefined();
      expect(captured?.method).toBe("GET");
      expect(captured?.responseStatus).toBe(200);
      expect(captured?.label).toBe("test-label");
    });
  });

  describe("control server", () => {
    it("starts and accepts connections", async () => {
      const session = storage.registerSession("test", process.pid);

      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      const controlServer = createControlServer({
        socketPath: paths.controlSocketFile,
        storage,
        proxyPort: proxy.port,
        version: "1.0.0",
      });
      cleanup.push(controlServer.close);

      // Create client and ping
      const client = new ControlClient(paths.controlSocketFile);
      const isAlive = await client.ping();

      expect(isAlive).toBe(true);
    });

    it("status includes version field", async () => {
      const session = storage.registerSession("test", process.pid);

      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      const testVersion = "2.3.4";
      const controlServer = createControlServer({
        socketPath: paths.controlSocketFile,
        storage,
        proxyPort: proxy.port,
        version: testVersion,
      });
      cleanup.push(controlServer.close);

      const client = new ControlClient(paths.controlSocketFile);
      const status = await client.status();

      expect(status.version).toBe(testVersion);
    });

    it("returns daemon status", async () => {
      const session1 = storage.registerSession("session1", 1);
      storage.registerSession("session2", 2);
      storage.saveRequest({
        sessionId: session1.id,
        timestamp: Date.now(),
        method: "GET",
        url: "https://example.com/",
        host: "example.com",
        path: "/",
        requestHeaders: {},
      });

      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: "test",
      });
      cleanup.push(proxy.stop);

      const testVersion = getHtpxVersion();
      const controlServer = createControlServer({
        socketPath: paths.controlSocketFile,
        storage,
        proxyPort: proxy.port,
        version: testVersion,
      });
      cleanup.push(controlServer.close);

      const client = new ControlClient(paths.controlSocketFile);
      const status = await client.status();

      expect(status.running).toBe(true);
      expect(status.proxyPort).toBe(proxy.port);
      expect(status.sessionCount).toBe(2);
      expect(status.requestCount).toBe(1);
      expect(status.version).toBe(testVersion);
    });

    it("lists and counts requests via control API", async () => {
      const session = storage.registerSession("test", process.pid);

      storage.saveRequest({
        sessionId: session.id,
        label: "api",
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: {},
      });

      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      const controlServer = createControlServer({
        socketPath: paths.controlSocketFile,
        storage,
        proxyPort: proxy.port,
        version: "1.0.0",
      });
      cleanup.push(controlServer.close);

      const client = new ControlClient(paths.controlSocketFile);

      const requests = await client.listRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0]?.path).toBe("/users");

      const count = await client.countRequests();
      expect(count).toBe(1);
    });

    it("registers sessions via control API", async () => {
      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: "test",
      });
      cleanup.push(proxy.stop);

      const controlServer = createControlServer({
        socketPath: paths.controlSocketFile,
        storage,
        proxyPort: proxy.port,
        version: "1.0.0",
      });
      cleanup.push(controlServer.close);

      const client = new ControlClient(paths.controlSocketFile);
      const session = await client.registerSession("my-label", 12345);

      expect(session.id).toBeDefined();
      expect(session.label).toBe("my-label");
      expect(session.pid).toBe(12345);
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
