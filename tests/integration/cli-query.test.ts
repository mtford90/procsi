/**
 * Integration tests for CLI query commands.
 *
 * Spins up a real control server backed by SQLite storage, seeds test data,
 * and exercises the ControlClient methods the CLI commands rely on —
 * verifying the full daemon communication path without spawning CLI processes.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RequestRepository } from "../../src/daemon/storage.js";
import { createControlServer } from "../../src/daemon/control.js";
import { ControlClient } from "../../src/shared/control-client.js";
import { ensureProcsiDir, getProcsiPaths } from "../../src/shared/project.js";
import { formatRequestTable, SHORT_ID_LENGTH } from "../../src/cli/formatters/table.js";
import { formatRequestDetail, formatSessionTable } from "../../src/cli/formatters/detail.js";
import { parseTime } from "../../src/cli/utils/parse-time.js";

describe("CLI query integration", () => {
  let tempDir: string;
  let paths: ReturnType<typeof getProcsiPaths>;
  let storage: RequestRepository;
  let client: ControlClient;
  let cleanup: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-cli-query-test-"));
    ensureProcsiDir(tempDir);
    paths = getProcsiPaths(tempDir);

    storage = new RequestRepository(paths.databaseFile);
    cleanup = [];

    // Create control server (no proxy needed for query tests)
    const controlServer = createControlServer({
      socketPath: paths.controlSocketFile,
      storage,
      proxyPort: 0,
      version: "1.0.0-test",
    });
    cleanup.push(controlServer.close);

    client = new ControlClient(paths.controlSocketFile);
  });

  afterEach(async () => {
    client.close();
    for (const fn of cleanup.reverse()) {
      await fn();
    }
    storage.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  /**
   * Seed a few requests with varied methods, statuses, and bodies.
   */
  function seedRequests(): string[] {
    const session = storage.registerSession("test", process.pid);
    const ids: string[] = [];

    // GET 200 with JSON response
    const id1 = storage.saveRequest({
      sessionId: session.id,
      timestamp: Date.now() - 5000,
      method: "GET",
      url: "https://api.example.com/users",
      host: "api.example.com",
      path: "/users",
      requestHeaders: { accept: "application/json" },
    });
    storage.updateRequestResponse(id1, {
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from(JSON.stringify([{ id: 1, name: "Alice" }])),
      durationMs: 45,
    });
    ids.push(id1);

    // POST 201
    const id2 = storage.saveRequest({
      sessionId: session.id,
      timestamp: Date.now() - 3000,
      method: "POST",
      url: "https://api.example.com/users",
      host: "api.example.com",
      path: "/users",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"Bob"}'),
    });
    storage.updateRequestResponse(id2, {
      status: 201,
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"id":2,"name":"Bob"}'),
      durationMs: 120,
    });
    ids.push(id2);

    // GET 404
    const id3 = storage.saveRequest({
      sessionId: session.id,
      timestamp: Date.now() - 1000,
      method: "GET",
      url: "https://api.example.com/products/999",
      host: "api.example.com",
      path: "/products/999",
      requestHeaders: { accept: "application/json" },
    });
    storage.updateRequestResponse(id3, {
      status: 404,
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"error":"not found"}'),
      durationMs: 12,
    });
    ids.push(id3);

    return ids;
  }

  describe("requests list (listRequestsSummary)", () => {
    it("returns all seeded requests via control client", async () => {
      seedRequests();

      const summaries = await client.listRequestsSummary();
      expect(summaries).toHaveLength(3);
    });

    it("supports limit and offset pagination", async () => {
      seedRequests();

      const page1 = await client.listRequestsSummary({ limit: 2, offset: 0 });
      expect(page1).toHaveLength(2);

      const page2 = await client.listRequestsSummary({ limit: 2, offset: 2 });
      expect(page2).toHaveLength(1);
    });

    it("filters by method", async () => {
      seedRequests();

      const gets = await client.listRequestsSummary({
        filter: { methods: ["GET"] },
      });
      expect(gets).toHaveLength(2);
      expect(gets.every((r) => r.method === "GET")).toBe(true);

      const posts = await client.listRequestsSummary({
        filter: { methods: ["POST"] },
      });
      expect(posts).toHaveLength(1);
      expect(posts[0]?.method).toBe("POST");
    });

    it("filters by status range", async () => {
      seedRequests();

      const success = await client.listRequestsSummary({
        filter: { statusRange: "2xx" },
      });
      expect(success).toHaveLength(2);

      const notFound = await client.listRequestsSummary({
        filter: { statusRange: "4xx" },
      });
      expect(notFound).toHaveLength(1);
      expect(notFound[0]?.responseStatus).toBe(404);
    });

    it("filters by host", async () => {
      seedRequests();

      const results = await client.listRequestsSummary({
        filter: { host: "api.example.com" },
      });
      expect(results).toHaveLength(3);

      const none = await client.listRequestsSummary({
        filter: { host: "other.com" },
      });
      expect(none).toHaveLength(0);
    });

    it("filters by path prefix", async () => {
      seedRequests();

      const users = await client.listRequestsSummary({
        filter: { pathPrefix: "/users" },
      });
      expect(users).toHaveLength(2);

      const products = await client.listRequestsSummary({
        filter: { pathPrefix: "/products" },
      });
      expect(products).toHaveLength(1);
    });

    it("filters by regex URL pattern", async () => {
      seedRequests();

      const regexMatches = await client.listRequestsSummary({
        filter: { regex: "products/\\d+$" },
      });
      expect(regexMatches).toHaveLength(1);
      expect(regexMatches[0]?.path).toBe("/products/999");
    });

    it("filters by regex URL pattern with flags", async () => {
      seedRequests();

      const regexMatches = await client.listRequestsSummary({
        filter: { regex: "USERS", regexFlags: "i" },
      });
      expect(regexMatches).toHaveLength(2);
      expect(regexMatches.every((r) => r.path.toLowerCase().includes("users"))).toBe(true);
    });

    it("filters by time window using parseTime", async () => {
      seedRequests();

      // All requests are within the last 10s, so "since 1m ago" should capture all
      const since = parseTime("1m");
      const all = await client.listRequestsSummary({
        filter: { since },
      });
      expect(all).toHaveLength(3);

      // "since 0s" should exclude everything (nothing at or after now)
      const futureMs = Date.now() + 60_000;
      const none = await client.listRequestsSummary({
        filter: { since: futureMs },
      });
      expect(none).toHaveLength(0);
    });
  });

  describe("request count (countRequests)", () => {
    it("returns total count", async () => {
      seedRequests();
      const count = await client.countRequests();
      expect(count).toBe(3);
    });

    it("counts with filters", async () => {
      seedRequests();
      const count = await client.countRequests({
        filter: { methods: ["POST"] },
      });
      expect(count).toBe(1);
    });
  });

  describe("request detail (getRequest)", () => {
    it("returns full request with headers and bodies", async () => {
      const ids = seedRequests();

      const postId = ids[1] ?? "";
      const request = await client.getRequest(postId);
      expect(request).not.toBeNull();
      expect(request?.method).toBe("POST");
      expect(request?.responseStatus).toBe(201);
      expect(request?.requestHeaders).toBeDefined();
      expect(request?.responseHeaders).toBeDefined();
      expect(request?.requestBody).toBeDefined();
      expect(request?.responseBody).toBeDefined();

      const reqBody = request?.requestBody?.toString("utf-8");
      expect(reqBody).toBe('{"name":"Bob"}');
    });

    it("returns null for non-existent ID", async () => {
      const result = await client.getRequest("non-existent-id");
      expect(result).toBeNull();
    });
  });

  describe("body search (searchBodies)", () => {
    it("finds requests by body content", async () => {
      seedRequests();

      const results = await client.searchBodies({ query: "Alice" });
      expect(results.length).toBeGreaterThanOrEqual(1);
    });

    it("returns empty for no match", async () => {
      seedRequests();

      const results = await client.searchBodies({ query: "nonexistent-term-xyz" });
      expect(results).toHaveLength(0);
    });
  });

  describe("JSON query (queryJsonBodies)", () => {
    it("extracts values from JSON response bodies", async () => {
      seedRequests();

      const results = await client.queryJsonBodies({
        jsonPath: "$.error",
        target: "response",
      });
      // The 404 response has {"error":"not found"}
      expect(results.length).toBeGreaterThanOrEqual(1);
      const match = results.find((r) => r.extractedValue === "not found");
      expect(match).toBeDefined();
    });
  });

  describe("clear requests", () => {
    it("clears all requests via control client", async () => {
      seedRequests();
      expect(await client.countRequests()).toBe(3);

      await client.clearRequests();
      expect(await client.countRequests()).toBe(0);
    });
  });

  describe("sessions (listSessions)", () => {
    it("lists active sessions", async () => {
      storage.registerSession("my-label", process.pid);

      const sessions = await client.listSessions();
      expect(sessions.length).toBeGreaterThanOrEqual(1);

      const session = sessions.find((s) => s.label === "my-label");
      expect(session).toBeDefined();
      expect(session?.pid).toBe(process.pid);
    });
  });

  describe("formatters produce correct output from real data", () => {
    it("formatRequestTable renders seeded data", async () => {
      seedRequests();

      const summaries = await client.listRequestsSummary();
      const total = await client.countRequests();
      const output = formatRequestTable(summaries, total);

      // Should contain short IDs
      for (const s of summaries) {
        expect(output).toContain(s.id.slice(0, SHORT_ID_LENGTH));
      }

      // Should contain methods and paths
      expect(output).toContain("GET");
      expect(output).toContain("POST");
      expect(output).toContain("/users");
      expect(output).toContain("/products/999");

      // Should contain summary line
      expect(output).toContain("Showing 3 request");
    });

    it("formatRequestDetail renders full request", async () => {
      const ids = seedRequests();

      const firstId = ids[0] ?? "";
      const request = await client.getRequest(firstId);
      expect(request).not.toBeNull();
      if (!request) return;

      const output = formatRequestDetail(request);

      expect(output).toContain("GET");
      expect(output).toContain("https://api.example.com/users");
      expect(output).toContain("200");
      expect(output).toContain("Request Headers");
      expect(output).toContain("Response Headers");
      expect(output).toContain("Response Body");
      expect(output).toContain("Alice");
    });

    it("formatSessionTable renders sessions", async () => {
      storage.registerSession("test-session", process.pid);

      const sessions = await client.listSessions();
      const output = formatSessionTable(sessions);

      expect(output).toContain("test-session");
      expect(output).toContain(String(process.pid));
      expect(output).toMatch(/\d+ session/);
    });
  });

  describe("ID prefix matching", () => {
    it("finds request by full ID", async () => {
      const ids = seedRequests();

      const firstId = ids[0] ?? "";
      const request = await client.getRequest(firstId);
      expect(request).not.toBeNull();
      expect(request?.id).toBe(ids[0]);
    });

    it("can implement prefix matching via summary list", async () => {
      const ids = seedRequests();
      const prefix = (ids[0] ?? "").slice(0, SHORT_ID_LENGTH);

      // Simulate what the request command does: list then filter by prefix
      const summaries = await client.listRequestsSummary({ limit: 1000 });
      const matches = summaries.filter((s) => s.id.startsWith(prefix));

      expect(matches).toHaveLength(1);
      expect(matches[0]?.id).toBe(ids[0]);
    });
  });
});
