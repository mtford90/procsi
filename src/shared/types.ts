/**
 * Core types for htpx
 */

export interface CapturedRequest {
  id: string;
  sessionId: string;
  label?: string;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  path: string;
  requestHeaders: Record<string, string>;
  requestBody?: Buffer;
  requestBodyTruncated?: boolean;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody?: Buffer;
  responseBodyTruncated?: boolean;
  durationMs?: number;
}

/**
 * Summary version of CapturedRequest for list views.
 * Excludes body and header data to reduce transfer size.
 */
export interface CapturedRequestSummary {
  id: string;
  sessionId: string;
  label?: string;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  path: string;
  responseStatus?: number;
  durationMs?: number;
  /** Size of request body in bytes (without transferring the body itself) */
  requestBodySize: number;
  /** Size of response body in bytes (without transferring the body itself) */
  responseBodySize: number;
}

export interface Session {
  id: string;
  label?: string;
  pid: number;
  startedAt: number;
}

export interface DaemonStatus {
  running: boolean;
  proxyPort?: number;
  sessionCount: number;
  requestCount: number;
  version: string;
}

export interface RequestFilter {
  methods?: string[]; // e.g. ["GET", "POST"]
  statusRange?: string; // e.g. "2xx", "4xx", "401", "500-503"
  search?: string; // substring match on url/path
  host?: string; // exact match, or suffix if starts with "."
  pathPrefix?: string; // prefix match on path column
  since?: number; // epoch ms, inclusive lower bound
  before?: number; // epoch ms, exclusive upper bound
  headerName?: string; // header name to filter by (lowercased before querying)
  headerValue?: string; // header value to match (requires headerName)
  headerTarget?: "request" | "response" | "both"; // which headers to search (default "both")
}

/**
 * Result from a JSON body query — a summary with the extracted value appended.
 */
export interface JsonQueryResult extends CapturedRequestSummary {
  extractedValue: unknown;
}
