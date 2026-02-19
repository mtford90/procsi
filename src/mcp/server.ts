/**
 * procsi MCP server — exposes read-only traffic inspection tools
 * to MCP clients (AI agents, IDE integrations, etc.).
 *
 * Connects to the daemon's existing control socket to query captured traffic.
 */

import * as fsp from "node:fs/promises";
import * as path from "node:path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ControlClient } from "../shared/control-client.js";
import { getProcsiPaths } from "../shared/project.js";
import { getProcsiVersion } from "../shared/version.js";
import { isTextContentType, isJsonContentType } from "../shared/content-type.js";
import { normaliseRegexFilterInput } from "../shared/regex-filter.js";
import type {
  CapturedRequest,
  CapturedRequestSummary,
  DaemonStatus,
  InterceptorInfo,
  JsonQueryResult,
  RequestFilter,
  Session,
} from "../shared/types.js";

const DEFAULT_LIST_LIMIT = 50;
const MAX_LIST_LIMIT = 500;
const JSON_INDENT = 2;

function textResult(text: string, isError?: boolean) {
  return {
    content: [{ type: "text" as const, text }],
    ...(isError ? { isError: true as const } : {}),
  };
}

const FORMAT_SCHEMA = z
  .enum(["text", "json"])
  .optional()
  .default("text")
  .describe('Output format: "text" (default) or "json" (structured).');

function jsonResult(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, JSON_INDENT) }],
  };
}

/**
 * Format a body buffer for display in text output.
 *
 * - **Binary** (non-text content type): returns `[binary data, N bytes]`
 * - **JSON** (JSON content type): pretty-prints inside a ```json code fence. Falls back to raw text on parse failure.
 * - **Other text / unknown**: raw UTF-8 string
 */
export function formatBody(body: Buffer | unknown, contentType: string | undefined): string {
  // Binary detection — if we know it's not text, show a placeholder
  if (contentType && !isTextContentType(contentType)) {
    const size = Buffer.isBuffer(body) ? body.length : Buffer.byteLength(String(body));
    return `[binary data, ${formatSize(size)}]`;
  }

  const text = bufferToString(body);

  // JSON pretty-printing
  if (isJsonContentType(contentType)) {
    try {
      const parsed = JSON.parse(text);
      return "```json\n" + JSON.stringify(parsed, null, JSON_INDENT) + "\n```";
    } catch {
      // Malformed JSON — fall through to raw text
    }
  }

  return text;
}

/**
 * JSON-safe representation of a CapturedRequest.
 * Buffers become strings (text) or null (binary), timestamps become ISO strings.
 */
export interface SerialisableRequest {
  id: string;
  sessionId: string;
  label?: string;
  timestamp: string;
  method: string;
  url: string;
  host: string;
  path: string;
  requestHeaders: Record<string, string>;
  requestBody: string | null;
  requestBodyTruncated: boolean;
  requestBodyBinary: boolean;
  responseStatus?: number;
  responseHeaders?: Record<string, string>;
  responseBody: string | null;
  responseBodyTruncated: boolean;
  responseBodyBinary: boolean;
  durationMs?: number;
  interceptedBy?: string;
  interceptionType?: string;
  replayedFromId?: string;
  replayInitiator?: string;
  source?: string;
}

/**
 * Convert a CapturedRequest into a JSON-serialisable object.
 * Text bodies become UTF-8 strings; binary bodies become null with a binary flag.
 */
export function serialiseRequest(req: CapturedRequest): SerialisableRequest {
  const reqContentType = req.requestHeaders?.["content-type"];
  const resContentType = req.responseHeaders?.["content-type"];

  const reqBodyBinary = reqContentType ? !isTextContentType(reqContentType) : false;
  const resBodyBinary = resContentType ? !isTextContentType(resContentType) : false;

  return {
    id: req.id,
    sessionId: req.sessionId,
    ...(req.label !== undefined ? { label: req.label } : {}),
    timestamp: new Date(req.timestamp).toISOString(),
    method: req.method,
    url: req.url,
    host: req.host,
    path: req.path,
    requestHeaders: req.requestHeaders,
    requestBody:
      req.requestBody != null ? (reqBodyBinary ? null : bufferToString(req.requestBody)) : null,
    requestBodyTruncated: req.requestBodyTruncated ?? false,
    requestBodyBinary: reqBodyBinary,
    ...(req.responseStatus !== undefined ? { responseStatus: req.responseStatus } : {}),
    ...(req.responseHeaders ? { responseHeaders: req.responseHeaders } : {}),
    responseBody:
      req.responseBody != null ? (resBodyBinary ? null : bufferToString(req.responseBody)) : null,
    responseBodyTruncated: req.responseBodyTruncated ?? false,
    responseBodyBinary: resBodyBinary,
    ...(req.durationMs !== undefined ? { durationMs: req.durationMs } : {}),
    ...(req.interceptedBy !== undefined ? { interceptedBy: req.interceptedBy } : {}),
    ...(req.interceptionType !== undefined ? { interceptionType: req.interceptionType } : {}),
    ...(req.replayedFromId !== undefined ? { replayedFromId: req.replayedFromId } : {}),
    ...(req.replayInitiator !== undefined ? { replayInitiator: req.replayInitiator } : {}),
    ...(req.source !== undefined ? { source: req.source } : {}),
  };
}

/**
 * Serialise a CapturedRequest into a human/AI-readable text block.
 * Buffers are converted to UTF-8 strings where possible.
 */
export function formatRequest(req: CapturedRequest): string {
  const lines: string[] = [];

  lines.push(`## ${req.method} ${req.url}`);
  lines.push(`**ID:** ${req.id}`);
  lines.push(`**Timestamp:** ${new Date(req.timestamp).toISOString()}`);
  lines.push(`**Host:** ${req.host}`);
  lines.push(`**Path:** ${req.path}`);
  if (req.source) {
    lines.push(`**Source:** ${req.source}`);
  }

  // Surface content-types for quick scanning
  const reqContentType = req.requestHeaders?.["content-type"];
  const resContentType = req.responseHeaders?.["content-type"];
  if (reqContentType) {
    lines.push(`**Request Content-Type:** ${reqContentType}`);
  }
  if (resContentType) {
    lines.push(`**Response Content-Type:** ${resContentType}`);
  }

  if (req.responseStatus !== undefined) {
    lines.push(`**Status:** ${req.responseStatus}`);
  }
  if (req.durationMs !== undefined) {
    lines.push(`**Duration:** ${req.durationMs}ms`);
  }
  if (req.interceptedBy) {
    const type = req.interceptionType ?? "modified";
    lines.push(`**Intercepted by:** ${req.interceptedBy} (${type})`);
  }
  if (req.replayedFromId) {
    lines.push(`**Replayed from:** ${req.replayedFromId}`);
  }
  if (req.replayInitiator) {
    lines.push(`**Replay initiator:** ${req.replayInitiator}`);
  }

  // Request headers
  if (req.requestHeaders && Object.keys(req.requestHeaders).length > 0) {
    lines.push("");
    lines.push("### Request Headers");
    for (const [key, value] of Object.entries(req.requestHeaders)) {
      lines.push(`- **${key}:** ${value}`);
    }
  }

  // Request body
  if (req.requestBody) {
    lines.push("");
    lines.push("### Request Body");
    lines.push(formatBody(req.requestBody, reqContentType));
    if (req.requestBodyTruncated) {
      lines.push("_(truncated)_");
    }
  }

  // Response headers
  if (req.responseHeaders && Object.keys(req.responseHeaders).length > 0) {
    lines.push("");
    lines.push("### Response Headers");
    for (const [key, value] of Object.entries(req.responseHeaders)) {
      lines.push(`- **${key}:** ${value}`);
    }
  }

  // Response body
  if (req.responseBody) {
    lines.push("");
    lines.push("### Response Body");
    lines.push(formatBody(req.responseBody, resContentType));
    if (req.responseBodyTruncated) {
      lines.push("_(truncated)_");
    }
  }

  return lines.join("\n");
}

/**
 * Convert a Buffer (or serialised Buffer from JSON) to a UTF-8 string.
 */
function bufferToString(buf: Buffer | unknown): string {
  if (Buffer.isBuffer(buf)) {
    return buf.toString("utf-8");
  }
  // Handle serialised Buffer from JSON (already revived by ControlClient)
  if (typeof buf === "string") {
    return buf;
  }
  return String(buf);
}

const BYTES_PER_KB = 1024;

/**
 * Format a byte count into a compact human-readable string.
 * Returns "0B" for zero, otherwise e.g. "500B", "1.2KB", "3.5MB".
 */
export function formatSize(bytes: number): string {
  if (bytes === 0) return "0B";
  if (bytes < BYTES_PER_KB) return `${bytes}B`;
  const kb = bytes / BYTES_PER_KB;
  if (kb < BYTES_PER_KB) return `${kb.toFixed(1)}KB`;
  const mb = kb / BYTES_PER_KB;
  return `${mb.toFixed(1)}MB`;
}

/**
 * Format a Session into a concise one-line description.
 */
export function formatSession(session: Session): string {
  const label = session.label ? ` (${session.label})` : "";
  const started = new Date(session.startedAt).toISOString();
  const source = session.source ? ` [${session.source}]` : "";
  return `[${session.id}] PID ${session.pid}${label} — started ${started}${source}`;
}

/**
 * Format an InterceptorInfo into a concise one-line description.
 */
export function formatInterceptor(info: InterceptorInfo): string {
  const matchLabel = info.hasMatch ? "[has match]" : "[match all]";
  const errorSuffix = info.error ? ` \u2014 Error: ${info.error}` : "";
  return `${info.name} (${info.sourceFile}) ${matchLabel}${errorSuffix}`;
}

/**
 * Format a summary into a concise one-line description.
 */
export function formatSummary(req: CapturedRequestSummary): string {
  const ts = new Date(req.timestamp).toISOString();
  const status = req.responseStatus !== undefined ? ` → ${req.responseStatus}` : " → pending";
  const duration = req.durationMs !== undefined ? ` (${req.durationMs}ms)` : "";
  const hasBody = req.requestBodySize > 0 || req.responseBodySize > 0;
  const bodySizes = hasBody
    ? ` [^${formatSize(req.requestBodySize)} v${formatSize(req.responseBodySize)}]`
    : "";
  const interceptionTag =
    req.interceptionType === "mocked" ? " [M]" : req.interceptionType === "modified" ? " [I]" : "";
  const savedTag = req.saved ? " [S]" : "";
  const replayTag = req.replayedFromId ? " [R]" : "";
  const sourceTag = req.source ? ` [${req.source}]` : "";
  return `[${req.id}] ${ts} ${req.method} ${req.url}${status}${duration}${bodySizes}${interceptionTag}${savedTag}${replayTag}${sourceTag}`;
}

const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;

/**
 * Validate and normalise a status_range value.
 * Accepts Nxx patterns, exact codes (e.g. "401"), and numeric ranges (e.g. "500-503").
 */
function validateStatusRange(value: string): string {
  // Nxx pattern
  if (/^[1-5]xx$/.test(value)) {
    return value;
  }

  // Numeric range — e.g. "500-503"
  const rangeMatch = value.match(/^(\d{3})-(\d{3})$/);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const low = parseInt(rangeMatch[1], 10);
    const high = parseInt(rangeMatch[2], 10);
    if (low < MIN_HTTP_STATUS || low > MAX_HTTP_STATUS) {
      throw new Error(
        `Invalid status_range "${value}". Lower bound ${low} is outside valid HTTP status range (${MIN_HTTP_STATUS}-${MAX_HTTP_STATUS}).`
      );
    }
    if (high < MIN_HTTP_STATUS || high > MAX_HTTP_STATUS) {
      throw new Error(
        `Invalid status_range "${value}". Upper bound ${high} is outside valid HTTP status range (${MIN_HTTP_STATUS}-${MAX_HTTP_STATUS}).`
      );
    }
    if (low > high) {
      throw new Error(
        `Invalid status_range "${value}". Lower bound (${low}) must not exceed upper bound (${high}).`
      );
    }
    return value;
  }

  // Exact code — e.g. "401"
  if (/^\d{3}$/.test(value)) {
    const code = parseInt(value, 10);
    if (code < MIN_HTTP_STATUS || code > MAX_HTTP_STATUS) {
      throw new Error(
        `Invalid status_range "${value}". Status code must be between ${MIN_HTTP_STATUS} and ${MAX_HTTP_STATUS}.`
      );
    }
    return value;
  }

  throw new Error(
    `Invalid status_range "${value}". Expected format: Nxx (e.g. 2xx), exact code (e.g. 401), or range (e.g. 500-503).`
  );
}

/**
 * Build a RequestFilter from optional MCP tool parameters.
 */
export function buildFilter(params: {
  method?: string;
  status_range?: string;
  search?: string;
  regex?: string;
  host?: string;
  path?: string;
  since?: string;
  before?: string;
  header_name?: string;
  header_value?: string;
  header_target?: "request" | "response" | "both";
  intercepted_by?: string;
  saved?: boolean;
  source?: string;
}): RequestFilter | undefined {
  const filter: RequestFilter = {};

  if (params.method) {
    filter.methods = params.method
      .split(",")
      .map((m) => m.trim().toUpperCase())
      .filter((m) => m.length > 0);
    if (filter.methods.length === 0) {
      delete filter.methods;
    }
  }
  if (params.status_range) {
    filter.statusRange = validateStatusRange(params.status_range);
  }
  if (params.search) {
    filter.search = params.search;
  }
  if (params.regex) {
    const regex = normaliseRegexFilterInput(params.regex);
    filter.regex = regex.pattern;
    if (regex.flags) {
      filter.regexFlags = regex.flags;
    }
  }
  if (params.host) {
    filter.host = params.host;
  }
  if (params.path) {
    filter.pathPrefix = params.path;
  }
  if (params.since) {
    const ts = new Date(params.since).getTime();
    if (isNaN(ts)) {
      throw new Error(`Invalid since timestamp "${params.since}". Expected ISO 8601 format.`);
    }
    filter.since = ts;
  }
  if (params.before) {
    const ts = new Date(params.before).getTime();
    if (isNaN(ts)) {
      throw new Error(`Invalid before timestamp "${params.before}". Expected ISO 8601 format.`);
    }
    filter.before = ts;
  }
  if (params.header_name) {
    filter.headerName = params.header_name;
  }
  if (params.header_value) {
    filter.headerValue = params.header_value;
  }
  if (params.header_target) {
    filter.headerTarget = params.header_target;
  }
  if (params.intercepted_by) {
    filter.interceptedBy = params.intercepted_by;
  }
  if (params.saved !== undefined) {
    filter.saved = params.saved;
  }
  if (params.source) {
    filter.source = params.source;
  }

  return Object.keys(filter).length > 0 ? filter : undefined;
}

/**
 * Clamp a limit value to a safe range.
 */
export function clampLimit(limit: number | undefined): number {
  if (limit === undefined) return DEFAULT_LIST_LIMIT;
  return Math.floor(Math.max(1, Math.min(limit, MAX_LIST_LIMIT)));
}

function resolveInterceptorPath(interceptorsDir: string, requestedPath: string): string {
  const trimmed = requestedPath.trim();
  if (!trimmed) {
    throw new Error("Path is required.");
  }

  const absoluteInterceptorsDir = path.resolve(interceptorsDir);
  const absoluteTarget = path.resolve(absoluteInterceptorsDir, trimmed);
  const relative = path.relative(absoluteInterceptorsDir, absoluteTarget);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error("Interceptor path must stay inside .procsi/interceptors/.");
  }

  if (!absoluteTarget.endsWith(".ts")) {
    throw new Error("Interceptor path must end with .ts");
  }

  return absoluteTarget;
}

export interface McpServerOptions {
  projectRoot: string;
}

/**
 * Create and configure the procsi MCP server.
 * Returns the server instance (call `start()` to connect transport).
 */
export function createProcsiMcpServer(options: McpServerOptions) {
  const { projectRoot } = options;
  const paths = getProcsiPaths(projectRoot);
  const version = getProcsiVersion();

  const server = new McpServer({
    name: "procsi",
    version,
  });

  const client = new ControlClient(paths.controlSocketFile);

  // --- procsi_get_status ---
  server.tool(
    "procsi_get_status",
    "Get the current status of the procsi proxy daemon — running state, proxy port, session count, and total captured request count. Use this to check if the daemon is running before calling other tools.",
    {},
    async () => {
      try {
        const status: DaemonStatus = await client.status();
        const lines = [
          `**Running:** ${status.running}`,
          `**Proxy Port:** ${status.proxyPort ?? "unknown"}`,
          `**Sessions:** ${status.sessionCount}`,
          `**Requests Captured:** ${status.requestCount}`,
          `**Version:** ${status.version}`,
        ];
        if (status.interceptorCount !== undefined) {
          lines.push(`**Interceptors:** ${status.interceptorCount}`);
        }
        return textResult(lines.join("\n"));
      } catch (err) {
        return textResult(
          `Failed to connect to procsi daemon. Is it running? Error: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_list_requests ---
  server.tool(
    "procsi_list_requests",
    "Search and filter captured HTTP requests. Returns summaries (method, URL, status, timing). Supports filtering by HTTP method(s), status code (range, exact, or Nxx pattern), host, path prefix, time window, URL substring/regex, and headers. Use procsi_get_request with a request ID to fetch full headers and bodies.",
    {
      method: z
        .string()
        .optional()
        .describe(
          "Filter by HTTP method (e.g. 'GET', 'POST'). Case-insensitive. Comma-separated for multiple methods (e.g. 'GET,POST')."
        ),
      status_range: z
        .string()
        .optional()
        .describe(
          "Filter by status code. Accepts Nxx patterns (e.g. '2xx'), exact codes (e.g. '401'), or numeric ranges (e.g. '500-503')."
        ),
      search: z
        .string()
        .optional()
        .describe("Case-insensitive substring match against the full URL and path."),
      regex: z
        .string()
        .optional()
        .describe(
          "JavaScript regex pattern to match against the full URL (e.g. 'users/\\d+$' or '/users\\\\/\\\\d+/i')."
        ),
      host: z
        .string()
        .optional()
        .describe(
          "Filter by host/domain. Exact match by default. Prefix with '.' for suffix matching (e.g. '.example.com' matches 'api.example.com')."
        ),
      path: z
        .string()
        .optional()
        .describe("Filter by path prefix (e.g. '/api/v2' matches '/api/v2/users')."),
      since: z
        .string()
        .optional()
        .describe(
          "Only include requests after this ISO 8601 timestamp (e.g. '2024-01-15T10:30:00Z')."
        ),
      before: z
        .string()
        .optional()
        .describe("Only include requests before this ISO 8601 timestamp."),
      header_name: z
        .string()
        .optional()
        .describe(
          "Filter by header name (case-insensitive). When used alone, matches requests that have this header. Combine with header_value for exact value matching."
        ),
      header_value: z
        .string()
        .optional()
        .describe(
          "Filter by header value (requires header_name). Only returns requests where the specified header has this exact value."
        ),
      header_target: z
        .enum(["request", "response", "both"])
        .optional()
        .describe('Which headers to search: "request", "response", or "both" (default "both").'),
      intercepted_by: z
        .string()
        .optional()
        .describe("Filter by interceptor name. Only returns requests handled by this interceptor."),
      saved: z
        .boolean()
        .optional()
        .describe("Filter by saved/bookmarked state. true = only saved, false = only unsaved."),
      source: z.string().optional().describe("Filter by request source (e.g. 'node', 'python')."),
      limit: z
        .number()
        .optional()
        .describe(`Max results to return (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT})`),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Offset for pagination (0-based, must be a non-negative integer)"),
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const filter = buildFilter(params);
        const limit = clampLimit(params.limit);
        const [summaries, total] = await Promise.all([
          client.listRequestsSummary({ limit, offset: params.offset, filter }),
          client.countRequests({ filter }),
        ]);

        if (params.format === "json") {
          return jsonResult({
            total,
            showing: summaries.length,
            requests: summaries.map((s) => ({
              ...s,
              timestamp: new Date(s.timestamp).toISOString(),
            })),
          });
        }

        if (summaries.length === 0) {
          if (total > 0) {
            return textResult(
              `No requests found. (${total.toLocaleString()} total, none in current page)`
            );
          }
          return textResult("No requests found.");
        }

        const lines = summaries.map(formatSummary);
        const header = `Showing ${summaries.length} of ${total.toLocaleString()} request(s):`;
        return textResult(`${header}\n\n${lines.join("\n")}`);
      } catch (err) {
        return textResult(
          `Failed to list requests: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_get_request ---
  server.tool(
    "procsi_get_request",
    "Fetch full details of captured HTTP request(s) by ID — including all headers, request/response bodies, timing, and status. Supports comma-separated IDs for batch fetching. Get request IDs from procsi_list_requests or procsi_search_bodies.",
    {
      id: z
        .string()
        .describe("The request ID (UUID), or multiple comma-separated IDs (e.g. 'id1,id2,id3')."),
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const ids = params.id
          .split(",")
          .map((s) => s.trim())
          .filter((s) => s.length > 0);

        if (ids.length === 0) {
          return textResult("No valid IDs provided.", true);
        }

        const found: CapturedRequest[] = [];
        const notFound: string[] = [];

        for (const id of ids) {
          const request: CapturedRequest | null = await client.getRequest(id);
          if (request) {
            found.push(request);
          } else {
            notFound.push(id);
          }
        }

        if (params.format === "json") {
          return jsonResult({
            requests: found.map(serialiseRequest),
            notFound,
          });
        }

        if (found.length === 0) {
          const idList = notFound.join(", ");
          return textResult(`No request(s) found with ID(s): ${idList}`, true);
        }

        let output = found.map(formatRequest).join("\n\n---\n\n");
        if (notFound.length > 0) {
          output += `\n\nNot found: ${notFound.join(", ")}`;
        }

        return textResult(output);
      } catch (err) {
        return textResult(
          `Failed to get request: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_search_bodies ---
  server.tool(
    "procsi_search_bodies",
    "Search through request and/or response body content for a text substring. Only searches text-based bodies (JSON, HTML, XML, etc.), skipping binary content. Supports body target selection (request/response/both), plus filtering by method(s), status code, host, path prefix, URL regex, time window, and headers. Returns summaries — use procsi_get_request for full details.",
    {
      query: z
        .string()
        .describe(
          "Text to search for in request/response bodies. Case-insensitive substring match."
        ),
      target: z
        .enum(["request", "response", "both"])
        .optional()
        .describe('Which body to search: "request", "response", or "both" (default "both").'),
      method: z
        .string()
        .optional()
        .describe(
          "Filter by HTTP method (e.g. 'GET', 'POST'). Case-insensitive. Comma-separated for multiple methods (e.g. 'GET,POST')."
        ),
      status_range: z
        .string()
        .optional()
        .describe(
          "Filter by status code. Accepts Nxx patterns (e.g. '2xx'), exact codes (e.g. '401'), or numeric ranges (e.g. '500-503')."
        ),
      regex: z
        .string()
        .optional()
        .describe(
          "JavaScript regex pattern to match against the full URL (e.g. 'users/\\d+$' or '/users\\\\/\\\\d+/i')."
        ),
      host: z
        .string()
        .optional()
        .describe(
          "Filter by host/domain. Exact match by default. Prefix with '.' for suffix matching (e.g. '.example.com' matches 'api.example.com')."
        ),
      path: z
        .string()
        .optional()
        .describe("Filter by path prefix (e.g. '/api/v2' matches '/api/v2/users')."),
      since: z
        .string()
        .optional()
        .describe(
          "Only include requests after this ISO 8601 timestamp (e.g. '2024-01-15T10:30:00Z')."
        ),
      before: z
        .string()
        .optional()
        .describe("Only include requests before this ISO 8601 timestamp."),
      header_name: z
        .string()
        .optional()
        .describe(
          "Filter by header name (case-insensitive). When used alone, matches requests that have this header. Combine with header_value for exact value matching."
        ),
      header_value: z
        .string()
        .optional()
        .describe(
          "Filter by header value (requires header_name). Only returns requests where the specified header has this exact value."
        ),
      header_target: z
        .enum(["request", "response", "both"])
        .optional()
        .describe('Which headers to search: "request", "response", or "both" (default "both").'),
      intercepted_by: z
        .string()
        .optional()
        .describe("Filter by interceptor name. Only returns requests handled by this interceptor."),
      saved: z
        .boolean()
        .optional()
        .describe("Filter by saved/bookmarked state. true = only saved, false = only unsaved."),
      source: z.string().optional().describe("Filter by request source (e.g. 'node', 'python')."),
      limit: z
        .number()
        .optional()
        .describe(`Max results to return (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT})`),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Offset for pagination (0-based, must be a non-negative integer)"),
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const filter = buildFilter(params);
        const summaries: CapturedRequestSummary[] = await client.searchBodies({
          query: params.query,
          target: params.target,
          limit: clampLimit(params.limit),
          offset: params.offset,
          filter,
        });

        if (params.format === "json") {
          return jsonResult({
            query: params.query,
            total: summaries.length,
            requests: summaries.map((s) => ({
              ...s,
              timestamp: new Date(s.timestamp).toISOString(),
            })),
          });
        }

        if (summaries.length === 0) {
          return textResult(`No requests found with body content matching: "${params.query}"`);
        }

        const lines = summaries.map(formatSummary);
        const header = `Found ${summaries.length} request(s) with body content matching "${params.query}":`;
        return textResult(`${header}\n\n${lines.join("\n")}`);
      } catch (err) {
        return textResult(
          `Failed to search bodies: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_count_requests ---
  server.tool(
    "procsi_count_requests",
    "Count captured HTTP requests, optionally filtered. Useful for checking total traffic volume or verifying how many requests match a filter before paginating through them.",
    {
      method: z
        .string()
        .optional()
        .describe(
          "Filter by HTTP method (e.g. 'GET', 'POST'). Case-insensitive. Comma-separated for multiple methods (e.g. 'GET,POST')."
        ),
      status_range: z
        .string()
        .optional()
        .describe(
          "Filter by status code. Accepts Nxx patterns (e.g. '2xx'), exact codes (e.g. '401'), or numeric ranges (e.g. '500-503')."
        ),
      search: z
        .string()
        .optional()
        .describe("Case-insensitive substring match against the full URL and path."),
      host: z
        .string()
        .optional()
        .describe(
          "Filter by host/domain. Exact match by default. Prefix with '.' for suffix matching (e.g. '.example.com' matches 'api.example.com')."
        ),
      path: z
        .string()
        .optional()
        .describe("Filter by path prefix (e.g. '/api/v2' matches '/api/v2/users')."),
      since: z
        .string()
        .optional()
        .describe(
          "Only include requests after this ISO 8601 timestamp (e.g. '2024-01-15T10:30:00Z')."
        ),
      before: z
        .string()
        .optional()
        .describe("Only include requests before this ISO 8601 timestamp."),
      header_name: z
        .string()
        .optional()
        .describe(
          "Filter by header name (case-insensitive). When used alone, matches requests that have this header. Combine with header_value for exact value matching."
        ),
      header_value: z
        .string()
        .optional()
        .describe(
          "Filter by header value (requires header_name). Only returns requests where the specified header has this exact value."
        ),
      header_target: z
        .enum(["request", "response", "both"])
        .optional()
        .describe('Which headers to search: "request", "response", or "both" (default "both").'),
      intercepted_by: z
        .string()
        .optional()
        .describe("Filter by interceptor name. Only returns requests handled by this interceptor."),
      saved: z
        .boolean()
        .optional()
        .describe("Filter by saved/bookmarked state. true = only saved, false = only unsaved."),
      source: z.string().optional().describe("Filter by request source (e.g. 'node', 'python')."),
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const filter = buildFilter(params);
        const count = await client.countRequests({ filter });

        if (params.format === "json") {
          return jsonResult({ count });
        }

        return textResult(`${count} request(s)`);
      } catch (err) {
        return textResult(
          `Failed to count requests: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_query_json ---
  server.tool(
    "procsi_query_json",
    "Extract values from JSON request/response bodies using JSONPath syntax (SQLite json_extract). Only queries bodies with JSON content types. Use this to find requests where a specific JSON field exists or has a particular value.",
    {
      json_path: z
        .string()
        .describe(
          "JSONPath expression to extract (e.g. '$.user.name', '$.items[0].id', '$.status'). Uses SQLite json_extract syntax."
        ),
      value: z
        .string()
        .optional()
        .describe(
          "Only return requests where the extracted value equals this string. Useful for finding requests with specific field values."
        ),
      target: z
        .enum(["request", "response", "both"])
        .optional()
        .describe(
          'Which body to query: "request", "response", or "both" (default "both"). When "both", prefers the request body value.'
        ),
      method: z
        .string()
        .optional()
        .describe(
          "Filter by HTTP method (e.g. 'GET', 'POST'). Case-insensitive. Comma-separated for multiple methods (e.g. 'GET,POST')."
        ),
      status_range: z
        .string()
        .optional()
        .describe(
          "Filter by status code. Accepts Nxx patterns (e.g. '2xx'), exact codes (e.g. '401'), or numeric ranges (e.g. '500-503')."
        ),
      host: z
        .string()
        .optional()
        .describe(
          "Filter by host/domain. Exact match by default. Prefix with '.' for suffix matching (e.g. '.example.com' matches 'api.example.com')."
        ),
      path: z
        .string()
        .optional()
        .describe("Filter by path prefix (e.g. '/api/v2' matches '/api/v2/users')."),
      since: z
        .string()
        .optional()
        .describe(
          "Only include requests after this ISO 8601 timestamp (e.g. '2024-01-15T10:30:00Z')."
        ),
      before: z
        .string()
        .optional()
        .describe("Only include requests before this ISO 8601 timestamp."),
      header_name: z.string().optional().describe("Filter by header name (case-insensitive)."),
      header_value: z
        .string()
        .optional()
        .describe("Filter by header value (requires header_name)."),
      header_target: z
        .enum(["request", "response", "both"])
        .optional()
        .describe('Which headers to search: "request", "response", or "both" (default "both").'),
      saved: z
        .boolean()
        .optional()
        .describe("Filter by saved/bookmarked state. true = only saved, false = only unsaved."),
      source: z.string().optional().describe("Filter by request source (e.g. 'node', 'python')."),
      limit: z
        .number()
        .optional()
        .describe(`Max results to return (default ${DEFAULT_LIST_LIMIT}, max ${MAX_LIST_LIMIT})`),
      offset: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Offset for pagination (0-based, must be a non-negative integer)"),
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const filter = buildFilter(params);
        const results: JsonQueryResult[] = await client.queryJsonBodies({
          jsonPath: params.json_path,
          value: params.value,
          target: params.target,
          limit: clampLimit(params.limit),
          offset: params.offset,
          filter,
        });

        if (params.format === "json") {
          return jsonResult({
            json_path: params.json_path,
            total: results.length,
            results: results.map((r) => ({
              ...r,
              timestamp: new Date(r.timestamp).toISOString(),
            })),
          });
        }

        if (results.length === 0) {
          return textResult(`No JSON bodies found with path: "${params.json_path}"`);
        }

        const lines = results.map((r) => {
          const summary = formatSummary(r);
          const valueStr =
            typeof r.extractedValue === "string"
              ? r.extractedValue
              : JSON.stringify(r.extractedValue);
          return `${summary} → ${params.json_path}=${valueStr}`;
        });
        const header = `Found ${results.length} request(s) with JSON path "${params.json_path}":`;
        return textResult(`${header}\n\n${lines.join("\n")}`);
      } catch (err) {
        return textResult(
          `Failed to query JSON bodies: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_clear_requests ---
  server.tool(
    "procsi_clear_requests",
    "Clear all captured HTTP requests from storage. This is irreversible.",
    {},
    async () => {
      try {
        await client.clearRequests();
        return textResult("All requests cleared.");
      } catch (err) {
        return textResult(
          `Failed to clear requests: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_replay_request ---
  server.tool(
    "procsi_replay_request",
    "Replay a previously captured HTTP request, optionally overriding method, URL, headers, or body. The replay is captured like normal traffic and can be inspected via procsi_list_requests/procsi_get_request.",
    {
      id: z.string().describe("The captured request ID to replay."),
      method: z.string().optional().describe("Override HTTP method (e.g. GET, POST, PUT)."),
      url: z.string().optional().describe("Override full URL for the replayed request."),
      set_headers: z
        .record(z.string(), z.string())
        .optional()
        .describe("Headers to set/override on replay (key-value map)."),
      remove_headers: z
        .array(z.string())
        .optional()
        .describe("Header names to remove before replay."),
      body: z.string().optional().describe("Override request body as UTF-8 text."),
      body_base64: z
        .string()
        .optional()
        .describe("Override request body as base64-encoded bytes (for binary payloads)."),
      timeout_ms: z
        .number()
        .optional()
        .describe("Replay timeout in milliseconds (clamped to a safe range)."),
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const replayed = await client.replayRequest({
          id: params.id,
          method: params.method,
          url: params.url,
          setHeaders: params.set_headers,
          removeHeaders: params.remove_headers,
          body: params.body,
          bodyBase64: params.body_base64,
          timeoutMs: params.timeout_ms,
          initiator: "mcp",
        });

        if (params.format === "json") {
          return jsonResult({
            requestId: replayed.requestId,
          });
        }

        return textResult(
          `Replayed request ${params.id} as ${replayed.requestId}. Use procsi_get_request with the new ID to inspect details.`
        );
      } catch (err) {
        return textResult(
          `Failed to replay request: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_save_request ---
  server.tool(
    "procsi_save_request",
    "Save (bookmark) a captured HTTP request so it persists across clear operations. Saved requests are not deleted by procsi_clear_requests and are not evicted by the storage limit.",
    {
      id: z.string().describe("The request ID to save/bookmark."),
    },
    async (params) => {
      try {
        const result = await client.saveRequest(params.id);
        if (result.success) {
          return textResult(`Request ${params.id} saved.`);
        }
        return textResult(`Request ${params.id} not found.`, true);
      } catch (err) {
        return textResult(
          `Failed to save request: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_unsave_request ---
  server.tool(
    "procsi_unsave_request",
    "Remove the saved/bookmark flag from a captured HTTP request. The request will then be subject to normal clear and eviction behaviour.",
    {
      id: z.string().describe("The request ID to unsave/unbookmark."),
    },
    async (params) => {
      try {
        const result = await client.unsaveRequest(params.id);
        if (result.success) {
          return textResult(`Request ${params.id} unsaved.`);
        }
        return textResult(`Request ${params.id} not found.`, true);
      } catch (err) {
        return textResult(
          `Failed to unsave request: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_list_sessions ---
  server.tool(
    "procsi_list_sessions",
    'List all active proxy sessions. Each session represents a process that registered with the daemon (e.g. a shell running `eval "$(procsi on)"`).',
    {},
    async () => {
      try {
        const sessions: Session[] = await client.listSessions();

        if (sessions.length === 0) {
          return textResult("No active sessions.");
        }

        const lines = sessions.map(formatSession);
        const header = `${sessions.length} session(s):`;
        return textResult(`${header}\n\n${lines.join("\n")}`);
      } catch (err) {
        return textResult(
          `Failed to list sessions: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_write_interceptor ---
  server.tool(
    "procsi_write_interceptor",
    "Write or update a TypeScript interceptor file under .procsi/interceptors/, then reload interceptors.",
    {
      path: z
        .string()
        .describe(
          "Relative interceptor path under .procsi/interceptors/ (e.g. 'mock-users.ts' or 'api/mock-auth.ts')."
        ),
      content: z.string().describe("Full TypeScript file content to write."),
      overwrite: z
        .boolean()
        .optional()
        .default(false)
        .describe("When false (default), fails if the file already exists."),
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const absolutePath = resolveInterceptorPath(paths.interceptorsDir, params.path);
        await fsp.mkdir(path.dirname(absolutePath), { recursive: true });

        if (!params.overwrite) {
          try {
            await fsp.access(absolutePath);
            return textResult(
              `Interceptor file already exists: ${params.path}. Set overwrite=true to replace it.`,
              true
            );
          } catch {
            // File does not exist, safe to proceed.
          }
        }

        await fsp.writeFile(absolutePath, params.content, "utf-8");
        const reload = await client.reloadInterceptors();

        if (params.format === "json") {
          return jsonResult({
            path: path.relative(projectRoot, absolutePath),
            reloaded: reload,
          });
        }

        if (!reload.success) {
          return textResult(
            `Wrote ${path.relative(projectRoot, absolutePath)} but reload failed: ${reload.error ?? "Unknown reload error"}`,
            true
          );
        }

        return textResult(
          `Wrote ${path.relative(projectRoot, absolutePath)} and reloaded interceptors (${reload.count} active).`
        );
      } catch (err) {
        return textResult(
          `Failed to write interceptor: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_delete_interceptor ---
  server.tool(
    "procsi_delete_interceptor",
    "Delete a TypeScript interceptor file under .procsi/interceptors/, then reload interceptors.",
    {
      path: z
        .string()
        .describe(
          "Relative interceptor path under .procsi/interceptors/ (e.g. 'mock-users.ts' or 'api/mock-auth.ts')."
        ),
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const absolutePath = resolveInterceptorPath(paths.interceptorsDir, params.path);
        await fsp.unlink(absolutePath);

        const reload = await client.reloadInterceptors();

        if (params.format === "json") {
          return jsonResult({
            path: path.relative(projectRoot, absolutePath),
            deleted: true,
            reloaded: reload,
          });
        }

        if (!reload.success) {
          return textResult(
            `Deleted ${path.relative(projectRoot, absolutePath)} but reload failed: ${reload.error ?? "Unknown reload error"}`,
            true
          );
        }

        return textResult(
          `Deleted ${path.relative(projectRoot, absolutePath)} and reloaded interceptors (${reload.count} active).`
        );
      } catch (err) {
        return textResult(
          `Failed to delete interceptor: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_list_interceptors ---
  server.tool(
    "procsi_list_interceptors",
    "List all loaded interceptors — their names, source files, whether they have a match function, and any load errors. Use this to check which interceptors are active.",
    {
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const interceptors: InterceptorInfo[] = await client.listInterceptors();

        if (params.format === "json") {
          return jsonResult(interceptors);
        }

        if (interceptors.length === 0) {
          return textResult("No interceptors loaded.");
        }

        const lines = interceptors.map(formatInterceptor);
        const header = `${interceptors.length} interceptor(s):`;
        return textResult(`${header}\n\n${lines.join("\n")}`);
      } catch (err) {
        return textResult(
          `Failed to list interceptors: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_reload_interceptors ---
  server.tool(
    "procsi_reload_interceptors",
    "Reload interceptors from disk. Use after editing interceptor files to apply changes without restarting the daemon.",
    {
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const result = await client.reloadInterceptors();

        if (params.format === "json") {
          return jsonResult(result);
        }

        if (!result.success) {
          return textResult(result.error ?? "Reload failed", true);
        }

        return textResult(
          `Interceptors reloaded successfully. ${result.count} interceptor(s) loaded.`
        );
      } catch (err) {
        return textResult(
          `Failed to reload interceptors: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  // --- procsi_get_interceptor_events ---
  server.tool(
    "procsi_get_interceptor_events",
    "Get interceptor runtime events — matches, errors, timeouts, and ctx.log() messages. Use this to debug interceptor behaviour. Typical workflow: list_interceptors → get_interceptor_events level=error → fix code → reload_interceptors → check events again.",
    {
      limit: z.number().optional().describe("Maximum number of events to return (default 100)."),
      level: z
        .enum(["info", "warn", "error"])
        .optional()
        .describe(
          'Minimum severity level: "info" (all), "warn" (warnings + errors), "error" (errors only).'
        ),
      interceptor: z.string().optional().describe("Filter by interceptor name."),
      type: z
        .enum([
          "matched",
          "mocked",
          "modified",
          "observed",
          "match_error",
          "match_timeout",
          "handler_error",
          "handler_timeout",
          "invalid_response",
          "forward_after_complete",
          "load_error",
          "loaded",
          "reload",
          "user_log",
        ])
        .optional()
        .describe('Filter by event type (e.g. "handler_error", "mocked", "user_log").'),
      format: FORMAT_SCHEMA,
    },
    async (params) => {
      try {
        const result = await client.getInterceptorEvents({
          limit: params.limit,
          level: params.level,
          interceptor: params.interceptor,
          type: params.type,
        });

        if (params.format === "json") {
          return jsonResult({
            total: result.events.length,
            counts: result.counts,
            events: result.events.map((e) => ({
              ...e,
              timestamp: new Date(e.timestamp).toISOString(),
            })),
          });
        }

        if (result.events.length === 0) {
          return textResult("No interceptor events.");
        }

        const lines = result.events.map((e) => {
          const ts = new Date(e.timestamp).toISOString();
          const parts = [`[${ts}]`, `[${e.level.toUpperCase()}]`, `[${e.interceptor}]`, e.message];
          if (e.error) {
            parts.push(`\n  Error: ${e.error}`);
          }
          return parts.join(" ");
        });

        const { info, warn, error } = result.counts;
        const header = `${result.events.length} event(s) (totals: ${info} info, ${warn} warn, ${error} error):`;
        return textResult(`${header}\n\n${lines.join("\n")}`);
      } catch (err) {
        return textResult(
          `Failed to get interceptor events: ${err instanceof Error ? err.message : "Unknown error"}`,
          true
        );
      }
    }
  );

  return {
    server,
    client,
    /**
     * Start the MCP server with stdio transport.
     */
    async start(): Promise<void> {
      const transport = new StdioServerTransport();
      await server.connect(transport);
    },
    /**
     * Shut down cleanly.
     */
    async close(): Promise<void> {
      client.close();
      await server.close();
    },
  };
}
