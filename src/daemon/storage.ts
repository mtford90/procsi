import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";
import type { CapturedRequest, Session } from "../shared/types.js";

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
    response_status INTEGER,
    response_headers TEXT,
    response_body BLOB,
    duration_ms INTEGER,
    created_at INTEGER DEFAULT (unixepoch()),
    FOREIGN KEY (session_id) REFERENCES sessions(id)
);

CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
CREATE INDEX IF NOT EXISTS idx_requests_label ON requests(label);
`;

export class RequestRepository {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(SCHEMA);
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
   * Get a session by ID.
   */
  getSession(id: string): Session | undefined {
    const stmt = this.db.prepare(`
      SELECT id, label, pid, started_at as startedAt
      FROM sessions
      WHERE id = ?
    `);

    const row = stmt.get(id) as
      | { id: string; label: string | null; pid: number; startedAt: number }
      | undefined;

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

    const rows = stmt.all() as {
      id: string;
      label: string | null;
      pid: number;
      startedAt: number;
    }[];

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

    const stmt = this.db.prepare(`
      INSERT INTO requests (
        id, session_id, label, timestamp, method, url, host, path,
        request_headers, request_body, response_status, response_headers,
        response_body, duration_ms
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      request.responseStatus ?? null,
      request.responseHeaders ? JSON.stringify(request.responseHeaders) : null,
      request.responseBody ?? null,
      request.durationMs ?? null
    );

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
    }
  ): void {
    const stmt = this.db.prepare(`
      UPDATE requests
      SET response_status = ?, response_headers = ?, response_body = ?, duration_ms = ?
      WHERE id = ?
    `);

    stmt.run(
      response.status,
      JSON.stringify(response.headers),
      response.body ?? null,
      response.durationMs,
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
    options: { sessionId?: string; label?: string; limit?: number; offset?: number } = {}
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

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
    const limit = options.limit ?? 1000;
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
   * Count requests, optionally filtered by session or label.
   */
  countRequests(options: { sessionId?: string; label?: string } = {}): number {
    const conditions: string[] = [];
    const params: string[] = [];

    if (options.sessionId) {
      conditions.push("session_id = ?");
      params.push(options.sessionId);
    }

    if (options.label) {
      conditions.push("label = ?");
      params.push(options.label);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

    const stmt = this.db.prepare(`
      SELECT COUNT(*) as count FROM requests ${whereClause}
    `);

    const result = stmt.get(...params) as { count: number };

    return result.count;
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
      requestHeaders: row.request_headers
        ? (JSON.parse(row.request_headers) as Record<string, string>)
        : {},
      requestBody: row.request_body ?? undefined,
      responseStatus: row.response_status ?? undefined,
      responseHeaders: row.response_headers
        ? (JSON.parse(row.response_headers) as Record<string, string>)
        : undefined,
      responseBody: row.response_body ?? undefined,
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
  response_status: number | null;
  response_headers: string | null;
  response_body: Buffer | null;
  duration_ms: number | null;
  created_at: number;
}
