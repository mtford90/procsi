import * as mockttp from "mockttp";
import type { CompletedRequest, CompletedBody, Headers } from "mockttp";
import type { RequestRepository } from "./storage.js";
import { createLogger, type LogLevel } from "../shared/logger.js";

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
}

export interface ProxyServer {
  port: number;
  url: string;
  stop: () => Promise<void>;
}

/**
 * Create and start a MITM proxy server that captures all HTTP/HTTPS traffic.
 */
export async function createProxy(options: ProxyOptions): Promise<ProxyServer> {
  const { storage, sessionId, label, projectRoot, logLevel } = options;

  // Create logger if projectRoot is provided
  const logger = projectRoot ? createLogger("proxy", projectRoot, logLevel) : undefined;

  // Map to track request info for response correlation
  const requestInfo = new Map<
    string,
    { ourId: string; timestamp: number; requestBodyTruncated: boolean }
  >();

  const maxBodySize = options.maxBodySize ?? DEFAULT_MAX_BODY_SIZE;

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

      logger?.trace("Request received", {
        method: request.method,
        url: request.url,
        headers: storedHeaders,
        bodyTruncated: requestBodyTruncated,
      });

      // Save request to storage and track the ID
      const ourId = storage.saveRequest({
        sessionId,
        label,
        timestamp,
        method: request.method,
        url: request.url,
        host: url.host,
        path: url.pathname + url.search,
        requestHeaders: storedHeaders,
        requestBody: decodedBody,
        requestBodyTruncated,
      });

      // Store mapping from mockttp ID to our ID and timestamp
      requestInfo.set(request.id, { ourId, timestamp, requestBodyTruncated });

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
