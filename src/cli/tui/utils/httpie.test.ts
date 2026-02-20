import { describe, it, expect } from "vitest";
import { generateHttpie } from "./httpie.js";
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

describe("generateHttpie", () => {
  it("should generate basic GET request", () => {
    const request = createMockRequest();
    const output = generateHttpie(request);

    expect(output).toContain("http");
    expect(output).toContain("GET");
    expect(output).toContain("'https://example.com/api/test'");
  });

  it("should generate POST request", () => {
    const request = createMockRequest({ method: "POST" });
    const output = generateHttpie(request);

    expect(output).toContain("POST");
  });

  it("should include headers with Name:Value syntax", () => {
    const request = createMockRequest({
      requestHeaders: {
        Authorization: "Bearer token123",
        "X-Custom": "value",
      },
    });
    const output = generateHttpie(request);

    expect(output).toContain("'Authorization:Bearer token123'");
    expect(output).toContain("'X-Custom:value'");
  });

  it("should exclude automatic headers", () => {
    const request = createMockRequest({
      requestHeaders: {
        Host: "example.com",
        "Content-Length": "100",
        Connection: "keep-alive",
      },
    });
    const output = generateHttpie(request);

    expect(output).not.toContain("Host");
    expect(output).not.toContain("Content-Length");
    expect(output).not.toContain("Connection");
  });

  it("should use key=value for JSON string values", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"test","city":"London"}'),
    });
    const output = generateHttpie(request);

    expect(output).toContain("'name=test'");
    expect(output).toContain("'city=London'");
  });

  it("should use key:=value for JSON non-string values", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"count":42,"active":true,"ref":null}'),
    });
    const output = generateHttpie(request);

    expect(output).toContain("'count:=42'");
    expect(output).toContain("'active:=true'");
    expect(output).toContain("'ref:=null'");
  });

  it("should use --raw for non-object JSON (array)", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from("[1,2,3]"),
    });
    const output = generateHttpie(request);

    expect(output).toContain("--raw=");
    expect(output).toContain("[1,2,3]");
  });

  it("should use --raw for nested JSON objects", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"nested":{"key":"value"}}'),
    });
    const output = generateHttpie(request);

    expect(output).toContain("--raw=");
  });

  it("should use --raw for non-JSON bodies", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "text/plain" },
      requestBody: Buffer.from("hello world"),
    });
    const output = generateHttpie(request);

    expect(output).toContain("--raw='hello world'");
  });

  it("should use --raw for invalid JSON with JSON content-type", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from("{invalid json}"),
    });
    const output = generateHttpie(request);

    expect(output).toContain("--raw=");
  });

  it("should escape single quotes in URL", () => {
    const request = createMockRequest({
      url: "https://example.com/api?name=O'Brien",
    });
    const output = generateHttpie(request);

    expect(output).toContain("O'\"'\"'Brien");
  });

  it("should strip null bytes", () => {
    const request = createMockRequest({
      url: "https://example.com/\0evil",
    });
    const output = generateHttpie(request);

    expect(output).not.toContain("\0");
  });

  it("should not include body for GET requests", () => {
    const request = createMockRequest({
      method: "GET",
      requestBody: Buffer.from("some body"),
    });
    const output = generateHttpie(request);

    expect(output).not.toContain("--raw");
    expect(output).not.toContain("=");
  });

  it("should not include body for HEAD requests", () => {
    const request = createMockRequest({
      method: "HEAD",
      requestBody: Buffer.from("some body"),
    });
    const output = generateHttpie(request);

    expect(output).not.toContain("--raw");
  });

  it("should handle empty body", () => {
    const request = createMockRequest({
      method: "POST",
      requestBody: Buffer.alloc(0),
    });
    const output = generateHttpie(request);

    expect(output).not.toContain("--raw");
  });

  it("should format as multiline with backslashes", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { Authorization: "Bearer token" },
      requestBody: Buffer.from("body"),
    });
    const output = generateHttpie(request);

    expect(output).toContain(" \\\n  ");
  });
});
