import { createLogger, type LogLevel } from "../shared/logger.js";
import type {
  InterceptorRequest,
  InterceptorResponse,
  InterceptorContext,
  InterceptionType,
  ProcsiClient,
} from "../shared/types.js";
import type { InterceptorLoader, LoadedInterceptor } from "./interceptor-loader.js";
import type { InterceptorEventLog } from "./interceptor-event-log.js";

// --- Constants (exported for testing) ---

export const HANDLER_TIMEOUT_MS = 30_000;
export const MATCH_TIMEOUT_MS = 5_000;
export const STALE_CLEANUP_INTERVAL_MS = 60_000;
/** Warn if total match evaluation across all interceptors exceeds this threshold */
const SLOW_MATCH_TOTAL_MS = 1_000;

// --- Result types ---

export interface HandleRequestResult {
  mockResponse?: InterceptorResponse;
  interception?: { name: string; type: InterceptionType };
}

export interface HandleResponseResult {
  responseOverride?: InterceptorResponse;
  interception?: { name: string; type: InterceptionType };
}

// --- Runner interface ---

export interface InterceptorRunner {
  handleRequest(
    requestId: string,
    request: InterceptorRequest
  ): Promise<HandleRequestResult | undefined>;
  handleResponse(
    requestId: string,
    upstreamResponse: InterceptorResponse
  ): Promise<HandleResponseResult | undefined>;
  cleanup(requestId: string): void;
}

// --- Internals ---

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

interface PendingEntry {
  resolveUpstream: (response: InterceptorResponse) => void;
  rejectUpstream: (reason: Error) => void;
  // eslint-disable-next-line @typescript-eslint/no-invalid-void-type -- matches Interceptor.handler return type
  handlerPromise: Promise<InterceptorResponse | undefined | void>;
  interceptorName: string;
  interception: { name: string; type: InterceptionType };
  completed: boolean;
  createdAt: number;
}

interface InterceptorRunnerOptions {
  loader: InterceptorLoader;
  procsiClient: ProcsiClient;
  projectRoot: string;
  logLevel?: LogLevel;
  /** Override handler timeout for testing */
  handlerTimeoutMs?: number;
  /** Override match timeout for testing */
  matchTimeoutMs?: number;
  /** Event log for structured interceptor debugging events */
  eventLog?: InterceptorEventLog;
}

// --- Response validation ---

const MIN_HTTP_STATUS = 100;
const MAX_HTTP_STATUS = 599;

export function isValidInterceptorResponse(value: unknown): value is InterceptorResponse {
  if (value === null || value === undefined || typeof value !== "object") {
    return false;
  }

  const candidate = value as Record<string, unknown>;

  if (typeof candidate["status"] !== "number") {
    return false;
  }
  if (candidate["status"] < MIN_HTTP_STATUS || candidate["status"] > MAX_HTTP_STATUS) {
    return false;
  }

  if (candidate["headers"] !== undefined) {
    if (candidate["headers"] === null || typeof candidate["headers"] !== "object") {
      return false;
    }
  }

  if (candidate["body"] !== undefined) {
    if (typeof candidate["body"] !== "string" && !Buffer.isBuffer(candidate["body"])) {
      return false;
    }
  }

  return true;
}

// --- Timeout helper ---

/**
 * Race a promise against a timeout. Resolves to `{ result }` on success
 * or `{ timedOut: true }` if the deadline is exceeded.
 */
function withTimeout<T>(
  promise: Promise<T>,
  ms: number
): Promise<{ result: T; timedOut?: never } | { timedOut: true; result?: never }> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve({ timedOut: true });
    }, ms);

    promise.then(
      (result) => {
        clearTimeout(timer);
        resolve({ result });
      },
      () => {
        clearTimeout(timer);
        // The caller handles errors separately; treat rejection as a timeout-like bail-out
        resolve({ timedOut: true });
      }
    );
  });
}

// --- Factory ---

export function createInterceptorRunner(options: InterceptorRunnerOptions): InterceptorRunner {
  const { loader, procsiClient, projectRoot, logLevel, eventLog } = options;
  const handlerTimeoutMs = options.handlerTimeoutMs ?? HANDLER_TIMEOUT_MS;
  const matchTimeoutMs = options.matchTimeoutMs ?? MATCH_TIMEOUT_MS;
  const logger = createLogger("interceptor", projectRoot, logLevel);

  // Tracks requests where forward() was called and we are waiting for the upstream response
  const pending = new Map<string, PendingEntry>();

  // Periodic cleanup of stale entries where completion never fired
  const staleThreshold = handlerTimeoutMs * 2;
  const cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [requestId, entry] of pending) {
      if (now - entry.createdAt > staleThreshold) {
        logger.trace("Cleaning up stale pending entry", {
          requestId,
          interceptor: entry.interceptorName,
        });
        pending.delete(requestId);
        entry.rejectUpstream(new Error("Stale pending entry cleaned up"));
      }
    }
  }, STALE_CLEANUP_INTERVAL_MS);

  // Prevent the interval from keeping the process alive
  cleanupInterval.unref();

  /**
   * Find the first interceptor whose match predicate returns true for the request.
   * If an interceptor has no match function it matches everything.
   */
  async function findMatchingInterceptor(
    interceptors: LoadedInterceptor[],
    request: InterceptorRequest
  ): Promise<LoadedInterceptor | undefined> {
    const matchStart = Date.now();

    for (const interceptor of interceptors) {
      if (!interceptor.match) {
        return interceptor;
      }

      try {
        const outcome = await withTimeout(
          Promise.resolve(interceptor.match(request)),
          matchTimeoutMs
        );

        if (outcome.timedOut) {
          const name = interceptor.name ?? interceptor.sourceFile;
          logger.warn("Match function timed out", { interceptor: name });
          eventLog?.append({
            type: "match_timeout",
            interceptor: name,
            message: "Match function timed out",
            requestId: undefined,
            requestUrl: request.url,
            requestMethod: request.method,
          });
          continue;
        }

        if (outcome.result) {
          return interceptor;
        }
      } catch (err: unknown) {
        const name = interceptor.name ?? interceptor.sourceFile;
        const errorMsg = err instanceof Error ? (err.stack ?? err.message) : String(err);
        logger.warn("Match function threw", { interceptor: name, error: errorMsg });
        eventLog?.append({
          type: "match_error",
          interceptor: name,
          message: "Match function threw",
          error: errorMsg,
          requestUrl: request.url,
          requestMethod: request.method,
        });
        continue;
      }
    }

    const totalMs = Date.now() - matchStart;
    if (totalMs > SLOW_MATCH_TOTAL_MS) {
      logger.warn("Slow match evaluation — keep match functions synchronous and fast", {
        totalMs,
        interceptorCount: interceptors.length,
      });
    }

    return undefined;
  }

  async function handleRequest(
    requestId: string,
    request: InterceptorRequest
  ): Promise<HandleRequestResult | undefined> {
    const interceptors = loader.getInterceptors();
    if (interceptors.length === 0) {
      return undefined;
    }

    const interceptor = await findMatchingInterceptor(interceptors, request);
    if (!interceptor) {
      return undefined;
    }

    const interceptorName = interceptor.name ?? interceptor.sourceFile;
    logger.debug("Request matched interceptor", {
      requestId,
      interceptor: interceptorName,
      method: request.method,
      url: request.url,
    });
    eventLog?.append({
      type: "matched",
      interceptor: interceptorName,
      message: `Matched ${request.method} ${request.url}`,
      requestId,
      requestUrl: request.url,
      requestMethod: request.method,
    });

    // Defensive copy of body buffer so handlers cannot mutate the original
    if (request.body) {
      request = { ...request, body: Buffer.from(request.body) };
    }

    // Freeze the request so handlers cannot mutate it
    Object.freeze(request.headers);
    Object.freeze(request);

    // Deferred for the upstream response that forward() will await
    const upstreamDeferred = createDeferred<InterceptorResponse>();

    // Signal deferred that resolves when forward() is called
    const forwardCalledDeferred = createDeferred<undefined>();

    let forwardCalled = false;
    let completed = false;

    const forward = (): Promise<InterceptorResponse> => {
      if (completed) {
        const msg = "forward() called after handler completed";
        logger.warn(msg, { requestId, interceptor: interceptorName });
        eventLog?.append({
          type: "forward_after_complete",
          interceptor: interceptorName,
          message: msg,
          requestId,
          requestUrl: request.url,
          requestMethod: request.method,
        });
        return Promise.reject(new Error(msg));
      }

      if (forwardCalled) {
        logger.debug("forward() called again (idempotent)", {
          requestId,
          interceptor: interceptorName,
        });
        return upstreamDeferred.promise;
      }

      forwardCalled = true;
      forwardCalledDeferred.resolve(undefined);
      return upstreamDeferred.promise;
    };

    const ctxLog = (message: string): void => {
      logger.info(`[${interceptorName}] ${message}`, { requestId });
      eventLog?.append({
        type: "user_log",
        interceptor: interceptorName,
        message,
        requestId,
        requestUrl: request.url,
        requestMethod: request.method,
      });
    };

    const ctx: InterceptorContext = {
      request,
      forward,
      procsi: procsiClient,
      log: ctxLog,
    };

    // Start the handler
    const handlerPromise = interceptor.handler(ctx);

    // Race: handler completes first (mock) vs forward() called first (modify/observe)
    try {
      const raceOutcome = await withTimeout(
        Promise.race([
          handlerPromise.then((result) => ({ kind: "handlerDone" as const, result })),
          forwardCalledDeferred.promise.then(() => ({
            kind: "forwardCalled" as const,
            result: undefined,
          })),
        ]),
        handlerTimeoutMs
      );

      if (raceOutcome.timedOut) {
        logger.warn("Handler timed out during request phase", {
          requestId,
          interceptor: interceptorName,
        });
        eventLog?.append({
          type: "handler_timeout",
          interceptor: interceptorName,
          message: "Handler timed out during request phase",
          requestId,
          requestUrl: request.url,
          requestMethod: request.method,
        });
        completed = true;
        return undefined;
      }

      const raceResult = raceOutcome.result;

      if (raceResult.kind === "handlerDone") {
        // Handler returned before calling forward() - this is a mock or pass-through
        completed = true;

        if (raceResult.result === undefined || raceResult.result === null) {
          // Handler returned nothing - pass through
          return undefined;
        }

        if (!isValidInterceptorResponse(raceResult.result)) {
          logger.warn("Handler returned invalid response", {
            requestId,
            interceptor: interceptorName,
          });
          eventLog?.append({
            type: "invalid_response",
            interceptor: interceptorName,
            message: "Handler returned invalid response",
            requestId,
            requestUrl: request.url,
            requestMethod: request.method,
          });
          return undefined;
        }

        logger.debug("Mock response returned", {
          requestId,
          interceptor: interceptorName,
          status: raceResult.result.status,
        });
        eventLog?.append({
          type: "mocked",
          interceptor: interceptorName,
          message: `Mock response ${raceResult.result.status} for ${request.method} ${request.url}`,
          requestId,
          requestUrl: request.url,
          requestMethod: request.method,
        });

        return {
          mockResponse: raceResult.result,
          interception: { name: interceptorName, type: "mocked" },
        };
      }

      // forward() was called - store state and let the proxy forward the request
      const interception = { name: interceptorName, type: "modified" as InterceptionType };

      pending.set(requestId, {
        resolveUpstream: upstreamDeferred.resolve,
        rejectUpstream: upstreamDeferred.reject,
        handlerPromise,
        interceptorName,
        interception,
        completed: false,
        createdAt: Date.now(),
      });

      return { interception };
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn("Handler threw during request phase", {
        requestId,
        interceptor: interceptorName,
        error: errorMsg,
      });
      eventLog?.append({
        type: "handler_error",
        interceptor: interceptorName,
        message: "Handler threw during request phase",
        error: errorMsg,
        requestId,
        requestUrl: request.url,
        requestMethod: request.method,
      });
      completed = true;
      return undefined;
    }
  }

  async function handleResponse(
    requestId: string,
    upstreamResponse: InterceptorResponse
  ): Promise<HandleResponseResult | undefined> {
    const entry = pending.get(requestId);
    if (!entry) {
      return undefined;
    }
    pending.delete(requestId);

    // Resolve the upstream promise so the handler's forward() call returns
    entry.resolveUpstream(upstreamResponse);

    // Calculate remaining time budget from when the handler started
    const elapsed = Date.now() - entry.createdAt;
    const remaining = Math.max(0, handlerTimeoutMs - elapsed);

    try {
      const outcome = await withTimeout(entry.handlerPromise, remaining);

      entry.completed = true;

      if (outcome.timedOut) {
        logger.warn("Handler timed out during response phase", {
          requestId,
          interceptor: entry.interceptorName,
        });
        eventLog?.append({
          type: "handler_timeout",
          interceptor: entry.interceptorName,
          message: "Handler timed out during response phase",
          requestId,
        });
        return undefined;
      }

      const result = outcome.result;

      if (result === undefined || result === null) {
        // Handler did not return a response override (observe mode)
        eventLog?.append({
          type: "observed",
          interceptor: entry.interceptorName,
          message: `Observed ${requestId} (no response override)`,
          requestId,
        });
        return { interception: entry.interception };
      }

      if (!isValidInterceptorResponse(result)) {
        logger.warn("Handler returned invalid response after forward()", {
          requestId,
          interceptor: entry.interceptorName,
        });
        eventLog?.append({
          type: "invalid_response",
          interceptor: entry.interceptorName,
          message: "Handler returned invalid response after forward()",
          requestId,
        });
        return { interception: entry.interception };
      }

      logger.debug("Response modified after forward()", {
        requestId,
        interceptor: entry.interceptorName,
        status: result.status,
      });
      eventLog?.append({
        type: "modified",
        interceptor: entry.interceptorName,
        message: `Response modified to ${result.status}`,
        requestId,
      });

      return {
        responseOverride: result,
        interception: entry.interception,
      };
    } catch (err: unknown) {
      entry.completed = true;

      const errorMsg = err instanceof Error ? err.message : String(err);
      logger.warn("Handler threw during response phase", {
        requestId,
        interceptor: entry.interceptorName,
        error: errorMsg,
      });
      eventLog?.append({
        type: "handler_error",
        interceptor: entry.interceptorName,
        message: "Handler threw during response phase",
        error: errorMsg,
        requestId,
      });

      return undefined;
    }
  }

  function cleanup(requestId: string): void {
    const entry = pending.get(requestId);
    if (!entry) {
      return;
    }
    pending.delete(requestId);
    entry.rejectUpstream(new Error("Request aborted"));
  }

  return { handleRequest, handleResponse, cleanup };
}
