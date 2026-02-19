import * as mockttp from "mockttp";
import type { CompletedRequest, CompletedBody, Headers } from "mockttp";
import type { RequestRepository } from "./storage.js";
import type { InterceptorRunner } from "./interceptor-runner.js";
import type { ReplayTracker } from "./replay-tracker.js";
import type { InterceptorRequest, InterceptorResponse } from "../shared/types.js";
import { createLogger, type LogLevel } from "../shared/logger.js";
import {
  PROCSI_RUNTIME_SOURCE_HEADER,
  PROCSI_SESSION_ID_HEADER,
  PROCSI_SESSION_TOKEN_HEADER,
  PROCSI_REPLAY_TOKEN_HEADER,
} from "../shared/constants.js";

/**
 * Response object passed to beforeResponse callback.
 * Defined inline as mockttp doesn't export this type directly.
 */
interface PassThroughResponse {
  id: string;
  statusCode: number;
  statusMessage?: string;
  headers: Headers;
  rawHeaders: [string, string][];
  body: CompletedBody;
}

/** Default maximum body size to capture (10MB) */
export const DEFAULT_MAX_BODY_SIZE = 10 * 1024 * 1024;
const MAX_RUNTIME_SOURCE_LENGTH = 32;
const RUNTIME_SOURCE_PATTERN = /^[a-z0-9._-]+$/;
const LEGACY_SESSION_HEADER = "x-procsi-session";

export interface ProxyOptions {
  port?: number;
  caKeyPath: string;
  caCertPath: string;
  storage: RequestRepository;
  sessionId: string;
  label?: string;
  projectRoot?: string;
  logLevel?: LogLevel;
  /** Maximum body size to capture in bytes. Bodies larger than this are not stored but still proxied. */
  maxBodySize?: number;
  /** Interceptor runner for mock/modify/observe interceptors */
  interceptorRunner?: InterceptorRunner;
  /** Tracks daemon-initiated replay requests via one-time replay tokens. */
  replayTracker?: ReplayTracker;
}

export interface ProxyServer {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

function normaliseRuntimeSource(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }

  const trimmed = value.trim().toLowerCase();
  if (!trimmed || trimmed.length > MAX_RUNTIME_SOURCE_LENGTH) {
    return undefined;
  }

  return RUNTIME_SOURCE_PATTERN.test(trimmed) ? trimmed : undefined;
}

/**
 * Create and start a MITM proxy server that captures all HTTP/HTTPS traffic.
 */
export async function createProxy(options: ProxyOptions): Promise<ProxyServer> {
  const { storage, sessionId, label, projectRoot, logLevel, interceptorRunner, replayTracker } =
    options;

  // Create logger if projectRoot is provided
  const logger = projectRoot ? createLogger("proxy", projectRoot, logLevel) : undefined;

  // Map to track request info for response correlation
  const requestInfo = new Map<
    string,
    { ourId: string; timestamp: number; requestBodyTruncated: boolean }
  >();

  const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

  // Cache session source lookups to avoid repeated DB queries
  const sessionSourceCache = new Map<string, string | undefined>();
  function getSessionSource(sid: string): string | undefined {
    if (!sessionSourceCache.has(sid)) {
      const session = storage.getSession(sid);
      sessionSourceCache.set(sid, session?.source);
    }
    return sessionSourceCache.get(sid);
  }

  // Cache trusted session auth lookups by (sessionId, token)
  const sessionAuthCache = new Map<string, { valid: boolean; source?: string }>();
  function getTrustedSessionSource(
    sid: string,
    token: string
  ): { valid: boolean; source?: string } {
    const cacheKey = `${sid}:${token}`;
    const cached = sessionAuthCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    const auth = storage.getSessionAuth(sid, token);
    const resolved = auth ? { valid: true, source: auth.source } : { valid: false };
    sessionAuthCache.set(cacheKey, resolved);
    return resolved;
  }

  const server = mockttp.getLocal({
    https: {
      keyPath: options.caKeyPath,
      certPath: options.caCertPath,
    },
    // Record traffic for potential debugging
    recordTraffic: false,
    // Limit body capture to prevent memory bloat from large files
    maxBodySize,
  });

  await server.start(options.port);

  // Set up passthrough rule that captures all traffic
  // Clean up requestInfo entries for requests that are aborted before completion
  await server.on("abort", (req) => {
    const info = requestInfo.get(req.id);
    if (info && interceptorRunner) {
      interceptorRunner.cleanup(info.ourId);
    }
    requestInfo.delete(req.id);
  });

  await server.forAnyRequest().thenPassThrough({
    // Ignore certificate errors when connecting to upstream servers
    ignoreHostHttpsErrors: true,

    beforeRequest: async (request: CompletedRequest) => {
      const timestamp = Date.now();

      // Parse URL to extract host and path
      const url = new URL(request.url);

      // Convert headers to simple object
      const headers = flattenHeaders(request.headers);

      // Detect if body was truncated due to maxBodySize
      // Body is truncated if we got an empty buffer but Content-Length indicates data
      const contentLength = parseInt(headers["content-length"] ?? "0", 10);
      const requestBodyTruncated = request.body.buffer.length === 0 && contentLength > 0;

      // Decode compressed request body (gzip, br, deflate) for storage.
      // The actual request to the upstream server is unmodified.
      const decodedBody =
        request.body.buffer.length > 0
          ? ((await request.body.getDecodedBuffer()) ?? request.body.buffer)
          : undefined;

      // Strip content-encoding from stored headers since we store the decoded body
      const storedHeaders = { ...headers };
      delete storedHeaders["content-encoding"];

      // Read and strip internal procsi attribution headers
      const requestSessionId = storedHeaders[PROCSI_SESSION_ID_HEADER];
      const requestSessionToken = storedHeaders[PROCSI_SESSION_TOKEN_HEADER];
      const runtimeSourceHeader = storedHeaders[PROCSI_RUNTIME_SOURCE_HEADER];
      const replayTokenHeader = storedHeaders[PROCSI_REPLAY_TOKEN_HEADER];
      const legacySessionId = storedHeaders[LEGACY_SESSION_HEADER];
      const headersCopy = { ...storedHeaders };
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete headersCopy[PROCSI_SESSION_ID_HEADER];
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete headersCopy[PROCSI_SESSION_TOKEN_HEADER];
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete headersCopy[PROCSI_RUNTIME_SOURCE_HEADER];
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete headersCopy[PROCSI_REPLAY_TOKEN_HEADER];
      // Legacy header used before token hardening. Strip it for compatibility.
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete headersCopy[LEGACY_SESSION_HEADER];
      const finalStoredHeaders = headersCopy;

      // Trust runtime attribution only when both session ID and token are valid.
      let effectiveSessionId = sessionId;
      let sessionSource = getSessionSource(sessionId);
      let trustedAttribution = false;
      if (typeof requestSessionId === "string" && typeof requestSessionToken === "string") {
        const trusted = getTrustedSessionSource(requestSessionId, requestSessionToken);
        if (trusted.valid) {
          effectiveSessionId = requestSessionId;
          sessionSource = trusted.source;
          trustedAttribution = true;
        } else {
          logger?.warn("Ignoring untrusted procsi session attribution headers", {
            sessionId: requestSessionId,
          });
        }
      }
      if (requestSessionId === undefined && typeof legacySessionId === "string") {
        logger?.warn("Ignoring legacy untrusted procsi session header without token");
      }

      // Runtime hint wins when present; otherwise fall back to the session source.
      const runtimeSource = trustedAttribution
        ? normaliseRuntimeSource(runtimeSourceHeader)
        : undefined;
      const source = runtimeSource ?? sessionSource;

      logger?.trace("Request received", {
        method: request.method,
        url: request.url,
        headers: finalStoredHeaders,
        bodyTruncated: requestBodyTruncated,
      });

      // Save request to storage and track the ID
      const ourId = storage.saveRequest({
        sessionId: effectiveSessionId,
        label,
        source,
        timestamp,
        method: request.method,
        url: request.url,
        host: url.host,
        path: url.pathname + url.search,
        requestHeaders: finalStoredHeaders,
        requestBody: decodedBody,
        requestBodyTruncated,
      });

      if (typeof replayTokenHeader === "string") {
        const replay = replayTracker?.consume(replayTokenHeader);
        if (replay) {
          storage.updateRequestReplay(ourId, replay.replayedFromId, replay.replayInitiator);
        }
      }

      // Store mapping from mockttp ID to our ID and timestamp
      requestInfo.set(request.id, { ourId, timestamp, requestBodyTruncated });

      // Run interceptor if available
      if (interceptorRunner) {
        const interceptorRequest: InterceptorRequest = {
          method: request.method,
          url: request.url,
          host: url.host,
          path: url.pathname + url.search,
          headers: { ...finalStoredHeaders },
          body: decodedBody,
        };

        const result = await interceptorRunner.handleRequest(ourId, interceptorRequest);

        if (result?.mockResponse && result.interception) {
          // Mock — interceptor returned a response without calling forward()
          storage.updateRequestInterception(
            ourId,
            result.interception.name,
            result.interception.type
          );

          const mockBody =
            typeof result.mockResponse.body === "string"
              ? Buffer.from(result.mockResponse.body)
              : result.mockResponse.body;

          storage.updateRequestResponse(ourId, {
            status: result.mockResponse.status,
            headers: result.mockResponse.headers ?? {},
            body: mockBody,
            durationMs: Date.now() - timestamp,
            responseBodyTruncated: false,
          });

          return {
            response: buildMockttpResponse(result.mockResponse),
          };
        }

        if (result?.interception) {
          // forward() was called — record interception metadata, let proxy continue
          storage.updateRequestInterception(
            ourId,
            result.interception.name,
            result.interception.type
          );
        }
      }

      // Strip internal procsi attribution headers from the upstream request.
      if (
        requestSessionId !== undefined ||
        requestSessionToken !== undefined ||
        runtimeSourceHeader !== undefined ||
        replayTokenHeader !== undefined ||
        legacySessionId !== undefined
      ) {
        const upstreamHeaders = flattenHeaders(request.headers);
        const cleanedHeaders = { ...upstreamHeaders };
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete cleanedHeaders[PROCSI_SESSION_ID_HEADER];
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete cleanedHeaders[PROCSI_SESSION_TOKEN_HEADER];
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete cleanedHeaders[PROCSI_RUNTIME_SOURCE_HEADER];
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete cleanedHeaders[PROCSI_REPLAY_TOKEN_HEADER];
        // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
        delete cleanedHeaders[LEGACY_SESSION_HEADER];
        return { headers: cleanedHeaders };
      }

      // Return undefined to pass through without modification
      return undefined;
    },

    beforeResponse: async (response: PassThroughResponse, request: CompletedRequest) => {
      const info = requestInfo.get(request.id);
      requestInfo.delete(request.id);

      if (!info) {
        // Request wasn't tracked (shouldn't happen, but handle gracefully)
        return undefined;
      }

      const durationMs = Date.now() - info.timestamp;

      // Convert headers to simple object
      const headers = flattenHeaders(response.headers);

      // Detect if body was truncated due to maxBodySize
      const contentLength = parseInt(headers["content-length"] ?? "0", 10);
      const responseBodyTruncated = response.body.buffer.length === 0 && contentLength > 0;

      // Decode compressed body (gzip, br, deflate) for storage.
      // The actual response to the client is unmodified.
      const decodedBody =
        response.body.buffer.length > 0
          ? ((await response.body.getDecodedBuffer()) ?? response.body.buffer)
          : undefined;

      // Strip content-encoding from stored headers since we store the decoded body
      const storedHeaders = { ...headers };
      delete storedHeaders["content-encoding"];

      logger?.trace("Response sent", {
        status: response.statusCode,
        durationMs,
        url: request.url,
        bodyTruncated: responseBodyTruncated,
      });

      // Run interceptor response handler if available
      if (interceptorRunner) {
        const upstreamResponse: InterceptorResponse = {
          status: response.statusCode,
          headers: { ...storedHeaders },
          body: decodedBody,
        };

        const interceptResult = await interceptorRunner.handleResponse(
          info.ourId,
          upstreamResponse
        );

        if (interceptResult?.responseOverride && interceptResult.interception) {
          // Handler modified the response after forward()
          storage.updateRequestInterception(
            info.ourId,
            interceptResult.interception.name,
            interceptResult.interception.type
          );

          const overrideBody =
            typeof interceptResult.responseOverride.body === "string"
              ? Buffer.from(interceptResult.responseOverride.body)
              : interceptResult.responseOverride.body;

          storage.updateRequestResponse(info.ourId, {
            status: interceptResult.responseOverride.status,
            headers: interceptResult.responseOverride.headers ?? storedHeaders,
            body: overrideBody,
            durationMs,
            responseBodyTruncated: false,
          });

          return buildMockttpResponse(interceptResult.responseOverride);
        }

        if (interceptResult?.interception) {
          // Observe mode — record interception metadata but don't modify response
          storage.updateRequestInterception(
            info.ourId,
            interceptResult.interception.name,
            interceptResult.interception.type
          );
        }
      }

      // Update request with response data using our ID
      storage.updateRequestResponse(info.ourId, {
        status: response.statusCode,
        headers: storedHeaders,
        body: decodedBody,
        durationMs,
        responseBodyTruncated,
      });

      // Return undefined to pass through without modification
      return undefined;
    },
  });

  return {
    port: server.port,
    url: server.url,
    stop: async () => {
      await server.stop();
    },
  };
}

/**
 * Convert an InterceptorResponse into the shape mockttp expects for mock/modified responses.
 */
function buildMockttpResponse(response: InterceptorResponse): {
  statusCode: number;
  statusMessage?: string;
  headers?: Record<string, string>;
  body?: string | Buffer;
} {
  return {
    statusCode: response.status,
    headers: response.headers,
    body: response.body,
  };
}

/**
 * Flatten mockttp headers (which may have array values) to simple string values.
 */
export function flattenHeaders(headers: Headers): Record<string, string> {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (Array.isArray(value)) {
      result[key] = value.join(", ");
    } else if (value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}
