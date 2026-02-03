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

export interface ProxyOptions {
  port?: number;
  caKeyPath: string;
  caCertPath: string;
  storage: RequestRepository;
  sessionId: string;
  label?: string;
  projectRoot?: string;
  logLevel?: LogLevel;
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
  const requestInfo = new Map<string, { ourId: string; timestamp: number }>();

  const server = mockttp.getLocal({
    https: {
      keyPath: options.caKeyPath,
      certPath: options.caCertPath,
    },
    // Record traffic for potential debugging
    recordTraffic: false,
  });

  await server.start(options.port);

  // Set up passthrough rule that captures all traffic
  await server.forAnyRequest().thenPassThrough({
    // Ignore certificate errors when connecting to upstream servers
    ignoreHostHttpsErrors: true,

    beforeRequest: (request: CompletedRequest) => {
      const timestamp = Date.now();

      // Parse URL to extract host and path
      const url = new URL(request.url);

      // Convert headers to simple object
      const headers = flattenHeaders(request.headers);

      logger?.trace("Request received", {
        method: request.method,
        url: request.url,
        headers,
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
        requestHeaders: headers,
        requestBody: request.body.buffer.length > 0 ? request.body.buffer : undefined,
      });

      // Store mapping from mockttp ID to our ID and timestamp
      requestInfo.set(request.id, { ourId, timestamp });

      // Return undefined to pass through without modification
      return undefined;
    },

    beforeResponse: (response: PassThroughResponse, request: CompletedRequest) => {
      const info = requestInfo.get(request.id);
      requestInfo.delete(request.id);

      if (!info) {
        // Request wasn't tracked (shouldn't happen, but handle gracefully)
        return undefined;
      }

      const durationMs = Date.now() - info.timestamp;

      // Convert headers to simple object
      const headers = flattenHeaders(response.headers);

      logger?.trace("Response sent", {
        status: response.statusCode,
        durationMs,
        url: request.url,
      });

      // Update request with response data using our ID
      storage.updateRequestResponse(info.ourId, {
        status: response.statusCode,
        headers,
        body: response.body.buffer.length > 0 ? response.body.buffer : undefined,
        durationMs,
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
function flattenHeaders(headers: Headers): Record<string, string> {
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
