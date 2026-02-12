import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { RequestRepository } from "./storage.js";
import { createProcsiClient } from "./procsi-client.js";
import type { ProcsiClient } from "../shared/types.js";

describe("createProcsiClient", () => {
  let tmpDir: string;
  let storage: RequestRepository;
  let client: ProcsiClient;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "procsi-client-test-"));
    const dbPath = path.join(tmpDir, "test.db");
    storage = new RequestRepository(dbPath);
    const session = storage.registerSession("test");

    // Seed some requests
    storage.saveRequest({
      sessionId: session.id,
      timestamp: Date.now(),
      method: "GET",
      url: "https://example.com/api/users",
      host: "example.com",
      path: "/api/users",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"query":"all"}'),
    });

    storage.saveRequest({
      sessionId: session.id,
      timestamp: Date.now() + 1,
      method: "POST",
      url: "https://example.com/api/data",
      host: "example.com",
      path: "/api/data",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"test"}'),
    });

    client = createProcsiClient(storage);
  });

  afterEach(() => {
    storage.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("countRequests returns total count", async () => {
    const count = await client.countRequests();
    expect(count).toBe(2);
  });

  it("countRequests with filter", async () => {
    const count = await client.countRequests({ methods: ["POST"] });
    expect(count).toBe(1);
  });

  it("listRequests returns summaries", async () => {
    const results = await client.listRequests();
    expect(results).toHaveLength(2);
    expect(results[0]).toHaveProperty("id");
    expect(results[0]).toHaveProperty("method");
    expect(results[0]).toHaveProperty("url");
  });

  it("listRequests with limit", async () => {
    const results = await client.listRequests({ limit: 1 });
    expect(results).toHaveLength(1);
  });

  it("getRequest returns full request", async () => {
    const summaries = await client.listRequests();
    const id = summaries[0]?.id;
    expect(id).toBeDefined();
    const full = await client.getRequest(id as string);
    expect(full).not.toBeNull();
    expect(full?.id).toBe(id);
    expect(full?.requestHeaders).toBeDefined();
  });

  it("getRequest returns null for missing ID", async () => {
    const result = await client.getRequest("nonexistent-id");
    expect(result).toBeNull();
  });

  it("searchBodies finds matching content", async () => {
    // Update one request with a response body containing searchable text
    const summaries = await client.listRequests();
    const id = summaries[0]?.id;
    expect(id).toBeDefined();
    storage.updateRequestResponse(id as string, {
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"result":"found-me"}'),
      durationMs: 50,
    });

    const results = await client.searchBodies({ query: "found-me" });
    expect(results.length).toBeGreaterThanOrEqual(1);
  });

  it("queryJsonBodies extracts JSON values", async () => {
    // Update request with JSON response
    const summaries = await client.listRequests();
    const id = summaries[0]?.id;
    expect(id).toBeDefined();
    storage.updateRequestResponse(id as string, {
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"status":"ok"}'),
      durationMs: 50,
    });

    const results = await client.queryJsonBodies({ jsonPath: "$.status" });
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0]?.extractedValue).toBe("ok");
  });
});
