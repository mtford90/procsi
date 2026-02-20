import { describe, it, expect } from "vitest";
import { generateCurl } from "./curl.js";
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

describe("generateCurl", () => {
  it("should generate basic GET request", () => {
    const request = createMockRequest();
    const curl = generateCurl(request);

    expect(curl).toContain("curl");
    expect(curl).toContain("'https://example.com/api/test'");
    expect(curl).not.toContain("-X");
  });

  it("should include method for non-GET requests", () => {
    const request = createMockRequest({ method: "POST" });
    const curl = generateCurl(request);

    expect(curl).toContain("-X POST");
    expect(curl).toContain("'https://example.com/api/test'");
  });

  it("should include custom headers", () => {
    const request = createMockRequest({
      requestHeaders: {
        Authorization: "Bearer token123",
        "Content-Type": "application/json",
      },
    });
    const curl = generateCurl(request);

    expect(curl).toContain("-H 'Authorization: Bearer token123'");
    expect(curl).toContain("-H 'Content-Type: application/json'");
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
    const curl = generateCurl(request);

    expect(curl).not.toContain("Host:");
    expect(curl).not.toContain("Content-Length:");
    expect(curl).not.toContain("Connection:");
    expect(curl).not.toContain("Accept-Encoding:");
  });

  it("should include request body", () => {
    const request = createMockRequest({
      method: "POST",
      requestBody: Buffer.from('{"name":"test"}'),
    });
    const curl = generateCurl(request);

    expect(curl).toContain('-d \'{"name":"test"}\'');
  });

  it("should escape single quotes in URL", () => {
    const request = createMockRequest({
      url: "https://example.com/api?name=O'Brien",
    });
    const curl = generateCurl(request);

    expect(curl).toContain("O'\"'\"'Brien");
  });

  it("should escape single quotes in headers", () => {
    const request = createMockRequest({
      requestHeaders: {
        "X-Custom": "It's a test",
      },
    });
    const curl = generateCurl(request);

    expect(curl).toContain("It'\"'\"'s a test");
  });

  it("should escape single quotes in body", () => {
    const request = createMockRequest({
      method: "POST",
      requestBody: Buffer.from("It's a test"),
    });
    const curl = generateCurl(request);

    expect(curl).toContain("-d 'It'\"'\"'s a test'");
  });

  it("should format as multiline with backslashes", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: {
        Authorization: "Bearer token",
      },
      requestBody: Buffer.from("body"),
    });
    const curl = generateCurl(request);

    expect(curl).toContain(" \\\n  ");
  });

  it("should handle DELETE method", () => {
    const request = createMockRequest({ method: "DELETE" });
    const curl = generateCurl(request);

    expect(curl).toContain("-X DELETE");
  });

  it("should handle PATCH method", () => {
    const request = createMockRequest({
      method: "PATCH",
      requestBody: Buffer.from('{"update":true}'),
    });
    const curl = generateCurl(request);

    expect(curl).toContain("-X PATCH");
    expect(curl).toContain("-d '{\"update\":true}'");
  });

  it("should omit body for GET requests", () => {
    const request = createMockRequest({
      method: "GET",
      requestBody: Buffer.from("some body"),
    });
    const curl = generateCurl(request);

    expect(curl).not.toContain("-d ");
  });

  it("should omit body for HEAD requests", () => {
    const request = createMockRequest({
      method: "HEAD",
      requestBody: Buffer.from("some body"),
    });
    const curl = generateCurl(request);

    expect(curl).not.toContain("-d ");
  });

  it("should handle binary request body", () => {
    const binaryBody = Buffer.from([0x00, 0xff, 0x80, 0xfe]);
    const request = createMockRequest({
      method: "POST",
      requestBody: binaryBody,
    });
    const curl = generateCurl(request);

    // Binary data gets toString("utf-8") - should still produce -d flag
    expect(curl).toContain("-d '");
  });

  it("should handle newlines in request body", () => {
    const request = createMockRequest({
      method: "POST",
      requestBody: Buffer.from("line1\nline2\nline3"),
    });
    const curl = generateCurl(request);

    expect(curl).toContain("-d 'line1\nline2\nline3'");
  });

  it("should handle empty Buffer (zero-length)", () => {
    const request = createMockRequest({
      method: "POST",
      requestBody: Buffer.alloc(0),
    });
    const curl = generateCurl(request);

    // Empty buffer should not produce -d flag
    expect(curl).not.toContain("-d ");
  });

  it("should handle undefined requestBody", () => {
    const request = createMockRequest({
      method: "POST",
      requestBody: undefined,
    });
    const curl = generateCurl(request);

    expect(curl).not.toContain("-d ");
  });

  it("should handle PUT method", () => {
    const request = createMockRequest({ method: "PUT" });
    const curl = generateCurl(request);
    expect(curl).toContain("-X PUT");
  });

  it("should handle HEAD method", () => {
    const request = createMockRequest({ method: "HEAD" });
    const curl = generateCurl(request);
    expect(curl).toContain("-X HEAD");
  });

  it("should handle OPTIONS method", () => {
    const request = createMockRequest({ method: "OPTIONS" });
    const curl = generateCurl(request);
    expect(curl).toContain("-X OPTIONS");
  });

  it("should exclude Transfer-Encoding header", () => {
    const request = createMockRequest({
      requestHeaders: {
        "Transfer-Encoding": "chunked",
      },
    });
    const curl = generateCurl(request);
    expect(curl).not.toContain("Transfer-Encoding");
  });

  it("should handle case-insensitive excluded headers", () => {
    const request = createMockRequest({
      requestHeaders: {
        HOST: "example.com",
        "CONTENT-LENGTH": "100",
        "ACCEPT-ENCODING": "gzip",
      },
    });
    const curl = generateCurl(request);

    expect(curl).not.toContain("HOST:");
    expect(curl).not.toContain("CONTENT-LENGTH:");
    expect(curl).not.toContain("ACCEPT-ENCODING:");
  });

  it("should handle multiple single quotes in body", () => {
    const request = createMockRequest({
      method: "POST",
      requestBody: Buffer.from("it's a 'test' isn't it"),
    });
    const curl = generateCurl(request);

    // Each ' becomes '"'"'
    expect(curl).toContain("-d '");
    // Verify it doesn't crash and produces output
    expect(curl.length).toBeGreaterThan(0);
  });

  describe("shell metacharacter safety", () => {
    it("should safely wrap dollar signs in single quotes", () => {
      const request = createMockRequest({
        url: "https://example.com/api?q=$(whoami)",
      });
      const curl = generateCurl(request);

      // $ is not interpreted inside single quotes — just check it's preserved literally
      expect(curl).toContain("$(whoami)");
      expect(curl).toMatch(/^curl/);
    });

    it("should safely wrap backticks in single quotes", () => {
      const request = createMockRequest({
        url: "https://example.com/api?q=`id`",
      });
      const curl = generateCurl(request);

      expect(curl).toContain("`id`");
    });

    it("should safely wrap backslashes in single quotes", () => {
      const request = createMockRequest({
        method: "POST",
        requestBody: Buffer.from("path\\to\\file"),
      });
      const curl = generateCurl(request);

      expect(curl).toContain("path\\to\\file");
    });

    it("should safely wrap exclamation marks in single quotes", () => {
      const request = createMockRequest({
        requestHeaders: { "X-Custom": "hello!world" },
      });
      const curl = generateCurl(request);

      expect(curl).toContain("hello!world");
    });

    it("should strip null bytes from values", () => {
      const request = createMockRequest({
        url: "https://example.com/\0evil",
      });
      const curl = generateCurl(request);

      expect(curl).not.toContain("\0");
      expect(curl).toContain("https://example.com/evil");
    });

    it("should strip null bytes from headers", () => {
      const request = createMockRequest({
        requestHeaders: { "X-Custom": "before\0after" },
      });
      const curl = generateCurl(request);

      expect(curl).not.toContain("\0");
      expect(curl).toContain("beforeafter");
    });

    it("should strip null bytes from body", () => {
      const request = createMockRequest({
        method: "POST",
        requestBody: Buffer.from("data\0more"),
      });
      const curl = generateCurl(request);

      expect(curl).not.toContain("\0");
      expect(curl).toContain("datamore");
    });
  });
});
