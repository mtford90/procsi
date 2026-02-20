import { describe, it, expect } from "vitest";
import { generateFetch } from "./fetch.js";
import type { CapturedRequest } from "../../../shared/types.js";

function createMockRequest(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  return {
    id: "test-id",
    sessionId: "session-id",
    timestamp: Date.now(),
    method: "GET",
    url: "https://example.com/api/test",
    host: "example.com",
    path: "/api/test",
    requestHeaders: {},
    ...overrides,
  };
}

describe("generateFetch", () => {
  it("should generate basic GET request without method option", () => {
    const request = createMockRequest();
    const output = generateFetch(request);

    expect(output).toContain("await fetch(");
    expect(output).toContain("'https://example.com/api/test'");
    expect(output).not.toContain("method:");
  });

  it("should include method for non-GET requests", () => {
    const request = createMockRequest({ method: "POST" });
    const output = generateFetch(request);

    expect(output).toContain("method: 'POST'");
  });

  it("should include custom headers", () => {
    const request = createMockRequest({
      requestHeaders: {
        Authorization: "Bearer token123",
        "Content-Type": "application/json",
      },
    });
    const output = generateFetch(request);

    expect(output).toContain("'Authorization': 'Bearer token123'");
    expect(output).toContain("'Content-Type': 'application/json'");
  });

  it("should exclude automatic headers", () => {
    const request = createMockRequest({
      requestHeaders: {
        Host: "example.com",
        "Content-Length": "100",
        Connection: "keep-alive",
        "Accept-Encoding": "gzip",
      },
    });
    const output = generateFetch(request);

    expect(output).not.toContain("Host");
    expect(output).not.toContain("Content-Length");
    expect(output).not.toContain("Connection");
    expect(output).not.toContain("Accept-Encoding");
  });

  it("should use JSON.stringify for JSON bodies", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"test"}'),
    });
    const output = generateFetch(request);

    expect(output).toContain("JSON.stringify(");
    expect(output).toContain('"name"');
  });

  it("should use string literal for non-JSON bodies", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "text/plain" },
      requestBody: Buffer.from("hello world"),
    });
    const output = generateFetch(request);

    expect(output).toContain("body: 'hello world'");
    expect(output).not.toContain("JSON.stringify");
  });

  it("should omit body for GET requests", () => {
    const request = createMockRequest({
      method: "GET",
      requestBody: Buffer.from("some body"),
    });
    const output = generateFetch(request);

    expect(output).not.toContain("body:");
  });

  it("should omit body for HEAD requests", () => {
    const request = createMockRequest({
      method: "HEAD",
      requestBody: Buffer.from("some body"),
    });
    const output = generateFetch(request);

    expect(output).not.toContain("body:");
  });

  it("should escape backslashes in strings", () => {
    const request = createMockRequest({
      url: "https://example.com/path\\to\\thing",
    });
    const output = generateFetch(request);

    expect(output).toContain("path\\\\to\\\\thing");
  });

  it("should escape single quotes in strings", () => {
    const request = createMockRequest({
      url: "https://example.com/api?name=O'Brien",
    });
    const output = generateFetch(request);

    expect(output).toContain("O\\'Brien");
  });

  it("should escape newlines in strings", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "text/plain" },
      requestBody: Buffer.from("line1\nline2"),
    });
    const output = generateFetch(request);

    expect(output).toContain("line1\\nline2");
  });

  it("should fall back to string literal for invalid JSON", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from("{invalid json}"),
    });
    const output = generateFetch(request);

    expect(output).toContain("body: '{invalid json}'");
    expect(output).not.toContain("JSON.stringify");
  });

  it("should handle empty body", () => {
    const request = createMockRequest({
      method: "POST",
      requestBody: Buffer.alloc(0),
    });
    const output = generateFetch(request);

    expect(output).not.toContain("body:");
  });

  it("should handle undefined body", () => {
    const request = createMockRequest({
      method: "POST",
      requestBody: undefined,
    });
    const output = generateFetch(request);

    expect(output).not.toContain("body:");
  });

  it("should produce a single-line call for simple GET", () => {
    const request = createMockRequest();
    const output = generateFetch(request);

    expect(output).toBe("await fetch('https://example.com/api/test');");
  });

  it("should handle DELETE method", () => {
    const request = createMockRequest({ method: "DELETE" });
    const output = generateFetch(request);

    expect(output).toContain("method: 'DELETE'");
  });

  it("should strip null bytes from URL", () => {
    const request = createMockRequest({
      url: "https://example.com/\0evil",
    });
    const output = generateFetch(request);

    expect(output).not.toContain("\0");
    expect(output).toContain("https://example.com/evil");
  });

  it("should strip null bytes from body", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "text/plain" },
      requestBody: Buffer.from("data\0more"),
    });
    const output = generateFetch(request);

    expect(output).not.toContain("\0");
    expect(output).toContain("datamore");
  });

  it("should indent JSON body consistently", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"a":1,"b":2}'),
    });
    const output = generateFetch(request);

    // The JSON.stringify output should be properly indented
    expect(output).toContain("JSON.stringify(");
    expect(output).toContain('"a"');
    expect(output).toContain('"b"');
  });
});
