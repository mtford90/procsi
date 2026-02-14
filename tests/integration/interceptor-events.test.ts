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
import { createInterceptorEventLog } from "../../src/daemon/interceptor-event-log.js";
import { createProcsiClient } from "../../src/daemon/procsi-client.js";

/**
 * Wait for async storage and interceptor processing to settle.
 */
const SETTLE_DELAY_MS = 250;

function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, SETTLE_DELAY_MS));
}

/**
 * Helper to make an HTTP GET request through a proxy.
 */
function makeProxiedRequest(
  proxyPort: number,
  url: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsedUrl = new URL(url);
    const req = http.request(
      {
        hostname: "127.0.0.1",
        port: proxyPort,
        path: url,
        method: "GET",
        headers: { Host: parsedUrl.host, Connection: "close" },
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body }));
      }
    );
    req.on("error", reject);
    req.end();
  });
}

describe("interceptor events integration", { timeout: 30_000 }, () => {
  let tempDir: string;
  let paths: ReturnType<typeof getProcsiPaths>;
  let storage: RequestRepository;
  let cleanup: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-iev-"));
    ensureProcsiDir(tempDir);
    paths = getProcsiPaths(tempDir);

    // Create interceptors directory
    fs.mkdirSync(paths.interceptorsDir, { recursive: true });

    // Generate CA certificate
    const ca = await generateCACertificate({
      subject: { commonName: "procsi Test CA" },
    });
    fs.writeFileSync(paths.caKeyFile, ca.key);
    fs.writeFileSync(paths.caCertFile, ca.cert);

    storage = new RequestRepository(paths.databaseFile);
    cleanup = [];
  });

  afterEach(async () => {
    // Run all cleanup functions in parallel with a hard overall timeout.
    // proxy.stop() from mockttp can hang indefinitely when connections
    // linger, so we cap the total cleanup budget to stay well within
    // vitest's hookTimeout (15s).
    const CLEANUP_BUDGET_MS = 8000;
    await Promise.race([
      Promise.allSettled(
        cleanup.reverse().map((fn) =>
          fn().catch(() => {
            /* best-effort */
          })
        )
      ),
      new Promise<void>((resolve) => setTimeout(resolve, CLEANUP_BUDGET_MS)),
    ]);
    try {
      storage.close();
    } catch {
      /* may already be closed */
    }
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  /**
   * Create a simple upstream test server that returns 200 with a JSON body.
   * Registered in cleanup automatically.
   */
  async function createTestServer(): Promise<{ port: number }> {
    const server = http.createServer((_req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ upstream: true }));
    });

    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const addr = server.address() as { port: number };

    cleanup.push(async () => {
      server.closeAllConnections();
      await new Promise<void>((res) => server.close(() => res()));
    });

    return { port: addr.port };
  }

  /**
   * Set up the full interceptor stack: loader, event log, runner, proxy, control server, client.
   * Interceptor files must be written to paths.interceptorsDir before calling this.
   */
  async function setupStack() {
    const eventLog = createInterceptorEventLog();
    const procsiClient = createProcsiClient(storage);

    const loader = await createInterceptorLoader({
      interceptorsDir: paths.interceptorsDir,
      projectRoot: tempDir,
      logLevel: "silent",
      eventLog,
    });
    cleanup.push(async () => loader.close());

    const runner = createInterceptorRunner({
      loader,
      procsiClient,
      projectRoot: tempDir,
      logLevel: "silent",
      eventLog,
    });

    const session = storage.registerSession("test", process.pid);

    // Create the upstream test server before proxy so it is available
    const testServer = await createTestServer();

    const proxy = await createProxy({
      caKeyPath: paths.caKeyFile,
      caCertPath: paths.caCertFile,
      storage,
      sessionId: session.id,
      projectRoot: tempDir,
      logLevel: "silent",
      interceptorRunner: runner,
    });
    cleanup.push(proxy.stop);

    const controlServer = createControlServer({
      socketPath: paths.controlSocketFile,
      storage,
      proxyPort: proxy.port,
      version: "1.0.0-test",
      projectRoot: tempDir,
      logLevel: "silent",
      interceptorLoader: loader,
      interceptorEventLog: eventLog,
    });
    cleanup.push(controlServer.close);

    const client = new ControlClient(paths.controlSocketFile);
    cleanup.push(async () => client.close());

    return { proxy, client, eventLog, loader, testServer };
  }

  it("matched interceptor emits matched event", async () => {
    fs.writeFileSync(
      path.join(paths.interceptorsDir, "mock-all.ts"),
      `export default {
        name: "mock-all",
        handler: async () => {
          return { status: 200, body: "mocked" };
        },
      };`
    );

    const { proxy, client, testServer } = await setupStack();

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testServer.port}/api/test`);
    await settle();

    const result = await client.getInterceptorEvents();
    const matchedEvents = result.events.filter((e) => e.type === "matched");

    expect(matchedEvents.length).toBeGreaterThanOrEqual(1);
    expect(matchedEvents[0]?.interceptor).toBe("mock-all");
    expect(matchedEvents[0]?.level).toBe("info");
  });

  it("mock interceptor emits mocked event", async () => {
    fs.writeFileSync(
      path.join(paths.interceptorsDir, "mock-response.ts"),
      `export default {
        name: "mock-response",
        handler: async () => {
          return { status: 201, body: '{"mocked":true}', headers: { "content-type": "application/json" } };
        },
      };`
    );

    const { proxy, client, testServer } = await setupStack();

    const response = await makeProxiedRequest(
      proxy.port,
      `http://127.0.0.1:${testServer.port}/api/mocked`
    );
    await settle();

    // The response should be the mock
    expect(response.statusCode).toBe(201);

    const result = await client.getInterceptorEvents();
    const mockedEvents = result.events.filter((e) => e.type === "mocked");

    expect(mockedEvents.length).toBeGreaterThanOrEqual(1);
    expect(mockedEvents[0]?.interceptor).toBe("mock-response");
    expect(mockedEvents[0]?.message).toContain("Mock response");
  });

  it("handler throw produces handler_timeout warn event", async () => {
    // When an async handler rejects, withTimeout treats the rejection as a
    // timeout-like bail-out, emitting handler_timeout (warn) rather than
    // handler_error (error). The request falls through to the upstream server.
    fs.writeFileSync(
      path.join(paths.interceptorsDir, "throws.ts"),
      `export default {
        name: "throwing-interceptor",
        handler: async () => {
          throw new Error("intentional test error");
        },
      };`
    );

    const { proxy, client, testServer } = await setupStack();

    const response = await makeProxiedRequest(
      proxy.port,
      `http://127.0.0.1:${testServer.port}/api/error`
    );
    await settle();

    // Handler threw, so the request falls through to upstream
    expect(response.statusCode).toBe(200);

    const result = await client.getInterceptorEvents();

    // Should have a matched event (info) before the handler_timeout (warn)
    const matchedEvents = result.events.filter((e) => e.type === "matched");
    expect(matchedEvents.length).toBeGreaterThanOrEqual(1);

    // The async throw is treated as a timeout by withTimeout
    const timeoutEvents = result.events.filter((e) => e.type === "handler_timeout");
    expect(timeoutEvents.length).toBeGreaterThanOrEqual(1);
    expect(timeoutEvents[0]?.interceptor).toBe("throwing-interceptor");
    expect(timeoutEvents[0]?.level).toBe("warn");
  });

  it("ctx.log() produces user_log event", async () => {
    fs.writeFileSync(
      path.join(paths.interceptorsDir, "logging.ts"),
      `export default {
        name: "logging-interceptor",
        handler: async (ctx) => {
          ctx.log("hello from interceptor");
          return { status: 200, body: "logged" };
        },
      };`
    );

    const { proxy, client, testServer } = await setupStack();

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testServer.port}/api/log`);
    await settle();

    const result = await client.getInterceptorEvents({ type: "user_log" });
    const logEvents = result.events.filter((e) => e.type === "user_log");

    expect(logEvents.length).toBeGreaterThanOrEqual(1);
    expect(logEvents[0]?.interceptor).toBe("logging-interceptor");
    expect(logEvents[0]?.message).toBe("hello from interceptor");
    expect(logEvents[0]?.level).toBe("info");
  });

  it("getInterceptorEvents with level filter returns only matching severity", async () => {
    // This interceptor throws, producing a warn-level handler_timeout event
    // (withTimeout converts async rejections to timeout). The matched/loaded
    // events are info-level.
    fs.writeFileSync(
      path.join(paths.interceptorsDir, "mixed-levels.ts"),
      `export default {
        name: "mixed-levels",
        handler: async () => {
          throw new Error("level test error");
        },
      };`
    );

    const { proxy, client, testServer } = await setupStack();

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testServer.port}/api/levels`);
    await settle();

    // Query all events
    const allResult = await client.getInterceptorEvents();
    const allEvents = allResult.events;

    // Should have info (matched, loaded) and warn (handler_timeout) events
    const infoEvents = allEvents.filter((e) => e.level === "info");
    const warnEvents = allEvents.filter((e) => e.level === "warn");
    expect(infoEvents.length).toBeGreaterThan(0);
    expect(warnEvents.length).toBeGreaterThan(0);

    // Query with level=warn filter -- should include warn+error but not info
    const warnResult = await client.getInterceptorEvents({ level: "warn" });
    const filteredEvents = warnResult.events;

    // All returned events should be warn or error level
    for (const event of filteredEvents) {
      expect(["warn", "error"]).toContain(event.level);
    }
    expect(filteredEvents.length).toBeGreaterThan(0);

    // Filtered results should be smaller than all events (info excluded)
    expect(filteredEvents.length).toBeLessThan(allEvents.length);
  });

  it("getInterceptorEvents with afterSeq polling returns only new events", async () => {
    fs.writeFileSync(
      path.join(paths.interceptorsDir, "polling-test.ts"),
      `export default {
        name: "polling-test",
        handler: async () => {
          return { status: 200, body: "polled" };
        },
      };`
    );

    const { proxy, client, testServer } = await setupStack();

    // First request
    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testServer.port}/api/first`);
    await settle();

    const firstResult = await client.getInterceptorEvents();
    const firstEvents = firstResult.events;
    expect(firstEvents.length).toBeGreaterThan(0);

    // Note the highest sequence number
    const lastSeq = Math.max(...firstEvents.map((e) => e.seq));
    expect(lastSeq).toBeGreaterThan(0);

    // Second request
    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testServer.port}/api/second`);
    await settle();

    // Poll with afterSeq
    const newResult = await client.getInterceptorEvents({ afterSeq: lastSeq });
    const newEvents = newResult.events;

    // New events should all have seq > lastSeq
    expect(newEvents.length).toBeGreaterThan(0);
    for (const event of newEvents) {
      expect(event.seq).toBeGreaterThan(lastSeq);
    }

    // Should contain events from the second request
    const secondRequestEvents = newEvents.filter((e) => e.requestUrl?.includes("/api/second"));
    expect(secondRequestEvents.length).toBeGreaterThan(0);

    // Should NOT contain events from the first request
    const firstRequestEvents = newEvents.filter((e) => e.requestUrl?.includes("/api/first"));
    expect(firstRequestEvents).toHaveLength(0);
  });

  it("clearInterceptorEvents clears all events", async () => {
    fs.writeFileSync(
      path.join(paths.interceptorsDir, "clear-test.ts"),
      `export default {
        name: "clear-test",
        handler: async () => {
          return { status: 200, body: "will be cleared" };
        },
      };`
    );

    const { proxy, client, testServer } = await setupStack();

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testServer.port}/api/clear`);
    await settle();

    // Verify events exist
    const beforeClear = await client.getInterceptorEvents();
    expect(beforeClear.events.length).toBeGreaterThan(0);

    // Clear events
    await client.clearInterceptorEvents();

    // Verify events are cleared
    const afterClear = await client.getInterceptorEvents();
    expect(afterClear.events).toHaveLength(0);
    expect(afterClear.counts.info).toBe(0);
    expect(afterClear.counts.warn).toBe(0);
    expect(afterClear.counts.error).toBe(0);
  });

  it("events include request metadata", async () => {
    fs.writeFileSync(
      path.join(paths.interceptorsDir, "metadata-test.ts"),
      `export default {
        name: "metadata-test",
        handler: async () => {
          return { status: 200, body: "metadata" };
        },
      };`
    );

    const { proxy, client, testServer } = await setupStack();

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testServer.port}/api/metadata-path`);
    await settle();

    const result = await client.getInterceptorEvents();
    const matchedEvent = result.events.find((e) => e.type === "matched");

    expect(matchedEvent).toBeDefined();
    expect(matchedEvent?.requestUrl).toContain("/api/metadata-path");
    expect(matchedEvent?.requestMethod).toBe("GET");
    expect(matchedEvent?.requestId).toBeDefined();
    expect(matchedEvent?.timestamp).toBeGreaterThan(0);
    expect(matchedEvent?.seq).toBeGreaterThan(0);
  });

  it("counts reflect event levels correctly", async () => {
    // Use an interceptor that logs and returns a mock to produce info-level events.
    // Then also make a second interceptor file that would log on load.
    fs.writeFileSync(
      path.join(paths.interceptorsDir, "counts-test.ts"),
      `export default {
        name: "counts-test",
        handler: async (ctx) => {
          ctx.log("count me");
          return { status: 200, body: "counted" };
        },
      };`
    );

    const { proxy, client, testServer } = await setupStack();

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testServer.port}/api/counts`);
    await settle();

    const result = await client.getInterceptorEvents();

    // There should be "loaded" (info), "matched" (info), "user_log" (info), "mocked" (info) events
    expect(result.counts.info).toBeGreaterThan(0);

    // Verify counts match actual events in the buffer
    const infoCount = result.events.filter((e) => e.level === "info").length;
    expect(result.counts.info).toBeGreaterThanOrEqual(infoCount);
  });
});
