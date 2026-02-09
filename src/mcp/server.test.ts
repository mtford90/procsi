import { describe, it, expect } from "vitest";
import {
  formatRequest,
  formatBody,
  serialiseRequest,
  formatSummary,
  formatSize,
  formatSession,
  buildFilter,
  clampLimit,
} from "./server.js";
import type { SerialisableRequest } from "./server.js";
import type { CapturedRequest, CapturedRequestSummary, Session } from "../shared/types.js";

describe("formatRequest", () => {
  it("formats basic request with method, URL, ID, host, path", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000, // 2024-01-01T00:00:00.000Z
      method: "GET",
      url: "https://example.com/api/users",
      host: "example.com",
      path: "/api/users",
      requestHeaders: {},
    };

    const result = formatRequest(req);

    expect(result).toContain("## GET https://example.com/api/users");
    expect(result).toContain("**ID:** req-123");
    expect(result).toContain("**Timestamp:** 2024-01-01T00:00:00.000Z");
    expect(result).toContain("**Host:** example.com");
    expect(result).toContain("**Path:** /api/users");
  });

  it("includes response status when present", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {},
      responseStatus: 200,
    };

    const result = formatRequest(req);

    expect(result).toContain("**Status:** 200");
  });

  it("includes duration when present", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {},
      durationMs: 125,
    };

    const result = formatRequest(req);

    expect(result).toContain("**Duration:** 125ms");
  });

  it("includes response status and duration together", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "POST",
      url: "https://example.com/api/submit",
      host: "example.com",
      path: "/api/submit",
      requestHeaders: {},
      responseStatus: 201,
      durationMs: 456,
    };

    const result = formatRequest(req);

    expect(result).toContain("**Status:** 201");
    expect(result).toContain("**Duration:** 456ms");
  });

  it("formats request headers when present", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {
        "content-type": "application/json",
        authorization: "Bearer token123",
      },
    };

    const result = formatRequest(req);

    expect(result).toContain("### Request Headers");
    expect(result).toContain("- **content-type:** application/json");
    expect(result).toContain("- **authorization:** Bearer token123");
  });

  it("omits request headers section when empty", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {},
    };

    const result = formatRequest(req);

    expect(result).not.toContain("### Request Headers");
  });

  it("formats response headers when present", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {},
      responseHeaders: {
        "content-type": "application/json",
        "cache-control": "no-cache",
      },
    };

    const result = formatRequest(req);

    expect(result).toContain("### Response Headers");
    expect(result).toContain("- **content-type:** application/json");
    expect(result).toContain("- **cache-control:** no-cache");
  });

  it("formats request body from Buffer", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "POST",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {},
      requestBody: Buffer.from('{"name":"test"}', "utf-8"),
    };

    const result = formatRequest(req);

    expect(result).toContain("### Request Body");
    expect(result).toContain('{"name":"test"}');
  });

  it("formats response body from Buffer", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {},
      responseBody: Buffer.from('{"status":"ok"}', "utf-8"),
    };

    const result = formatRequest(req);

    expect(result).toContain("### Response Body");
    expect(result).toContain('{"status":"ok"}');
  });

  it("shows truncation marker when request body is truncated", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "POST",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {},
      requestBody: Buffer.from("large payload", "utf-8"),
      requestBodyTruncated: true,
    };

    const result = formatRequest(req);

    expect(result).toContain("### Request Body");
    expect(result).toContain("large payload");
    expect(result).toContain("_(truncated)_");
  });

  it("shows truncation marker when response body is truncated", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {},
      responseBody: Buffer.from("large response", "utf-8"),
      responseBodyTruncated: true,
    };

    const result = formatRequest(req);

    expect(result).toContain("### Response Body");
    expect(result).toContain("large response");
    expect(result).toContain("_(truncated)_");
  });

  it("omits truncation marker when body is not truncated", () => {
    const req: CapturedRequest = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "POST",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {},
      requestBody: Buffer.from("complete body", "utf-8"),
      requestBodyTruncated: false,
    };

    const result = formatRequest(req);

    expect(result).toContain("complete body");
    expect(result).not.toContain("_(truncated)_");
  });

  it("handles minimal request with no optional fields", () => {
    const req: CapturedRequest = {
      id: "req-minimal",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/",
      host: "example.com",
      path: "/",
      requestHeaders: {},
    };

    const result = formatRequest(req);

    expect(result).toContain("## GET https://example.com/");
    expect(result).toContain("**ID:** req-minimal");
    expect(result).not.toContain("**Status:**");
    expect(result).not.toContain("**Duration:**");
    expect(result).not.toContain("### Request Headers");
    expect(result).not.toContain("### Request Body");
    expect(result).not.toContain("### Response Headers");
    expect(result).not.toContain("### Response Body");
  });

  it("handles complete request with all fields", () => {
    const req: CapturedRequest = {
      id: "req-full",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "PUT",
      url: "https://api.example.com/users/123",
      host: "api.example.com",
      path: "/users/123",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"updated"}', "utf-8"),
      requestBodyTruncated: false,
      responseStatus: 200,
      responseHeaders: { "content-type": "application/json" },
      responseBody: Buffer.from('{"id":123,"name":"updated"}', "utf-8"),
      responseBodyTruncated: false,
      durationMs: 89,
    };

    const result = formatRequest(req);

    // Check all sections are present
    expect(result).toContain("## PUT https://api.example.com/users/123");
    expect(result).toContain("**Request Content-Type:** application/json");
    expect(result).toContain("**Response Content-Type:** application/json");
    expect(result).toContain("**Status:** 200");
    expect(result).toContain("**Duration:** 89ms");
    expect(result).toContain("### Request Headers");
    expect(result).toContain("### Request Body");
    // JSON bodies should be pretty-printed inside code fences
    expect(result).toContain("```json");
    expect(result).toContain('"name": "updated"');
    expect(result).toContain("### Response Headers");
    expect(result).toContain("### Response Body");
    expect(result).toContain('"id": 123');
  });

  it("omits content-type lines when headers lack content-type", () => {
    const req: CapturedRequest = {
      id: "req-no-ct",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/plain",
      host: "example.com",
      path: "/plain",
      requestHeaders: { accept: "text/html" },
      responseHeaders: { "x-custom": "value" },
    };

    const result = formatRequest(req);

    expect(result).not.toContain("**Request Content-Type:**");
    expect(result).not.toContain("**Response Content-Type:**");
  });

  it("shows only response content-type when request has none", () => {
    const req: CapturedRequest = {
      id: "req-res-ct",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: {},
      responseHeaders: { "content-type": "text/html" },
    };

    const result = formatRequest(req);

    expect(result).not.toContain("**Request Content-Type:**");
    expect(result).toContain("**Response Content-Type:** text/html");
  });
});

describe("formatBody", () => {
  describe("JSON pretty-printing", () => {
    it("pretty-prints application/json body inside code fence", () => {
      const body = Buffer.from('{"name":"test","value":42}');
      const result = formatBody(body, "application/json");

      expect(result).toContain("```json");
      expect(result).toContain('"name": "test"');
      expect(result).toContain('"value": 42');
      expect(result).toContain("```");
    });

    it("pretty-prints application/json with charset", () => {
      const body = Buffer.from('{"ok":true}');
      const result = formatBody(body, "application/json; charset=utf-8");

      expect(result).toContain("```json");
      expect(result).toContain('"ok": true');
    });

    it("pretty-prints +json suffix types", () => {
      const body = Buffer.from('{"data":[1,2]}');
      const result = formatBody(body, "application/vnd.api+json");

      expect(result).toContain("```json");
      expect(result).toContain('"data": [');
    });

    it("pretty-prints application/ld+json", () => {
      const body = Buffer.from('{"@context":"https://schema.org"}');
      const result = formatBody(body, "application/ld+json");

      expect(result).toContain("```json");
      expect(result).toContain('"@context"');
    });

    it("falls back to raw text on malformed JSON", () => {
      const body = Buffer.from("{not valid json");
      const result = formatBody(body, "application/json");

      expect(result).toBe("{not valid json");
      expect(result).not.toContain("```");
    });

    it("pretty-prints nested objects", () => {
      const body = Buffer.from('{"user":{"name":"Alice","address":{"city":"London"}}}');
      const result = formatBody(body, "application/json");

      expect(result).toContain("```json");
      expect(result).toContain('"city": "London"');
    });

    it("pretty-prints arrays", () => {
      const body = Buffer.from("[1,2,3]");
      const result = formatBody(body, "application/json");

      expect(result).toContain("```json");
      expect(result).toContain("[\n");
    });
  });

  describe("binary handling", () => {
    it("shows binary placeholder for image/png", () => {
      const body = Buffer.alloc(1024);
      const result = formatBody(body, "image/png");

      expect(result).toBe("[binary data, 1.0KB]");
    });

    it("shows binary placeholder for application/octet-stream", () => {
      const body = Buffer.alloc(500);
      const result = formatBody(body, "application/octet-stream");

      expect(result).toBe("[binary data, 500B]");
    });

    it("shows binary placeholder for image/jpeg", () => {
      const body = Buffer.alloc(2048);
      const result = formatBody(body, "image/jpeg");

      expect(result).toBe("[binary data, 2.0KB]");
    });

    it("shows binary placeholder for application/pdf", () => {
      const body = Buffer.alloc(100);
      const result = formatBody(body, "application/pdf");

      expect(result).toBe("[binary data, 100B]");
    });

    it("shows binary placeholder for video/mp4", () => {
      const body = Buffer.alloc(0);
      const result = formatBody(body, "video/mp4");

      expect(result).toBe("[binary data, 0B]");
    });

    it("shows binary placeholder for audio/mpeg", () => {
      const body = Buffer.alloc(256);
      const result = formatBody(body, "audio/mpeg");

      expect(result).toBe("[binary data, 256B]");
    });
  });

  describe("text handling", () => {
    it("returns raw text for text/html", () => {
      const body = Buffer.from("<h1>Hello</h1>");
      const result = formatBody(body, "text/html");

      expect(result).toBe("<h1>Hello</h1>");
    });

    it("returns raw text for text/plain", () => {
      const body = Buffer.from("plain text content");
      const result = formatBody(body, "text/plain");

      expect(result).toBe("plain text content");
    });

    it("returns raw text for application/xml", () => {
      const body = Buffer.from("<root><item/></root>");
      const result = formatBody(body, "application/xml");

      expect(result).toBe("<root><item/></root>");
    });

    it("returns raw text for text/plain with charset", () => {
      const body = Buffer.from("charset text");
      const result = formatBody(body, "text/plain; charset=utf-8");

      expect(result).toBe("charset text");
    });
  });

  describe("edge cases", () => {
    it("returns raw text for undefined content-type", () => {
      const body = Buffer.from("unknown type");
      const result = formatBody(body, undefined);

      expect(result).toBe("unknown type");
    });

    it("returns raw text for empty string content-type", () => {
      const body = Buffer.from("empty ct");
      const result = formatBody(body, "");

      expect(result).toBe("empty ct");
    });

    it("handles string input instead of Buffer", () => {
      const result = formatBody("string body", "text/plain");

      expect(result).toBe("string body");
    });
  });
});

describe("serialiseRequest", () => {
  it("serialises text bodies as strings", () => {
    const req: CapturedRequest = {
      id: "req-1",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "POST",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"test"}'),
      responseStatus: 200,
      responseHeaders: { "content-type": "application/json" },
      responseBody: Buffer.from('{"ok":true}'),
    };

    const result: SerialisableRequest = serialiseRequest(req);

    expect(result.requestBody).toBe('{"name":"test"}');
    expect(result.requestBodyBinary).toBe(false);
    expect(result.responseBody).toBe('{"ok":true}');
    expect(result.responseBodyBinary).toBe(false);
  });

  it("serialises binary bodies as null with binary flag", () => {
    const req: CapturedRequest = {
      id: "req-2",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "POST",
      url: "https://example.com/upload",
      host: "example.com",
      path: "/upload",
      requestHeaders: { "content-type": "image/png" },
      requestBody: Buffer.alloc(100),
      responseStatus: 200,
      responseHeaders: { "content-type": "application/octet-stream" },
      responseBody: Buffer.alloc(200),
    };

    const result = serialiseRequest(req);

    expect(result.requestBody).toBeNull();
    expect(result.requestBodyBinary).toBe(true);
    expect(result.responseBody).toBeNull();
    expect(result.responseBodyBinary).toBe(true);
  });

  it("converts timestamps to ISO strings", () => {
    const req: CapturedRequest = {
      id: "req-3",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/",
      host: "example.com",
      path: "/",
      requestHeaders: {},
    };

    const result = serialiseRequest(req);

    expect(result.timestamp).toBe("2024-01-01T00:00:00.000Z");
  });

  it("handles missing optional fields", () => {
    const req: CapturedRequest = {
      id: "req-4",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/",
      host: "example.com",
      path: "/",
      requestHeaders: {},
    };

    const result = serialiseRequest(req);

    expect(result.requestBody).toBeNull();
    expect(result.responseBody).toBeNull();
    expect(result.requestBodyTruncated).toBe(false);
    expect(result.responseBodyTruncated).toBe(false);
    expect(result.requestBodyBinary).toBe(false);
    expect(result.responseBodyBinary).toBe(false);
    expect(result).not.toHaveProperty("responseStatus");
    expect(result).not.toHaveProperty("durationMs");
  });

  it("treats unknown content-type as non-binary", () => {
    const req: CapturedRequest = {
      id: "req-5",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "POST",
      url: "https://example.com/data",
      host: "example.com",
      path: "/data",
      requestHeaders: {},
      requestBody: Buffer.from("no content-type"),
    };

    const result = serialiseRequest(req);

    expect(result.requestBody).toBe("no content-type");
    expect(result.requestBodyBinary).toBe(false);
  });

  it("preserves headers", () => {
    const req: CapturedRequest = {
      id: "req-6",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/",
      host: "example.com",
      path: "/",
      requestHeaders: { accept: "text/html", authorization: "Bearer tok" },
      responseHeaders: { "x-custom": "value" },
    };

    const result = serialiseRequest(req);

    expect(result.requestHeaders).toEqual({ accept: "text/html", authorization: "Bearer tok" });
    expect(result.responseHeaders).toEqual({ "x-custom": "value" });
  });
});

describe("formatSummary", () => {
  it("formats request with status and duration", () => {
    const req: CapturedRequestSummary = {
      id: "req-123",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/api",
      host: "example.com",
      path: "/api",
      responseStatus: 200,
      durationMs: 45,
      requestBodySize: 0,
      responseBodySize: 128,
    };

    const result = formatSummary(req);

    expect(result).toBe(
      "[req-123] 2024-01-01T00:00:00.000Z GET https://example.com/api → 200 (45ms) [^0B v128B]"
    );
  });

  it("shows pending when response status is missing", () => {
    const req: CapturedRequestSummary = {
      id: "req-pending",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "POST",
      url: "https://example.com/upload",
      host: "example.com",
      path: "/upload",
      durationMs: 1200,
      requestBodySize: 5000,
      responseBodySize: 0,
    };

    const result = formatSummary(req);

    expect(result).toBe(
      "[req-pending] 2024-01-01T00:00:00.000Z POST https://example.com/upload → pending (1200ms) [^4.9KB v0B]"
    );
  });

  it("omits duration suffix when duration is missing", () => {
    const req: CapturedRequestSummary = {
      id: "req-no-duration",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/status",
      host: "example.com",
      path: "/status",
      responseStatus: 304,
      requestBodySize: 0,
      responseBodySize: 0,
    };

    const result = formatSummary(req);

    expect(result).toBe(
      "[req-no-duration] 2024-01-01T00:00:00.000Z GET https://example.com/status → 304"
    );
  });

  it("shows pending with no duration when both status and duration are missing", () => {
    const req: CapturedRequestSummary = {
      id: "req-minimal",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "DELETE",
      url: "https://example.com/items/5",
      host: "example.com",
      path: "/items/5",
      requestBodySize: 0,
      responseBodySize: 0,
    };

    const result = formatSummary(req);

    expect(result).toBe(
      "[req-minimal] 2024-01-01T00:00:00.000Z DELETE https://example.com/items/5 → pending"
    );
  });

  it("handles zero duration correctly", () => {
    const req: CapturedRequestSummary = {
      id: "req-fast",
      sessionId: "sess-1",
      timestamp: 1704067200000,
      method: "GET",
      url: "https://example.com/cache",
      host: "example.com",
      path: "/cache",
      responseStatus: 200,
      durationMs: 0,
      requestBodySize: 0,
      responseBodySize: 256,
    };

    const result = formatSummary(req);

    expect(result).toBe(
      "[req-fast] 2024-01-01T00:00:00.000Z GET https://example.com/cache → 200 (0ms) [^0B v256B]"
    );
  });
});

describe("formatSize", () => {
  it("returns '0B' for zero", () => {
    expect(formatSize(0)).toBe("0B");
  });

  it("returns bytes for values under 1KB", () => {
    expect(formatSize(500)).toBe("500B");
  });

  it("returns KB for exactly 1024 bytes", () => {
    expect(formatSize(1024)).toBe("1.0KB");
  });

  it("returns KB with decimal for fractional KB", () => {
    expect(formatSize(1536)).toBe("1.5KB");
  });

  it("returns MB for exactly 1MB", () => {
    expect(formatSize(1048576)).toBe("1.0MB");
  });
});

describe("formatSession", () => {
  it("formats session with label", () => {
    const session: Session = {
      id: "sess-abc",
      label: "my-app",
      pid: 12345,
      startedAt: 1704067200000, // 2024-01-01T00:00:00.000Z
    };

    const result = formatSession(session);

    expect(result).toBe("[sess-abc] PID 12345 (my-app) — started 2024-01-01T00:00:00.000Z");
  });

  it("formats session without label", () => {
    const session: Session = {
      id: "sess-xyz",
      pid: 9999,
      startedAt: 1704067200000,
    };

    const result = formatSession(session);

    expect(result).toBe("[sess-xyz] PID 9999 — started 2024-01-01T00:00:00.000Z");
  });

  it("formats timestamp correctly", () => {
    const session: Session = {
      id: "sess-ts",
      pid: 1,
      startedAt: 1719835200000, // 2024-07-01T12:00:00.000Z
    };

    const result = formatSession(session);

    expect(result).toContain("2024-07-01T12:00:00.000Z");
  });
});

describe("buildFilter", () => {
  it("converts method to uppercase and sets methods array", () => {
    const filter = buildFilter({ method: "get" });

    expect(filter).toEqual({ methods: ["GET"] });
  });

  it("preserves uppercase method input", () => {
    const filter = buildFilter({ method: "POST" });

    expect(filter).toEqual({ methods: ["POST"] });
  });

  it("sets status_range when provided", () => {
    const filter = buildFilter({ status_range: "4xx" });

    expect(filter).toEqual({ statusRange: "4xx" });
  });

  it("sets search when provided", () => {
    const filter = buildFilter({ search: "api/users" });

    expect(filter).toEqual({ search: "api/users" });
  });

  it("combines all parameters", () => {
    const filter = buildFilter({
      method: "post",
      status_range: "2xx",
      search: "login",
    });

    expect(filter).toEqual({
      methods: ["POST"],
      statusRange: "2xx",
      search: "login",
    });
  });

  it("returns undefined when no parameters provided", () => {
    const filter = buildFilter({});

    expect(filter).toBeUndefined();
  });

  it("returns undefined when all parameters are undefined", () => {
    const filter = buildFilter({
      method: undefined,
      status_range: undefined,
      search: undefined,
    });

    expect(filter).toBeUndefined();
  });

  it("ignores undefined parameters and includes defined ones", () => {
    const filter = buildFilter({
      method: "DELETE",
      status_range: undefined,
      search: "items",
    });

    expect(filter).toEqual({
      methods: ["DELETE"],
      search: "items",
    });
  });

  it("treats empty string method as no filter", () => {
    // Empty string is falsy in the conditional check
    const filter = buildFilter({ method: "" });

    // Returns undefined since empty string is falsy
    expect(filter).toBeUndefined();
  });

  it("throws on invalid status_range format", () => {
    expect(() => buildFilter({ status_range: "invalid" })).toThrow(
      'Invalid status_range "invalid". Expected format: Nxx (e.g. 2xx), exact code (e.g. 401), or range (e.g. 500-503).'
    );
  });

  it("throws on out-of-range status_range", () => {
    expect(() => buildFilter({ status_range: "6xx" })).toThrow(
      'Invalid status_range "6xx". Expected format: Nxx (e.g. 2xx), exact code (e.g. 401), or range (e.g. 500-503).'
    );
  });

  it("accepts numeric-only status_range as exact code", () => {
    const filter = buildFilter({ status_range: "200" });
    expect(filter).toEqual({ statusRange: "200" });
  });

  it("accepts valid status_range values", () => {
    expect(buildFilter({ status_range: "1xx" })).toEqual({ statusRange: "1xx" });
    expect(buildFilter({ status_range: "2xx" })).toEqual({ statusRange: "2xx" });
    expect(buildFilter({ status_range: "3xx" })).toEqual({ statusRange: "3xx" });
    expect(buildFilter({ status_range: "4xx" })).toEqual({ statusRange: "4xx" });
    expect(buildFilter({ status_range: "5xx" })).toEqual({ statusRange: "5xx" });
  });

  it("splits comma-separated methods", () => {
    const filter = buildFilter({ method: "GET,POST" });

    expect(filter).toEqual({ methods: ["GET", "POST"] });
  });

  it("trims and uppercases comma-separated methods", () => {
    const filter = buildFilter({ method: " get , post " });

    expect(filter).toEqual({ methods: ["GET", "POST"] });
  });

  it("filters empty entries from comma-separated methods", () => {
    const filter = buildFilter({ method: "GET,,POST," });

    expect(filter).toEqual({ methods: ["GET", "POST"] });
  });

  it("single method backward compat still works", () => {
    const filter = buildFilter({ method: "delete" });

    expect(filter).toEqual({ methods: ["DELETE"] });
  });

  it("accepts exact status code", () => {
    const filter = buildFilter({ status_range: "401" });

    expect(filter).toEqual({ statusRange: "401" });
  });

  it("accepts numeric status range", () => {
    const filter = buildFilter({ status_range: "500-503" });

    expect(filter).toEqual({ statusRange: "500-503" });
  });

  it("Nxx backward compat still works", () => {
    const filter = buildFilter({ status_range: "2xx" });

    expect(filter).toEqual({ statusRange: "2xx" });
  });

  it("throws on status code 600 (out of range)", () => {
    expect(() => buildFilter({ status_range: "600" })).toThrow('Invalid status_range "600"');
  });

  it("throws on non-numeric status_range", () => {
    expect(() => buildFilter({ status_range: "abc" })).toThrow('Invalid status_range "abc"');
  });

  it("throws on reversed numeric range (low > high)", () => {
    expect(() => buildFilter({ status_range: "200-100" })).toThrow(
      'Invalid status_range "200-100"'
    );
  });

  it("throws on status code below 100", () => {
    expect(() => buildFilter({ status_range: "099" })).toThrow('Invalid status_range "099"');
  });

  it("passes host through to filter", () => {
    const filter = buildFilter({ host: "api.example.com" });

    expect(filter).toEqual({ host: "api.example.com" });
  });

  it("passes path through to pathPrefix", () => {
    const filter = buildFilter({ path: "/api/v2" });

    expect(filter).toEqual({ pathPrefix: "/api/v2" });
  });

  it("converts valid since ISO string to epoch ms", () => {
    const filter = buildFilter({ since: "2024-01-15T10:30:00Z" });

    expect(filter?.since).toBe(new Date("2024-01-15T10:30:00Z").getTime());
  });

  it("converts valid before ISO string to epoch ms", () => {
    const filter = buildFilter({ before: "2024-06-01T00:00:00Z" });

    expect(filter?.before).toBe(new Date("2024-06-01T00:00:00Z").getTime());
  });

  it("throws on invalid since date string", () => {
    expect(() => buildFilter({ since: "not-a-date" })).toThrow(
      'Invalid since timestamp "not-a-date"'
    );
  });

  it("throws on invalid before date string", () => {
    expect(() => buildFilter({ before: "also-invalid" })).toThrow(
      'Invalid before timestamp "also-invalid"'
    );
  });

  it("combines all new parameters", () => {
    const filter = buildFilter({
      method: "GET,POST",
      status_range: "2xx",
      host: ".example.com",
      path: "/api",
      since: "2024-01-01T00:00:00Z",
      before: "2024-12-31T23:59:59Z",
    });

    expect(filter).toEqual({
      methods: ["GET", "POST"],
      statusRange: "2xx",
      host: ".example.com",
      pathPrefix: "/api",
      since: new Date("2024-01-01T00:00:00Z").getTime(),
      before: new Date("2024-12-31T23:59:59Z").getTime(),
    });
  });

  it("passes header_name through to headerName", () => {
    const filter = buildFilter({ header_name: "content-type" });
    expect(filter).toEqual({ headerName: "content-type" });
  });

  it("passes header_value through to headerValue", () => {
    const filter = buildFilter({ header_name: "x-api-key", header_value: "secret" });
    expect(filter).toEqual({ headerName: "x-api-key", headerValue: "secret" });
  });

  it("passes header_target through to headerTarget", () => {
    const filter = buildFilter({ header_name: "content-type", header_target: "response" });
    expect(filter).toEqual({ headerName: "content-type", headerTarget: "response" });
  });

  it("combines header params with other filters", () => {
    const filter = buildFilter({
      method: "POST",
      header_name: "content-type",
      header_value: "application/json",
      header_target: "request",
    });
    expect(filter).toEqual({
      methods: ["POST"],
      headerName: "content-type",
      headerValue: "application/json",
      headerTarget: "request",
    });
  });
});

describe("clampLimit", () => {
  it("returns 50 when undefined", () => {
    expect(clampLimit(undefined)).toBe(50);
  });

  it("returns value unchanged when within range", () => {
    expect(clampLimit(25)).toBe(25);
    expect(clampLimit(100)).toBe(100);
    expect(clampLimit(250)).toBe(250);
  });

  it("clamps to 1 when below minimum", () => {
    expect(clampLimit(0)).toBe(1);
  });

  it("clamps to 1 when negative", () => {
    expect(clampLimit(-5)).toBe(1);
    expect(clampLimit(-100)).toBe(1);
  });

  it("clamps to 500 when above maximum", () => {
    expect(clampLimit(1000)).toBe(500);
    expect(clampLimit(999999)).toBe(500);
  });

  it("returns 500 when exactly at maximum", () => {
    expect(clampLimit(500)).toBe(500);
  });

  it("returns 1 when exactly at minimum", () => {
    expect(clampLimit(1)).toBe(1);
  });

  it("handles decimal values by flooring after clamping", () => {
    expect(clampLimit(50.5)).toBe(50);
    expect(clampLimit(0.5)).toBe(1);
    expect(clampLimit(600.7)).toBe(500);
  });
});
