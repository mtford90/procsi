import * as net from "node:net";
import type {
  CapturedRequest,
  CapturedRequestSummary,
  DaemonStatus,
  InterceptorEvent,
  InterceptorEventLevel,
  InterceptorEventType,
  InterceptorInfo,
  JsonQueryResult,
  RegisteredSession,
  RequestFilter,
  Session,
  BodySearchTarget,
  ReplayInitiator,
} from "./types.js";

const CONTROL_TIMEOUT_MS = 5000;
const DEFAULT_REPLAY_TIMEOUT_MS = 10_000;
const REPLAY_CONTROL_TIMEOUT_BUFFER_MS = 2000;

/** Maximum buffer size per connection before disconnecting (1 MB). Shared by both client and server. */
export const MAX_BUFFER_SIZE = 1024 * 1024;

/**
 * JSON-RPC style message format for control API.
 */
export interface ControlMessage {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

export interface ControlResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

/**
 * Runtime type guard for incoming control responses.
 */
function isControlResponse(value: unknown): value is ControlResponse {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["id"] === "string"
  );
}

/**
 * Recursively revive Buffer objects from JSON serialisation.
 * JSON.stringify(Buffer) produces { type: 'Buffer', data: [...] }
 * This converts them back to actual Buffer instances.
 */
export function reviveBuffers<T>(obj: T): T {
  if (obj === null || obj === undefined) {
    return obj;
  }

  // Check if this is a serialised Buffer
  if (
    typeof obj === "object" &&
    "type" in obj &&
    "data" in obj &&
    (obj as Record<string, unknown>)["type"] === "Buffer" &&
    Array.isArray((obj as Record<string, unknown>)["data"])
  ) {
    return Buffer.from((obj as { data: number[] }).data) as T;
  }

  // Recurse into arrays
  if (Array.isArray(obj)) {
    return obj.map(reviveBuffers) as T;
  }

  // Recurse into objects
  if (typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = reviveBuffers(value);
    }
    return result as T;
  }

  return obj;
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

interface ControlRequestOptions {
  timeoutMs?: number;
}

/**
 * Client for communicating with the control server via Unix socket.
 * Maintains a persistent connection and multiplexes requests by ID.
 */
export class ControlClient {
  private socketPath: string;
  private requestId = 0;
  private socket: net.Socket | null = null;
  private pending = new Map<string, PendingRequest>();
  private buffer = "";
  private connectPromise: Promise<net.Socket> | null = null;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  /**
   * Send a request to the control server and wait for response.
   */
  async request<T>(
    method: string,
    params?: Record<string, unknown>,
    options: ControlRequestOptions = {}
  ): Promise<T> {
    const socket = await this.getSocket();
    const id = String(++this.requestId);
    const timeoutMs = options.timeoutMs ?? CONTROL_TIMEOUT_MS;

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error("Control request timed out"));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
        timer,
      });

      const message: ControlMessage = { id, method, params };
      socket.write(JSON.stringify(message) + "\n");
    });
  }

  /**
   * Close the persistent socket and reject any pending requests.
   */
  close(): void {
    if (this.socket) {
      this.socket.end();
      this.socket = null;
    }
    this.connectPromise = null;
    this.buffer = "";
    this.rejectAllPending(new Error("Client closed"));
  }

  /**
   * Check if the daemon is running by sending a ping.
   */
  async ping(): Promise<boolean> {
    try {
      await this.request<{ pong: boolean }>("ping");
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Get daemon status.
   */
  async status(): Promise<DaemonStatus> {
    return this.request<DaemonStatus>("status");
  }

  /**
   * Register a new session.
   */
  async registerSession(label?: string, pid?: number, source?: string): Promise<RegisteredSession> {
    return this.request<RegisteredSession>("registerSession", { label, pid, source });
  }

  /**
   * List all active sessions.
   */
  async listSessions(): Promise<Session[]> {
    return this.request<Session[]>("listSessions");
  }

  /**
   * List captured requests (full data including bodies).
   */
  async listRequests(options?: {
    sessionId?: string;
    label?: string;
    limit?: number;
    offset?: number;
    filter?: RequestFilter;
  }): Promise<CapturedRequest[]> {
    return this.request<CapturedRequest[]>("listRequests", options);
  }

  /**
   * List request summaries (excludes body/header data for performance).
   */
  async listRequestsSummary(options?: {
    sessionId?: string;
    label?: string;
    limit?: number;
    offset?: number;
    filter?: RequestFilter;
  }): Promise<CapturedRequestSummary[]> {
    return this.request<CapturedRequestSummary[]>("listRequestsSummary", options);
  }

  /**
   * Get a specific request by ID.
   */
  async getRequest(id: string): Promise<CapturedRequest | null> {
    return this.request<CapturedRequest | null>("getRequest", { id });
  }

  /**
   * Count requests.
   */
  async countRequests(options?: {
    sessionId?: string;
    label?: string;
    filter?: RequestFilter;
  }): Promise<number> {
    return this.request<number>("countRequests", options);
  }

  /**
   * Search through request/response body content.
   */
  async searchBodies(options: {
    query: string;
    target?: BodySearchTarget;
    limit?: number;
    offset?: number;
    filter?: RequestFilter;
  }): Promise<CapturedRequestSummary[]> {
    return this.request<CapturedRequestSummary[]>("searchBodies", options);
  }

  /**
   * Query JSON bodies using json_extract.
   */
  async queryJsonBodies(options: {
    jsonPath: string;
    value?: string;
    target?: "request" | "response" | "both";
    limit?: number;
    offset?: number;
    filter?: RequestFilter;
  }): Promise<JsonQueryResult[]> {
    return this.request<JsonQueryResult[]>("queryJsonBodies", options);
  }

  /**
   * Clear all unsaved requests.
   */
  async clearRequests(): Promise<void> {
    await this.request<{ success: boolean }>("clearRequests");
  }

  /**
   * Replay a captured request, optionally overriding method/url/headers/body.
   */
  async replayRequest(options: {
    id: string;
    method?: string;
    url?: string;
    setHeaders?: Record<string, string>;
    removeHeaders?: string[];
    body?: string;
    bodyBase64?: string;
    timeoutMs?: number;
    initiator?: ReplayInitiator;
  }): Promise<{ requestId: string }> {
    const replayTimeoutMs = options.timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS;
    const controlTimeoutMs = Math.max(
      CONTROL_TIMEOUT_MS,
      replayTimeoutMs + REPLAY_CONTROL_TIMEOUT_BUFFER_MS
    );

    return this.request<{ requestId: string }>("replayRequest", options, {
      timeoutMs: controlTimeoutMs,
    });
  }

  /**
   * Mark a request as saved (bookmarked).
   */
  async saveRequest(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("saveRequest", { id });
  }

  /**
   * Remove the saved (bookmark) flag from a request.
   */
  async unsaveRequest(id: string): Promise<{ success: boolean }> {
    return this.request<{ success: boolean }>("unsaveRequest", { id });
  }

  /**
   * List loaded interceptors and their metadata.
   */
  async listInterceptors(): Promise<InterceptorInfo[]> {
    return this.request<InterceptorInfo[]>("listInterceptors");
  }

  /**
   * Reload interceptors from disk.
   */
  async reloadInterceptors(): Promise<{ success: boolean; count: number; error?: string }> {
    return this.request<{ success: boolean; count: number; error?: string }>("reloadInterceptors");
  }

  /**
   * Get interceptor runtime events (matches, errors, timeouts, ctx.log() messages).
   */
  async getInterceptorEvents(options?: {
    afterSeq?: number;
    limit?: number;
    level?: InterceptorEventLevel;
    interceptor?: string;
    type?: InterceptorEventType;
  }): Promise<{
    events: InterceptorEvent[];
    counts: { info: number; warn: number; error: number };
  }> {
    return this.request("getInterceptorEvents", options);
  }

  /**
   * Clear all interceptor events from the ring buffer.
   */
  async clearInterceptorEvents(): Promise<void> {
    await this.request<{ success: boolean }>("clearInterceptorEvents");
  }

  /**
   * Lazily connect, reuse existing socket, deduplicate concurrent connect attempts.
   */
  private getSocket(): Promise<net.Socket> {
    if (this.socket && !this.socket.destroyed) {
      return Promise.resolve(this.socket);
    }

    // Deduplicate concurrent connection attempts
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<net.Socket>((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);

      socket.on("connect", () => {
        this.socket = socket;
        this.connectPromise = null;
        this.buffer = "";
        resolve(socket);
      });

      socket.on("data", (data) => {
        this.handleData(data);
      });

      socket.on("error", (err) => {
        // If we're still connecting, reject the connect promise
        if (this.connectPromise) {
          this.connectPromise = null;
          reject(err);
        }
        this.handleDisconnect(err);
      });

      socket.on("close", () => {
        this.handleDisconnect(new Error("Socket closed"));
      });

      socket.setTimeout(CONTROL_TIMEOUT_MS, () => {
        if (this.connectPromise) {
          this.connectPromise = null;
          socket.destroy();
          reject(new Error("Control connection timed out"));
        }
      });
    });

    return this.connectPromise;
  }

  /**
   * Parse newline-delimited responses and resolve/reject matching pending requests.
   */
  private handleData(data: Buffer | string): void {
    this.buffer += data.toString();

    // Guard against unbounded buffer growth
    if (this.buffer.length > MAX_BUFFER_SIZE) {
      this.socket?.destroy();
      this.handleDisconnect(new Error("Response buffer exceeded maximum size"));
      return;
    }

    let newlineIndex: number;
    while ((newlineIndex = this.buffer.indexOf("\n")) !== -1) {
      const responseStr = this.buffer.slice(0, newlineIndex);
      this.buffer = this.buffer.slice(newlineIndex + 1);

      try {
        const parsed: unknown = JSON.parse(responseStr);
        if (!isControlResponse(parsed)) {
          continue;
        }

        const pending = this.pending.get(parsed.id);
        if (!pending) {
          continue;
        }

        this.pending.delete(parsed.id);
        clearTimeout(pending.timer);

        if (parsed.error) {
          pending.reject(new Error(parsed.error.message));
        } else {
          pending.resolve(reviveBuffers(parsed.result));
        }
      } catch {
        // Skip malformed messages
      }
    }
  }

  /**
   * Handle socket disconnection — null socket, reject all pending, next request reconnects.
   */
  private handleDisconnect(err: Error): void {
    this.socket = null;
    this.connectPromise = null;
    this.buffer = "";
    this.rejectAllPending(err);
  }

  private rejectAllPending(err: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
      this.pending.delete(id);
    }
  }
}
