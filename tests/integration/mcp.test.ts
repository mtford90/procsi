import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import * as http from "node:http";
import { generateCACertificate } from "mockttp";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RequestRepository } from "../../src/daemon/storage.js";
import { createProxy } from "../../src/daemon/proxy.js";
import { createControlServer } from "../../src/daemon/control.js";
import { ensureHtpxDir, getHtpxPaths } from "../../src/shared/project.js";
import { createHtpxMcpServer } from "../../src/mcp/server.js";

/**
 * Helper to extract text content from an MCP tool call result.
 */
function getTextContent(result: { content: { type: string; text?: string }[] }): string {
  const textItem = result.content.find((c) => c.type === "text");
  if (!textItem?.text) {
    throw new Error("Expected text content in MCP tool result but found none");
  }
  return textItem.text;
}

describe("MCP integration", () => {
  let tempDir: string;
  let paths: ReturnType<typeof getHtpxPaths>;
  let storage: RequestRepository;
  let cleanup: (() => Promise<void>)[] = [];

  beforeEach(async () => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "htpx-mcp-test-"));
    ensureHtpxDir(tempDir);
    paths = getHtpxPaths(tempDir);

    // Generate CA certificate
    const ca = await generateCACertificate({
      subject: { commonName: "htpx Test CA" },
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
   * Set up a full daemon (proxy + control server) and connect an MCP client
   * to the htpx MCP server via in-memory transport.
   */
  async function setupMcpStack() {
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
      version: "1.0.0-test",
    });
    cleanup.push(controlServer.close);

    // Create the MCP server, then connect via in-memory transport
    const mcp = createHtpxMcpServer({ projectRoot: tempDir });
    cleanup.push(async () => mcp.client.close());

    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await mcp.server.connect(serverTransport);
    cleanup.push(async () => mcp.server.close());

    const mcpClient = new Client({ name: "test-client", version: "1.0.0" });
    await mcpClient.connect(clientTransport);
    cleanup.push(async () => mcpClient.close());

    return { proxy, session, mcpClient };
  }

  /**
   * Make an HTTP GET request through the proxy.
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
          headers: { Host: parsedUrl.host },
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

  /**
   * Make an HTTP POST request through the proxy.
   */
  function makeProxiedPostRequest(
    proxyPort: number,
    url: string,
    body: string,
    headers: Record<string, string> = {}
  ): Promise<{ statusCode: number; body: string }> {
    return new Promise((resolve, reject) => {
      const parsedUrl = new URL(url);
      const bodyBuffer = Buffer.from(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port: proxyPort,
          path: url,
          method: "POST",
          headers: {
            Host: parsedUrl.host,
            "Content-Length": String(bodyBuffer.length),
            ...headers,
          },
        },
        (res) => {
          let responseBody = "";
          res.on("data", (chunk) => (responseBody += chunk));
          res.on("end", () => resolve({ statusCode: res.statusCode ?? 0, body: responseBody }));
        }
      );
      req.on("error", reject);
      req.write(bodyBuffer);
      req.end();
    });
  }

  it("htpx_get_status returns daemon status", async () => {
    const { mcpClient } = await setupMcpStack();

    const result = await mcpClient.callTool({ name: "htpx_get_status", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("**Running:** true");
    expect(text).toContain("**Proxy Port:**");
    expect(text).toContain("**Version:** 1.0.0-test");
  });

  it("htpx_list_requests returns captured traffic", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    // Create a test server and make a request through the proxy
    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ message: "hello" }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testAddr.port}/api/users`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({ name: "htpx_list_requests", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("Showing 1 of 1 request(s):");
    expect(text).toContain("/api/users");
    expect(text).toContain("GET");
  });

  it("htpx_list_requests filters by method", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    const baseUrl = `http://127.0.0.1:${testAddr.port}`;
    await makeProxiedRequest(proxy.port, `${baseUrl}/api/get-endpoint`);
    await makeProxiedPostRequest(proxy.port, `${baseUrl}/api/post-endpoint`, '{"x":1}', {
      "Content-Type": "application/json",
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { method: "POST" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Showing 1 of 1 request(s):");
    expect(text).toContain("POST");
    expect(text).not.toContain("get-endpoint");
  });

  it("htpx_get_request returns full request details", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(201, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: 42 }));
      });
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedPostRequest(
      proxy.port,
      `http://127.0.0.1:${testAddr.port}/api/create`,
      '{"name":"test"}',
      { "Content-Type": "application/json" }
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    // First list to get the ID
    const listResult = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: {},
    });
    const listText = getTextContent(listResult);
    // Extract ID from format: [<uuid>] POST ...
    const idMatch = listText.match(/\[([^\]]+)\]/);
    expect(idMatch).not.toBeNull();
    const requestId = idMatch?.[1] ?? "";
    expect(requestId).not.toBe("");

    // Now get full details
    const result = await mcpClient.callTool({
      name: "htpx_get_request",
      arguments: { id: requestId },
    });
    const text = getTextContent(result);

    expect(text).toContain("## POST");
    expect(text).toContain("/api/create");
    expect(text).toContain("### Request Body");
    // JSON bodies are now pretty-printed in code fences
    expect(text).toContain("```json");
    expect(text).toContain('"name": "test"');
    expect(text).toContain("### Response Body");
    expect(text).toContain('"id": 42');
    expect(text).toContain("**Status:** 201");
  });

  it("htpx_get_request returns error for non-existent ID", async () => {
    const { mcpClient } = await setupMcpStack();

    const result = await mcpClient.callTool({
      name: "htpx_get_request",
      arguments: { id: "non-existent-id" },
    });
    const text = getTextContent(result);

    expect(text).toContain("No request(s) found with ID(s): non-existent-id");
  });

  it("htpx_search_bodies finds matching content", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ secret: "unicorn-rainbow-42" }));
      });
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testAddr.port}/api/secret`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({
      name: "htpx_search_bodies",
      arguments: { query: "unicorn-rainbow" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Found 1 request(s)");
    expect(text).toContain("unicorn-rainbow");
    expect(text).toContain("/api/secret");
  });

  it("htpx_search_bodies returns empty for no match", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ data: "hello" }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testAddr.port}/api/data`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({
      name: "htpx_search_bodies",
      arguments: { query: "nonexistent-term-xyz" },
    });
    const text = getTextContent(result);

    expect(text).toContain("No requests found");
  });

  it("htpx_list_requests returns empty message when no traffic", async () => {
    const { mcpClient } = await setupMcpStack();

    const result = await mcpClient.callTool({ name: "htpx_list_requests", arguments: {} });
    const text = getTextContent(result);

    expect(text).toBe("No requests found.");
  });

  it("htpx_list_requests returns error for invalid status_range", async () => {
    const { mcpClient } = await setupMcpStack();

    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { status_range: "invalid" },
    });
    const text = getTextContent(result);

    expect(result.isError).toBe(true);
    expect(text).toContain("Invalid status_range");
    expect(text).toContain("Expected format: Nxx");
  });

  it("htpx_list_requests supports pagination", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: req.url }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    const baseUrl = `http://127.0.0.1:${testAddr.port}`;
    await makeProxiedRequest(proxy.port, `${baseUrl}/first`);
    await makeProxiedRequest(proxy.port, `${baseUrl}/second`);
    await makeProxiedRequest(proxy.port, `${baseUrl}/third`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const page1 = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { limit: 1, offset: 0 },
    });
    const page2 = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { limit: 1, offset: 1 },
    });
    const text1 = getTextContent(page1);
    const text2 = getTextContent(page2);

    expect(text1).toContain("Showing 1 of 3 request(s):");
    expect(text2).toContain("Showing 1 of 3 request(s):");
    // Pages should return different requests
    expect(text1).not.toBe(text2);
  });

  it("htpx_list_requests filters by search", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    const baseUrl = `http://127.0.0.1:${testAddr.port}`;
    await makeProxiedRequest(proxy.port, `${baseUrl}/api/users`);
    await makeProxiedRequest(proxy.port, `${baseUrl}/api/products`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { search: "products" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Showing 1 of 1 request(s):");
    expect(text).toContain("/api/products");
    expect(text).not.toContain("/api/users");
  });

  it("htpx_list_requests filters by status_range", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      if (req.url === "/ok") {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      } else {
        res.writeHead(404, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "not found" }));
      }
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    const baseUrl = `http://127.0.0.1:${testAddr.port}`;
    await makeProxiedRequest(proxy.port, `${baseUrl}/ok`);
    await makeProxiedRequest(proxy.port, `${baseUrl}/missing`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { status_range: "4xx" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Showing 1 of 1 request(s):");
    expect(text).toContain("/missing");
    expect(text).not.toContain("/ok");
  });

  it("htpx_list_requests filters by host", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    // Create two test servers on different ports to simulate different hosts
    const server1 = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ server: 1 }));
    });
    await new Promise<void>((resolve) => server1.listen(0, "127.0.0.1", resolve));
    const addr1 = server1.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => server1.close(() => resolve())));

    const server2 = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ server: 2 }));
    });
    await new Promise<void>((resolve) => server2.listen(0, "127.0.0.1", resolve));
    const addr2 = server2.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => server2.close(() => resolve())));

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${addr1.port}/api/one`);
    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${addr2.port}/api/two`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Filter by the first server's host:port
    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { host: `127.0.0.1:${addr1.port}` },
    });
    const text = getTextContent(result);

    expect(text).toContain("Showing 1 of 1 request(s):");
    expect(text).toContain("/api/one");
    expect(text).not.toContain("/api/two");
  });

  it("htpx_list_requests filters by since timestamp", async () => {
    const { mcpClient } = await setupMcpStack();

    // Insert requests directly via storage with controlled timestamps
    const oldTime = Date.now() - 60000;
    const newTime = Date.now();

    const sessions = storage.listSessions();
    const sessionId = sessions[0]?.id ?? "";

    storage.saveRequest({
      sessionId,
      timestamp: oldTime,
      method: "GET",
      url: "http://example.com/old",
      host: "example.com",
      path: "/old",
      requestHeaders: {},
    });

    storage.saveRequest({
      sessionId,
      timestamp: newTime,
      method: "GET",
      url: "http://example.com/new",
      host: "example.com",
      path: "/new",
      requestHeaders: {},
    });

    // Use since to only get the newer request
    const sinceIso = new Date(newTime - 1).toISOString();
    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { since: sinceIso },
    });
    const text = getTextContent(result);

    expect(text).toContain("Showing 1 of 1 request(s):");
    expect(text).toContain("/new");
    expect(text).not.toContain("/old");
  });

  it("htpx_list_requests filters by comma-separated methods", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    const baseUrl = `http://127.0.0.1:${testAddr.port}`;
    await makeProxiedRequest(proxy.port, `${baseUrl}/api/get-it`);
    await makeProxiedPostRequest(proxy.port, `${baseUrl}/api/post-it`, '{"x":1}', {
      "Content-Type": "application/json",
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Comma-separated: "GET,POST" should return both
    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { method: "GET,POST" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Showing 2 of 2 request(s):");
    expect(text).toContain("GET");
    expect(text).toContain("POST");
  });

  it("htpx_count_requests returns total count", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    const baseUrl = `http://127.0.0.1:${testAddr.port}`;
    await makeProxiedRequest(proxy.port, `${baseUrl}/one`);
    await makeProxiedRequest(proxy.port, `${baseUrl}/two`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({ name: "htpx_count_requests", arguments: {} });
    const text = getTextContent(result);

    expect(text).toBe("2 request(s)");
  });

  it("htpx_count_requests supports filtering", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    const baseUrl = `http://127.0.0.1:${testAddr.port}`;
    await makeProxiedRequest(proxy.port, `${baseUrl}/get-it`);
    await makeProxiedPostRequest(proxy.port, `${baseUrl}/post-it`, '{"x":1}', {
      "Content-Type": "application/json",
    });
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({
      name: "htpx_count_requests",
      arguments: { method: "POST" },
    });
    const text = getTextContent(result);

    expect(text).toBe("1 request(s)");
  });

  it("htpx_clear_requests clears all requests", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testAddr.port}/data`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Verify there are requests
    const countBefore = await mcpClient.callTool({ name: "htpx_count_requests", arguments: {} });
    expect(getTextContent(countBefore)).toBe("1 request(s)");

    // Clear
    const clearResult = await mcpClient.callTool({ name: "htpx_clear_requests", arguments: {} });
    expect(getTextContent(clearResult)).toBe("All requests cleared.");

    // Verify empty
    const countAfter = await mcpClient.callTool({ name: "htpx_count_requests", arguments: {} });
    expect(getTextContent(countAfter)).toBe("0 request(s)");
  });

  it("htpx_list_sessions shows session info", async () => {
    const { mcpClient } = await setupMcpStack();

    const result = await mcpClient.callTool({ name: "htpx_list_sessions", arguments: {} });
    const text = getTextContent(result);

    expect(text).toContain("1 session(s):");
    expect(text).toContain("PID");
    expect(text).toContain("(test)");
    expect(text).toContain("started");
  });

  it("htpx_get_request batch fetches multiple requests", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ path: req.url }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    const baseUrl = `http://127.0.0.1:${testAddr.port}`;
    await makeProxiedRequest(proxy.port, `${baseUrl}/alpha`);
    await makeProxiedRequest(proxy.port, `${baseUrl}/beta`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Get IDs from list
    const listResult = await mcpClient.callTool({ name: "htpx_list_requests", arguments: {} });
    const listText = getTextContent(listResult);
    // Match IDs at start of lines — skip body size brackets like [^0B v128B]
    const ids = [...listText.matchAll(/^\[([^\]]+)\]/gm)].map((m) => m[1]);
    expect(ids.length).toBe(2);

    // Batch fetch
    const result = await mcpClient.callTool({
      name: "htpx_get_request",
      arguments: { id: ids.join(",") },
    });
    const text = getTextContent(result);

    expect(text).toContain("/alpha");
    expect(text).toContain("/beta");
    expect(text).toContain("---");
  });

  it("htpx_get_request batch reports missing IDs", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testAddr.port}/exists`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Get the real ID
    const listResult = await mcpClient.callTool({ name: "htpx_list_requests", arguments: {} });
    const listText = getTextContent(listResult);
    const idMatch = listText.match(/\[([^\]]+)\]/);
    const realId = idMatch?.[1] ?? "";

    // Batch with one valid and one invalid
    const result = await mcpClient.callTool({
      name: "htpx_get_request",
      arguments: { id: `${realId},nonexistent-id` },
    });
    const text = getTextContent(result);

    expect(text).toContain("/exists");
    expect(text).toContain("Not found: nonexistent-id");
  });

  it("htpx_list_requests total count with pagination", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    const baseUrl = `http://127.0.0.1:${testAddr.port}`;
    await makeProxiedRequest(proxy.port, `${baseUrl}/a`);
    await makeProxiedRequest(proxy.port, `${baseUrl}/b`);
    await makeProxiedRequest(proxy.port, `${baseUrl}/c`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { limit: 1 },
    });
    const text = getTextContent(result);

    expect(text).toContain("Showing 1 of 3 request(s):");
  });

  it("htpx_get_request format=json returns structured output", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ id: 1, name: "test" }));
      });
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedPostRequest(
      proxy.port,
      `http://127.0.0.1:${testAddr.port}/api/create`,
      '{"name":"test"}',
      { "Content-Type": "application/json" }
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Get ID
    const listResult = await mcpClient.callTool({ name: "htpx_list_requests", arguments: {} });
    const listText = getTextContent(listResult);
    const idMatch = listText.match(/\[([^\]]+)\]/);
    const requestId = idMatch?.[1] ?? "";

    const result = await mcpClient.callTool({
      name: "htpx_get_request",
      arguments: { id: requestId, format: "json" },
    });
    const text = getTextContent(result);
    const parsed = JSON.parse(text);

    expect(parsed.requests).toHaveLength(1);
    expect(parsed.notFound).toHaveLength(0);
    const req = parsed.requests[0];
    expect(req.method).toBe("POST");
    expect(req.path).toBe("/api/create");
    expect(req.requestBody).toBe('{"name":"test"}');
    expect(req.requestBodyBinary).toBe(false);
    expect(req.responseBody).toContain("test");
    expect(req.responseBodyBinary).toBe(false);
    expect(req.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("htpx_list_requests format=json returns structured output", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testAddr.port}/api/data`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { format: "json" },
    });
    const text = getTextContent(result);
    const parsed = JSON.parse(text);

    expect(parsed).toHaveProperty("total");
    expect(parsed).toHaveProperty("showing");
    expect(parsed).toHaveProperty("requests");
    expect(parsed.total).toBe(1);
    expect(parsed.showing).toBe(1);
    expect(parsed.requests[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("htpx_count_requests format=json returns structured output", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testAddr.port}/one`);
    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testAddr.port}/two`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({
      name: "htpx_count_requests",
      arguments: { format: "json" },
    });
    const text = getTextContent(result);
    const parsed = JSON.parse(text);

    expect(parsed).toEqual({ count: 2 });
  });

  it("htpx_get_request pretty-prints JSON bodies in text format", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ result: "success", count: 42 }));
      });
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedPostRequest(
      proxy.port,
      `http://127.0.0.1:${testAddr.port}/api/action`,
      '{"action":"do"}',
      { "Content-Type": "application/json" }
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Get ID
    const listResult = await mcpClient.callTool({ name: "htpx_list_requests", arguments: {} });
    const listText = getTextContent(listResult);
    const idMatch = listText.match(/\[([^\]]+)\]/);
    const requestId = idMatch?.[1] ?? "";

    const result = await mcpClient.callTool({
      name: "htpx_get_request",
      arguments: { id: requestId },
    });
    const text = getTextContent(result);

    // Should contain code-fenced JSON
    expect(text).toContain("```json");
    expect(text).toContain('"result": "success"');
    expect(text).toContain('"count": 42');
  });

  it("htpx_get_request shows binary placeholder for non-text responses", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    // Server that returns binary content (image/png)
    const pngBytes = Buffer.alloc(64, 0x89);
    const testServer = http.createServer((_req, res) => {
      res.writeHead(200, {
        "Content-Type": "image/png",
        "Content-Length": String(pngBytes.length),
      });
      res.end(pngBytes);
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedRequest(proxy.port, `http://127.0.0.1:${testAddr.port}/image.png`);
    await new Promise((resolve) => setTimeout(resolve, 150));

    // Get ID
    const listResult = await mcpClient.callTool({ name: "htpx_list_requests", arguments: {} });
    const listText = getTextContent(listResult);
    const idMatch = listText.match(/\[([^\]]+)\]/);
    const requestId = idMatch?.[1] ?? "";

    const result = await mcpClient.callTool({
      name: "htpx_get_request",
      arguments: { id: requestId },
    });
    const text = getTextContent(result);

    expect(text).toContain("[binary data,");
  });

  it("htpx_list_requests filters by header_name", async () => {
    const { mcpClient } = await setupMcpStack();

    const sessions = storage.listSessions();
    const sessionId = sessions[0]?.id ?? "";

    // Request with x-api-key header
    const id1 = storage.saveRequest({
      sessionId,
      timestamp: Date.now(),
      method: "GET",
      url: "http://api.example.com/secure",
      host: "api.example.com",
      path: "/secure",
      requestHeaders: { "x-api-key": "secret-123" },
    });
    storage.updateRequestResponse(id1, {
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from("{}"),
      durationMs: 10,
    });

    // Request without x-api-key
    const id2 = storage.saveRequest({
      sessionId,
      timestamp: Date.now() + 1,
      method: "GET",
      url: "http://api.example.com/public",
      host: "api.example.com",
      path: "/public",
      requestHeaders: { accept: "text/html" },
    });
    storage.updateRequestResponse(id2, {
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<h1>OK</h1>"),
      durationMs: 5,
    });

    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { header_name: "x-api-key" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Showing 1 of 1 request(s):");
    expect(text).toContain("/secure");
    expect(text).not.toContain("/public");
  });

  it("htpx_list_requests filters by header_name + header_value", async () => {
    const { mcpClient } = await setupMcpStack();

    const sessions = storage.listSessions();
    const sessionId = sessions[0]?.id ?? "";

    const id1 = storage.saveRequest({
      sessionId,
      timestamp: Date.now(),
      method: "POST",
      url: "http://api.example.com/json",
      host: "api.example.com",
      path: "/json",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from("{}"),
    });
    storage.updateRequestResponse(id1, {
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from("{}"),
      durationMs: 10,
    });

    const id2 = storage.saveRequest({
      sessionId,
      timestamp: Date.now() + 1,
      method: "POST",
      url: "http://api.example.com/form",
      host: "api.example.com",
      path: "/form",
      requestHeaders: { "content-type": "application/x-www-form-urlencoded" },
      requestBody: Buffer.from("key=value"),
    });
    storage.updateRequestResponse(id2, {
      status: 200,
      headers: { "content-type": "text/html" },
      body: Buffer.from("<h1>OK</h1>"),
      durationMs: 5,
    });

    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { header_name: "content-type", header_value: "application/json" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Showing 1 of 1 request(s):");
    expect(text).toContain("/json");
    expect(text).not.toContain("/form");
  });

  it("htpx_list_requests filters by header_target=response", async () => {
    const { mcpClient } = await setupMcpStack();

    const sessions = storage.listSessions();
    const sessionId = sessions[0]?.id ?? "";

    const id1 = storage.saveRequest({
      sessionId,
      timestamp: Date.now(),
      method: "GET",
      url: "http://api.example.com/cached",
      host: "api.example.com",
      path: "/cached",
      requestHeaders: {},
    });
    storage.updateRequestResponse(id1, {
      status: 200,
      headers: { "content-type": "application/json", "x-cache": "HIT" },
      body: Buffer.from("{}"),
      durationMs: 10,
    });

    const id2 = storage.saveRequest({
      sessionId,
      timestamp: Date.now() + 1,
      method: "GET",
      url: "http://api.example.com/uncached",
      host: "api.example.com",
      path: "/uncached",
      requestHeaders: {},
    });
    storage.updateRequestResponse(id2, {
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from("{}"),
      durationMs: 5,
    });

    const result = await mcpClient.callTool({
      name: "htpx_list_requests",
      arguments: { header_name: "x-cache", header_target: "response" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Showing 1 of 1 request(s):");
    expect(text).toContain("/cached");
    expect(text).not.toContain("/uncached");
  });

  it("htpx_query_json extracts value from JSON body", async () => {
    const { mcpClient } = await setupMcpStack();

    const sessions = storage.listSessions();
    const sessionId = sessions[0]?.id ?? "";

    const id = storage.saveRequest({
      sessionId,
      timestamp: Date.now(),
      method: "POST",
      url: "http://api.example.com/users",
      host: "api.example.com",
      path: "/users",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"Alice","age":30}'),
    });
    storage.updateRequestResponse(id, {
      status: 201,
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"id":1,"name":"Alice"}'),
      durationMs: 50,
    });

    const result = await mcpClient.callTool({
      name: "htpx_query_json",
      arguments: { json_path: "$.name", target: "request" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Found 1 request(s)");
    expect(text).toContain("$.name=Alice");
  });

  it("htpx_query_json with value filter", async () => {
    const { mcpClient } = await setupMcpStack();

    const sessions = storage.listSessions();
    const sessionId = sessions[0]?.id ?? "";

    storage.saveRequest({
      sessionId,
      timestamp: Date.now(),
      method: "POST",
      url: "http://api.example.com/users",
      host: "api.example.com",
      path: "/users",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"Alice"}'),
    });

    storage.saveRequest({
      sessionId,
      timestamp: Date.now() + 1,
      method: "POST",
      url: "http://api.example.com/users",
      host: "api.example.com",
      path: "/users",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"Bob"}'),
    });

    const result = await mcpClient.callTool({
      name: "htpx_query_json",
      arguments: { json_path: "$.name", value: "Alice", target: "request" },
    });
    const text = getTextContent(result);

    expect(text).toContain("Found 1 request(s)");
    expect(text).toContain("$.name=Alice");
  });

  it("htpx_query_json format=json returns structured output", async () => {
    const { mcpClient } = await setupMcpStack();

    const sessions = storage.listSessions();
    const sessionId = sessions[0]?.id ?? "";

    const id = storage.saveRequest({
      sessionId,
      timestamp: Date.now(),
      method: "POST",
      url: "http://api.example.com/data",
      host: "api.example.com",
      path: "/data",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"status":"active","count":42}'),
    });
    storage.updateRequestResponse(id, {
      status: 200,
      headers: { "content-type": "application/json" },
      body: Buffer.from('{"ok":true}'),
      durationMs: 20,
    });

    const result = await mcpClient.callTool({
      name: "htpx_query_json",
      arguments: { json_path: "$.status", target: "request", format: "json" },
    });
    const text = getTextContent(result);
    const parsed = JSON.parse(text);

    expect(parsed.json_path).toBe("$.status");
    expect(parsed.total).toBe(1);
    expect(parsed.results).toHaveLength(1);
    expect(parsed.results[0].extractedValue).toBe("active");
    expect(parsed.results[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("htpx_list_requests enriched format shows timestamp and body sizes", async () => {
    const { proxy, mcpClient } = await setupMcpStack();

    const testServer = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ received: body }));
      });
    });
    await new Promise<void>((resolve) => testServer.listen(0, "127.0.0.1", resolve));
    const testAddr = testServer.address() as { port: number };
    cleanup.push(() => new Promise((resolve) => testServer.close(() => resolve())));

    await makeProxiedPostRequest(
      proxy.port,
      `http://127.0.0.1:${testAddr.port}/api/submit`,
      '{"data":"hello"}',
      { "Content-Type": "application/json" }
    );
    await new Promise((resolve) => setTimeout(resolve, 150));

    const result = await mcpClient.callTool({ name: "htpx_list_requests", arguments: {} });
    const text = getTextContent(result);

    // Should contain ISO timestamp
    expect(text).toMatch(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    // Should contain body size indicators (POST with body)
    expect(text).toContain("[^");
    expect(text).toContain("v");
  });
});
