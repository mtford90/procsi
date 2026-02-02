import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { RequestRepository } from "../../src/daemon/storage.js";

describe("RequestRepository", () => {
  let tempDir: string;
  let dbPath: string;
  let repo: RequestRepository;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "htpx-storage-test-"));
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

      expect(retrieved).toEqual(created);
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
});
