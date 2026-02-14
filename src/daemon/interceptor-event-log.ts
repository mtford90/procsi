/**
 * In-memory ring buffer for interceptor runtime events.
 * Provides monotonically increasing sequence numbers for efficient polling.
 */

import type {
  InterceptorEvent,
  InterceptorEventLevel,
  InterceptorEventType,
} from "../shared/types.js";

export const DEFAULT_MAX_INTERCEPTOR_EVENTS = 1000;

/** Level hierarchy for filtering — higher levels include lower ones */
const LEVEL_SEVERITY: Record<InterceptorEventLevel, number> = {
  info: 0,
  warn: 1,
  error: 2,
};

/** Maps event types to their default log level */
const EVENT_TYPE_LEVEL: Record<InterceptorEventType, InterceptorEventLevel> = {
  matched: "info",
  mocked: "info",
  modified: "info",
  observed: "info",
  loaded: "info",
  reload: "info",
  user_log: "info",
  match_timeout: "warn",
  handler_timeout: "warn",
  invalid_response: "warn",
  forward_after_complete: "warn",
  match_error: "error",
  handler_error: "error",
  load_error: "error",
};

export function getLevelForEventType(type: InterceptorEventType): InterceptorEventLevel {
  return EVENT_TYPE_LEVEL[type];
}

export interface InterceptorEventInput {
  type: InterceptorEventType;
  interceptor: string;
  message: string;
  requestId?: string;
  requestUrl?: string;
  requestMethod?: string;
  error?: string;
}

export interface EventFilterOptions {
  limit?: number;
  level?: InterceptorEventLevel;
  interceptor?: string;
  type?: InterceptorEventType;
}

export interface EventCounts {
  info: number;
  warn: number;
  error: number;
}

export interface InterceptorEventLog {
  append(input: InterceptorEventInput): number;
  since(afterSeq: number, options?: EventFilterOptions): InterceptorEvent[];
  latest(limit?: number): InterceptorEvent[];
  counts(): EventCounts;
  errorCountSince(afterSeq: number): number;
  clear(): void;
}

export function createInterceptorEventLog(
  capacity: number = DEFAULT_MAX_INTERCEPTOR_EVENTS
): InterceptorEventLog {
  const buffer: (InterceptorEvent | undefined)[] = new Array(capacity);
  let nextSeq = 1;
  let writeIndex = 0;
  let size = 0;

  // Running totals per level
  let infoCount = 0;
  let warnCount = 0;
  let errorCount = 0;

  function append(input: InterceptorEventInput): number {
    const seq = nextSeq++;
    const level = getLevelForEventType(input.type);

    const event: InterceptorEvent = {
      seq,
      timestamp: Date.now(),
      type: input.type,
      level,
      interceptor: input.interceptor,
      message: input.message,
      requestId: input.requestId,
      requestUrl: input.requestUrl,
      requestMethod: input.requestMethod,
      error: input.error,
    };

    // If we're overwriting an old event, decrement its level count
    if (size === capacity) {
      const evicted = buffer[writeIndex];
      if (evicted) {
        decrementCount(evicted.level);
      }
    }

    buffer[writeIndex] = event;
    writeIndex = (writeIndex + 1) % capacity;
    if (size < capacity) {
      size++;
    }

    incrementCount(level);

    return seq;
  }

  function incrementCount(level: InterceptorEventLevel): void {
    if (level === "info") infoCount++;
    else if (level === "warn") warnCount++;
    else errorCount++;
  }

  function decrementCount(level: InterceptorEventLevel): void {
    if (level === "info") infoCount--;
    else if (level === "warn") warnCount--;
    else errorCount--;
  }

  /**
   * Iterate events in chronological order (oldest first).
   */
  function* iterateEvents(): Generator<InterceptorEvent> {
    if (size === 0) return;

    // Start from the oldest event in the buffer
    const startIndex = size < capacity ? 0 : writeIndex;
    for (let i = 0; i < size; i++) {
      const index = (startIndex + i) % capacity;
      const event = buffer[index];
      if (event) {
        yield event;
      }
    }
  }

  function matchesFilter(event: InterceptorEvent, options: EventFilterOptions): boolean {
    if (options.level) {
      const minSeverity = LEVEL_SEVERITY[options.level];
      if (LEVEL_SEVERITY[event.level] < minSeverity) {
        return false;
      }
    }
    if (options.interceptor && event.interceptor !== options.interceptor) {
      return false;
    }
    if (options.type && event.type !== options.type) {
      return false;
    }
    return true;
  }

  function since(afterSeq: number, options: EventFilterOptions = {}): InterceptorEvent[] {
    const results: InterceptorEvent[] = [];

    for (const event of iterateEvents()) {
      if (event.seq <= afterSeq) continue;
      if (!matchesFilter(event, options)) continue;
      results.push(event);
      if (options.limit !== undefined && results.length >= options.limit) break;
    }

    return results;
  }

  function latest(limit = 50): InterceptorEvent[] {
    // Collect all events in order, then take the last N
    const all: InterceptorEvent[] = [];
    for (const event of iterateEvents()) {
      all.push(event);
    }

    return all.slice(-limit);
  }

  function counts(): EventCounts {
    return { info: infoCount, warn: warnCount, error: errorCount };
  }

  function errorCountSince(afterSeq: number): number {
    let count = 0;
    for (const event of iterateEvents()) {
      if (event.seq <= afterSeq) continue;
      if (event.level === "error") count++;
    }
    return count;
  }

  function clear(): void {
    buffer.fill(undefined);
    writeIndex = 0;
    size = 0;
    nextSeq = 1;
    infoCount = 0;
    warnCount = 0;
    errorCount = 0;
  }

  return { append, since, latest, counts, errorCountSince, clear };
}
