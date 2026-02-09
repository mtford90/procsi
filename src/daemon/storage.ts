import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type {
  CapturedRequest,
  CapturedRequestSummary,
  JsonQueryResult,
  RequestFilter,
  Session,
} from "../shared/types.js";
import { createLogger, type LogLevel, type Logger } from "../shared/logger.js";
import {
  normaliseContentType,
  buildTextContentTypeSqlCondition,
  buildJsonContentTypeSqlCondition,
} from "../shared/content-type.js";

const DEFAULT_QUERY_LIMIT = 1000;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    label TEXT,
    pid INTEGER NOT NULL,
    started_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    label TEXT,
    timestamp INTEGER NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    host TEXT NOT NULL,
    path TEXT NOT NULL,
    request_headers TEXT,
    request_body BLOB,
    request_body_truncated INTEGER DEFAULT 0,
    response_status INTEGER,
    response_headers TEXT,
    response_body BLOB,
    response_body_truncated INTEGER DEFAULT 0,
    duration_ms INTEGER,
    request_content_type TEXT,
    response_content_type TEXT,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
CREATE INDEX IF NOT EXISTS idx_requests_label ON requests(label);
CREATE INDEX IF NOT EXISTS idx_requests_method ON requests(method);
CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(response_status);
CREATE INDEX IF NOT EXISTS idx_requests_host ON requests(host);
`;

interface Migration {
  version: number;
  description: string;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  {
    version: 1,
    description: "Add body truncation tracking columns",
    sql: `
      ALTER TABLE requests ADD COLUMN request_body_truncated INTEGER DEFAULT 0;
      ALTER TABLE requests ADD COLUMN response_body_truncated INTEGER DEFAULT 0;
    `,
  },
  {
    version: 2,
    description: "Add indices for method and status filtering",
    sql: `
      CREATE INDEX IF NOT EXISTS idx_requests_method ON requests(method);
      CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(response_status);
    `,
  },
  {
    version: 3,
    description: "Add content-type columns for efficient body searching",
    sql: `
      ALTER TABLE requests ADD COLUMN request_content_type TEXT;
      ALTER TABLE requests ADD COLUMN response_content_type TEXT;
    `,
  },
  {
    version: 4,
    description: "Add index on host for host-based filtering",
    sql: `CREATE INDEX IF NOT EXISTS idx_requests_host ON requests(host);`,
  },
];

const STATUS_RANGE_MULTIPLIER = 100;
const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;

/**
 * Escape SQL LIKE wildcards in user input to prevent unintended pattern matching.
 */
function escapeLikeWildcards(input: string): string {
  return input.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

/**
 * Apply status range filter condition. Supports three formats:
 * - Nxx pattern (e.g. "2xx") → range from N00 to (N+1)00
 * - Exact code (e.g. "401") → exact match
 * - Numeric range (e.g. "500-503") → inclusive range
 */
function applyStatusCondition(
  conditions: string[],
  params: (string | number)[],
  statusRange: string
): void {
  // Nxx pattern — e.g. "2xx", "4xx"
  if (/^[1-5]xx$/.test(statusRange)) {
    const firstDigit = parseInt(statusRange.charAt(0), 10);
    const lower = firstDigit * STATUS_RANGE_MULTIPLIER;
    const upper = (firstDigit + 1) * STATUS_RANGE_MULTIPLIER;
    conditions.push("response_status >= ? AND response_status < ?");
    params.push(lower, upper);
    return;
  }

  // Numeric range — e.g. "500-503"
  const rangeMatch = statusRange.match(/^(\d{3})-(\d{3})$/);
  if (rangeMatch && rangeMatch[1] && rangeMatch[2]) {
    const low = parseInt(rangeMatch[1], 10);
    const high = parseInt(rangeMatch[2], 10);
    if (low >= MIN_HTTP_STATUS && high <= MAX_HTTP_STATUS && low <= high) {
      conditions.push("response_status >= ? AND response_status <= ?");
      params.push(low, high);
      return;
    }
  }

  // Exact code — e.g. "401"
  if (/^\d{3}$/.test(statusRange)) {
    const code = parseInt(statusRange, 10);
    if (code >= MIN_HTTP_STATUS && code <= MAX_HTTP_STATUS) {
      conditions.push("response_status = ?");
      params.push(code);
      return;
    }
  }

  // Unrecognised format — silently ignored at the storage layer
  // (validation should happen upstream in MCP/control server)
}

/**
 * Apply RequestFilter conditions to an existing SQL conditions/params array.
 * Mutates both arrays in place.
 */
function applyFilterConditions(
  conditions: string[],
  params: (string | number)[],
  filter: RequestFilter | undefined
): void {
  if (!filter) return;

  if (filter.methods && filter.methods.length > 0) {
    const placeholders = filter.methods.map(() => "?").join(", ");
    conditions.push(`method IN (${placeholders})`);
    params.push(...filter.methods);
  }

  if (filter.statusRange) {
    applyStatusCondition(conditions, params, filter.statusRange);
  }

  if (filter.search) {
    const escaped = escapeLikeWildcards(filter.search);
    const pattern = `%${escaped}%`;
    conditions.push("(url LIKE ? ESCAPE '\\' OR path LIKE ? ESCAPE '\\')");
    params.push(pattern, pattern);
  }

  if (filter.host) {
    if (filter.host.startsWith(".")) {
      // Suffix match — e.g. ".example.com" matches "api.example.com"
      const escaped = escapeLikeWildcards(filter.host);
      conditions.push("host LIKE ? ESCAPE '\\'");
      params.push(`%${escaped}`);
    } else {
      // Exact match
      conditions.push("host = ?");
      params.push(filter.host);
    }
  }

  if (filter.pathPrefix) {
    const escaped = escapeLikeWildcards(filter.pathPrefix);
    conditions.push("path LIKE ? ESCAPE '\\'");
    params.push(`${escaped}%`);
  }

  if (filter.since !== undefined) {
    conditions.push("timestamp >= ?");
    params.push(filter.since);
  }

  if (filter.before !== undefined) {
    conditions.push("timestamp < ?");
    params.push(filter.before);
  }

  if (filter.headerName) {
    const name = filter.headerName.toLowerCase();
    const jsonPath = `$."${name}"`;
    const target = filter.headerTarget ?? "both";

    if (filter.headerValue !== undefined) {
      // Name + value match
      if (target === "request") {
        conditions.push("json_extract(request_headers, ?) = ?");
        params.push(jsonPath, filter.headerValue);
      } else if (target === "response") {
        conditions.push("json_extract(response_headers, ?) = ?");
        params.push(jsonPath, filter.headerValue);
      } else {
        conditions.push(
          "(json_extract(request_headers, ?) = ? OR json_extract(response_headers, ?) = ?)"
        );
        params.push(jsonPath, filter.headerValue, jsonPath, filter.headerValue);
      }
    } else {
      // Name-only existence check
      if (target === "request") {
        conditions.push("json_extract(request_headers, ?) IS NOT NULL");
        params.push(jsonPath);
      } else if (target === "response") {
        conditions.push("json_extract(response_headers, ?) IS NOT NULL");
        params.push(jsonPath);
      } else {
        conditions.push(
          "(json_extract(request_headers, ?) IS NOT NULL OR json_extract(response_headers, ?) IS NOT NULL)"
        );
        params.push(jsonPath, jsonPath);
      }
    }
  }
}

export class RequestRepository {
  private db: Database.Database;
  private logger: Logger | undefined;

  constructor(dbPath: string, projectRoot?: string, logLevel?: LogLevel) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);

    // Fresh databases already have the latest schema — stamp to latest version
    // so migrations don't try to re-apply what's already in the CREATE TABLE.
    const currentVersion = this.db.pragma("user_version", { simple: true }) as number;
    if (currentVersion === 0) {
      const hasData =
        (this.db.prepare("SELECT COUNT(*) as count FROM requests").get() as DbCountRow).count > 0;
      if (!hasData) {
        const lastMigration = MIGRATIONS[MIGRATIONS.length - 1];
        const latestVersion = lastMigration ? lastMigration.version : 0;
        this.db.pragma(`user_version = ${latestVersion}`);
      }
    }

    this.applyMigrations();

    if (projectRoot) {
      this.logger = createLogger("storage", projectRoot, logLevel);
    }
  }

  /**
   * Apply pending database migrations using SQLite's user_version pragma for tracking.
   */
  private applyMigrations(): void {
    const currentVersion = this.db.pragma("user_version", { simple: true }) as number;

    const pending = MIGRATIONS.filter((m) => m.version > currentVersion);
    if (pending.length === 0) return;

    const applyAll = this.db.transaction(() => {
      for (const migration of pending) {
        this.db.exec(migration.sql);
        this.db.pragma(`user_version = ${migration.version}`);
      }
    });

    applyAll();
  }

  /**
   * Register a new session.
   */
  registerSession(label?: string, pid: number = process.pid): Session {
    const session: Session = {
      id: uuidv4(),
      label,
      pid,
      startedAt: Date.now(),
    };

    const stmt = this.db.prepare(`
      INSERT INTO sessions (id, label, pid, started_at)
      VALUES (?, ?, ?, ?)
    `);

    stmt.run(session.id, session.label ?? null, session.pid, session.startedAt);

    return session;
  }

  /**
   * Ensure a session exists with a specific ID.
   * If the session already exists, returns it unchanged.
   * If not, creates a new session with the given ID.
   */
  ensureSession(id: string, label?: string, pid: number = process.pid): Session {
    const startedAt = Date.now();
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO sessions (id, label, pid, started_at)
      VALUES (?, ?, ?, ?)
    `);
    stmt.run(id, label ?? null, pid, startedAt);

    // Return the session (either newly created or existing)
    const existing = this.getSession(id);
    if (existing) {
      return existing;
    }

    // This should never happen since we just inserted, but satisfies the type checker
    return { id, label, pid, startedAt };
  }

  /**
   * Get a session by ID.
   */
  getSession(id: string): Session | undefined {
    const stmt = this.db.prepare(`
      SELECT id, label, pid, started_at as startedAt
      FROM sessions
      WHERE id = ?
    `);

    const row = stmt.get(id) as DbSessionRow | undefined;

    if (!row) {
      return undefined;
    }

    return {
      id: row.id,
      label: row.label ?? undefined,
      pid: row.pid,
      startedAt: row.startedAt,
    };
  }

  /**
   * List all sessions.
   */
  listSessions(): Session[] {
    const stmt = this.db.prepare(`
      SELECT id, label, pid, started_at as startedAt
      FROM sessions
      ORDER BY started_at DESC
    `);

    const rows = stmt.all() as DbSessionRow[];

    return rows.map((row) => ({
      id: row.id,
      label: row.label ?? undefined,
      pid: row.pid,
      startedAt: row.startedAt,
    }));
  }

  /**
   * Save a captured request. Returns the generated ID.
   */
  saveRequest(request: Omit<CapturedRequest, "id">): string {
    const id = uuidv4();

    const requestContentType = request.requestHeaders
      ? normaliseContentType(request.requestHeaders["content-type"])
      : null;

    const stmt = this.db.prepare(`
      INSERT INTO requests (
        id, session_id, label, timestamp, method, url, host, path,
        request_headers, request_body, request_body_truncated, response_status, response_headers,
        response_body, response_body_truncated, duration_ms, request_content_type
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    stmt.run(
      id,
      request.sessionId,
      request.label ?? null,
      request.timestamp,
      request.method,
      request.url,
      request.host,
      request.path,
      request.requestHeaders ? JSON.stringify(request.requestHeaders) : null,
      request.requestBody ?? null,
      request.requestBodyTruncated ? 1 : 0,
      request.responseStatus ?? null,
      request.responseHeaders ? JSON.stringify(request.responseHeaders) : null,
      request.responseBody ?? null,
      request.responseBodyTruncated ? 1 : 0,
      request.durationMs ?? null,
      requestContentType
    );

    this.logger?.debug("Request saved", {
      id,
      sessionId: request.sessionId,
      method: request.method,
      url: request.url,
    });

    return id;
  }

  /**
   * Update a request with response data.
   */
  updateRequestResponse(
    id: string,
    response: {
      status: number;
      headers: Record<string, string>;
      body?: Buffer;
      durationMs: number;
      responseBodyTruncated?: boolean;
    }
  ): void {
    const responseContentType = normaliseContentType(response.headers["content-type"]);

    const stmt = this.db.prepare(`
      UPDATE requests
      SET response_status = ?, response_headers = ?, response_body = ?, response_body_truncated = ?, duration_ms = ?, response_content_type = ?
      WHERE id = ?
    `);

    stmt.run(
      response.status,
      JSON.stringify(response.headers),
      response.body ?? null,
      response.responseBodyTruncated ? 1 : 0,
      response.durationMs,
      responseContentType,
      id
    );
  }

  /**
   * Get a request by ID.
   */
  getRequest(id: string): CapturedRequest | undefined {
    const stmt = this.db.prepare(`
      SELECT * FROM requests WHERE id = ?
    `);

    const row = stmt.get(id) as DbRequestRow | undefined;

    return row ? this.rowToRequest(row) : undefined;
  }

  /**
   * List requests, optionally filtered by session or label.
   */
  listRequests(
    options: {
      sessionId?: string;
      label?: string;
      limit?: number;
      offset?: number;
      filter?: RequestFilter;
    } = {}
  ): CapturedRequest[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.sessionId) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }

    if (options.label) {
      conditions.push("label = ?");
      params.push(options.label);
    }

    applyFilterConditions(conditions, params, options.filter);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? DEFAULT_QUERY_LIMIT;
    const offset = options.offset ?? 0;

    const stmt = this.db.prepare(`
      SELECT * FROM requests
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    params.push(limit, offset);

    const rows = stmt.all(...params) as DbRequestRow[];

    return rows.map((row) => this.rowToRequest(row));
  }

  /**
   * List request summaries (excludes body/header data for performance).
   * Use this for list views where full request data isn't needed.
   */
  listRequestsSummary(
    options: {
      sessionId?: string;
      label?: string;
      limit?: number;
      offset?: number;
      filter?: RequestFilter;
    } = {}
  ): CapturedRequestSummary[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.sessionId) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }

    if (options.label) {
      conditions.push("label = ?");
      params.push(options.label);
    }

    applyFilterConditions(conditions, params, options.filter);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? DEFAULT_QUERY_LIMIT;
    const offset = options.offset ?? 0;

    const stmt = this.db.prepare(`
      SELECT
        id,
        session_id,
        label,
        timestamp,
        method,
        url,
        host,
        path,
        response_status,
        duration_ms,
        COALESCE(LENGTH(request_body), 0) as request_body_size,
        COALESCE(LENGTH(response_body), 0) as response_body_size
      FROM requests
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    params.push(limit, offset);

    const rows = stmt.all(...params) as DbRequestSummaryRow[];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      label: row.label ?? undefined,
      timestamp: row.timestamp,
      method: row.method,
      url: row.url,
      host: row.host,
      path: row.path,
      responseStatus: row.response_status ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      requestBodySize: row.request_body_size,
      responseBodySize: row.response_body_size,
    }));
  }

  /**
   * Count requests, optionally filtered by session or label.
   */
  countRequests(
    options: { sessionId?: string; label?: string; filter?: RequestFilter } = {}
  ): number {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    if (options.sessionId) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }

    if (options.label) {
      conditions.push("label = ?");
      params.push(options.label);
    }

    applyFilterConditions(conditions, params, options.filter);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM requests ${whereClause}
    `);

    const result = stmt.get(...params) as DbCountRow;

    return result.count;
  }

  /**
   * Search through request/response body content for a text pattern.
   * Only searches text-based bodies (not binary).
   */
  searchBodies(options: {
    query: string;
    limit?: number;
    offset?: number;
    filter?: RequestFilter;
  }): CapturedRequestSummary[] {
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    const escaped = escapeLikeWildcards(options.query);
    const pattern = `%${escaped}%`;

    // Build content-type conditions — only search text-based bodies
    const reqCt = buildTextContentTypeSqlCondition("request_content_type");
    const resCt = buildTextContentTypeSqlCondition("response_content_type");

    // Search in both request and response bodies, but only where the content type is text-based
    conditions.push(
      `((${reqCt.clause} AND CAST(request_body AS TEXT) LIKE ? ESCAPE '\\') OR (${resCt.clause} AND CAST(response_body AS TEXT) LIKE ? ESCAPE '\\'))`
    );
    params.push(...reqCt.params, pattern, ...resCt.params, pattern);

    applyFilterConditions(conditions, params, options.filter);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? DEFAULT_QUERY_LIMIT;
    const offset = options.offset ?? 0;

    const stmt = this.db.prepare(`
      SELECT
        id,
        session_id,
        label,
        timestamp,
        method,
        url,
        host,
        path,
        response_status,
        duration_ms,
        COALESCE(LENGTH(request_body), 0) as request_body_size,
        COALESCE(LENGTH(response_body), 0) as response_body_size
      FROM requests
      ${whereClause}
      ORDER BY timestamp DESC
      LIMIT ? OFFSET ?
    `);

    params.push(limit, offset);

    const rows = stmt.all(...params) as DbRequestSummaryRow[];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      label: row.label ?? undefined,
      timestamp: row.timestamp,
      method: row.method,
      url: row.url,
      host: row.host,
      path: row.path,
      responseStatus: row.response_status ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      requestBodySize: row.request_body_size,
      responseBodySize: row.response_body_size,
    }));
  }

  /**
   * Query JSON bodies using SQLite's json_extract.
   * Only queries rows with JSON content types.
   */
  queryJsonBodies(options: {
    jsonPath: string;
    value?: string;
    target?: "request" | "response" | "both";
    limit?: number;
    offset?: number;
    filter?: RequestFilter;
  }): JsonQueryResult[] {
    const target = options.target ?? "both";
    const conditions: string[] = [];
    const params: (string | number)[] = [];

    // Build the JSON extraction expressions per target
    const extractParts: string[] = [];

    if (target === "request" || target === "both") {
      const reqCt = buildJsonContentTypeSqlCondition("request_content_type");
      const reqExtract = `CASE WHEN ${reqCt.clause} THEN json_extract(CAST(request_body AS TEXT), ?) ELSE NULL END`;
      extractParts.push({ sql: reqExtract, ctParams: reqCt.params, column: "request" } as never);
    }
    if (target === "response" || target === "both") {
      const resCt = buildJsonContentTypeSqlCondition("response_content_type");
      const resExtract = `CASE WHEN ${resCt.clause} THEN json_extract(CAST(response_body AS TEXT), ?) ELSE NULL END`;
      extractParts.push({ sql: resExtract, ctParams: resCt.params, column: "response" } as never);
    }

    // Build the select with extracted value, preferring request over response for "both"
    const extracts = extractParts as unknown as {
      sql: string;
      ctParams: string[];
      column: string;
    }[];
    const extractSelectParts: string[] = [];
    const extractSelectParams: (string | number)[] = [];

    for (const part of extracts) {
      extractSelectParts.push(part.sql);
      extractSelectParams.push(...part.ctParams, options.jsonPath);
    }

    // COALESCE so "both" returns the first non-null value
    const extractedValueExpr =
      extractSelectParts.length > 1
        ? `COALESCE(${extractSelectParts.join(", ")})`
        : (extractSelectParts[0] ?? "NULL");

    // Content-type restriction: at least one target must have a JSON content type
    const ctConditions: string[] = [];
    const ctParams: (string | number)[] = [];
    if (target === "request" || target === "both") {
      const reqCt = buildJsonContentTypeSqlCondition("request_content_type");
      ctConditions.push(reqCt.clause);
      ctParams.push(...reqCt.params);
    }
    if (target === "response" || target === "both") {
      const resCt = buildJsonContentTypeSqlCondition("response_content_type");
      ctConditions.push(resCt.clause);
      ctParams.push(...resCt.params);
    }
    conditions.push(`(${ctConditions.join(" OR ")})`);
    params.push(...ctParams);

    applyFilterConditions(conditions, params, options.filter);

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? DEFAULT_QUERY_LIMIT;
    const offset = options.offset ?? 0;

    // Build the full query — we use a subquery to compute extracted_value,
    // then filter on it in the outer query
    let sql: string;
    const allParams: (string | number)[] = [];

    if (options.value !== undefined) {
      sql = `
        SELECT * FROM (
          SELECT
            id,
            session_id,
            label,
            timestamp,
            method,
            url,
            host,
            path,
            response_status,
            duration_ms,
            COALESCE(LENGTH(request_body), 0) as request_body_size,
            COALESCE(LENGTH(response_body), 0) as response_body_size,
            ${extractedValueExpr} as extracted_value
          FROM requests
          ${whereClause}
        ) sub
        WHERE extracted_value = ?
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;
      allParams.push(...extractSelectParams, ...params, options.value, limit, offset);
    } else {
      sql = `
        SELECT * FROM (
          SELECT
            id,
            session_id,
            label,
            timestamp,
            method,
            url,
            host,
            path,
            response_status,
            duration_ms,
            COALESCE(LENGTH(request_body), 0) as request_body_size,
            COALESCE(LENGTH(response_body), 0) as response_body_size,
            ${extractedValueExpr} as extracted_value
          FROM requests
          ${whereClause}
        ) sub
        WHERE extracted_value IS NOT NULL
        ORDER BY timestamp DESC
        LIMIT ? OFFSET ?
      `;
      allParams.push(...extractSelectParams, ...params, limit, offset);
    }

    const stmt = this.db.prepare(sql);
    const rows = stmt.all(...allParams) as DbJsonQueryRow[];

    return rows.map((row) => ({
      id: row.id,
      sessionId: row.session_id,
      label: row.label ?? undefined,
      timestamp: row.timestamp,
      method: row.method,
      url: row.url,
      host: row.host,
      path: row.path,
      responseStatus: row.response_status ?? undefined,
      durationMs: row.duration_ms ?? undefined,
      requestBodySize: row.request_body_size,
      responseBodySize: row.response_body_size,
      extractedValue: row.extracted_value,
    }));
  }

  /**
   * Delete all requests (useful for cleanup).
   */
  clearRequests(): void {
    this.db.exec("DELETE FROM requests");
  }

  /**
   * Close the database connection.
   */
  close(): void {
    this.db.close();
  }

  private safeParseHeaders(json: string): Record<string, string> {
    try {
      return JSON.parse(json) as Record<string, string>;
    } catch {
      return {};
    }
  }

  private rowToRequest(row: DbRequestRow): CapturedRequest {
    return {
      id: row.id,
      sessionId: row.session_id,
      label: row.label ?? undefined,
      timestamp: row.timestamp,
      method: row.method,
      url: row.url,
      host: row.host,
      path: row.path,
      requestHeaders: row.request_headers ? this.safeParseHeaders(row.request_headers) : {},
      requestBody: row.request_body ?? undefined,
      requestBodyTruncated: row.request_body_truncated === 1,
      responseStatus: row.response_status ?? undefined,
      responseHeaders: row.response_headers
        ? this.safeParseHeaders(row.response_headers)
        : undefined,
      responseBody: row.response_body ?? undefined,
      responseBodyTruncated: row.response_body_truncated === 1,
      durationMs: row.duration_ms ?? undefined,
    };
  }
}

interface DbRequestRow {
  id: string;
  session_id: string;
  label: string | null;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  path: string;
  request_headers: string | null;
  request_body: Buffer | null;
  request_body_truncated: number;
  response_status: number | null;
  response_headers: string | null;
  response_body: Buffer | null;
  response_body_truncated: number;
  duration_ms: number | null;
  created_at: number;
}

interface DbRequestSummaryRow {
  id: string;
  session_id: string;
  label: string | null;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  path: string;
  response_status: number | null;
  duration_ms: number | null;
  request_body_size: number;
  response_body_size: number;
}

interface DbSessionRow {
  id: string;
  label: string | null;
  pid: number;
  startedAt: number;
}

interface DbJsonQueryRow {
  id: string;
  session_id: string;
  label: string | null;
  timestamp: number;
  method: string;
  url: string;
  host: string;
  path: string;
  response_status: number | null;
  duration_ms: number | null;
  request_body_size: number;
  response_body_size: number;
  extracted_value: unknown;
}

interface DbCountRow {
  count: number;
}
