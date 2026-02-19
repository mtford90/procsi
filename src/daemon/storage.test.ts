import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import Database from "better-sqlite3";
import { RequestRepository } from "./storage.js";
import { DEFAULT_MAX_STORED_REQUESTS } from "../shared/config.js";

describe("RequestRepository", () => {
  let tempDir: string;
  let dbPath: string;
  let repo: RequestRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-storage-test-"));
    dbPath = path.join(tempDir, "test.db");
    repo = new RequestRepository(dbPath);
  });

  afterEach(() => {
    repo.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  describe("sessions", () => {
    it("registers a session with label", () => {
      const session = repo.registerSession("my-label", 12345);

      expect(session.id).toBeDefined();
      expect(session.label).toBe("my-label");
      expect(session.token).toMatch(/^[a-f0-9]{32}$/);
      expect(session.pid).toBe(12345);
      expect(session.startedAt).toBeDefined();
    });

    it("registers a session without label", () => {
      const session = repo.registerSession(undefined, 12345);

      expect(session.id).toBeDefined();
      expect(session.label).toBeUndefined();
    });

    it("retrieves a session by ID", () => {
      const created = repo.registerSession("test", 1);

      const retrieved = repo.getSession(created.id);

      expect(retrieved).toEqual({
        id: created.id,
        label: created.label,
        source: created.source,
        pid: created.pid,
        startedAt: created.startedAt,
      });
    });

    it("returns undefined for non-existent session", () => {
      const result = repo.getSession("non-existent");
      expect(result).toBeUndefined();
    });

    it("lists all sessions", () => {
      repo.registerSession("first", 1);
      repo.registerSession("second", 2);

      const sessions = repo.listSessions();

      expect(sessions).toHaveLength(2);
    });

    it("registers a session with source", () => {
      const session = repo.registerSession("my-label", 12345, "node");
      expect(session.source).toBe("node");

      const retrieved = repo.getSession(session.id);
      expect(retrieved?.source).toBe("node");
    });

    it("registers a session without source", () => {
      const session = repo.registerSession("my-label", 12345);
      expect(session.source).toBeUndefined();
    });

    it("lists sessions with source", () => {
      repo.registerSession("first", 1, "node");
      repo.registerSession("second", 2, "python");

      const sessions = repo.listSessions();
      expect(sessions).toHaveLength(2);

      // Check that both sources are present (order may vary)
      const sources = sessions.map((s) => s.source).sort();
      expect(sources).toEqual(["node", "python"]);
    });

    it("validates session token and returns source for trusted headers", () => {
      const session = repo.registerSession("my-label", 12345, "node");
      expect(repo.getSessionAuth(session.id, session.token)).toEqual({ source: "node" });
      expect(repo.getSessionAuth(session.id, "invalid-token")).toBeUndefined();
    });
  });

  describe("ensureSession", () => {
    it("creates a new session with specified ID", () => {
      const session = repo.ensureSession("my-id", "my-label", 12345);

      expect(session.id).toBe("my-id");
      expect(session.label).toBe("my-label");
      expect(session.pid).toBe(12345);
      expect(session.startedAt).toBeDefined();
    });

    it("returns existing session if ID already exists", () => {
      const first = repo.ensureSession("same-id", "first", 111);
      const second = repo.ensureSession("same-id", "second", 222);

      // Should return the original session, not update it
      expect(second.id).toBe("same-id");
      expect(second.label).toBe("first"); // Original label preserved
      expect(second.pid).toBe(111); // Original PID preserved
      expect(second.startedAt).toBe(first.startedAt);
    });

    it("uses process.pid as default when pid not specified", () => {
      const session = repo.ensureSession("default-pid-id", "test");

      expect(session.pid).toBe(process.pid);
    });

    it("creates a session with source", () => {
      const session = repo.ensureSession("src-id", "label", 123, "zsh");
      expect(session.source).toBe("zsh");

      const retrieved = repo.getSession("src-id");
      expect(retrieved?.source).toBe("zsh");
    });
  });

  describe("requests", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repo.registerSession("test", 1);
      sessionId = session.id;
    });

    it("saves and retrieves a request", () => {
      const id = repo.saveRequest({
        sessionId,
        label: "api",
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: { "Content-Type": "application/json" },
      });

      const request = repo.getRequest(id);

      expect(request).toBeDefined();
      expect(request?.method).toBe("GET");
      expect(request?.url).toBe("https://api.example.com/users");
      expect(request?.requestHeaders).toEqual({ "Content-Type": "application/json" });
    });

    it("saves request with body", () => {
      const body = Buffer.from('{"name":"test"}');
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: {},
        requestBody: body,
      });

      const request = repo.getRequest(id);

      expect(request?.requestBody).toEqual(body);
    });

    it("updates request with response", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: {},
      });

      repo.updateRequestResponse(id, {
        status: 200,
        headers: { "Content-Type": "application/json" },
        body: Buffer.from('[{"id":1}]'),
        durationMs: 150,
      });

      const request = repo.getRequest(id);

      expect(request?.responseStatus).toBe(200);
      expect(request?.responseHeaders).toEqual({ "Content-Type": "application/json" });
      expect(request?.responseBody?.toString()).toBe('[{"id":1}]');
      expect(request?.durationMs).toBe(150);
    });

    it("lists requests", () => {
      repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: {},
      });

      repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: {},
      });

      const requests = repo.listRequests();

      expect(requests).toHaveLength(2);
    });

    it("filters requests by session", () => {
      const otherSession = repo.registerSession("other", 2);

      repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/a",
        host: "api.example.com",
        path: "/a",
        requestHeaders: {},
      });

      repo.saveRequest({
        sessionId: otherSession.id,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/b",
        host: "api.example.com",
        path: "/b",
        requestHeaders: {},
      });

      const requests = repo.listRequests({ sessionId });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.path).toBe("/a");
    });

    it("filters requests by label", () => {
      repo.saveRequest({
        sessionId,
        label: "api",
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/a",
        host: "api.example.com",
        path: "/a",
        requestHeaders: {},
      });

      repo.saveRequest({
        sessionId,
        label: "web",
        timestamp: Date.now(),
        method: "GET",
        url: "https://web.example.com/b",
        host: "web.example.com",
        path: "/b",
        requestHeaders: {},
      });

      const requests = repo.listRequests({ label: "api" });

      expect(requests).toHaveLength(1);
      expect(requests[0]?.host).toBe("api.example.com");
    });

    it("paginates requests with limit and offset", () => {
      for (let i = 0; i < 5; i++) {
        repo.saveRequest({
          sessionId,
          timestamp: Date.now() + i,
          method: "GET",
          url: `https://api.example.com/${i}`,
          host: "api.example.com",
          path: `/${i}`,
          requestHeaders: {},
        });
      }

      const page1 = repo.listRequests({ limit: 2 });
      const page2 = repo.listRequests({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
    });

    it("counts requests", () => {
      repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/a",
        host: "api.example.com",
        path: "/a",
        requestHeaders: {},
      });

      repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/b",
        host: "api.example.com",
        path: "/b",
        requestHeaders: {},
      });

      const count = repo.countRequests();

      expect(count).toBe(2);
    });

    it("counts requests with filter", () => {
      repo.saveRequest({
        sessionId,
        label: "api",
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/a",
        host: "api.example.com",
        path: "/a",
        requestHeaders: {},
      });

      repo.saveRequest({
        sessionId,
        label: "web",
        timestamp: Date.now(),
        method: "GET",
        url: "https://web.example.com/b",
        host: "web.example.com",
        path: "/b",
        requestHeaders: {},
      });

      const count = repo.countRequests({ label: "api" });

      expect(count).toBe(1);
    });

    it("clears all requests", () => {
      repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/a",
        host: "api.example.com",
        path: "/a",
        requestHeaders: {},
      });

      repo.clearRequests();

      const count = repo.countRequests();
      expect(count).toBe(0);
    });
  });

  describe("filtering", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repo.registerSession("test", 1);
      sessionId = session.id;
    });

    /**
     * Insert a batch of requests covering different methods and status codes
     * to give the filter tests something to work with.
     */
    function seedRequests(): void {
      const entries = [
        { method: "GET", url: "https://api.example.com/users", path: "/users", status: 200 },
        { method: "GET", url: "https://api.example.com/posts", path: "/posts", status: 200 },
        { method: "POST", url: "https://api.example.com/users", path: "/users", status: 201 },
        { method: "PUT", url: "https://api.example.com/users/1", path: "/users/1", status: 200 },
        { method: "DELETE", url: "https://api.example.com/users/1", path: "/users/1", status: 404 },
        { method: "GET", url: "https://api.example.com/health", path: "/health", status: 301 },
        { method: "POST", url: "https://api.example.com/login", path: "/login", status: 500 },
      ];

      for (const entry of entries) {
        const id = repo.saveRequest({
          sessionId,
          timestamp: Date.now(),
          method: entry.method,
          url: entry.url,
          host: "api.example.com",
          path: entry.path,
          requestHeaders: {},
        });
        repo.updateRequestResponse(id, {
          status: entry.status,
          headers: {},
          durationMs: 10,
        });
      }
    }

    it("filters by single method", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { methods: ["POST"] } });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.method === "POST")).toBe(true);
    });

    it("filters by multiple methods", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { methods: ["GET", "DELETE"] } });
      expect(results).toHaveLength(4);
      expect(results.every((r) => r.method === "GET" || r.method === "DELETE")).toBe(true);
    });

    it("filters by status range 2xx", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { statusRange: "2xx" } });
      expect(results).toHaveLength(4);
      expect(
        results.every(
          (r) => r.responseStatus !== undefined && r.responseStatus >= 200 && r.responseStatus < 300
        )
      ).toBe(true);
    });

    it("filters by status range 4xx", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { statusRange: "4xx" } });
      expect(results).toHaveLength(1);
      expect(results[0]?.responseStatus).toBe(404);
    });

    it("filters by text search matching URL", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { search: "users" } });
      expect(results).toHaveLength(4);
      expect(results.every((r) => r.url.includes("users"))).toBe(true);
    });

    it("filters by text search matching path", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { search: "/health" } });
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe("/health");
    });

    it("filters by regex pattern on full URL", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { regex: "users/\\d+$" } });
      expect(results).toHaveLength(2);
      expect(results.every((r) => /users\/\d+$/.test(r.url))).toBe(true);
    });

    it("filters by regex pattern with flags", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { regex: "USERS", regexFlags: "i" } });
      expect(results).toHaveLength(4);
      expect(results.every((r) => r.url.toLowerCase().includes("users"))).toBe(true);
    });

    it("accepts slash literals in regex filters", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { regex: "/users\\/\\d+$/" } });
      expect(results).toHaveLength(2);
    });

    it("throws on invalid regex filters", () => {
      seedRequests();
      expect(() => repo.listRequests({ filter: { regex: "users([" } })).toThrow(
        'Invalid regex pattern "users(["'
      );
    });

    it("combines regex with other filters", () => {
      seedRequests();
      const results = repo.listRequests({
        filter: { methods: ["PUT"], regex: "users/\\d+$" },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.method).toBe("PUT");
      expect(results[0]?.path).toBe("/users/1");
    });

    it("filters by multi-term search (AND logic)", () => {
      seedRequests();
      // "users" AND "POST" would match URL containing "users" — but we're matching URL/path
      // Use terms that narrow to a single result: "users" matches 4, "1" narrows to 2 (/users/1)
      const results = repo.listRequests({ filter: { search: "users 1" } });
      expect(results).toHaveLength(2); // PUT /users/1 and DELETE /users/1
      expect(results.every((r) => r.url.includes("users") && r.url.includes("1"))).toBe(true);
    });

    it("multi-term search requires ALL terms to match", () => {
      seedRequests();
      // "health" matches 1, "login" matches 1 — no request matches both
      const results = repo.listRequests({ filter: { search: "health login" } });
      expect(results).toHaveLength(0);
    });

    it("single-term search still works as before", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { search: "users" } });
      expect(results).toHaveLength(4);
    });

    it("ignores extra whitespace in multi-term search", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { search: "  users   1  " } });
      expect(results).toHaveLength(2);
    });

    it("whitespace-only search returns all results", () => {
      seedRequests();
      const allResults = repo.listRequests({});
      const results = repo.listRequests({ filter: { search: "   " } });
      expect(results).toHaveLength(allResults.length);
    });

    it("combines method + status + search filters", () => {
      seedRequests();
      const results = repo.listRequests({
        filter: { methods: ["GET"], statusRange: "2xx", search: "users" },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.method).toBe("GET");
      expect(results[0]?.path).toBe("/users");
      expect(results[0]?.responseStatus).toBe(200);
    });

    it("escapes SQL wildcards in search term", () => {
      // Insert a request with a literal % in the URL
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/search?q=100%25done",
        host: "api.example.com",
        path: "/search?q=100%25done",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id, { status: 200, headers: {}, durationMs: 10 });

      // Also insert a request that should NOT match
      const id2 = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/other",
        host: "api.example.com",
        path: "/other",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id2, { status: 200, headers: {}, durationMs: 10 });

      // Searching for literal '%' should only match the URL containing it
      const results = repo.listRequests({ filter: { search: "%" } });
      expect(results).toHaveLength(1);
      expect(results[0]?.url).toContain("%");
    });

    it("escapes underscore wildcard in search term", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/my_endpoint",
        host: "api.example.com",
        path: "/my_endpoint",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id, { status: 200, headers: {}, durationMs: 10 });

      const id2 = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/myXendpoint",
        host: "api.example.com",
        path: "/myXendpoint",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id2, { status: 200, headers: {}, durationMs: 10 });

      // Searching for '_' should only match the URL containing a literal underscore
      const results = repo.listRequests({ filter: { search: "_" } });
      expect(results).toHaveLength(1);
      expect(results[0]?.url).toContain("_");
    });

    it("returns all results with empty filter", () => {
      seedRequests();
      const allResults = repo.listRequests({});
      const filteredResults = repo.listRequests({ filter: {} });
      expect(filteredResults).toHaveLength(allResults.length);
    });

    it("returns all results with undefined filter", () => {
      seedRequests();
      const allResults = repo.listRequests({});
      const filteredResults = repo.listRequests({ filter: undefined });
      expect(filteredResults).toHaveLength(allResults.length);
    });

    it("works with listRequestsSummary", () => {
      seedRequests();
      const results = repo.listRequestsSummary({ filter: { methods: ["POST"] } });
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.method === "POST")).toBe(true);
    });

    it("works with countRequests", () => {
      seedRequests();
      const count = repo.countRequests({ filter: { methods: ["POST"] } });
      expect(count).toBe(2);
    });

    it("filters by exact status code", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { statusRange: "404" } });
      expect(results).toHaveLength(1);
      expect(results[0]?.responseStatus).toBe(404);
    });

    it("filters by numeric status range", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { statusRange: "200-201" } });
      expect(results).toHaveLength(4);
      expect(
        results.every(
          (r) =>
            r.responseStatus !== undefined && r.responseStatus >= 200 && r.responseStatus <= 201
        )
      ).toBe(true);
    });

    it("Nxx status range still works (backward compat)", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { statusRange: "3xx" } });
      expect(results).toHaveLength(1);
      expect(results[0]?.responseStatus).toBe(301);
    });

    it("filters by exact host match", () => {
      // Seed requests go to api.example.com — add one to a different host
      seedRequests();
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://other.example.com/page",
        host: "other.example.com",
        path: "/page",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id, { status: 200, headers: {}, durationMs: 10 });

      const results = repo.listRequests({ filter: { host: "other.example.com" } });
      expect(results).toHaveLength(1);
      expect(results[0]?.host).toBe("other.example.com");
    });

    it("filters by host suffix match", () => {
      seedRequests();
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://cdn.other.com/asset",
        host: "cdn.other.com",
        path: "/asset",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id, { status: 200, headers: {}, durationMs: 10 });

      // ".example.com" should match "api.example.com" from seed, not "cdn.other.com"
      const results = repo.listRequests({ filter: { host: ".example.com" } });
      expect(results).toHaveLength(7); // all seed requests
      expect(results.every((r) => r.host.endsWith(".example.com"))).toBe(true);
    });

    it("filters by path prefix", () => {
      seedRequests();
      const results = repo.listRequests({ filter: { pathPrefix: "/users" } });
      expect(results).toHaveLength(4);
      expect(results.every((r) => r.path.startsWith("/users"))).toBe(true);
    });

    it("escapes SQL wildcards in path prefix", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/a%b/test",
        host: "api.example.com",
        path: "/a%b/test",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id, { status: 200, headers: {}, durationMs: 10 });

      const id2 = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/aXb/test",
        host: "api.example.com",
        path: "/aXb/test",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id2, { status: 200, headers: {}, durationMs: 10 });

      // Literal "%" in prefix should only match "/a%b/test"
      const results = repo.listRequests({ filter: { pathPrefix: "/a%b" } });
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe("/a%b/test");
    });

    it("filters by since (inclusive lower bound)", () => {
      const baseTime = 1700000000000;
      const id1 = repo.saveRequest({
        sessionId,
        timestamp: baseTime,
        method: "GET",
        url: "https://api.example.com/old",
        host: "api.example.com",
        path: "/old",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id1, { status: 200, headers: {}, durationMs: 10 });

      const id2 = repo.saveRequest({
        sessionId,
        timestamp: baseTime + 1000,
        method: "GET",
        url: "https://api.example.com/new",
        host: "api.example.com",
        path: "/new",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id2, { status: 200, headers: {}, durationMs: 10 });

      // since is inclusive — exactly at baseTime+1000 should include id2
      const results = repo.listRequests({ filter: { since: baseTime + 1000 } });
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe("/new");
    });

    it("filters by before (exclusive upper bound)", () => {
      const baseTime = 1700000000000;
      const id1 = repo.saveRequest({
        sessionId,
        timestamp: baseTime,
        method: "GET",
        url: "https://api.example.com/old",
        host: "api.example.com",
        path: "/old",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id1, { status: 200, headers: {}, durationMs: 10 });

      const id2 = repo.saveRequest({
        sessionId,
        timestamp: baseTime + 1000,
        method: "GET",
        url: "https://api.example.com/new",
        host: "api.example.com",
        path: "/new",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id2, { status: 200, headers: {}, durationMs: 10 });

      // before is exclusive — exactly at baseTime+1000 should exclude id2
      const results = repo.listRequests({ filter: { before: baseTime + 1000 } });
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe("/old");
    });

    it("filters by since + before combined (time window)", () => {
      const baseTime = 1700000000000;
      for (let i = 0; i < 5; i++) {
        const id = repo.saveRequest({
          sessionId,
          timestamp: baseTime + i * 1000,
          method: "GET",
          url: `https://api.example.com/t${i}`,
          host: "api.example.com",
          path: `/t${i}`,
          requestHeaders: {},
        });
        repo.updateRequestResponse(id, { status: 200, headers: {}, durationMs: 10 });
      }

      // Window: [baseTime+1000, baseTime+3000) → t1, t2
      const results = repo.listRequests({
        filter: { since: baseTime + 1000, before: baseTime + 3000 },
      });
      expect(results).toHaveLength(2);
    });

    it("returns empty when since equals before", () => {
      const baseTime = 1700000000000;
      const id = repo.saveRequest({
        sessionId,
        timestamp: baseTime,
        method: "GET",
        url: "https://api.example.com/x",
        host: "api.example.com",
        path: "/x",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id, { status: 200, headers: {}, durationMs: 10 });

      // since >= baseTime AND timestamp < baseTime → impossible
      const results = repo.listRequests({
        filter: { since: baseTime, before: baseTime },
      });
      expect(results).toHaveLength(0);
    });

    it("combines host + method + time filters", () => {
      const baseTime = 1700000000000;
      // POST to api.example.com at baseTime
      const id1 = repo.saveRequest({
        sessionId,
        timestamp: baseTime,
        method: "POST",
        url: "https://api.example.com/data",
        host: "api.example.com",
        path: "/data",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id1, { status: 201, headers: {}, durationMs: 10 });

      // GET to api.example.com at baseTime+1000
      const id2 = repo.saveRequest({
        sessionId,
        timestamp: baseTime + 1000,
        method: "GET",
        url: "https://api.example.com/data",
        host: "api.example.com",
        path: "/data",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id2, { status: 200, headers: {}, durationMs: 10 });

      // POST to other.com at baseTime
      const id3 = repo.saveRequest({
        sessionId,
        timestamp: baseTime,
        method: "POST",
        url: "https://other.com/data",
        host: "other.com",
        path: "/data",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id3, { status: 201, headers: {}, durationMs: 10 });

      const results = repo.listRequests({
        filter: {
          methods: ["POST"],
          host: "api.example.com",
          since: baseTime,
          before: baseTime + 500,
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(id1);
    });
  });

  describe("source filtering", () => {
    it("saves and retrieves requests with source", () => {
      const session = repo.registerSession("test", 1, "node");
      const id = repo.saveRequest({
        sessionId: session.id,
        source: "node",
        timestamp: Date.now(),
        method: "GET",
        url: "https://example.com",
        host: "example.com",
        path: "/",
        requestHeaders: {},
      });

      const request = repo.getRequest(id);
      expect(request?.source).toBe("node");
    });

    it("includes source in request summaries", () => {
      const session = repo.registerSession("test", 1, "node");
      repo.saveRequest({
        sessionId: session.id,
        source: "node",
        timestamp: Date.now(),
        method: "GET",
        url: "https://example.com",
        host: "example.com",
        path: "/",
        requestHeaders: {},
      });

      const summaries = repo.listRequestsSummary();
      expect(summaries).toHaveLength(1);
      expect(summaries[0].source).toBe("node");
    });

    it("filters requests by source", () => {
      const session1 = repo.registerSession("s1", 1, "node");
      const session2 = repo.registerSession("s2", 2, "python");

      repo.saveRequest({
        sessionId: session1.id,
        source: "node",
        timestamp: Date.now(),
        method: "GET",
        url: "https://example.com/node",
        host: "example.com",
        path: "/node",
        requestHeaders: {},
      });

      repo.saveRequest({
        sessionId: session2.id,
        source: "python",
        timestamp: Date.now(),
        method: "POST",
        url: "https://example.com/python",
        host: "example.com",
        path: "/python",
        requestHeaders: {},
      });

      const nodeRequests = repo.listRequestsSummary({ filter: { source: "node" } });
      expect(nodeRequests).toHaveLength(1);
      expect(nodeRequests[0].source).toBe("node");

      const pythonRequests = repo.listRequestsSummary({ filter: { source: "python" } });
      expect(pythonRequests).toHaveLength(1);
      expect(pythonRequests[0].source).toBe("python");

      const allRequests = repo.listRequestsSummary();
      expect(allRequests).toHaveLength(2);
    });

    it("source filter works with count", () => {
      const session = repo.registerSession("test", 1, "node");
      repo.saveRequest({
        sessionId: session.id,
        source: "node",
        timestamp: Date.now(),
        method: "GET",
        url: "https://example.com",
        host: "example.com",
        path: "/",
        requestHeaders: {},
      });
      repo.saveRequest({
        sessionId: session.id,
        source: "node",
        timestamp: Date.now(),
        method: "GET",
        url: "https://example.com/2",
        host: "example.com",
        path: "/2",
        requestHeaders: {},
      });

      expect(repo.countRequests({ filter: { source: "node" } })).toBe(2);
      expect(repo.countRequests({ filter: { source: "python" } })).toBe(0);
    });
  });

  describe("listRequestsSummary", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repo.registerSession("test", 1);
      sessionId = session.id;
    });

    it("returns summaries without body data", () => {
      const requestBody = Buffer.from('{"name":"test"}');
      const responseBody = Buffer.from('{"id":1}');

      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: { "Content-Type": "application/json" },
        requestBody,
      });

      repo.updateRequestResponse(id, {
        status: 201,
        headers: { "Content-Type": "application/json" },
        body: responseBody,
        durationMs: 100,
      });

      const summaries = repo.listRequestsSummary();

      expect(summaries).toHaveLength(1);
      const summary = summaries[0];
      expect(summary).toBeDefined();

      // Should have metadata
      expect(summary?.id).toBe(id);
      expect(summary?.method).toBe("POST");
      expect(summary?.url).toBe("https://api.example.com/users");
      expect(summary?.responseStatus).toBe(201);
      expect(summary?.durationMs).toBe(100);

      // Should have body sizes
      expect(summary?.requestBodySize).toBe(requestBody.length);
      expect(summary?.responseBodySize).toBe(responseBody.length);

      // Should NOT have body data (these fields don't exist on summary type)
      if (summary) {
        expect("requestBody" in summary).toBe(false);
        expect("responseBody" in summary).toBe(false);
        expect("requestHeaders" in summary).toBe(false);
        expect("responseHeaders" in summary).toBe(false);
      }
    });

    it("returns zero for null body sizes", () => {
      repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: {},
      });

      const summaries = repo.listRequestsSummary();

      expect(summaries[0]?.requestBodySize).toBe(0);
      expect(summaries[0]?.responseBodySize).toBe(0);
    });

    it("filters by session", () => {
      const otherSession = repo.registerSession("other", 2);

      repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/a",
        host: "api.example.com",
        path: "/a",
        requestHeaders: {},
      });

      repo.saveRequest({
        sessionId: otherSession.id,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/b",
        host: "api.example.com",
        path: "/b",
        requestHeaders: {},
      });

      const summaries = repo.listRequestsSummary({ sessionId });

      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.path).toBe("/a");
    });

    it("supports pagination", () => {
      for (let i = 0; i < 5; i++) {
        repo.saveRequest({
          sessionId,
          timestamp: Date.now() + i,
          method: "GET",
          url: `https://api.example.com/${i}`,
          host: "api.example.com",
          path: `/${i}`,
          requestHeaders: {},
        });
      }

      const page1 = repo.listRequestsSummary({ limit: 2 });
      const page2 = repo.listRequestsSummary({ limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
    });
  });

  describe("migrations", () => {
    // Old schema without truncation columns
    const OLD_SCHEMA = `
      CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY,
          label TEXT,
          pid INTEGER NOT NULL,
          started_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS requests (
          id TEXT PRIMARY KEY,
          session_id TEXT NOT NULL,
          label TEXT,
          timestamp INTEGER NOT NULL,
          method TEXT NOT NULL,
          url TEXT NOT NULL,
          host TEXT NOT NULL,
          path TEXT NOT NULL,
          request_headers TEXT,
          request_body BLOB,
          response_status INTEGER,
          response_headers TEXT,
          response_body BLOB,
          duration_ms INTEGER,
          created_at INTEGER DEFAULT (unixepoch()),
          FOREIGN KEY (session_id) REFERENCES sessions(id)
      );

      CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC);
      CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
      CREATE INDEX IF NOT EXISTS idx_requests_label ON requests(label);
    `;

    it("applies migrations to old schema", () => {
      // Create a DB with the old schema (no truncation columns)
      const migrationDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-migration-test-"));
      const migrationDbPath = path.join(migrationDir, "old.db");

      const rawDb = new Database(migrationDbPath);
      rawDb.exec(OLD_SCHEMA);

      // Insert a row so it looks like an existing DB
      rawDb.exec(`
        INSERT INTO sessions (id, label, pid, started_at)
        VALUES ('s1', 'test', 1, 1000)
      `);
      rawDb.exec(`
        INSERT INTO requests (id, session_id, timestamp, method, url, host, path)
        VALUES ('r1', 's1', 1000, 'GET', 'http://example.com', 'example.com', '/')
      `);
      rawDb.close();

      // Open with RequestRepository — migrations should apply
      const migratedRepo = new RequestRepository(migrationDbPath);
      const request = migratedRepo.getRequest("r1");
      expect(request).toBeDefined();
      expect(request?.requestBodyTruncated).toBe(false);
      expect(request?.responseBodyTruncated).toBe(false);

      // Verify user_version was set to latest migration
      const checkDb = new Database(migrationDbPath);
      const version = checkDb.pragma("user_version", { simple: true });
      expect(version).toBe(11);
      checkDb.close();

      migratedRepo.close();
      fs.rmSync(migrationDir, { recursive: true, force: true });
    });

    it("skips migrations on fresh database", () => {
      // The default repo from beforeEach is a fresh DB
      const checkDb = new Database(dbPath);
      const version = checkDb.pragma("user_version", { simple: true });
      expect(version).toBe(11);
      checkDb.close();
    });

    it("is idempotent when opened multiple times", () => {
      const idempotentDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-idempotent-test-"));
      const idempotentDbPath = path.join(idempotentDir, "test.db");

      const repo1 = new RequestRepository(idempotentDbPath);
      repo1.close();

      // Opening again should not throw
      const repo2 = new RequestRepository(idempotentDbPath);
      repo2.close();

      fs.rmSync(idempotentDir, { recursive: true, force: true });
    });

    it("propagates real errors instead of swallowing them", () => {
      const errorDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-error-test-"));
      const errorDbPath = path.join(errorDir, "error.db");

      // Create an old-schema DB with data and only ONE of the truncation columns.
      // The column detection requires BOTH to stamp as v1, so migration v1 will run
      // and fail on the duplicate column — verifying errors propagate.
      const rawDb = new Database(errorDbPath);
      rawDb.exec(OLD_SCHEMA);
      rawDb.exec(`
        INSERT INTO sessions (id, label, pid, started_at)
        VALUES ('s1', 'test', 1, 1000)
      `);
      rawDb.exec(`
        INSERT INTO requests (id, session_id, timestamp, method, url, host, path)
        VALUES ('r1', 's1', 1000, 'GET', 'http://example.com', 'example.com', '/')
      `);
      // Add only the first column — migration v1 will try to add it again and fail
      rawDb.exec("ALTER TABLE requests ADD COLUMN request_body_truncated INTEGER DEFAULT 0");
      rawDb.close();

      expect(() => new RequestRepository(errorDbPath)).toThrow();

      fs.rmSync(errorDir, { recursive: true, force: true });
    });

    it("rolls back all migrations on failure", () => {
      const rollbackDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-rollback-test-"));
      const rollbackDbPath = path.join(rollbackDir, "rollback.db");

      // Create a DB with old schema and data
      const rawDb = new Database(rollbackDbPath);
      rawDb.exec(OLD_SCHEMA);
      rawDb.exec(`
        INSERT INTO sessions (id, label, pid, started_at)
        VALUES ('s1', 'test', 1, 1000)
      `);
      rawDb.exec(`
        INSERT INTO requests (id, session_id, timestamp, method, url, host, path)
        VALUES ('r1', 's1', 1000, 'GET', 'http://example.com', 'example.com', '/')
      `);
      rawDb.close();

      // Open will try migration v1 which should succeed on this old schema
      // To test rollback, we need a multi-migration scenario where the second fails.
      // Apply v1 manually and set version to 0 so it tries again, causing failure.
      const setupDb = new Database(rollbackDbPath);
      setupDb.exec("ALTER TABLE requests ADD COLUMN request_body_truncated INTEGER DEFAULT 0");
      // Leave response_body_truncated missing — so v1 migration will partially succeed
      // then fail on the second ALTER (request_body_truncated already exists)
      // Actually, the whole v1 SQL runs as one exec, so the first ALTER will fail.
      // Let's instead not add request_body_truncated but add response_body_truncated:
      setupDb.exec("ALTER TABLE requests ADD COLUMN response_body_truncated INTEGER DEFAULT 0");
      // Now v1 migration will succeed on the first ALTER but fail on the second (duplicate column)
      // Wait — both are in the same exec() call. SQLite exec runs them sequentially
      // and stops at first error. So request_body_truncated will be added, then
      // response_body_truncated will fail. The transaction should roll back both.
      setupDb.close();

      // Undo our manual changes and set up correctly for the test
      const resetDb = new Database(rollbackDbPath);
      // Drop and recreate to get clean state
      resetDb.exec("DROP TABLE requests");
      resetDb.exec("DROP TABLE sessions");
      resetDb.exec(OLD_SCHEMA);
      resetDb.exec(`
        INSERT INTO sessions (id, label, pid, started_at)
        VALUES ('s1', 'test', 1, 1000)
      `);
      resetDb.exec(`
        INSERT INTO requests (id, session_id, timestamp, method, url, host, path)
        VALUES ('r1', 's1', 1000, 'GET', 'http://example.com', 'example.com', '/')
      `);
      // Add only response_body_truncated — so v1's second ALTER will fail
      resetDb.exec("ALTER TABLE requests ADD COLUMN response_body_truncated INTEGER DEFAULT 0");
      resetDb.pragma("user_version = 0");
      resetDb.close();

      // RequestRepository should fail because migration v1 will try to add
      // response_body_truncated which already exists
      expect(() => new RequestRepository(rollbackDbPath)).toThrow();

      // Verify version stayed at 0 (transaction rolled back)
      const checkDb = new Database(rollbackDbPath);
      const version = checkDb.pragma("user_version", { simple: true });
      expect(version).toBe(0);

      // Verify request_body_truncated was NOT added (rolled back)
      const columns = checkDb.prepare("PRAGMA table_info(requests)").all() as { name: string }[];
      const columnNames = columns.map((c) => c.name);
      expect(columnNames).not.toContain("request_body_truncated");

      checkDb.close();
      fs.rmSync(rollbackDir, { recursive: true, force: true });
    });
  });

  describe("header filtering", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repo.registerSession("test", 1);
      sessionId = session.id;
    });

    function seedHeaderRequests(): void {
      // Request with content-type header on request
      const id1 = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/data",
        host: "api.example.com",
        path: "/data",
        requestHeaders: { "content-type": "application/json", "x-custom": "req-value" },
        requestBody: Buffer.from('{"a":1}'),
      });
      repo.updateRequestResponse(id1, {
        status: 200,
        headers: { "content-type": "text/html", "x-custom": "res-value" },
        body: Buffer.from("<h1>OK</h1>"),
        durationMs: 10,
      });

      // Request with x-api-key header
      const id2 = repo.saveRequest({
        sessionId,
        timestamp: Date.now() + 1,
        method: "GET",
        url: "https://api.example.com/secure",
        host: "api.example.com",
        path: "/secure",
        requestHeaders: { "x-api-key": "secret-123" },
      });
      repo.updateRequestResponse(id2, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from("{}"),
        durationMs: 5,
      });

      // Request with no special headers
      const id3 = repo.saveRequest({
        sessionId,
        timestamp: Date.now() + 2,
        method: "GET",
        url: "https://api.example.com/plain",
        host: "api.example.com",
        path: "/plain",
        requestHeaders: { accept: "text/html" },
      });
      repo.updateRequestResponse(id3, {
        status: 200,
        headers: { "content-type": "text/plain" },
        body: Buffer.from("hello"),
        durationMs: 3,
      });
    }

    it("filters by header name only (existence check)", () => {
      seedHeaderRequests();
      const results = repo.listRequests({
        filter: { headerName: "x-api-key" },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe("/secure");
    });

    it("filters by header name + value", () => {
      seedHeaderRequests();
      const results = repo.listRequests({
        filter: { headerName: "x-custom", headerValue: "req-value" },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe("/data");
    });

    it("filters by response target", () => {
      seedHeaderRequests();
      const results = repo.listRequests({
        filter: { headerName: "x-custom", headerTarget: "response" },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe("/data");
    });

    it("filters by both target (default) matches request or response", () => {
      seedHeaderRequests();
      // x-custom exists on both request and response of /data
      const results = repo.listRequests({
        filter: { headerName: "x-custom" },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe("/data");
    });

    it("is case-insensitive for header name", () => {
      seedHeaderRequests();
      const results = repo.listRequests({
        filter: { headerName: "X-API-KEY" },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe("/secure");
    });

    it("returns empty for non-existent header", () => {
      seedHeaderRequests();
      const results = repo.listRequests({
        filter: { headerName: "x-nonexistent" },
      });
      expect(results).toHaveLength(0);
    });

    it("combines header filter with other filters", () => {
      seedHeaderRequests();
      const results = repo.listRequests({
        filter: { headerName: "content-type", methods: ["POST"] },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.method).toBe("POST");
    });

    it("handles hyphenated header names", () => {
      seedHeaderRequests();
      const results = repo.listRequests({
        filter: {
          headerName: "content-type",
          headerValue: "application/json",
          headerTarget: "request",
        },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.path).toBe("/data");
    });
  });

  describe("searchBodies", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repo.registerSession("test", 1);
      sessionId = session.id;
    });

    it("finds text in request body", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"name":"Alice"}'),
      });
      repo.updateRequestResponse(id, {
        status: 201,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"id":1}'),
        durationMs: 50,
      });

      const results = repo.searchBodies({ query: "Alice" });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(id);
    });

    it("finds text in response body", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"users":["Bob"]}'),
        durationMs: 30,
      });

      const results = repo.searchBodies({ query: "Bob" });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(id);
    });

    it("supports request-only body search via target=request", () => {
      const requestMatchId = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/request-match",
        host: "api.example.com",
        path: "/request-match",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"message":"needle"}'),
      });
      repo.updateRequestResponse(requestMatchId, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"message":"other"}'),
        durationMs: 10,
      });

      const responseMatchId = repo.saveRequest({
        sessionId,
        timestamp: Date.now() + 1,
        method: "GET",
        url: "https://api.example.com/response-match",
        host: "api.example.com",
        path: "/response-match",
        requestHeaders: {},
      });
      repo.updateRequestResponse(responseMatchId, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"message":"needle"}'),
        durationMs: 10,
      });

      const results = repo.searchBodies({ query: "needle", target: "request" });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(requestMatchId);
    });

    it("supports response-only body search via target=response", () => {
      const requestMatchId = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/request-match",
        host: "api.example.com",
        path: "/request-match",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"message":"needle"}'),
      });
      repo.updateRequestResponse(requestMatchId, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"message":"other"}'),
        durationMs: 10,
      });

      const responseMatchId = repo.saveRequest({
        sessionId,
        timestamp: Date.now() + 1,
        method: "GET",
        url: "https://api.example.com/response-match",
        host: "api.example.com",
        path: "/response-match",
        requestHeaders: {},
      });
      repo.updateRequestResponse(responseMatchId, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"message":"needle"}'),
        durationMs: 10,
      });

      const results = repo.searchBodies({ query: "needle", target: "response" });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(responseMatchId);
    });

    it("defaults to target=both when omitted", () => {
      const requestMatchId = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/request-match",
        host: "api.example.com",
        path: "/request-match",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"message":"needle"}'),
      });
      repo.updateRequestResponse(requestMatchId, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"message":"other"}'),
        durationMs: 10,
      });

      const responseMatchId = repo.saveRequest({
        sessionId,
        timestamp: Date.now() + 1,
        method: "GET",
        url: "https://api.example.com/response-match",
        host: "api.example.com",
        path: "/response-match",
        requestHeaders: {},
      });
      repo.updateRequestResponse(responseMatchId, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"message":"needle"}'),
        durationMs: 10,
      });

      const results = repo.searchBodies({ query: "needle" });
      expect(results).toHaveLength(2);
      const ids = new Set(results.map((result) => result.id));
      expect(ids.has(requestMatchId)).toBe(true);
      expect(ids.has(responseMatchId)).toBe(true);
    });

    it("returns empty when no match", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"name":"Alice"}'),
      });
      repo.updateRequestResponse(id, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from("{}"),
        durationMs: 10,
      });

      const results = repo.searchBodies({ query: "NonExistent" });
      expect(results).toHaveLength(0);
    });

    it("respects filters", () => {
      const id1 = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/users/1",
        host: "api.example.com",
        path: "/users/1",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"name":"shared-term"}'),
      });
      repo.updateRequestResponse(id1, {
        status: 201,
        headers: { "content-type": "application/json" },
        body: Buffer.from("{}"),
        durationMs: 10,
      });

      const id2 = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/search",
        host: "api.example.com",
        path: "/search",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id2, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"result":"shared-term"}'),
        durationMs: 10,
      });

      // Both match the query, but filter to POST only
      const results = repo.searchBodies({
        query: "shared-term",
        filter: { methods: ["POST"] },
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(id1);

      // Regex URL filter should also narrow correctly
      const regexFiltered = repo.searchBodies({
        query: "shared-term",
        filter: { regex: "users/\\d+$" },
      });
      expect(regexFiltered).toHaveLength(1);
      expect(regexFiltered[0]?.id).toBe(id1);
    });

    it("handles LIKE wildcards in query", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/data",
        host: "api.example.com",
        path: "/data",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"rate":"100%"}'),
      });
      repo.updateRequestResponse(id, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from("{}"),
        durationMs: 10,
      });

      // The % is a SQL wildcard — should be escaped
      const results = repo.searchBodies({ query: "100%" });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(id);
    });

    it("skips binary bodies when content-type is set", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://example.com/image.png",
        host: "example.com",
        path: "/image.png",
        requestHeaders: {},
      });
      // The response body happens to contain the search term as bytes,
      // but the content-type is binary — should not be searched
      repo.updateRequestResponse(id, {
        status: 200,
        headers: { "content-type": "image/png" },
        body: Buffer.from("findme"),
        durationMs: 10,
      });

      const results = repo.searchBodies({ query: "findme" });
      expect(results).toHaveLength(0);
    });

    it("searches rows with NULL content-type (legacy/unknown data)", () => {
      // Directly insert a row without content-type columns to simulate pre-migration data
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/legacy",
        host: "api.example.com",
        path: "/legacy",
        requestHeaders: {},
        requestBody: Buffer.from('{"legacy":"data"}'),
      });

      // No updateRequestResponse call — request_content_type is set but
      // response_content_type is NULL. The request_content_type will also be NULL
      // since no content-type header was provided. NULL = unknown = searched.
      const results = repo.searchBodies({ query: "legacy" });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(id);
    });

    it("supports pagination", () => {
      for (let i = 0; i < 5; i++) {
        const id = repo.saveRequest({
          sessionId,
          timestamp: Date.now() + i,
          method: "POST",
          url: `https://api.example.com/item/${i}`,
          host: "api.example.com",
          path: `/item/${i}`,
          requestHeaders: { "content-type": "application/json" },
          requestBody: Buffer.from(`{"index":${i},"common":"needle"}`),
        });
        repo.updateRequestResponse(id, {
          status: 200,
          headers: { "content-type": "application/json" },
          body: Buffer.from("{}"),
          durationMs: 10,
        });
      }

      const page1 = repo.searchBodies({ query: "needle", limit: 2 });
      const page2 = repo.searchBodies({ query: "needle", limit: 2, offset: 2 });

      expect(page1).toHaveLength(2);
      expect(page2).toHaveLength(2);
    });
  });

  describe("queryJsonBodies", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repo.registerSession("test", 1);
      sessionId = session.id;
    });

    function seedJsonRequests(): void {
      // JSON request body
      const id1 = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"name":"Alice","age":30}'),
      });
      repo.updateRequestResponse(id1, {
        status: 201,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"id":1,"name":"Alice"}'),
        durationMs: 50,
      });

      // Another JSON request
      const id2 = repo.saveRequest({
        sessionId,
        timestamp: Date.now() + 1,
        method: "POST",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"name":"Bob","age":25}'),
      });
      repo.updateRequestResponse(id2, {
        status: 201,
        headers: { "content-type": "application/json" },
        body: Buffer.from('{"id":2,"name":"Bob"}'),
        durationMs: 30,
      });

      // Non-JSON request (HTML response)
      const id3 = repo.saveRequest({
        sessionId,
        timestamp: Date.now() + 2,
        method: "GET",
        url: "https://example.com/page",
        host: "example.com",
        path: "/page",
        requestHeaders: {},
      });
      repo.updateRequestResponse(id3, {
        status: 200,
        headers: { "content-type": "text/html" },
        body: Buffer.from("<h1>Hello</h1>"),
        durationMs: 10,
      });
    }

    it("extracts values from request body", () => {
      seedJsonRequests();
      const results = repo.queryJsonBodies({
        jsonPath: "$.name",
        target: "request",
      });
      expect(results).toHaveLength(2);
      const values = results.map((r) => r.extractedValue);
      expect(values).toContain("Alice");
      expect(values).toContain("Bob");
    });

    it("extracts values from response body", () => {
      seedJsonRequests();
      const results = repo.queryJsonBodies({
        jsonPath: "$.id",
        target: "response",
      });
      expect(results).toHaveLength(2);
      const values = results.map((r) => r.extractedValue);
      expect(values).toContain(1);
      expect(values).toContain(2);
    });

    it("extracts from both request and response (default)", () => {
      seedJsonRequests();
      const results = repo.queryJsonBodies({
        jsonPath: "$.name",
      });
      // Both rows have "name" in request body; response body also has "name"
      expect(results).toHaveLength(2);
    });

    it("filters by extracted value", () => {
      seedJsonRequests();
      const results = repo.queryJsonBodies({
        jsonPath: "$.name",
        value: "Alice",
        target: "request",
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.extractedValue).toBe("Alice");
    });

    it("skips non-JSON bodies", () => {
      seedJsonRequests();
      // The HTML response should not be queried
      const results = repo.queryJsonBodies({
        jsonPath: "$.name",
        target: "response",
      });
      // Only the two JSON responses have "name"
      expect(results).toHaveLength(2);
      expect(results.every((r) => r.host === "api.example.com")).toBe(true);
    });

    it("returns empty for missing path", () => {
      seedJsonRequests();
      const results = repo.queryJsonBodies({
        jsonPath: "$.nonexistent",
        target: "request",
      });
      expect(results).toHaveLength(0);
    });

    it("handles nested paths", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/nested",
        host: "api.example.com",
        path: "/nested",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"user":{"address":{"city":"London"}}}'),
      });
      repo.updateRequestResponse(id, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from("{}"),
        durationMs: 5,
      });

      const results = repo.queryJsonBodies({
        jsonPath: "$.user.address.city",
        target: "request",
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.extractedValue).toBe("London");
    });

    it("handles array index paths", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/array",
        host: "api.example.com",
        path: "/array",
        requestHeaders: { "content-type": "application/json" },
        requestBody: Buffer.from('{"items":["first","second","third"]}'),
      });
      repo.updateRequestResponse(id, {
        status: 200,
        headers: { "content-type": "application/json" },
        body: Buffer.from("{}"),
        durationMs: 5,
      });

      const results = repo.queryJsonBodies({
        jsonPath: "$.items[1]",
        target: "request",
      });
      expect(results).toHaveLength(1);
      expect(results[0]?.extractedValue).toBe("second");
    });

    it("combines with other filters", () => {
      seedJsonRequests();
      const results = repo.queryJsonBodies({
        jsonPath: "$.name",
        target: "request",
        filter: { methods: ["POST"], host: "api.example.com" },
      });
      expect(results).toHaveLength(2);
    });

    it("supports pagination", () => {
      seedJsonRequests();
      const page1 = repo.queryJsonBodies({
        jsonPath: "$.name",
        target: "request",
        limit: 1,
      });
      const page2 = repo.queryJsonBodies({
        jsonPath: "$.name",
        target: "request",
        limit: 1,
        offset: 1,
      });
      expect(page1).toHaveLength(1);
      expect(page2).toHaveLength(1);
      expect(page1[0]?.extractedValue).not.toBe(page2[0]?.extractedValue);
    });
  });

  describe("eviction", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repo.registerSession("test", 1);
      sessionId = session.id;
    });

    /**
     * Insert N requests with sequential timestamps so ordering is deterministic.
     * Returns the IDs of the inserted requests (oldest first).
     */
    function insertRequests(count: number, repoInstance: RequestRepository = repo): string[] {
      const ids: string[] = [];
      for (let i = 0; i < count; i++) {
        const id = repoInstance.saveRequest({
          sessionId,
          timestamp: 1000 + i,
          method: "GET",
          url: `https://example.com/${i}`,
          host: "example.com",
          path: `/${i}`,
          requestHeaders: {},
        });
        ids.push(id);
      }
      return ids;
    }

    it("does not evict when below the cap", () => {
      // Default EVICTION_CHECK_INTERVAL is 100, insert fewer than that
      insertRequests(50);
      expect(repo.countRequests()).toBe(50);
    });

    it("evicts oldest when over cap", () => {
      // Use a small cap. Eviction runs every 100 inserts, so insert exactly
      // 200 to trigger eviction at insert 100 and again at 200. After the
      // second eviction the count should be exactly at the cap.
      const smallRepo = new RequestRepository(dbPath + "-evict", undefined, undefined, {
        maxStoredRequests: 50,
      });
      const evictSession = smallRepo.registerSession("test", 1);

      for (let i = 0; i < 200; i++) {
        smallRepo.saveRequest({
          sessionId: evictSession.id,
          timestamp: 1000 + i,
          method: "GET",
          url: `https://example.com/${i}`,
          host: "example.com",
          path: `/${i}`,
          requestHeaders: {},
        });
      }

      // Eviction fired at insert 200 — count should be exactly at cap
      const count = smallRepo.countRequests();
      expect(count).toBe(50);

      smallRepo.close();
      fs.unlinkSync(dbPath + "-evict");
    });

    it("preserves newest requests after eviction", () => {
      const smallRepo = new RequestRepository(dbPath + "-newest", undefined, undefined, {
        maxStoredRequests: 50,
      });
      const evictSession = smallRepo.registerSession("test", 1);

      for (let i = 0; i < 200; i++) {
        smallRepo.saveRequest({
          sessionId: evictSession.id,
          timestamp: 1000 + i,
          method: "GET",
          url: `https://example.com/${i}`,
          host: "example.com",
          path: `/${i}`,
          requestHeaders: {},
        });
      }

      // The newest 50 requests should survive (timestamps 1150-1199)
      const remaining = smallRepo.listRequests({ limit: 50 });
      const timestamps = remaining.map((r) => r.timestamp);
      for (const ts of timestamps) {
        expect(ts).toBeGreaterThanOrEqual(1150);
      }

      smallRepo.close();
      fs.unlinkSync(dbPath + "-newest");
    });

    it("keeps count at cap across multiple eviction cycles", () => {
      const smallRepo = new RequestRepository(dbPath + "-cycles", undefined, undefined, {
        maxStoredRequests: 50,
      });
      const evictSession = smallRepo.registerSession("test", 1);

      // Three full eviction cycles (300 inserts = 3 x EVICTION_CHECK_INTERVAL)
      for (let i = 0; i < 300; i++) {
        smallRepo.saveRequest({
          sessionId: evictSession.id,
          timestamp: 1000 + i,
          method: "GET",
          url: `https://example.com/${i}`,
          host: "example.com",
          path: `/${i}`,
          requestHeaders: {},
        });
      }

      const count = smallRepo.countRequests();
      expect(count).toBe(50);

      smallRepo.close();
      fs.unlinkSync(dbPath + "-cycles");
    });

    it("respects custom maxStoredRequests", () => {
      const smallRepo = new RequestRepository(dbPath + "-custom", undefined, undefined, {
        maxStoredRequests: 20,
      });
      const evictSession = smallRepo.registerSession("test", 1);

      for (let i = 0; i < 200; i++) {
        smallRepo.saveRequest({
          sessionId: evictSession.id,
          timestamp: 1000 + i,
          method: "GET",
          url: `https://example.com/${i}`,
          host: "example.com",
          path: `/${i}`,
          requestHeaders: {},
        });
      }

      expect(smallRepo.countRequests()).toBe(20);

      smallRepo.close();
      fs.unlinkSync(dbPath + "-custom");
    });

    it("uses DEFAULT_MAX_STORED_REQUESTS when no option provided", () => {
      // Just verifying the constant is exported and used
      expect(DEFAULT_MAX_STORED_REQUESTS).toBe(5000);
    });
  });

  describe("compactDatabase", () => {
    it("runs without error on populated database", () => {
      const session = repo.registerSession("test", 1);
      for (let i = 0; i < 10; i++) {
        repo.saveRequest({
          sessionId: session.id,
          timestamp: Date.now() + i,
          method: "GET",
          url: `https://example.com/${i}`,
          host: "example.com",
          path: `/${i}`,
          requestHeaders: {},
        });
      }

      expect(() => repo.compactDatabase()).not.toThrow();
    });

    it("runs without error on empty database", () => {
      expect(() => repo.compactDatabase()).not.toThrow();
    });
  });

  describe("interceptor metadata", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repo.registerSession("test", 1);
      sessionId = session.id;
    });

    it("updateRequestInterception sets fields correctly", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/users",
        host: "api.example.com",
        path: "/users",
        requestHeaders: {},
      });

      repo.updateRequestInterception(id, "my-interceptor", "mocked");

      const request = repo.getRequest(id);
      expect(request?.interceptedBy).toBe("my-interceptor");
      expect(request?.interceptionType).toBe("mocked");
    });

    it("updateRequestInterception can record interceptor name without a modified/mock marker", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/observe",
        host: "api.example.com",
        path: "/observe",
        requestHeaders: {},
      });

      repo.updateRequestInterception(id, "observer-only");

      const request = repo.getRequest(id);
      expect(request?.interceptedBy).toBe("observer-only");
      expect(request?.interceptionType).toBeUndefined();
    });

    it("listRequestsSummary returns interceptedBy and interceptionType", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/data",
        host: "api.example.com",
        path: "/data",
        requestHeaders: {},
      });

      repo.updateRequestInterception(id, "rate-limiter", "modified");

      const summaries = repo.listRequestsSummary();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.interceptedBy).toBe("rate-limiter");
      expect(summaries[0]?.interceptionType).toBe("modified");
    });

    it("getRequest returns interceptor fields", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "DELETE",
        url: "https://api.example.com/resource",
        host: "api.example.com",
        path: "/resource",
        requestHeaders: {},
      });

      repo.updateRequestInterception(id, "logger", "modified");

      const request = repo.getRequest(id);
      expect(request).toBeDefined();
      expect(request?.interceptedBy).toBe("logger");
      expect(request?.interceptionType).toBe("modified");
    });

    it("filters by interceptedBy works", () => {
      const id1 = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/first",
        host: "api.example.com",
        path: "/first",
        requestHeaders: {},
      });
      repo.updateRequestInterception(id1, "rate-limit", "modified");

      const id2 = repo.saveRequest({
        sessionId,
        timestamp: Date.now() + 1,
        method: "GET",
        url: "https://api.example.com/second",
        host: "api.example.com",
        path: "/second",
        requestHeaders: {},
      });
      repo.updateRequestInterception(id2, "logger", "mocked");

      const results = repo.listRequests({ filter: { interceptedBy: "rate-limit" } });
      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(id1);
      expect(results[0]?.interceptedBy).toBe("rate-limit");
    });

    it("filters by interceptedBy with no matches", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/test",
        host: "api.example.com",
        path: "/test",
        requestHeaders: {},
      });
      repo.updateRequestInterception(id, "actual-interceptor", "modified");

      const results = repo.listRequests({ filter: { interceptedBy: "nonexistent" } });
      expect(results).toHaveLength(0);
    });

    it("requests without interception metadata have undefined fields", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/unintercepted",
        host: "api.example.com",
        path: "/unintercepted",
        requestHeaders: {},
      });

      const request = repo.getRequest(id);
      expect(request).toBeDefined();
      expect(request?.interceptedBy).toBeUndefined();
      expect(request?.interceptionType).toBeUndefined();
    });

    it("works with both listRequests and listRequestsSummary", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "PUT",
        url: "https://api.example.com/update",
        host: "api.example.com",
        path: "/update",
        requestHeaders: {},
      });
      repo.updateRequestInterception(id, "cache-interceptor", "mocked");

      const fullRequests = repo.listRequests({ filter: { interceptedBy: "cache-interceptor" } });
      const summaries = repo.listRequestsSummary({
        filter: { interceptedBy: "cache-interceptor" },
      });

      expect(fullRequests).toHaveLength(1);
      expect(summaries).toHaveLength(1);
      expect(fullRequests[0]?.interceptedBy).toBe("cache-interceptor");
      expect(summaries[0]?.interceptedBy).toBe("cache-interceptor");
    });

    it("combines interceptedBy filter with other filters", () => {
      const id1 = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/data",
        host: "api.example.com",
        path: "/data",
        requestHeaders: {},
      });
      repo.updateRequestInterception(id1, "filter-test", "modified");
      repo.updateRequestResponse(id1, {
        status: 200,
        headers: {},
        durationMs: 10,
      });

      const id2 = repo.saveRequest({
        sessionId,
        timestamp: Date.now() + 1,
        method: "POST",
        url: "https://api.example.com/data",
        host: "api.example.com",
        path: "/data",
        requestHeaders: {},
      });
      repo.updateRequestInterception(id2, "filter-test", "mocked");
      repo.updateRequestResponse(id2, {
        status: 201,
        headers: {},
        durationMs: 15,
      });

      const results = repo.listRequests({
        filter: {
          interceptedBy: "filter-test",
          methods: ["POST"],
          statusRange: "2xx",
        },
      });

      expect(results).toHaveLength(1);
      expect(results[0]?.id).toBe(id2);
      expect(results[0]?.method).toBe("POST");
      expect(results[0]?.interceptedBy).toBe("filter-test");
    });
  });

  describe("replay metadata", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repo.registerSession("test", 1);
      sessionId = session.id;
    });

    it("persists replay metadata on full request records", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: "https://api.example.com/replayed",
        host: "api.example.com",
        path: "/replayed",
        requestHeaders: {},
      });

      repo.updateRequestReplay(id, "original-req-id", "mcp");

      const request = repo.getRequest(id);
      expect(request?.replayedFromId).toBe("original-req-id");
      expect(request?.replayInitiator).toBe("mcp");
    });

    it("includes replay metadata in summary rows", () => {
      const id = repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "POST",
        url: "https://api.example.com/replayed-summary",
        host: "api.example.com",
        path: "/replayed-summary",
        requestHeaders: {},
      });

      repo.updateRequestReplay(id, "origin-123", "tui");

      const summaries = repo.listRequestsSummary();
      expect(summaries).toHaveLength(1);
      expect(summaries[0]?.replayedFromId).toBe("origin-123");
      expect(summaries[0]?.replayInitiator).toBe("tui");
    });
  });

  describe("bookmarks (saved requests)", () => {
    let sessionId: string;

    beforeEach(() => {
      const session = repo.registerSession("test", 1);
      sessionId = session.id;
    });

    function insertRequest(path = "/test"): string {
      return repo.saveRequest({
        sessionId,
        timestamp: Date.now(),
        method: "GET",
        url: `https://api.example.com${path}`,
        host: "api.example.com",
        path,
        requestHeaders: {},
      });
    }

    describe("bookmarkRequest/unbookmarkRequest", () => {
      it("bookmarkRequest sets saved flag", () => {
        const id = insertRequest();

        const result = repo.bookmarkRequest(id);

        expect(result).toBe(true);
        const request = repo.getRequest(id);
        expect(request?.saved).toBe(true);
      });

      it("unbookmarkRequest clears saved flag", () => {
        const id = insertRequest();
        repo.bookmarkRequest(id);

        const result = repo.unbookmarkRequest(id);

        expect(result).toBe(true);
        const request = repo.getRequest(id);
        expect(request?.saved).not.toBe(true);
      });

      it("bookmarkRequest returns false for non-existent ID", () => {
        const result = repo.bookmarkRequest("non-existent-id");
        expect(result).toBe(false);
      });

      it("unbookmarkRequest returns false for non-existent ID", () => {
        const result = repo.unbookmarkRequest("non-existent-id");
        expect(result).toBe(false);
      });
    });

    describe("clearRequests preserves saved", () => {
      it("only deletes unsaved requests", () => {
        const id1 = insertRequest("/first");
        const id2 = insertRequest("/second");
        const id3 = insertRequest("/third");

        // Bookmark the second one
        repo.bookmarkRequest(id2);

        repo.clearRequests();

        // Only the bookmarked request should remain
        expect(repo.countRequests()).toBe(1);
        const remaining = repo.getRequest(id2);
        expect(remaining).toBeDefined();
        expect(remaining?.path).toBe("/second");
        expect(remaining?.saved).toBe(true);

        // Others should be gone
        expect(repo.getRequest(id1)).toBeUndefined();
        expect(repo.getRequest(id3)).toBeUndefined();
      });
    });

    describe("filter saved", () => {
      it("saved: true returns only saved requests", () => {
        const id1 = insertRequest("/first");
        const id2 = insertRequest("/second");
        const id3 = insertRequest("/third");

        // Bookmark two of them
        repo.bookmarkRequest(id1);
        repo.bookmarkRequest(id3);

        const results = repo.listRequestsSummary({ filter: { saved: true } });

        expect(results).toHaveLength(2);
        const ids = results.map((r) => r.id);
        expect(ids).toContain(id1);
        expect(ids).toContain(id3);
        expect(ids).not.toContain(id2);
      });

      it("saved: false returns only unsaved requests", () => {
        const id1 = insertRequest("/first");
        const id2 = insertRequest("/second");
        const id3 = insertRequest("/third");

        // Bookmark two of them
        repo.bookmarkRequest(id1);
        repo.bookmarkRequest(id3);

        const results = repo.listRequestsSummary({ filter: { saved: false } });

        expect(results).toHaveLength(1);
        expect(results[0]?.id).toBe(id2);
      });

      it("no filter returns all requests", () => {
        insertRequest("/first");
        insertRequest("/second");
        const id3 = insertRequest("/third");

        repo.bookmarkRequest(id3);

        const results = repo.listRequestsSummary();

        expect(results).toHaveLength(3);
      });
    });

    describe("eviction skips saved requests", () => {
      it("preserves bookmarked request during eviction", () => {
        // Create a repo with small cap
        const smallRepo = new RequestRepository(dbPath + "-bookmark-evict", undefined, undefined, {
          maxStoredRequests: 10,
        });
        const evictSession = smallRepo.registerSession("test", 1);

        // Insert a request and bookmark it
        const bookmarkedId = smallRepo.saveRequest({
          sessionId: evictSession.id,
          timestamp: 1000,
          method: "GET",
          url: "https://api.example.com/bookmarked",
          host: "api.example.com",
          path: "/bookmarked",
          requestHeaders: {},
        });
        smallRepo.bookmarkRequest(bookmarkedId);

        // Insert 200 more unsaved requests to trigger eviction
        for (let i = 0; i < 200; i++) {
          smallRepo.saveRequest({
            sessionId: evictSession.id,
            timestamp: 2000 + i,
            method: "GET",
            url: `https://api.example.com/${i}`,
            host: "api.example.com",
            path: `/${i}`,
            requestHeaders: {},
          });
        }

        // Verify the bookmarked request still exists
        const bookmarked = smallRepo.getRequest(bookmarkedId);
        expect(bookmarked).toBeDefined();
        expect(bookmarked?.path).toBe("/bookmarked");
        expect(bookmarked?.saved).toBe(true);

        // Verify the bookmarked request is preserved
        // Note: After 200 inserts (plus 1 bookmarked), eviction has fired twice
        // (at insert 100 and 200), but not at 201. So we have 11 unsaved requests
        // until the next eviction at insert 300.
        const totalCount = smallRepo.countRequests();
        const savedCount = smallRepo.countRequests({ filter: { saved: true } });
        const unsavedCount = smallRepo.countRequests({ filter: { saved: false } });

        expect(savedCount).toBe(1);
        expect(unsavedCount).toBe(11);
        expect(totalCount).toBe(12);

        smallRepo.close();
        fs.unlinkSync(dbPath + "-bookmark-evict");
      });
    });

    describe("listRequestsSummary includes saved flag", () => {
      it("returns saved flag in summary", () => {
        const id = insertRequest();
        repo.bookmarkRequest(id);

        const summaries = repo.listRequestsSummary();

        expect(summaries).toHaveLength(1);
        expect(summaries[0]?.id).toBe(id);
        expect(summaries[0]?.saved).toBe(true);
      });

      it("returns saved flag for unsaved requests", () => {
        insertRequest();

        const summaries = repo.listRequestsSummary();

        expect(summaries).toHaveLength(1);
        expect(summaries[0]?.saved).not.toBe(true);
      });
    });
  });
});
