import { ProxyAgent } from "undici";
import {
  PROCSI_REPLAY_TOKEN_HEADER,
  PROCSI_RUNTIME_SOURCE_HEADER,
  PROCSI_SESSION_ID_HEADER,
  PROCSI_SESSION_TOKEN_HEADER,
} from "../shared/constants.js";

const DEFAULT_REPLAY_TIMEOUT_MS = 10_000;
const MIN_REPLAY_TIMEOUT_MS = 1_000;
const MAX_REPLAY_TIMEOUT_MS = 120_000;
const LOOPBACK_PROXY_HOST = "127.0.0.1";

function getErrorMessageWithCause(error: unknown): string {
  if (!(error instanceof Error)) {
    return String(error);
  }

  const maybeCause = Reflect.get(error, "cause");
  if (maybeCause instanceof Error) {
    return `${error.message}: ${maybeCause.message}`;
  }
  if (typeof maybeCause === "string") {
    return `${error.message}: ${maybeCause}`;
  }

  return error.message;
}

const HOP_BY_HOP_HEADERS = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
]);

const INTERNAL_HEADERS = new Set([
  PROCSI_SESSION_ID_HEADER,
  PROCSI_SESSION_TOKEN_HEADER,
  PROCSI_RUNTIME_SOURCE_HEADER,
  PROCSI_REPLAY_TOKEN_HEADER,
]);

function clampReplayTimeout(timeoutMs: number | undefined): number {
  const raw = timeoutMs ?? DEFAULT_REPLAY_TIMEOUT_MS;
  return Math.max(MIN_REPLAY_TIMEOUT_MS, Math.min(MAX_REPLAY_TIMEOUT_MS, Math.floor(raw)));
}

function normaliseMethod(method: string): string {
  return method.toUpperCase();
}

function canHaveRequestBody(method: string): boolean {
  const upper = normaliseMethod(method);
  return upper !== "GET" && upper !== "HEAD";
}

export function buildReplayHeaders(options: {
  baseHeaders: Record<string, string>;
  setHeaders?: Record<string, string>;
  removeHeaders?: string[];
  replayToken: string;
}): Record<string, string> {
  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(options.baseHeaders)) {
    const lowerName = name.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerName) || INTERNAL_HEADERS.has(lowerName)) {
      continue;
    }
    headers[lowerName] = value;
  }

  if (options.setHeaders) {
    for (const [name, value] of Object.entries(options.setHeaders)) {
      const lowerName = name.toLowerCase();
      if (HOP_BY_HOP_HEADERS.has(lowerName) || INTERNAL_HEADERS.has(lowerName)) {
        continue;
      }
      headers[lowerName] = value;
    }
  }

  if (options.removeHeaders) {
    for (const name of options.removeHeaders) {
      const lowerName = name.toLowerCase();
      // eslint-disable-next-line @typescript-eslint/no-dynamic-delete
      delete headers[lowerName];
    }
  }

  // Let fetch calculate content-length for us
  delete headers["content-length"];

  headers[PROCSI_REPLAY_TOKEN_HEADER] = options.replayToken;

  return headers;
}

export interface ReplayExecutionOptions {
  proxyPort: number;
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: Buffer;
  timeoutMs?: number;
  caCertPem?: string;
}

export interface ReplayExecutionResult {
  status: number;
}

export async function replayViaProxy(
  options: ReplayExecutionOptions
): Promise<ReplayExecutionResult> {
  const timeoutMs = clampReplayTimeout(options.timeoutMs);
  const dispatcher = new ProxyAgent({
    uri: `http://${LOOPBACK_PROXY_HOST}:${options.proxyPort}`,
    requestTls: options.caCertPem ? { ca: options.caCertPem } : undefined,
  });
  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), timeoutMs);

  try {
    const method = normaliseMethod(options.method);
    const body = canHaveRequestBody(method) ? options.body : undefined;

    const response = await fetch(options.url, {
      method,
      headers: options.headers,
      body,
      redirect: "manual",
      signal: abortController.signal,
      dispatcher,
    } as RequestInit & { dispatcher: ProxyAgent });

    // Drain response body so the request lifecycle completes.
    await response.arrayBuffer();

    return {
      status: response.status,
    };
  } catch (error) {
    if (error instanceof Error && error.name === "AbortError") {
      throw new Error(`Replay timed out after ${timeoutMs}ms`);
    }
    throw new Error(`Replay fetch failed: ${getErrorMessageWithCause(error)}`);
  } finally {
    clearTimeout(timeout);
    await dispatcher.close();
  }
}
