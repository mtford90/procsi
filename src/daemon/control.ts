import * as net from "node:net";
import * as fs from "node:fs";
import type { RequestRepository } from "./storage.js";
import type {
  CapturedRequest,
  CapturedRequestSummary,
  DaemonStatus,
  JsonQueryResult,
  RequestFilter,
  Session,
} from "../shared/types.js";
import {
  MAX_BUFFER_SIZE,
  type ControlMessage,
  type ControlResponse,
} from "../shared/control-client.js";
import { createLogger, type LogLevel, type Logger } from "../shared/logger.js";

export { ControlClient } from "../shared/control-client.js";

export interface ControlServerOptions {
  socketPath: string;
  storage: RequestRepository;
  proxyPort: number;
  version: string;
  projectRoot?: string;
  logLevel?: LogLevel;
}

export interface ControlServer {
  close: () => Promise<void>;
}

type ControlHandler = (params: Record<string, unknown>) => unknown;

/**
 * Typed handler map — locks down which methods exist and their return types.
 */
interface ControlHandlers {
  status: ControlHandler;
  registerSession: ControlHandler;
  listSessions: ControlHandler;
  listRequests: ControlHandler;
  listRequestsSummary: ControlHandler;
  getRequest: ControlHandler;
  countRequests: ControlHandler;
  searchBodies: ControlHandler;
  queryJsonBodies: ControlHandler;
  clearRequests: ControlHandler;
  ping: ControlHandler;
}

/**
 * Runtime type guard for incoming control messages.
 */
function isControlMessage(value: unknown): value is ControlMessage {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as Record<string, unknown>)["id"] === "string" &&
    typeof (value as Record<string, unknown>)["method"] === "string"
  );
}

/**
 * Parameter validation helpers — runtime checks instead of blind casts.
 */
function optionalString(params: Record<string, unknown>, key: string): string | undefined {
  const value = params[key];
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(params: Record<string, unknown>, key: string): number | undefined {
  const value = params[key];
  return typeof value === "number" ? value : undefined;
}

function requireString(params: Record<string, unknown>, key: string): string {
  const value = params[key];
  if (typeof value !== "string") {
    throw new Error(`Missing required string parameter: ${key}`);
  }
  return value;
}

/**
 * Validate an optional RequestFilter from untyped control message params.
 */
function optionalFilter(params: Record<string, unknown>): RequestFilter | undefined {
  const filter = params["filter"];
  if (!filter || typeof filter !== "object") return undefined;
  const f = filter as Record<string, unknown>;

  const result: RequestFilter = {};

  if (Array.isArray(f["methods"])) {
    const methods = f["methods"].filter((m): m is string => typeof m === "string");
    if (methods.length > 0) {
      result.methods = methods;
    }
  }

  if (typeof f["statusRange"] === "string") {
    result.statusRange = f["statusRange"];
  }

  if (typeof f["search"] === "string") {
    result.search = f["search"];
  }

  if (typeof f["host"] === "string") {
    result.host = f["host"];
  }

  if (typeof f["pathPrefix"] === "string") {
    result.pathPrefix = f["pathPrefix"];
  }

  if (typeof f["since"] === "number") {
    result.since = f["since"];
  }

  if (typeof f["before"] === "number") {
    result.before = f["before"];
  }

  if (typeof f["headerName"] === "string") {
    result.headerName = f["headerName"];
  }

  if (typeof f["headerValue"] === "string") {
    result.headerValue = f["headerValue"];
  }

  if (
    f["headerTarget"] === "request" ||
    f["headerTarget"] === "response" ||
    f["headerTarget"] === "both"
  ) {
    result.headerTarget = f["headerTarget"];
  }

  return Object.keys(result).length > 0 ? result : undefined;
}

/**
 * Create a Unix socket control server for daemon communication.
 */
export function createControlServer(options: ControlServerOptions): ControlServer {
  const { socketPath, storage, proxyPort, version, projectRoot, logLevel } = options;

  // Create logger if projectRoot is provided
  const logger: Logger | undefined = projectRoot
    ? createLogger("control", projectRoot, logLevel)
    : undefined;

  // Remove existing socket file if it exists
  if (fs.existsSync(socketPath)) {
    fs.unlinkSync(socketPath);
  }

  const handlers: ControlHandlers = {
    status: (): DaemonStatus => {
      const sessions = storage.listSessions();
      const requestCount = storage.countRequests();

      return {
        running: true,
        proxyPort,
        sessionCount: sessions.length,
        requestCount,
        version,
      };
    },

    registerSession: (params): Session => {
      const label = optionalString(params, "label");
      const pid = optionalNumber(params, "pid");
      return storage.registerSession(label, pid);
    },

    listSessions: (): Session[] => {
      return storage.listSessions();
    },

    listRequests: (params): CapturedRequest[] => {
      return storage.listRequests({
        sessionId: optionalString(params, "sessionId"),
        label: optionalString(params, "label"),
        limit: optionalNumber(params, "limit"),
        offset: optionalNumber(params, "offset"),
        filter: optionalFilter(params),
      });
    },

    listRequestsSummary: (params): CapturedRequestSummary[] => {
      return storage.listRequestsSummary({
        sessionId: optionalString(params, "sessionId"),
        label: optionalString(params, "label"),
        limit: optionalNumber(params, "limit"),
        offset: optionalNumber(params, "offset"),
        filter: optionalFilter(params),
      });
    },

    getRequest: (params): CapturedRequest | null => {
      const id = requireString(params, "id");
      // storage.getRequest() returns undefined for missing rows, but undefined
      // disappears during JSON serialisation over the control socket. Convert
      // to null so the client receives an explicit "not found" value.
      return storage.getRequest(id) ?? null;
    },

    countRequests: (params): number => {
      return storage.countRequests({
        sessionId: optionalString(params, "sessionId"),
        label: optionalString(params, "label"),
        filter: optionalFilter(params),
      });
    },

    searchBodies: (params): CapturedRequestSummary[] => {
      const query = requireString(params, "query");
      return storage.searchBodies({
        query,
        limit: optionalNumber(params, "limit"),
        offset: optionalNumber(params, "offset"),
        filter: optionalFilter(params),
      });
    },

    queryJsonBodies: (params): JsonQueryResult[] => {
      const jsonPath = requireString(params, "jsonPath");
      const target = optionalString(params, "target") as
        | "request"
        | "response"
        | "both"
        | undefined;
      return storage.queryJsonBodies({
        jsonPath,
        value: optionalString(params, "value"),
        target,
        limit: optionalNumber(params, "limit"),
        offset: optionalNumber(params, "offset"),
        filter: optionalFilter(params),
      });
    },

    clearRequests: (): { success: boolean } => {
      storage.clearRequests();
      return { success: true };
    },

    ping: (): { pong: boolean } => {
      return { pong: true };
    },
  };

  const server = net.createServer((socket) => {
    let buffer = "";

    socket.on("data", (data) => {
      buffer += data.toString();

      if (buffer.length > MAX_BUFFER_SIZE) {
        logger?.error("Control socket buffer exceeded maximum size, dropping connection");
        socket.destroy();
        return;
      }

      // Process complete messages (newline-delimited JSON)
      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
        const messageStr = buffer.slice(0, newlineIndex);
        buffer = buffer.slice(newlineIndex + 1);

        try {
          const parsed: unknown = JSON.parse(messageStr);
          if (!isControlMessage(parsed)) {
            throw new Error("Invalid control message: missing id or method");
          }
          const message = parsed;
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

function handleMessage(message: ControlMessage, handlers: ControlHandlers): ControlResponse {
  const { id, method, params } = message;

  if (!(method in handlers)) {
    return {
      id,
      error: {
        code: -32601,
        message: `Method not found: ${method}`,
      },
    };
  }

  const handler = handlers[method as keyof ControlHandlers];

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
