import { describe, it, expect, vi, afterEach } from "vitest";
import type { CapturedRequest, InterceptorEvent, Session } from "../../shared/types.js";
import { formatRequestDetail, formatSessionTable, formatInterceptorEventTable } from "./detail.js";

// Disable colours for consistent test output
vi.stubEnv("NO_COLOR", "1");

afterEach(() => {
  vi.unstubAllEnvs();
});

function makeRequest(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
  const base: CapturedRequest = {
    id: "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
    sessionId: "session-1",
    timestamp: Date.now(),
    method: "GET",
    url: "https://api.example.com/users",
    host: "api.example.com",
    path: "/users",
    requestHeaders: {
      Host: "api.example.com",
      Accept: "application/json",
    },
    responseStatus: 200,
    responseHeaders: {
      "content-type": "application/json",
      "content-length": "100",
    },
    responseBody: Buffer.from('{"users":[]}'),
    durationMs: 45,
  };
  return { ...base, ...overrides };
}

describe("formatRequestDetail", () => {
  it("should show method, URL, status and duration", () => {
    const output = formatRequestDetail(makeRequest());

    expect(output).toContain("GET");
    expect(output).toContain("https://api.example.com/users");
    expect(output).toContain("200 OK");
    expect(output).toContain("45ms");
  });

  it("should show request headers", () => {
    const output = formatRequestDetail(makeRequest());

    expect(output).toContain("Request Headers");
    expect(output).toContain("Host: api.example.com");
    expect(output).toContain("Accept: application/json");
  });

  it("should show response headers", () => {
    const output = formatRequestDetail(makeRequest());

    expect(output).toContain("Response Headers");
    expect(output).toContain("content-type: application/json");
  });

  it("should show response body preview", () => {
    const output = formatRequestDetail(makeRequest());

    expect(output).toContain("Response Body");
    expect(output).toContain('{"users":[]}');
  });

  it("should mask authorization header values", () => {
    const req = makeRequest({
      requestHeaders: {
        Authorization: "Bearer eyJhbGciOiJIUzI1NiJ9.secretstuff",
      },
    });
    const output = formatRequestDetail(req);

    expect(output).toContain("Bearer ***");
    expect(output).not.toContain("eyJhbGciOiJIUzI1NiJ9");
  });

  it("should show interception info", () => {
    const req = makeRequest({
      interceptedBy: "mock-users",
      interceptionType: "mocked",
    });
    const output = formatRequestDetail(req);

    expect(output).toContain("Mocked by: mock-users");
  });

  it("should handle pending request (no response)", () => {
    const req = makeRequest({
      responseStatus: undefined,
      responseHeaders: undefined,
      responseBody: undefined,
      durationMs: undefined,
    });
    const output = formatRequestDetail(req);

    expect(output).toContain("pending");
    expect(output).not.toContain("Response Headers");
  });
});

describe("formatSessionTable", () => {
  it("should render sessions with headers", () => {
    const sessions: Session[] = [
      {
        id: "session-abc-123",
        label: "my-app",
        pid: 12345,
        startedAt: new Date("2024-01-17T10:00:00").getTime(),
      },
    ];
    const output = formatSessionTable(sessions);

    expect(output).toContain("ID");
    expect(output).toContain("Label");
    expect(output).toContain("PID");
    expect(output).toContain("session-abc-123");
    expect(output).toContain("my-app");
    expect(output).toContain("12345");
    expect(output).toContain("1 session");
  });

  it("should show dash for missing label", () => {
    const sessions: Session[] = [{ id: "s1", pid: 100, startedAt: Date.now() }];
    const output = formatSessionTable(sessions);

    expect(output).toContain("-");
  });

  it("should pluralise correctly", () => {
    const sessions: Session[] = [
      { id: "s1", pid: 100, startedAt: Date.now() },
      { id: "s2", pid: 200, startedAt: Date.now() },
    ];
    const output = formatSessionTable(sessions);

    expect(output).toContain("2 sessions");
  });
});

describe("formatInterceptorEventTable", () => {
  it("should render events with timestamp, level, interceptor, and message", () => {
    const events: InterceptorEvent[] = [
      {
        seq: 1,
        timestamp: new Date("2024-01-17T10:00:00").getTime(),
        type: "matched",
        level: "info",
        interceptor: "mock-users",
        message: "Matched GET /api/users",
      },
    ];
    const output = formatInterceptorEventTable(events);

    expect(output).toContain("INFO");
    expect(output).toContain("mock-users");
    expect(output).toContain("Matched GET /api/users");
  });

  it("should handle empty events", () => {
    const output = formatInterceptorEventTable([]);
    expect(output).toBe("");
  });
});
