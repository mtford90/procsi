import * as net from "node:net";
import * as fs from "node:fs";
import type { RequestRepository } from "./storage.js";
import type { CapturedRequest, DaemonStatus, Session } from "../shared/types.js";
import { createLogger, type LogLevel, type Logger } from "../shared/logger.js";

export interface ControlServerOptions {
  socketPath: string;
  storage: RequestRepository;
  proxyPort: number;
  projectRoot?: string;
  logLevel?: LogLevel;
}

export interface ControlServer {
  close: () => Promise<void>;
}

/**
 * JSON-RPC style message format for control API.
 */
interface ControlMessage {
  id: string;
  method: string;
  params?: Record<string, unknown>;
}

interface ControlResponse {
  id: string;
  result?: unknown;
  error?: { code: number; message: string };
}

type RequestHandler = (params: Record<string, unknown>) => unknown;

/**
 * Create a Unix socket control server for daemon communication.
 */
export function createControlServer(options: ControlServerOptions): ControlServer {
  const { socketPath, storage, proxyPort, projectRoot, logLevel } = options;

  // Create logger if projectRoot is provided
  const logger: Logger | undefined = projectRoot
    ? createLogger("control", projectRoot, logLevel)
    : undefined;

  // Remove existing socket file if it exists
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  const handlers: Record<string, RequestHandler> = {
    /**
     * Get daemon status.
     */
    status: (): DaemonStatus => {
      const sessions = storage.listSessions();
      const requestCount = storage.countRequests();

      return {
        running: true,
        proxyPort,
        sessionCount: sessions.length,
        requestCount,
      };
    },

    /**
     * Register a new session.
     */
    registerSession: (params): Session => {
      const label = params["label"] as string | undefined;
      const pid = params["pid"] as number | undefined;
      return storage.registerSession(label, pid);
    },

    /**
     * List all sessions.
     */
    listSessions: (): Session[] => {
      return storage.listSessions();
    },

    /**
     * List captured requests.
     */
    listRequests: (params): CapturedRequest[] => {
      return storage.listRequests({
        sessionId: params["sessionId"] as string | undefined,
        label: params["label"] as string | undefined,
        limit: params["limit"] as number | undefined,
        offset: params["offset"] as number | undefined,
      });
    },

    /**
     * Get a specific request by ID.
     */
    getRequest: (params): CapturedRequest | null => {
      const id = params["id"] as string;
      return storage.getRequest(id) ?? null;
    },

    /**
     * Count requests.
     */
    countRequests: (params): number => {
      return storage.countRequests({
        sessionId: params["sessionId"] as string | undefined,
        label: params["label"] as string | undefined,
      });
    },

    /**
     * Clear all requests.
     */
    clearRequests: (): { success: boolean } => {
      storage.clearRequests();
      return { success: true };
    },

    /**
     * Ping - used for health checks.
     */
    ping: (): { pong: boolean } => {
      return { pong: true };
    },
  };

  const server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();

      // Process complete messages (newline-delimited JSON)
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const messageStr = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        try {
          const message = JSON.parse(messageStr) as ControlMessage;
          logger?.debug("Control message received", { type: message.method });
          const response = handleMessage(message, handlers);
          socket.write(JSON.stringify(response) + "\n");
        } catch (err) {
          logger?.error("Control message parse error", {
            error: err instanceof Error ? err.message : "Unknown error",
          });
          const errorResponse: ControlResponse = {
            id: "unknown",
            error: {
              code: -32700,
              message: `Parse error: ${err instanceof Error ? err.message : "Unknown error"}`,
            },
          };
          socket.write(JSON.stringify(errorResponse) + "\n");
        }
      }
    });

    socket.on("error", (err) => {
      logger?.error("Control socket error", { error: err.message });
    });
  });

  server.listen(socketPath);

  // Set socket permissions to be accessible only by owner
  fs.chmodSync(socketPath, 0o600);

  return {
    close: () => {
      return new Promise((resolve, reject) => {
        server.close((err) => {
          if (err) {
            reject(err);
          } else {
            // Clean up socket file
            if (fs.existsSync(socketPath)) {
              fs.unlinkSync(socketPath);
            }
            resolve();
          }
        });
      });
    },
  };
}

function handleMessage(
  message: ControlMessage,
  handlers: Record<string, RequestHandler>
): ControlResponse {
  const { id, method, params } = message;

  const handler = handlers[method];
  if (!handler) {
    return {
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }

  try {
    const result = handler(params ?? {});
    return { id, result };
  } catch (err) {
    return {
      id,
      error: {
        code: -32000,
        message: err instanceof Error ? err.message : "Unknown error",
      },
    };
  }
}

/**
 * Client for communicating with the control server.
 */
export class ControlClient {
  private socketPath: string;
  private requestId = 0;

  constructor(socketPath: string) {
    this.socketPath = socketPath;
  }

  /**
   * Send a request to the control server and wait for response.
   */
  async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    return new Promise((resolve, reject) => {
      const socket = net.createConnection(this.socketPath);
      const id = String(++this.requestId);
      let buffer = "";

      socket.on("connect", () => {
        const message: ControlMessage = { id, method, params };
        socket.write(JSON.stringify(message) + "\n");
      });

      socket.on("data", (data) => {
        buffer += data.toString();

        const newlineIndex = buffer.indexOf("\n");
        if (newlineIndex !== -1) {
          const responseStr = buffer.slice(0, newlineIndex);

          try {
            const response = JSON.parse(responseStr) as ControlResponse;
            socket.end();

            if (response.error) {
              reject(new Error(response.error.message));
            } else {
              resolve(response.result as T);
            }
          } catch (err) {
            socket.end();
            reject(err);
          }
        }
      });

      socket.on("error", (err) => {
        reject(err);
      });

      socket.setTimeout(5000, () => {
        socket.destroy();
        reject(new Error("Control request timed out"));
      });
    });
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
  async registerSession(label?: string, pid?: number): Promise<Session> {
    return this.request<Session>("registerSession", { label, pid });
  }

  /**
   * List captured requests.
   */
  async listRequests(options?: {
    sessionId?: string;
    label?: string;
    limit?: number;
    offset?: number;
  }): Promise<CapturedRequest[]> {
    return this.request<CapturedRequest[]>("listRequests", options);
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
  async countRequests(options?: { sessionId?: string; label?: string }): Promise<number> {
    return this.request<number>("countRequests", options);
  }

  /**
   * Clear all requests.
   */
  async clearRequests(): Promise<void> {
    await this.request<{ success: boolean }>("clearRequests");
  }
}
