/**
 * Core types for procsi
 */

export type InterceptionType = "modified" | "mocked";
export type BodySearchTarget = "request" | "response" | "both";
export type ReplayInitiator = "mcp" | "tui";

export interface BodySearchOptions {
  query: string;
  target: BodySearchTarget;
}

export interface CapturedRequest {
  id: string;
  sessionId: string;
  label?: string;
  source?: string;
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
  interceptedBy?: string;
  interceptionType?: InterceptionType;
  replayedFromId?: string;
  replayInitiator?: ReplayInitiator;
  saved?: boolean;
}

/**
 * Summary version of CapturedRequest for list views.
 * Excludes body and header data to reduce transfer size.
 */
export interface CapturedRequestSummary {
  id: string;
  sessionId: string;
  label?: string;
  source?: string;
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
  interceptedBy?: string;
  interceptionType?: InterceptionType;
  replayedFromId?: string;
  replayInitiator?: ReplayInitiator;
  saved?: boolean;
}

export interface Session {
  id: string;
  label?: string;
  source?: string;
  pid: number;
  startedAt: number;
}

export interface RegisteredSession extends Session {
  token: string;
}

export interface DaemonStatus {
  running: boolean;
  proxyPort?: number;
  sessionCount: number;
  requestCount: number;
  version: string;
  interceptorCount?: number;
}

export interface RequestFilter {
  methods?: string[]; // e.g. ["GET", "POST"]
  statusRange?: string; // e.g. "2xx", "4xx", "401", "500-503"
  search?: string; // substring match on url/path
  regex?: string; // JavaScript regex pattern match on full URL
  regexFlags?: string; // JavaScript regex flags (e.g. "i", "im")
  host?: string; // exact match, or suffix if starts with "."
  pathPrefix?: string; // prefix match on path column
  since?: number; // epoch ms, inclusive lower bound
  before?: number; // epoch ms, exclusive upper bound
  headerName?: string; // header name to filter by (lowercased before querying)
  headerValue?: string; // header value to match (requires headerName)
  headerTarget?: "request" | "response" | "both"; // which headers to search (default "both")
  interceptedBy?: string; // filter by interceptor name
  saved?: boolean; // true = only saved, false = only unsaved, undefined = all
  source?: string; // filter by request source (e.g. "node", "python", "curl")
}

/**
 * Result from a JSON body query — a summary with the extracted value appended.
 */
export interface JsonQueryResult extends CapturedRequestSummary {
  extractedValue: unknown;
}

// --- Interceptor types ---

export interface InterceptorRequest {
  method: string;
  url: string;
  host: string;
  path: string;
  headers: Record<string, string>;
  body?: Buffer;
}

export interface InterceptorResponse {
  status: number;
  headers?: Record<string, string>;
  body?: string | Buffer;
}

export interface InterceptorContext {
  request: Readonly<InterceptorRequest>;
  forward: () => Promise<InterceptorResponse>;
  procsi: ProcsiClient;
  log: (message: string) => void;
}

export interface Interceptor {
  name?: string;
  match?: (request: InterceptorRequest) => boolean | Promise<boolean>;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- handler may return void (implicit return)
  handler: (ctx: InterceptorContext) => Promise<InterceptorResponse | undefined | void>;
}

export interface ProcsiClient {
  countRequests(filter?: RequestFilter): Promise<number>;
  listRequests(options?: {
    filter?: RequestFilter;
    limit?: number;
    offset?: number;
  }): Promise<CapturedRequestSummary[]>;
  getRequest(id: string): Promise<CapturedRequest | null>;
  searchBodies(options: {
    query: string;
    target?: BodySearchTarget;
    filter?: RequestFilter;
    limit?: number;
  }): Promise<CapturedRequestSummary[]>;
  queryJsonBodies(options: {
    jsonPath: string;
    filter?: RequestFilter;
  }): Promise<JsonQueryResult[]>;
}

export interface InterceptorInfo {
  name: string;
  hasMatch: boolean;
  sourceFile: string;
  error?: string;
}

// --- Interceptor event log types ---

export type InterceptorEventType =
  | "matched"
  | "mocked"
  | "modified"
  | "observed"
  | "match_error"
  | "match_timeout"
  | "handler_error"
  | "handler_timeout"
  | "invalid_response"
  | "forward_after_complete"
  | "load_error"
  | "loaded"
  | "reload"
  | "user_log";

export type InterceptorEventLevel = "info" | "warn" | "error";

export interface InterceptorEvent {
  seq: number;
  timestamp: number;
  type: InterceptorEventType;
  level: InterceptorEventLevel;
  interceptor: string;
  message: string;
  requestId?: string;
  requestUrl?: string;
  requestMethod?: string;
  error?: string;
}
