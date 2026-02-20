import { describe, it, expect } from "vitest";
import { generatePythonRequests, pythonRepr, escapePythonString } from "./python-requests.js";
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

describe("pythonRepr", () => {
  it("should convert true to True", () => {
    expect(pythonRepr(true)).toBe("True");
  });

  it("should convert false to False", () => {
    expect(pythonRepr(false)).toBe("False");
  });

  it("should convert null to None", () => {
    expect(pythonRepr(null)).toBe("None");
  });

  it("should convert undefined to None", () => {
    expect(pythonRepr(undefined)).toBe("None");
  });

  it("should handle numbers", () => {
    expect(pythonRepr(42)).toBe("42");
    expect(pythonRepr(3.14)).toBe("3.14");
  });

  it("should handle strings with escaping", () => {
    expect(pythonRepr("hello")).toBe("'hello'");
    expect(pythonRepr("it's")).toBe("'it\\'s'");
    expect(pythonRepr("line1\nline2")).toBe("'line1\\nline2'");
  });

  it("should handle arrays", () => {
    expect(pythonRepr([1, "two", true])).toBe("[1, 'two', True]");
  });

  it("should handle nested objects", () => {
    expect(pythonRepr({ a: 1, b: "two" })).toBe("{'a': 1, 'b': 'two'}");
  });

  it("should handle nested structures", () => {
    const value = { list: [1, 2], nested: { key: true } };
    expect(pythonRepr(value)).toBe("{'list': [1, 2], 'nested': {'key': True}}");
  });
});

describe("generatePythonRequests", () => {
  it("should generate basic GET request", () => {
    const request = createMockRequest();
    const output = generatePythonRequests(request);

    expect(output).toContain("import requests");
    expect(output).toContain("requests.get(");
    expect(output).toContain("'https://example.com/api/test'");
  });

  it("should map method to correct function name", () => {
    const methods = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
    for (const method of methods) {
      const request = createMockRequest({ method });
      const output = generatePythonRequests(request);
      expect(output).toContain(`requests.${method.toLowerCase()}(`);
    }
  });

  it("should use json= kwarg for JSON content-type", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"test","active":true}'),
    });
    const output = generatePythonRequests(request);

    expect(output).toContain("json=");
    expect(output).toContain("'name': 'test'");
    expect(output).toContain("'active': True");
  });

  it("should strip content-type header when using json= kwarg", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: {
        "content-type": "application/json",
        Authorization: "Bearer token",
      },
      requestBody: Buffer.from('{"test":true}'),
    });
    const output = generatePythonRequests(request);

    expect(output).toContain("json=");
    expect(output).toContain("Authorization");
    expect(output).not.toContain("'content-type'");
    expect(output).not.toContain("'Content-Type'");
  });

  it("should use data= kwarg for non-JSON bodies", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "text/plain" },
      requestBody: Buffer.from("hello world"),
    });
    const output = generatePythonRequests(request);

    expect(output).toContain("data='hello world'");
    expect(output).not.toContain("json=");
  });

  it("should include headers", () => {
    const request = createMockRequest({
      requestHeaders: {
        Authorization: "Bearer token123",
        "X-Custom": "value",
      },
    });
    const output = generatePythonRequests(request);

    expect(output).toContain("headers=");
    expect(output).toContain("'Authorization': 'Bearer token123'");
    expect(output).toContain("'X-Custom': 'value'");
  });

  it("should exclude automatic headers", () => {
    const request = createMockRequest({
      requestHeaders: {
        Host: "example.com",
        "Content-Length": "100",
      },
    });
    const output = generatePythonRequests(request);

    expect(output).not.toContain("Host");
    expect(output).not.toContain("Content-Length");
  });

  it("should escape strings in Python", () => {
    const request = createMockRequest({
      url: "https://example.com/api?name=O'Brien",
    });
    const output = generatePythonRequests(request);

    expect(output).toContain("O\\'Brien");
  });

  it("should fall back to data= for invalid JSON with JSON content-type", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from("{invalid json}"),
    });
    const output = generatePythonRequests(request);

    expect(output).toContain("data=");
    expect(output).not.toContain("json=");
  });

  it("should not include body for GET requests", () => {
    const request = createMockRequest({
      method: "GET",
      requestBody: Buffer.from("some body"),
    });
    const output = generatePythonRequests(request);

    expect(output).not.toContain("data=");
    expect(output).not.toContain("json=");
  });

  it("should not include body for HEAD requests", () => {
    const request = createMockRequest({
      method: "HEAD",
      requestBody: Buffer.from("some body"),
    });
    const output = generatePythonRequests(request);

    expect(output).not.toContain("data=");
    expect(output).not.toContain("json=");
  });

  it("should handle empty body", () => {
    const request = createMockRequest({
      method: "POST",
      requestBody: Buffer.alloc(0),
    });
    const output = generatePythonRequests(request);

    expect(output).not.toContain("data=");
    expect(output).not.toContain("json=");
  });

  it("should strip null bytes from URL", () => {
    const request = createMockRequest({
      url: "https://example.com/\0evil",
    });
    const output = generatePythonRequests(request);

    expect(output).not.toContain("\0");
    expect(output).toContain("https://example.com/evil");
  });

  it("should strip null bytes from body", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "text/plain" },
      requestBody: Buffer.from("data\0more"),
    });
    const output = generatePythonRequests(request);

    expect(output).not.toContain("\0");
    expect(output).toContain("datamore");
  });
});

describe("escapePythonString", () => {
  it("should strip null bytes", () => {
    expect(escapePythonString("before\0after")).toBe("beforeafter");
  });

  it("should escape backslashes", () => {
    expect(escapePythonString("path\\to")).toBe("path\\\\to");
  });

  it("should escape single quotes", () => {
    expect(escapePythonString("it's")).toBe("it\\'s");
  });

  it("should escape newlines", () => {
    expect(escapePythonString("a\nb")).toBe("a\\nb");
  });

  it("should escape carriage returns", () => {
    expect(escapePythonString("a\rb")).toBe("a\\rb");
  });

  it("should escape tabs", () => {
    expect(escapePythonString("a\tb")).toBe("a\\tb");
  });
});
