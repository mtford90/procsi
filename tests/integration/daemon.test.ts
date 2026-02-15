import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import * as zlib from "node:zlib";
import { generateCACertificate } from "mockttp";
import { RequestRepository } from "../../src/daemon/storage.js";
import { createProxy } from "../../src/daemon/proxy.js";
import { createControlServer } from "../../src/daemon/control.js";
import { ControlClient } from "../../src/shared/control-client.js";
import { ensureProcsiDir, getProcsiPaths } from "../../src/shared/project.js";
import { getProcsiVersion } from "../../src/shared/version.js";

describe("daemon integration", () => {
  let tempDir: string;
  let paths: ReturnType<typeof getProcsiPaths>;
  let storage: RequestRepository;
  let cleanup: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-daemon-test-"));
    ensureProcsiDir(tempDir);
    paths = getProcsiPaths(tempDir);

    // Generate CA certificate
    const ca = await generateCACertificate({
      subject: { commonName: "procsi Test CA" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);

    // Create storage
    storage = new RequestRepository(paths.databaseFile);

    cleanup = [];
  });

  afterEach(async () => {
    // Snapshot shared state so a lingering afterEach cannot corrupt
    // the next test's variables if vitest moves on after a timeout.
    const dirToClean = tempDir;
    const storageRef = storage;
    const cleanupFns = [...cleanup].reverse();

    // Run cleanup in reverse order
    for (const fn of cleanupFns) {
      await fn();
    }
    storageRef.close();
    fs.rmSync(dirToClean, { recursive: true, force: true });
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
      cleanup.push(() => {
        testServer.closeAllConnections();
        return new Promise((resolve) => testServer.close(() => resolve()));
      });

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
      cleanup.push(() => {
        testServer.closeAllConnections();
        return new Promise((resolve) => testServer.close(() => resolve()));
      });

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

    it("decompresses gzip-encoded response bodies before storage", async () => {
      const jsonPayload = JSON.stringify({ input_tokens: 42 });
      const gzippedPayload = zlib.gzipSync(Buffer.from(jsonPayload));

      const testServer = http.createServer((req, res) => {
        res.writeHead(200, {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
          "Content-Length": String(gzippedPayload.length),
        });
        res.end(gzippedPayload);
      });

      await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
      const testServerAddress = testServer.address() as { port: number };
      cleanup.push(() => {
        testServer.closeAllConnections();
        return new Promise((resolve) => testServer.close(() => resolve()));
      });

      const session = storage.registerSession("test", process.pid);
      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testServerAddress.port}/api/tokens`);
      await new Promise((resolve) => setTimeout(resolve, 200));

      const requests = storage.listRequests();
      const captured = requests.find((r) => r.path === "/api/tokens");
      expect(captured).toBeDefined();

      // Stored body should be the decompressed JSON, not garbled gzip bytes
      const storedBody = captured?.responseBody?.toString("utf-8");
      expect(storedBody).toBe(jsonPayload);

      // Stored headers should not include content-encoding since the body is decoded
      expect(captured?.responseHeaders?.["content-encoding"]).toBeUndefined();
    });

    it("decompresses gzip-encoded request bodies before storage", async () => {
      const jsonPayload = JSON.stringify({ name: "compressed-request" });
      const gzippedPayload = zlib.gzipSync(Buffer.from(jsonPayload));

      const testServer = http.createServer((req, res) => {
        // Just consume the body and respond
        const chunks: Buffer[] = [];
        req.on("data", (chunk: Buffer) => chunks.push(chunk));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ ok: true }));
        });
      });

      await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
      const testServerAddress = testServer.address() as { port: number };
      cleanup.push(() => {
        testServer.closeAllConnections();
        return new Promise((resolve) => testServer.close(() => resolve()));
      });

      const session = storage.registerSession("test", process.pid);
      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      await makeProxiedPostRequest(
        proxy.port,
        `http://127.0.0.1:${testServerAddress.port}/api/compressed`,
        gzippedPayload,
        {
          "Content-Type": "application/json",
          "Content-Encoding": "gzip",
        }
      );

      await new Promise((resolve) => setTimeout(resolve, 200));

      const requests = storage.listRequests();
      const captured = requests.find((r) => r.path === "/api/compressed");
      expect(captured).toBeDefined();

      // Stored body should be the decompressed JSON, not garbled gzip bytes
      const storedBody = captured?.requestBody?.toString("utf-8");
      expect(storedBody).toBe(jsonPayload);

      // Stored headers should not include content-encoding since the body is decoded
      expect(captured?.requestHeaders?.["content-encoding"]).toBeUndefined();
    });

    it("captures POST requests with JSON body", async () => {
      const testServer = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(201, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ received: body }));
        });
      });

      await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
      const testServerAddress = testServer.address() as { port: number };
      cleanup.push(() => {
        testServer.closeAllConnections();
        return new Promise((resolve) => testServer.close(() => resolve()));
      });

      const session = storage.registerSession("test", process.pid);
      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      // Make POST request through proxy
      await makeProxiedPostRequest(
        proxy.port,
        `http://127.0.0.1:${testServerAddress.port}/api/users`,
        '{"name":"Alice"}',
        { "Content-Type": "application/json" }
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const requests = storage.listRequests();
      const captured = requests.find((r) => r.path === "/api/users");
      expect(captured).toBeDefined();
      expect(captured?.method).toBe("POST");
      expect(captured?.requestBody?.toString("utf-8")).toBe('{"name":"Alice"}');
      expect(captured?.responseStatus).toBe(201);
      expect(captured?.responseBody).toBeDefined();
    });

    it("captures PUT requests with body", async () => {
      const testServer = http.createServer((req, res) => {
        let body = "";
        req.on("data", (chunk) => (body += chunk));
        req.on("end", () => {
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ updated: true }));
        });
      });

      await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
      const testServerAddress = testServer.address() as { port: number };
      cleanup.push(() => {
        testServer.closeAllConnections();
        return new Promise((resolve) => testServer.close(() => resolve()));
      });

      const session = storage.registerSession("test", process.pid);
      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      await makeProxiedPostRequest(
        proxy.port,
        `http://127.0.0.1:${testServerAddress.port}/api/users/1`,
        '{"name":"Bob"}',
        { "Content-Type": "application/json" },
        "PUT"
      );

      await new Promise((resolve) => setTimeout(resolve, 100));

      const requests = storage.listRequests();
      const captured = requests.find((r) => r.path === "/api/users/1");
      expect(captured).toBeDefined();
      expect(captured?.method).toBe("PUT");
      expect(captured?.requestBody?.toString("utf-8")).toBe('{"name":"Bob"}');
    });

    it("captures multiple rapid sequential requests", async () => {
      let requestCount = 0;
      const testServer = http.createServer((req, res) => {
        requestCount++;
        res.writeHead(200);
        res.end(`response-${requestCount}`);
      });

      await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
      const testServerAddress = testServer.address() as { port: number };
      cleanup.push(() => {
        testServer.closeAllConnections();
        return new Promise((resolve) => testServer.close(() => resolve()));
      });

      const session = storage.registerSession("test", process.pid);
      const proxy = await createProxy({
        caKeyPath: paths.caKeyFile,
        caCertPath: paths.caCertFile,
        storage,
        sessionId: session.id,
      });
      cleanup.push(proxy.stop);

      const baseUrl = `http://127.0.0.1:${testServerAddress.port}`;

      // Fire off multiple requests rapidly
      await Promise.all([
        makeProxiedRequest(proxy.port, `${baseUrl}/api/one`),
        makeProxiedRequest(proxy.port, `${baseUrl}/api/two`),
        makeProxiedRequest(proxy.port, `${baseUrl}/api/three`),
      ]);

      await new Promise((resolve) => setTimeout(resolve, 200));

      const requests = storage.listRequests();
      const capturedPaths = requests.map((r) => r.path);
      expect(capturedPaths).toContain("/api/one");
      expect(capturedPaths).toContain("/api/two");
      expect(capturedPaths).toContain("/api/three");
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
      client.close();
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
      client.close();
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

      const testVersion = getProcsiVersion();
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
      client.close();
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
      client.close();
    });

    it("lists request summaries via control API", async () => {
      const session = storage.registerSession("test", process.pid);
      const requestBody = Buffer.from('{"name":"test"}');
      const responseBody = Buffer.from('{"id":1,"name":"test"}');

      const requestId = storage.saveRequest({
        sessionId: session.id,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: { "content-type": "application/json" },
        requestBody,
      });

      storage.updateRequestResponse(requestId, {
        status: 201,
        headers: { "content-type": "application/json" },
        body: responseBody,
        durationMs: 150,
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

      // Get summaries
      const summaries = await client.listRequestsSummary();
      expect(summaries).toHaveLength(1);

      const summary = summaries[0];
      expect(summary?.method).toBe("POST");
      expect(summary?.path).toBe("/users");
      expect(summary?.responseStatus).toBe(201);
      expect(summary?.durationMs).toBe(150);

      // Should have body sizes
      expect(summary?.requestBodySize).toBe(requestBody.length);
      expect(summary?.responseBodySize).toBe(responseBody.length);

      // Should NOT have body/header data (type checking ensures this)
      expect("requestBody" in summary).toBe(false);
      expect("responseBody" in summary).toBe(false);
      client.close();
    });

    it("gets individual request with full data via control API", async () => {
      const session = storage.registerSession("test", process.pid);
      const requestBody = Buffer.from('{"name":"test"}');
      const responseBody = Buffer.from('{"id":1}');

      const requestId = storage.saveRequest({
        sessionId: session.id,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: { "content-type": "application/json" },
        requestBody,
      });

      storage.updateRequestResponse(requestId, {
        status: 201,
        headers: { "content-type": "application/json" },
        body: responseBody,
        durationMs: 100,
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

      // Get full request data
      const request = await client.getRequest(requestId);
      expect(request).not.toBeNull();
      expect(request?.method).toBe("POST");
      expect(request?.responseStatus).toBe(201);

      // Should have headers
      expect(request?.requestHeaders).toEqual({ "content-type": "application/json" });
      expect(request?.responseHeaders).toEqual({ "content-type": "application/json" });

      // Should have body data (as Buffer after revival)
      expect(request?.requestBody).toEqual(requestBody);
      expect(request?.responseBody).toEqual(responseBody);
      client.close();
    });

    it("returns null for non-existent request via control API", async () => {
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

      const client = new ControlClient(paths.controlSocketFile);

      const request = await client.getRequest("non-existent-id");
      expect(request).toBeNull();
      client.close();
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
      client.close();
    });

    it("returns error for unknown control method", async () => {
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

      const client = new ControlClient(paths.controlSocketFile);

      await expect(client.request("nonExistentMethod")).rejects.toThrow();
      client.close();
    });

    it("clears requests via control API", async () => {
      const session = storage.registerSession("test", process.pid);

      storage.saveRequest({
        sessionId: session.id,
        timestamp: Date.now(),
        method: "GET",
        url: "https://example.com/",
        host: "example.com",
        path: "/",
        requestHeaders: {},
      });

      expect(storage.countRequests()).toBe(1);

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
      await client.clearRequests();

      const count = await client.countRequests();
      expect(count).toBe(0);
      client.close();
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
        Connection: "close",
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

/**
 * Helper to make an HTTP request with a body through a proxy.
 */
function makeProxiedPostRequest(
  proxyPort: number,
  url: string,
  body: string | Buffer,
  headers: Record<string, string> = {},
  method = "POST"
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const bodyBuffer = Buffer.isBuffer(body) ? body : Buffer.from(body);

    const options: http.RequestOptions = {
      hostname: "127.0.0.1",
      port: proxyPort,
      path: url,
      method,
      headers: {
        Host: parsedUrl.host,
        Connection: "close",
        "Content-Length": String(bodyBuffer.length),
        ...headers,
      },
    };

    const req = http.request(options, (res) => {
      let responseBody = "";
      res.on("data", (chunk) => (responseBody += chunk));
      res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: responseBody }));
    });

    req.on("error", reject);
    req.write(bodyBuffer);
    req.end();
  });
}
