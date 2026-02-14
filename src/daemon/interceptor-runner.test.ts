import { describe, it, expect, vi, beforeEach } from "vitest";
import * as os from "node:os";
import { createInterceptorRunner, isValidInterceptorResponse } from "./interceptor-runner.js";
import type { InterceptorLoader, LoadedInterceptor } from "./interceptor-loader.js";
import type { ProcsiClient, InterceptorRequest, InterceptorResponse } from "../shared/types.js";
import { createInterceptorEventLog, type InterceptorEventLog } from "./interceptor-event-log.js";

function createMockLoader(interceptors: LoadedInterceptor[]): InterceptorLoader {
  return {
    getInterceptors: () => interceptors,
    getInterceptorInfo: () =>
      interceptors.map((i) => ({
        name: i.name ?? i.sourceFile,
        hasMatch: i.match !== undefined,
        sourceFile: i.sourceFile,
      })),
    reload: vi.fn().mockResolvedValue(undefined),
    close: vi.fn(),
  };
}

function createMockProcsiClient(): ProcsiClient {
  return {
    countRequests: vi.fn().mockResolvedValue(0),
    listRequests: vi.fn().mockResolvedValue([]),
    getRequest: vi.fn().mockResolvedValue(null),
    searchBodies: vi.fn().mockResolvedValue([]),
    queryJsonBodies: vi.fn().mockResolvedValue([]),
  };
}

function createTestRequest(): InterceptorRequest {
  return {
    method: "GET",
    url: "https://example.com/test",
    host: "example.com",
    path: "/test",
    headers: { "content-type": "application/json" },
  };
}

describe("interceptor-runner", () => {
  let mockProcsiClient: ProcsiClient;
  let projectRoot: string;

  beforeEach(() => {
    mockProcsiClient = createMockProcsiClient();
    projectRoot = os.tmpdir();
  });

  describe("isValidInterceptorResponse", () => {
    it("should validate response with status only", () => {
      expect(isValidInterceptorResponse({ status: 200 })).toBe(true);
    });

    it("should validate response with status and headers", () => {
      expect(
        isValidInterceptorResponse({
          status: 200,
          headers: { "content-type": "text/plain" },
        })
      ).toBe(true);
    });

    it("should validate response with status and string body", () => {
      expect(isValidInterceptorResponse({ status: 200, body: "hello" })).toBe(true);
    });

    it("should validate response with status and Buffer body", () => {
      expect(isValidInterceptorResponse({ status: 200, body: Buffer.from("hello") })).toBe(true);
    });

    it("should reject null", () => {
      expect(isValidInterceptorResponse(null)).toBe(false);
    });

    it("should reject undefined", () => {
      expect(isValidInterceptorResponse(undefined)).toBe(false);
    });

    it("should reject non-object", () => {
      expect(isValidInterceptorResponse("string")).toBe(false);
      expect(isValidInterceptorResponse(42)).toBe(false);
    });

    it("should reject response without status", () => {
      expect(isValidInterceptorResponse({ body: "hello" })).toBe(false);
    });

    it("should reject response with non-number status", () => {
      expect(isValidInterceptorResponse({ status: "200" })).toBe(false);
    });

    it("should reject response with status below 100", () => {
      expect(isValidInterceptorResponse({ status: 99 })).toBe(false);
    });

    it("should reject response with status above 599", () => {
      expect(isValidInterceptorResponse({ status: 600 })).toBe(false);
    });

    it("should reject response with non-object headers", () => {
      expect(isValidInterceptorResponse({ status: 200, headers: "not an object" })).toBe(false);
      expect(isValidInterceptorResponse({ status: 200, headers: null })).toBe(false);
    });

    it("should reject response with invalid body type", () => {
      expect(isValidInterceptorResponse({ status: 200, body: 42 })).toBe(false);
      expect(isValidInterceptorResponse({ status: 200, body: {} })).toBe(false);
    });
  });

  describe("createInterceptorRunner", () => {
    describe("mock pattern", () => {
      it("should return mock response when handler returns response without calling forward", async () => {
        const mockResponse: InterceptorResponse = {
          status: 200,
          body: "mocked",
        };

        const interceptor: LoadedInterceptor = {
          name: "mock-test",
          handler: async () => mockResponse,
          sourceFile: "mock.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-1", request);

        expect(result).toBeDefined();
        expect(result?.mockResponse).toEqual(mockResponse);
        expect(result?.interception).toEqual({
          name: "mock-test",
          type: "mocked",
        });
      });

      it("should return mock response with async handler", async () => {
        const mockResponse: InterceptorResponse = {
          status: 201,
          body: "async mocked",
        };

        const interceptor: LoadedInterceptor = {
          name: "async-mock",
          handler: async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return mockResponse;
          },
          sourceFile: "async-mock.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-2", request);

        expect(result?.mockResponse).toEqual(mockResponse);
        expect(result?.interception?.type).toBe("mocked");
      });
    });

    describe("modify pattern", () => {
      it("should allow handler to call forward and modify response", async () => {
        const interceptor: LoadedInterceptor = {
          name: "modify-test",
          handler: async (ctx) => {
            const upstream = await ctx.forward();
            return {
              ...upstream,
              status: 418,
              body: "modified",
            };
          },
          sourceFile: "modify.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const requestResult = await runner.handleRequest("req-3", request);

        expect(requestResult?.mockResponse).toBeUndefined();
        expect(requestResult?.interception).toEqual({
          name: "modify-test",
          type: "modified",
        });

        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "original",
        };
        const responseResult = await runner.handleResponse("req-3", upstreamResponse);

        expect(responseResult?.responseOverride).toEqual({
          status: 418,
          body: "modified",
        });
      });
    });

    describe("pass-through pattern", () => {
      it("should return undefined when handler returns undefined", async () => {
        const interceptor: LoadedInterceptor = {
          name: "pass-through-test",
          handler: () => undefined,
          sourceFile: "pass.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-4", request);

        expect(result).toBeUndefined();
      });

      it("should return undefined when handler returns null", async () => {
        const interceptor: LoadedInterceptor = {
          name: "null-test",
          handler: () => null,
          sourceFile: "null.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-5", request);

        expect(result).toBeUndefined();
      });
    });

    describe("observe pattern", () => {
      it("should record interception when handler calls forward but returns undefined", async () => {
        const interceptor: LoadedInterceptor = {
          name: "observe-test",
          handler: async (ctx) => {
            await ctx.forward();
            // Return nothing - just observe
          },
          sourceFile: "observe.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const requestResult = await runner.handleRequest("req-6", request);

        expect(requestResult?.mockResponse).toBeUndefined();
        expect(requestResult?.interception).toEqual({
          name: "observe-test",
          type: "modified",
        });

        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "upstream",
        };
        const responseResult = await runner.handleResponse("req-6", upstreamResponse);

        expect(responseResult?.responseOverride).toBeUndefined();
        expect(responseResult?.interception).toEqual({
          name: "observe-test",
          type: "modified",
        });
      });
    });

    describe("matching", () => {
      it("should return undefined when no interceptors loaded", async () => {
        const loader = createMockLoader([]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-7", request);

        expect(result).toBeUndefined();
      });

      it("should return undefined when all match functions return false", async () => {
        const interceptors: LoadedInterceptor[] = [
          {
            name: "first",
            match: () => false,
            handler: () => ({ status: 200 }),
            sourceFile: "first.ts",
          },
          {
            name: "second",
            match: () => false,
            handler: () => ({ status: 200 }),
            sourceFile: "second.ts",
          },
        ];

        const loader = createMockLoader(interceptors);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-8", request);

        expect(result).toBeUndefined();
      });

      it("should use first matching interceptor when multiple match", async () => {
        const interceptors: LoadedInterceptor[] = [
          {
            name: "first",
            match: () => true,
            handler: async () => ({ status: 201, body: "first" }),
            sourceFile: "first.ts",
          },
          {
            name: "second",
            match: () => true,
            handler: async () => ({ status: 202, body: "second" }),
            sourceFile: "second.ts",
          },
        ];

        const loader = createMockLoader(interceptors);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-9", request);

        expect(result?.mockResponse?.body).toBe("first");
        expect(result?.interception?.name).toBe("first");
      });

      it("should match interceptor without match function", async () => {
        const interceptor: LoadedInterceptor = {
          name: "catch-all",
          handler: async () => ({ status: 200, body: "caught" }),
          sourceFile: "catch-all.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-10", request);

        expect(result?.mockResponse?.body).toBe("caught");
      });

      it("should skip interceptor when match function throws", async () => {
        const interceptors: LoadedInterceptor[] = [
          {
            name: "throwing",
            match: () => {
              throw new Error("Match error");
            },
            handler: async () => ({ status: 200, body: "first" }),
            sourceFile: "throwing.ts",
          },
          {
            name: "working",
            match: () => true,
            handler: async () => ({ status: 200, body: "second" }),
            sourceFile: "working.ts",
          },
        ];

        const loader = createMockLoader(interceptors);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-11", request);

        expect(result?.mockResponse?.body).toBe("second");
        expect(result?.interception?.name).toBe("working");
      });
    });

    describe("error handling", () => {
      it("should pass through when handler throws", async () => {
        const interceptor: LoadedInterceptor = {
          name: "throwing-handler",
          handler: async () => {
            throw new Error("Handler error");
          },
          sourceFile: "throwing.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-12", request);

        expect(result).toBeUndefined();
      });

      it("should pass through when handler returns invalid response", async () => {
        const interceptor: LoadedInterceptor = {
          name: "invalid-response",
          handler: () => ({ body: "no status" }) as InterceptorResponse,
          sourceFile: "invalid.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-13", request);

        expect(result).toBeUndefined();
      });

      it("should pass through when handler returns invalid response after forward", async () => {
        const interceptor: LoadedInterceptor = {
          name: "invalid-after-forward",
          handler: async (ctx) => {
            await ctx.forward();
            return { body: "no status" } as InterceptorResponse;
          },
          sourceFile: "invalid.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        await runner.handleRequest("req-14", request);

        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "upstream",
        };
        const responseResult = await runner.handleResponse("req-14", upstreamResponse);

        expect(responseResult?.responseOverride).toBeUndefined();
        expect(responseResult?.interception).toBeDefined();
      });

      it("should handle handler throwing during response phase", async () => {
        const interceptor: LoadedInterceptor = {
          name: "throws-after-forward",
          handler: async (ctx) => {
            await ctx.forward();
            throw new Error("Response phase error");
          },
          sourceFile: "throws.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        await runner.handleRequest("req-15", request);

        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "upstream",
        };
        const responseResult = await runner.handleResponse("req-15", upstreamResponse);

        expect(responseResult).toBeUndefined();
      });
    });

    describe("forward() behavior", () => {
      it("should return same response when forward() called twice", async () => {
        const interceptor: LoadedInterceptor = {
          name: "double-forward",
          handler: async (ctx) => {
            const first = await ctx.forward();
            const second = await ctx.forward();
            expect(first).toBe(second);
            return first;
          },
          sourceFile: "double.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        await runner.handleRequest("req-16", request);

        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "upstream",
        };
        await runner.handleResponse("req-16", upstreamResponse);
      });
    });

    describe("cleanup", () => {
      it("should clear pending entry and reject forward on cleanup", async () => {
        let forwardError: Error | undefined;

        const interceptor: LoadedInterceptor = {
          name: "cleanup-test",
          handler: async (ctx) => {
            try {
              await ctx.forward();
            } catch (err) {
              forwardError = err as Error;
            }
          },
          sourceFile: "cleanup.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        await runner.handleRequest("req-17", request);

        runner.cleanup("req-17");

        // Wait for handler to catch the error
        await new Promise((resolve) => setTimeout(resolve, 50));

        expect(forwardError).toBeDefined();
        expect(forwardError?.message).toContain("aborted");

        // handleResponse should return undefined after cleanup
        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "upstream",
        };
        const responseResult = await runner.handleResponse("req-17", upstreamResponse);
        expect(responseResult).toBeUndefined();
      });
    });

    describe("request immutability", () => {
      it("should freeze request object so handler cannot mutate it", async () => {
        const interceptor: LoadedInterceptor = {
          name: "mutate-test",
          handler: (ctx) => {
            try {
              // Attempt to mutate request
              (ctx.request as { method: string }).method = "POST";
            } catch {
              // Expected in strict mode
            }
            return { status: 200 };
          },
          sourceFile: "mutate.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        await runner.handleRequest("req-18", request);

        // In strict mode, mutation of frozen object throws TypeError
        // In non-strict mode, mutation silently fails
        // Either way, the original request should be unchanged
        expect(request.method).toBe("GET");
      });

      it("should freeze request headers so handler cannot mutate them", async () => {
        const interceptor: LoadedInterceptor = {
          name: "mutate-headers",
          handler: (ctx) => {
            try {
              ctx.request.headers["x-custom"] = "value";
            } catch {
              // Expected in strict mode
            }
            return { status: 200 };
          },
          sourceFile: "mutate-headers.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        await runner.handleRequest("req-19", request);

        expect(request.headers["x-custom"]).toBeUndefined();
      });
    });

    describe("context.log", () => {
      it("should provide context.log function to handler", async () => {
        let logCalled = false;

        const interceptor: LoadedInterceptor = {
          name: "log-test",
          handler: (ctx) => {
            ctx.log("test message");
            logCalled = true;
            return { status: 200 };
          },
          sourceFile: "log.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        await runner.handleRequest("req-20", request);

        expect(logCalled).toBe(true);
      });
    });

    describe("context.procsi", () => {
      it("should provide procsi client to handler", async () => {
        const interceptor: LoadedInterceptor = {
          name: "procsi-test",
          handler: async (ctx) => {
            const count = await ctx.procsi.countRequests();
            expect(count).toBe(0);
            return { status: 200 };
          },
          sourceFile: "procsi.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        await runner.handleRequest("req-21", request);

        expect(mockProcsiClient.countRequests).toHaveBeenCalled();
      });
    });

    describe("no-op cases", () => {
      it("should return undefined from handleResponse when no pending entry", async () => {
        const loader = createMockLoader([]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "upstream",
        };
        const result = await runner.handleResponse("non-existent", upstreamResponse);

        expect(result).toBeUndefined();
      });

      it("should be no-op when cleanup called with non-existent requestId", () => {
        const loader = createMockLoader([]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        expect(() => runner.cleanup("non-existent")).not.toThrow();
      });
    });

    describe("async match function", () => {
      it("should handle async match function", async () => {
        const interceptor: LoadedInterceptor = {
          name: "async-match",
          match: async (req) => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            return req.path === "/test";
          },
          handler: async () => ({ status: 200, body: "matched" }),
          sourceFile: "async-match.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-22", request);

        expect(result?.mockResponse?.body).toBe("matched");
      });
    });

    describe("timeouts", () => {
      it("should pass through when handler times out (mock path)", async () => {
        const interceptor: LoadedInterceptor = {
          name: "slow-handler",
          handler: async () => {
            // Never resolves within the timeout
            await new Promise((resolve) => setTimeout(resolve, 500));
            return { status: 200, body: "too late" };
          },
          sourceFile: "slow.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "error",
          handlerTimeoutMs: 50,
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-timeout-1", request);

        expect(result).toBeUndefined();
      });

      it("should skip interceptor when match function times out", async () => {
        const interceptors: LoadedInterceptor[] = [
          {
            name: "slow-match",
            match: async () => {
              // Never resolves within the timeout
              await new Promise((resolve) => setTimeout(resolve, 500));
              return true;
            },
            handler: async () => ({ status: 200, body: "first" }),
            sourceFile: "slow-match.ts",
          },
          {
            name: "fast-match",
            match: () => true,
            handler: async () => ({ status: 200, body: "second" }),
            sourceFile: "fast-match.ts",
          },
        ];

        const loader = createMockLoader(interceptors);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "error",
          matchTimeoutMs: 50,
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-timeout-2", request);

        // Slow match should be skipped, fast match should win
        expect(result?.mockResponse?.body).toBe("second");
        expect(result?.interception?.name).toBe("fast-match");
      });

      it("should pass through when handler times out during response phase", async () => {
        const interceptor: LoadedInterceptor = {
          name: "slow-response",
          handler: async (ctx) => {
            const upstream = await ctx.forward();
            // Slow processing after forward
            await new Promise((resolve) => setTimeout(resolve, 500));
            return { ...upstream, status: 418 };
          },
          sourceFile: "slow-response.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "error",
          handlerTimeoutMs: 50,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-timeout-3", request);

        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "upstream",
        };
        const responseResult = await runner.handleResponse("req-timeout-3", upstreamResponse);

        // Should return undefined (timeout) rather than the modified response
        expect(responseResult).toBeUndefined();
      });
    });

    describe("body buffer immutability", () => {
      it("should pass a copy of the body buffer so handler mutations do not affect the original", async () => {
        const originalBody = Buffer.from("original content");

        const interceptor: LoadedInterceptor = {
          name: "body-mutate",
          handler: (ctx) => {
            if (ctx.request.body) {
              // Attempt to mutate the buffer contents
              ctx.request.body.fill(0);
            }
            return { status: 200 };
          },
          sourceFile: "body-mutate.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "error",
        });

        const request: InterceptorRequest = {
          ...createTestRequest(),
          body: originalBody,
        };
        await runner.handleRequest("req-body-1", request);

        // Original buffer should be unaffected
        expect(originalBody.toString()).toBe("original content");
      });
    });

    describe("event log emissions", () => {
      let eventLog: InterceptorEventLog;

      beforeEach(() => {
        eventLog = createInterceptorEventLog();
      });

      it("should emit matched event when request matches an interceptor", async () => {
        const interceptor: LoadedInterceptor = {
          name: "match-event-test",
          handler: async () => ({ status: 200, body: "ok" }),
          sourceFile: "match-event.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-1", request);

        const events = eventLog.since(0, { type: "matched" });
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("matched");
        expect(events[0].requestId).toBe("req-ev-1");
        expect(events[0].requestUrl).toBe("https://example.com/test");
        expect(events[0].requestMethod).toBe("GET");
        expect(events[0].interceptor).toBe("match-event-test");
      });

      it("should emit mocked event when handler returns a mock response", async () => {
        const interceptor: LoadedInterceptor = {
          name: "mock-event-test",
          handler: async () => ({ status: 200, body: "mocked" }),
          sourceFile: "mock-event.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-2", request);

        const events = eventLog.since(0, { type: "mocked" });
        expect(events).toHaveLength(1);
        expect(events[0].type).toBe("mocked");
        expect(events[0].requestId).toBe("req-ev-2");
        expect(events[0].requestUrl).toBe("https://example.com/test");
        expect(events[0].requestMethod).toBe("GET");
      });

      it("should emit match_timeout event when match function times out", async () => {
        const interceptors: LoadedInterceptor[] = [
          {
            name: "slow-match-event",
            match: async () => {
              await new Promise((resolve) => setTimeout(resolve, 500));
              return true;
            },
            handler: async () => ({ status: 200 }),
            sourceFile: "slow-match-event.ts",
          },
          {
            name: "fallback",
            match: () => true,
            handler: async () => ({ status: 200 }),
            sourceFile: "fallback.ts",
          },
        ];

        const loader = createMockLoader(interceptors);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
          matchTimeoutMs: 50,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-3", request);

        const events = eventLog.since(0, { type: "match_timeout" });
        expect(events).toHaveLength(1);
        expect(events[0].level).toBe("warn");
        expect(events[0].requestUrl).toBe("https://example.com/test");
        expect(events[0].requestMethod).toBe("GET");
      });

      it("should emit match_error event when match function throws", async () => {
        const interceptors: LoadedInterceptor[] = [
          {
            name: "throwing-match-event",
            match: () => {
              throw new Error("Match explosion");
            },
            handler: async () => ({ status: 200 }),
            sourceFile: "throwing-match-event.ts",
          },
          {
            name: "fallback",
            match: () => true,
            handler: async () => ({ status: 200 }),
            sourceFile: "fallback.ts",
          },
        ];

        const loader = createMockLoader(interceptors);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-4", request);

        const events = eventLog.since(0, { type: "match_error" });
        expect(events).toHaveLength(1);
        expect(events[0].level).toBe("error");
        expect(events[0].error).toContain("Match explosion");
        expect(events[0].requestUrl).toBe("https://example.com/test");
        expect(events[0].requestMethod).toBe("GET");
      });

      it("should emit handler_timeout event when handler times out in request phase", async () => {
        const interceptor: LoadedInterceptor = {
          name: "slow-handler-event",
          handler: async () => {
            await new Promise((resolve) => setTimeout(resolve, 500));
            return { status: 200, body: "too late" };
          },
          sourceFile: "slow-handler-event.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
          handlerTimeoutMs: 50,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-5", request);

        const events = eventLog.since(0, { type: "handler_timeout" });
        expect(events).toHaveLength(1);
        expect(events[0].interceptor).toBe("slow-handler-event");
        expect(events[0].requestId).toBe("req-ev-5");
      });

      it("should emit handler_error event when handler returns non-promise value", async () => {
        // Returning a non-thenable value causes .then() to throw inside the
        // try block, which triggers the handler_error catch path
        const interceptor: LoadedInterceptor = {
          name: "non-promise-handler",
          handler: (() => 42) as unknown as LoadedInterceptor["handler"],
          sourceFile: "non-promise.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        const result = await runner.handleRequest("req-ev-6", request);

        expect(result).toBeUndefined();

        const events = eventLog.since(0, { type: "handler_error" });
        expect(events).toHaveLength(1);
        expect(events[0].level).toBe("error");
        expect(events[0].requestId).toBe("req-ev-6");
      });

      it("should emit invalid_response event when handler returns invalid response", async () => {
        const interceptor: LoadedInterceptor = {
          name: "invalid-response-event",
          handler: async () => ({ body: "no status" }) as InterceptorResponse,
          sourceFile: "invalid-response-event.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-7", request);

        const events = eventLog.since(0, { type: "invalid_response" });
        expect(events).toHaveLength(1);
        expect(events[0].interceptor).toBe("invalid-response-event");
        expect(events[0].requestId).toBe("req-ev-7");
      });

      it("should emit user_log event when ctx.log() is called", async () => {
        const interceptor: LoadedInterceptor = {
          name: "log-event-test",
          handler: (ctx) => {
            ctx.log("hello from interceptor");
            return { status: 200 };
          },
          sourceFile: "log-event.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-8", request);

        const events = eventLog.since(0, { type: "user_log" });
        expect(events).toHaveLength(1);
        expect(events[0].message).toBe("hello from interceptor");
        expect(events[0].interceptor).toBe("log-event-test");
        expect(events[0].requestId).toBe("req-ev-8");
      });

      it("should emit modified event when handler modifies response after forward", async () => {
        const interceptor: LoadedInterceptor = {
          name: "modify-event-test",
          handler: async (ctx) => {
            const upstream = await ctx.forward();
            return { ...upstream, status: 418, body: "modified" };
          },
          sourceFile: "modify-event.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-9", request);

        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "original",
        };
        await runner.handleResponse("req-ev-9", upstreamResponse);

        const events = eventLog.since(0, { type: "modified" });
        expect(events).toHaveLength(1);
        expect(events[0].interceptor).toBe("modify-event-test");
        expect(events[0].requestId).toBe("req-ev-9");
      });

      it("should emit observed event when handler calls forward but returns undefined", async () => {
        const interceptor: LoadedInterceptor = {
          name: "observe-event-test",
          handler: async (ctx) => {
            await ctx.forward();
            // Return nothing - just observe
          },
          sourceFile: "observe-event.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-10", request);

        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "upstream",
        };
        await runner.handleResponse("req-ev-10", upstreamResponse);

        const events = eventLog.since(0, { type: "observed" });
        expect(events).toHaveLength(1);
        expect(events[0].interceptor).toBe("observe-event-test");
        expect(events[0].requestId).toBe("req-ev-10");
      });

      it("should emit handler_timeout event when handler throws in response phase", async () => {
        // When an async handler rejects after forward(), withTimeout treats the
        // rejection as a timeout-like bail-out, so handler_timeout is emitted
        // rather than handler_error.
        const interceptor: LoadedInterceptor = {
          name: "throws-response-event",
          handler: async (ctx) => {
            await ctx.forward();
            throw new Error("Response phase boom");
          },
          sourceFile: "throws-response-event.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-11", request);

        const upstreamResponse: InterceptorResponse = {
          status: 200,
          body: "upstream",
        };
        await runner.handleResponse("req-ev-11", upstreamResponse);

        const events = eventLog.since(0, { type: "handler_timeout" });
        expect(events).toHaveLength(1);
        expect(events[0].interceptor).toBe("throws-response-event");
        expect(events[0].requestId).toBe("req-ev-11");
      });

      it("should not emit events when no interceptors are loaded", async () => {
        const loader = createMockLoader([]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-12", request);

        const events = eventLog.since(0);
        expect(events).toHaveLength(0);
      });

      it("should not emit events when no interceptor matches", async () => {
        const interceptor: LoadedInterceptor = {
          name: "non-matching",
          match: () => false,
          handler: async () => ({ status: 200 }),
          sourceFile: "non-matching.ts",
        };

        const loader = createMockLoader([interceptor]);
        const runner = createInterceptorRunner({
          loader,
          procsiClient: mockProcsiClient,
          projectRoot,
          logLevel: "silent",
          eventLog,
        });

        const request = createTestRequest();
        await runner.handleRequest("req-ev-13", request);

        const events = eventLog.since(0);
        expect(events).toHaveLength(0);
      });
    });
  });
});
