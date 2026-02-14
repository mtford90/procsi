import { describe, it, expect, beforeEach } from "vitest";
import {
  createInterceptorEventLog,
  DEFAULT_MAX_INTERCEPTOR_EVENTS,
  getLevelForEventType,
  type InterceptorEventLog,
  type InterceptorEventInput,
} from "./interceptor-event-log.js";
import type { InterceptorEvent } from "../shared/types.js";

function makeEvent(overrides: Partial<InterceptorEventInput> = {}): InterceptorEventInput {
  return {
    type: "matched",
    interceptor: "test-interceptor",
    message: "test message",
    ...overrides,
  };
}

/** Safe accessor — fails the test if the index is out of bounds */
function eventAt(events: InterceptorEvent[], index: number): InterceptorEvent {
  expect(events.length).toBeGreaterThan(index);
  return events[index] as InterceptorEvent;
}

describe("interceptor-event-log", () => {
  let log: InterceptorEventLog;

  beforeEach(() => {
    log = createInterceptorEventLog();
  });

  describe("getLevelForEventType", () => {
    it("maps info event types correctly", () => {
      expect(getLevelForEventType("matched")).toBe("info");
      expect(getLevelForEventType("mocked")).toBe("info");
      expect(getLevelForEventType("modified")).toBe("info");
      expect(getLevelForEventType("observed")).toBe("info");
      expect(getLevelForEventType("loaded")).toBe("info");
      expect(getLevelForEventType("reload")).toBe("info");
      expect(getLevelForEventType("user_log")).toBe("info");
    });

    it("maps warn event types correctly", () => {
      expect(getLevelForEventType("match_timeout")).toBe("warn");
      expect(getLevelForEventType("handler_timeout")).toBe("warn");
      expect(getLevelForEventType("invalid_response")).toBe("warn");
      expect(getLevelForEventType("forward_after_complete")).toBe("warn");
    });

    it("maps error event types correctly", () => {
      expect(getLevelForEventType("match_error")).toBe("error");
      expect(getLevelForEventType("handler_error")).toBe("error");
      expect(getLevelForEventType("load_error")).toBe("error");
    });
  });

  describe("append", () => {
    it("assigns monotonically increasing seq numbers", () => {
      const seq1 = log.append(makeEvent());
      const seq2 = log.append(makeEvent());
      const seq3 = log.append(makeEvent());

      expect(seq1).toBe(1);
      expect(seq2).toBe(2);
      expect(seq3).toBe(3);
    });

    it("assigns timestamps", () => {
      const before = Date.now();
      log.append(makeEvent());
      const after = Date.now();

      const events = log.latest(1);
      expect(events).toHaveLength(1);
      const event = eventAt(events, 0);
      expect(event.timestamp).toBeGreaterThanOrEqual(before);
      expect(event.timestamp).toBeLessThanOrEqual(after);
    });

    it("assigns correct level from event type", () => {
      log.append(makeEvent({ type: "matched" }));
      log.append(makeEvent({ type: "handler_error" }));
      log.append(makeEvent({ type: "match_timeout" }));

      const events = log.latest(10);
      expect(eventAt(events, 0).level).toBe("info");
      expect(eventAt(events, 1).level).toBe("error");
      expect(eventAt(events, 2).level).toBe("warn");
    });

    it("preserves all input fields", () => {
      log.append({
        type: "handler_error",
        interceptor: "my-interceptor",
        message: "Something went wrong",
        requestId: "req-123",
        requestUrl: "https://example.com/api",
        requestMethod: "POST",
        error: "TypeError: cannot read property",
      });

      const events = log.latest(1);
      expect(eventAt(events, 0)).toMatchObject({
        type: "handler_error",
        level: "error",
        interceptor: "my-interceptor",
        message: "Something went wrong",
        requestId: "req-123",
        requestUrl: "https://example.com/api",
        requestMethod: "POST",
        error: "TypeError: cannot read property",
      });
    });
  });

  describe("since", () => {
    it("returns only events after the given seq", () => {
      log.append(makeEvent({ message: "first" }));
      const seq2 = log.append(makeEvent({ message: "second" }));
      log.append(makeEvent({ message: "third" }));

      const events = log.since(seq2);
      expect(events).toHaveLength(1);
      expect(eventAt(events, 0).message).toBe("third");
    });

    it("returns all events when afterSeq is 0", () => {
      log.append(makeEvent({ message: "first" }));
      log.append(makeEvent({ message: "second" }));

      const events = log.since(0);
      expect(events).toHaveLength(2);
    });

    it("returns empty array when afterSeq is beyond latest", () => {
      log.append(makeEvent());

      const events = log.since(999);
      expect(events).toHaveLength(0);
    });

    it("filters by level (error only returns errors)", () => {
      log.append(makeEvent({ type: "matched" })); // info
      log.append(makeEvent({ type: "match_timeout" })); // warn
      log.append(makeEvent({ type: "handler_error" })); // error

      const events = log.since(0, { level: "error" });
      expect(events).toHaveLength(1);
      expect(eventAt(events, 0).type).toBe("handler_error");
    });

    it("filters by level (warn returns warn + error)", () => {
      log.append(makeEvent({ type: "matched" })); // info
      log.append(makeEvent({ type: "match_timeout" })); // warn
      log.append(makeEvent({ type: "handler_error" })); // error

      const events = log.since(0, { level: "warn" });
      expect(events).toHaveLength(2);
      expect(events.map((e) => e.type)).toEqual(["match_timeout", "handler_error"]);
    });

    it("filters by level (info returns all)", () => {
      log.append(makeEvent({ type: "matched" }));
      log.append(makeEvent({ type: "match_timeout" }));
      log.append(makeEvent({ type: "handler_error" }));

      const events = log.since(0, { level: "info" });
      expect(events).toHaveLength(3);
    });

    it("filters by interceptor name", () => {
      log.append(makeEvent({ interceptor: "alpha" }));
      log.append(makeEvent({ interceptor: "beta" }));
      log.append(makeEvent({ interceptor: "alpha" }));

      const events = log.since(0, { interceptor: "alpha" });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.interceptor === "alpha")).toBe(true);
    });

    it("filters by event type", () => {
      log.append(makeEvent({ type: "matched" }));
      log.append(makeEvent({ type: "mocked" }));
      log.append(makeEvent({ type: "matched" }));

      const events = log.since(0, { type: "mocked" });
      expect(events).toHaveLength(1);
      expect(eventAt(events, 0).type).toBe("mocked");
    });

    it("respects limit", () => {
      for (let i = 0; i < 10; i++) {
        log.append(makeEvent({ message: `msg-${i}` }));
      }

      const events = log.since(0, { limit: 3 });
      expect(events).toHaveLength(3);
      expect(eventAt(events, 0).message).toBe("msg-0");
      expect(eventAt(events, 2).message).toBe("msg-2");
    });

    it("combines multiple filters", () => {
      log.append(makeEvent({ type: "handler_error", interceptor: "alpha" }));
      log.append(makeEvent({ type: "handler_error", interceptor: "beta" }));
      log.append(makeEvent({ type: "matched", interceptor: "alpha" }));
      log.append(makeEvent({ type: "handler_error", interceptor: "alpha" }));

      const events = log.since(0, { level: "error", interceptor: "alpha" });
      expect(events).toHaveLength(2);
      expect(events.every((e) => e.interceptor === "alpha" && e.level === "error")).toBe(true);
    });

    it("returns empty array from empty log", () => {
      expect(log.since(0)).toHaveLength(0);
    });
  });

  describe("latest", () => {
    it("returns the N most recent events", () => {
      for (let i = 0; i < 10; i++) {
        log.append(makeEvent({ message: `msg-${i}` }));
      }

      const events = log.latest(3);
      expect(events).toHaveLength(3);
      expect(eventAt(events, 0).message).toBe("msg-7");
      expect(eventAt(events, 1).message).toBe("msg-8");
      expect(eventAt(events, 2).message).toBe("msg-9");
    });

    it("returns all events when limit exceeds size", () => {
      log.append(makeEvent({ message: "a" }));
      log.append(makeEvent({ message: "b" }));

      const events = log.latest(100);
      expect(events).toHaveLength(2);
    });

    it("returns empty array from empty log", () => {
      expect(log.latest()).toHaveLength(0);
    });

    it("defaults to 50 events", () => {
      for (let i = 0; i < 60; i++) {
        log.append(makeEvent());
      }

      const events = log.latest();
      expect(events).toHaveLength(50);
    });
  });

  describe("ring buffer overflow", () => {
    it("drops oldest events when capacity exceeded", () => {
      const small = createInterceptorEventLog(3);

      small.append(makeEvent({ message: "first" }));
      small.append(makeEvent({ message: "second" }));
      small.append(makeEvent({ message: "third" }));
      small.append(makeEvent({ message: "fourth" }));

      const events = small.latest(10);
      expect(events).toHaveLength(3);
      expect(eventAt(events, 0).message).toBe("second");
      expect(eventAt(events, 1).message).toBe("third");
      expect(eventAt(events, 2).message).toBe("fourth");
    });

    it("since() works correctly after wrap-around", () => {
      const small = createInterceptorEventLog(3);

      small.append(makeEvent({ message: "first" })); // seq 1
      small.append(makeEvent({ message: "second" })); // seq 2
      small.append(makeEvent({ message: "third" })); // seq 3
      small.append(makeEvent({ message: "fourth" })); // seq 4 (evicts first)
      small.append(makeEvent({ message: "fifth" })); // seq 5 (evicts second)

      // Should only see events after seq 3
      const events = small.since(3);
      expect(events).toHaveLength(2);
      expect(eventAt(events, 0).message).toBe("fourth");
      expect(eventAt(events, 1).message).toBe("fifth");
    });

    it("since() with seq of evicted event returns all remaining", () => {
      const small = createInterceptorEventLog(3);

      small.append(makeEvent({ message: "first" })); // seq 1
      small.append(makeEvent({ message: "second" })); // seq 2
      small.append(makeEvent({ message: "third" })); // seq 3
      small.append(makeEvent({ message: "fourth" })); // seq 4 (evicts first)

      // Seq 1 was evicted, but since(1) should still return events after seq 1
      const events = small.since(1);
      expect(events).toHaveLength(3);
      expect(eventAt(events, 0).message).toBe("second");
    });

    it("maintains correct seq numbers across wraps", () => {
      const small = createInterceptorEventLog(2);

      for (let i = 1; i <= 5; i++) {
        const seq = small.append(makeEvent({ message: `msg-${i}` }));
        expect(seq).toBe(i);
      }

      const events = small.latest(10);
      expect(events).toHaveLength(2);
      expect(eventAt(events, 0).seq).toBe(4);
      expect(eventAt(events, 1).seq).toBe(5);
    });
  });

  describe("counts", () => {
    it("returns correct totals per level", () => {
      log.append(makeEvent({ type: "matched" })); // info
      log.append(makeEvent({ type: "mocked" })); // info
      log.append(makeEvent({ type: "match_timeout" })); // warn
      log.append(makeEvent({ type: "handler_error" })); // error
      log.append(makeEvent({ type: "load_error" })); // error

      const counts = log.counts();
      expect(counts).toEqual({ info: 2, warn: 1, error: 2 });
    });

    it("returns zeros for empty log", () => {
      expect(log.counts()).toEqual({ info: 0, warn: 0, error: 0 });
    });

    it("adjusts counts when events are evicted by overflow", () => {
      const small = createInterceptorEventLog(2);

      small.append(makeEvent({ type: "handler_error" })); // error
      small.append(makeEvent({ type: "matched" })); // info
      small.append(makeEvent({ type: "match_timeout" })); // warn (evicts error)

      const counts = small.counts();
      expect(counts).toEqual({ info: 1, warn: 1, error: 0 });
    });
  });

  describe("errorCountSince", () => {
    it("only counts errors after the given seq", () => {
      log.append(makeEvent({ type: "handler_error" })); // seq 1
      const seq2 = log.append(makeEvent({ type: "matched" })); // seq 2
      log.append(makeEvent({ type: "load_error" })); // seq 3
      log.append(makeEvent({ type: "match_timeout" })); // seq 4
      log.append(makeEvent({ type: "handler_error" })); // seq 5

      expect(log.errorCountSince(seq2)).toBe(2);
    });

    it("returns 0 when no errors after seq", () => {
      log.append(makeEvent({ type: "handler_error" }));
      const seq = log.append(makeEvent({ type: "matched" }));
      log.append(makeEvent({ type: "mocked" }));

      expect(log.errorCountSince(seq)).toBe(0);
    });

    it("returns 0 for empty log", () => {
      expect(log.errorCountSince(0)).toBe(0);
    });
  });

  describe("clear", () => {
    it("resets everything", () => {
      log.append(makeEvent({ type: "handler_error" }));
      log.append(makeEvent({ type: "matched" }));

      log.clear();

      expect(log.latest()).toHaveLength(0);
      expect(log.counts()).toEqual({ info: 0, warn: 0, error: 0 });
      expect(log.since(0)).toHaveLength(0);
      expect(log.errorCountSince(0)).toBe(0);
    });

    it("resets seq numbers", () => {
      log.append(makeEvent());
      log.append(makeEvent());
      log.clear();

      const seq = log.append(makeEvent());
      expect(seq).toBe(1);
    });
  });

  describe("default capacity", () => {
    it("uses DEFAULT_MAX_INTERCEPTOR_EVENTS", () => {
      expect(DEFAULT_MAX_INTERCEPTOR_EVENTS).toBe(1000);
    });
  });
});
