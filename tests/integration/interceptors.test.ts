import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { generateCACertificate } from "mockttp";
import { RequestRepository } from "../../src/daemon/storage.js";
import { createProxy } from "../../src/daemon/proxy.js";
import { createControlServer } from "../../src/daemon/control.js";
import { ControlClient } from "../../src/shared/control-client.js";
import { ensureProcsiDir, getProcsiPaths } from "../../src/shared/project.js";
import { createInterceptorLoader } from "../../src/daemon/interceptor-loader.js";
import { createInterceptorRunner } from "../../src/daemon/interceptor-runner.js";
import { createProcsiClient } from "../../src/daemon/procsi-client.js";

describe("interceptor integration", { timeout: 30_000 }, () => {
  let tempDir: string;
  let paths: ReturnType<typeof getProcsiPaths>;
  let storage: RequestRepository;
  let cleanup: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-interceptor-test-"));
    ensureProcsiDir(tempDir);
    paths = getProcsiPaths(tempDir);

    const ca = await generateCACertificate({
      subject: { commonName: "procsi Test CA" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);

    storage = new RequestRepository(paths.databaseFile);
    cleanup = [];
  });

  afterEach(async () => {
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Spin up an upstream test server, load an interceptor from the given code,
   * and wire everything together through the proxy.
   */
  async function setupWithInterceptor(interceptorCode: string) {
    // Write the interceptor file
    fs.mkdirSync(paths.interceptorsDir, { recursive: true });
    const interceptorFile = path.join(paths.interceptorsDir, "test.ts");
    fs.writeFileSync(interceptorFile, interceptorCode);

    // Start a simple upstream HTTP server
    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "hello from upstream" }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testPort = (testServer.address() as { port: number }).port;
    cleanup.push(() => {
      testServer.closeAllConnections();
      return new Promise((resolve) => testServer.close(() => resolve()));
    });

    // Load interceptors via jiti
    const procsiClient = createProcsiClient(storage);
    const loader = await createInterceptorLoader({
      interceptorsDir: paths.interceptorsDir,
      projectRoot: tempDir,
      logLevel: "silent",
    });
    cleanup.push(async () => loader.close());

    const runner = createInterceptorRunner({
      loader,
      procsiClient,
      projectRoot: tempDir,
      logLevel: "silent",
    });

    // Create session and proxy with the interceptor runner
    const session = storage.registerSession("test", process.pid);
    const proxy = await createProxy({
      caKeyPath: paths.caKeyFile,
      caCertPath: paths.caCertFile,
      storage,
      sessionId: session.id,
      interceptorRunner: runner,
    });
    cleanup.push(proxy.stop);

    return { proxy, session, loader, testPort };
  }

  /**
   * Make an HTTP request routed through the proxy.
   */
  function makeProxiedRequest(
    proxyPort: number,
    url: string,
    options?: { method?: string; body?: string; headers?: Record<string, string> }
  ): Promise<{ statusCode: number; body: string; headers: http.IncomingHttpHeaders }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: proxyPort,
          path: url,
          method: options?.method ?? "GET",
          headers: { Host: parsedUrl.host, Connection: "close", ...options?.headers },
        },
        (res) => {
          let body = "";
          res.on("data", (chunk: string) => (body += chunk));
          res.on("end", () =>
            resolve({ statusCode: res.statusCode ?? 0, body, headers: res.headers })
          );
        }
      );
      req.on("error", reject);
      if (options?.body) req.write(options.body);
      req.end();
    });
  }

  describe("proxy with interceptors", () => {
    it("returns a mocked response when the interceptor matches and does not call forward()", async () => {
      const mockInterceptorCode = `
export default {
  name: "test-mock",
  match: (req) => req.path === "/api/test",
  handler: async () => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mocked: true }),
  }),
};
`;

      const { proxy, testPort } = await setupWithInterceptor(mockInterceptorCode);

      const response = await makeProxiedRequest(
        proxy.port,
        `http://127.0.0.1:${testPort}/api/test`
      );

      expect(response.statusCode).toBe(200);
      const parsed = JSON.parse(response.body);
      expect(parsed).toEqual({ mocked: true });

      // Allow async storage writes to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      const requests = storage.listRequests();
      expect(requests).toHaveLength(1);

      const captured = requests[0];
      expect(captured?.interceptionType).toBe("mocked");
      expect(captured?.interceptedBy).toBe("test-mock");
      expect(captured?.responseStatus).toBe(200);
    });

    it("modifies the upstream response when the interceptor calls forward()", async () => {
      const modifyInterceptorCode = `
export default {
  name: "test-modify",
  match: (req) => req.path === "/api/test",
  handler: async (ctx) => {
    const response = await ctx.forward();
    return {
      ...response,
      headers: { ...response.headers, "x-intercepted": "true" },
    };
  },
};
`;

      const { proxy, testPort } = await setupWithInterceptor(modifyInterceptorCode);

      const response = await makeProxiedRequest(
        proxy.port,
        `http://127.0.0.1:${testPort}/api/test`
      );

      expect(response.statusCode).toBe(200);
      expect(response.headers["x-intercepted"]).toBe("true");

      // Upstream response should still come through
      const parsed = JSON.parse(response.body);
      expect(parsed).toEqual({ message: "hello from upstream" });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const requests = storage.listRequests();
      expect(requests).toHaveLength(1);

      const captured = requests[0];
      expect(captured?.interceptionType).toBe("modified");
      expect(captured?.interceptedBy).toBe("test-modify");
    });

    it("passes through to upstream when the interceptor match function does not match", async () => {
      const noMatchInterceptorCode = `
export default {
  name: "test-no-match",
  match: (req) => req.path === "/never/matches",
  handler: async () => ({
    status: 418,
    body: "should not see this",
  }),
};
`;

      const { proxy, testPort } = await setupWithInterceptor(noMatchInterceptorCode);

      const response = await makeProxiedRequest(
        proxy.port,
        `http://127.0.0.1:${testPort}/api/test`
      );

      // Should get the real upstream response, not the mock
      expect(response.statusCode).toBe(200);
      const parsed = JSON.parse(response.body);
      expect(parsed).toEqual({ message: "hello from upstream" });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const requests = storage.listRequests();
      expect(requests).toHaveLength(1);

      // No interception metadata should be recorded
      const captured = requests[0];
      expect(captured?.interceptedBy).toBeUndefined();
      expect(captured?.interceptionType).toBeUndefined();
    });

    it("passes through to upstream when the interceptor handler throws an error", async () => {
      const errorInterceptorCode = `
export default {
  name: "test-error",
  match: (req) => req.path === "/api/test",
  handler: async () => {
    throw new Error("interceptor kaboom");
  },
};
`;

      const { proxy, testPort } = await setupWithInterceptor(errorInterceptorCode);

      const response = await makeProxiedRequest(
        proxy.port,
        `http://127.0.0.1:${testPort}/api/test`
      );

      // Graceful degradation: the upstream response should still be returned
      expect(response.statusCode).toBe(200);
      const parsed = JSON.parse(response.body);
      expect(parsed).toEqual({ message: "hello from upstream" });

      await new Promise((resolve) => setTimeout(resolve, 100));

      const requests = storage.listRequests();
      expect(requests).toHaveLength(1);

      // The handler threw before returning a result, so no interception should be recorded
      const captured = requests[0];
      expect(captured?.interceptedBy).toBeUndefined();
      expect(captured?.interceptionType).toBeUndefined();
    });

    it("filters stored requests by interceptedBy name", async () => {
      const mockInterceptorCode = `
export default {
  name: "named-mock",
  match: (req) => req.path === "/api/mocked",
  handler: async () => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ mocked: true }),
  }),
};
`;

      const { proxy, testPort } = await setupWithInterceptor(mockInterceptorCode);

      // One request that matches the interceptor
      await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testPort}/api/mocked`);
      // One request that passes through to upstream
      await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testPort}/api/other`);

      await new Promise((resolve) => setTimeout(resolve, 100));

      // All requests
      const allSummaries = storage.listRequestsSummary();
      expect(allSummaries).toHaveLength(2);

      // Filtered by interceptor name
      const filtered = storage.listRequestsSummary({
        filter: { interceptedBy: "named-mock" },
      });
      expect(filtered).toHaveLength(1);
      expect(filtered[0]?.interceptedBy).toBe("named-mock");
      expect(filtered[0]?.interceptionType).toBe("mocked");
    });
  });

  describe("control API with interceptors", () => {
    it("lists loaded interceptors via the control API", async () => {
      const interceptorCode = `
export default {
  name: "ctrl-test",
  match: (req) => req.path === "/api/ctrl",
  handler: async () => ({
    status: 200,
    body: "ctrl",
  }),
};
`;

      fs.mkdirSync(paths.interceptorsDir, { recursive: true });
      fs.writeFileSync(path.join(paths.interceptorsDir, "ctrl.ts"), interceptorCode);

      const loader = await createInterceptorLoader({
        interceptorsDir: paths.interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });
      cleanup.push(async () => loader.close());

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
        interceptorLoader: loader,
      });
      cleanup.push(controlServer.close);

      const client = new ControlClient(paths.controlSocketFile);

      const interceptors = await client.listInterceptors();
      expect(interceptors).toHaveLength(1);
      expect(interceptors[0]?.name).toBe("ctrl-test");
      expect(interceptors[0]?.hasMatch).toBe(true);
      expect(interceptors[0]?.error).toBeUndefined();

      client.close();
    });

    it("reloads interceptors via the control API", async () => {
      const interceptorCode = `
export default {
  name: "reload-test",
  handler: async () => ({
    status: 200,
    body: "ok",
  }),
};
`;

      fs.mkdirSync(paths.interceptorsDir, { recursive: true });
      fs.writeFileSync(path.join(paths.interceptorsDir, "reload.ts"), interceptorCode);

      const loader = await createInterceptorLoader({
        interceptorsDir: paths.interceptorsDir,
        projectRoot: tempDir,
        logLevel: "silent",
      });
      cleanup.push(async () => loader.close());

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
        interceptorLoader: loader,
      });
      cleanup.push(controlServer.close);

      const client = new ControlClient(paths.controlSocketFile);

      const result = await client.reloadInterceptors();
      expect(result.success).toBe(true);
      expect(result.count).toBe(1);

      client.close();
    });
  });
});
