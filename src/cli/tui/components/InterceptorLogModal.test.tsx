/**
 * Tests for the InterceptorLogModal component.
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { InterceptorLogModal } from "./InterceptorLogModal.js";
import type { InterceptorEvent } from "../../../shared/types.js";

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

function makeTestEvent(overrides: Partial<InterceptorEvent> = {}): InterceptorEvent {
  return {
    seq: 1,
    timestamp: Date.now(),
    type: "matched",
    level: "info",
    interceptor: "test-interceptor",
    message: "test message",
    ...overrides,
  };
}

describe("InterceptorLogModal", () => {
  const defaultProps = {
    width: 120,
    height: 30,
    onClose: vi.fn(),
    isActive: true,
  };

  it("renders Interceptor Log title", () => {
    const { lastFrame } = render(
      <InterceptorLogModal {...defaultProps} events={[makeTestEvent()]} />,
    );
    expect(lastFrame()).toContain("Interceptor Log");
  });

  it("renders event messages in the output", () => {
    const events = [
      makeTestEvent({ seq: 1, message: "first event message" }),
      makeTestEvent({ seq: 2, message: "second event message" }),
    ];
    const { lastFrame } = render(
      <InterceptorLogModal {...defaultProps} events={events} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("first event message");
    expect(frame).toContain("second event message");
  });

  it("shows 'No interceptor events' when events array is empty", () => {
    const { lastFrame } = render(
      <InterceptorLogModal {...defaultProps} events={[]} />,
    );
    expect(lastFrame()).toContain("No interceptor events");
  });

  it("shows error event text with error detail on second line", () => {
    const events = [
      makeTestEvent({
        seq: 1,
        level: "error",
        message: "something broke",
        error: "TypeError: Cannot read property of undefined",
      }),
    ];
    const { lastFrame } = render(
      <InterceptorLogModal {...defaultProps} events={events} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("something broke");
    expect(frame).toContain("TypeError: Cannot read property of undefined");
  });

  it("renders multi-line stack trace with all frames", () => {
    const stackTrace = [
      "Error: something went wrong",
      "    at functionA (/src/a.ts:10:5)",
      "    at functionB (/src/b.ts:20:10)",
    ].join("\n");

    const events = [
      makeTestEvent({
        seq: 1,
        level: "error",
        message: "handler threw",
        error: stackTrace,
      }),
    ];
    const { lastFrame } = render(
      <InterceptorLogModal {...defaultProps} events={events} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("handler threw");
    expect(frame).toContain("Error: something went wrong");
    expect(frame).toContain("at functionA");
    expect(frame).toContain("at functionB");
  });

  it("renders warn events", () => {
    const events = [
      makeTestEvent({
        seq: 1,
        level: "warn",
        message: "this is a warning",
      }),
    ];
    const { lastFrame } = render(
      <InterceptorLogModal {...defaultProps} events={events} />,
    );
    expect(lastFrame()).toContain("this is a warning");
  });

  it("q key calls onClose", async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <InterceptorLogModal {...defaultProps} onClose={onClose} events={[makeTestEvent()]} />,
    );
    stdin.write("q");
    await tick();
    expect(onClose).toHaveBeenCalled();
  });

  it("Escape key calls onClose", async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <InterceptorLogModal {...defaultProps} onClose={onClose} events={[makeTestEvent()]} />,
    );
    stdin.write("\x1b");
    await tick();
    expect(onClose).toHaveBeenCalled();
  });

  describe("/ key opens filter bar", () => {
    it("shows filter bar when / is pressed", async () => {
      const events = [
        makeTestEvent({ seq: 1, level: "info", message: "info event here" }),
        makeTestEvent({ seq: 2, level: "error", message: "error event here" }),
      ];
      const { lastFrame, stdin } = render(
        <InterceptorLogModal {...defaultProps} events={events} />,
      );

      // Initially no filter bar indicators
      const frameBefore = lastFrame();
      expect(frameBefore).not.toContain("Tab=switch");

      // Press / to open filter bar
      stdin.write("/");
      await tick();

      const frameAfter = lastFrame();
      expect(frameAfter).toContain("Tab=switch");
    });
  });

  it("j/k navigation scrolls through events", async () => {
    // Create enough events to exceed visible height (height=30, header=3, footer=3 → 24 visible rows)
    const events = Array.from({ length: 40 }, (_, i) =>
      makeTestEvent({ seq: i + 1, message: `event-line-${i + 1}` }),
    );
    const { lastFrame, stdin } = render(
      <InterceptorLogModal {...defaultProps} events={events} />,
    );

    // Events are displayed newest-first, so event-line-40 should be at the top initially
    const frameBefore = lastFrame();
    expect(frameBefore).toContain("event-line-40");

    // Scroll down with j several times to move past some events
    for (let i = 0; i < 20; i++) {
      stdin.write("j");
    }
    await tick();

    const frameAfter = lastFrame();
    // After scrolling down, the topmost event should have shifted
    // event-line-40 (which was at scroll offset 0) should no longer be visible
    expect(frameAfter).not.toContain("event-line-40");
  });

  it("g key jumps to top", async () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      makeTestEvent({ seq: i + 1, message: `evt-${i + 1}` }),
    );
    const { lastFrame, stdin } = render(
      <InterceptorLogModal {...defaultProps} events={events} />,
    );

    // Scroll down first
    for (let i = 0; i < 20; i++) {
      stdin.write("j");
    }
    await tick();
    expect(lastFrame()).not.toContain("evt-40");

    // Press g to jump to top
    stdin.write("g");
    await tick();

    // Newest event (evt-40) should be visible again at the top
    expect(lastFrame()).toContain("evt-40");
  });

  it("G key jumps to bottom", async () => {
    const events = Array.from({ length: 40 }, (_, i) =>
      makeTestEvent({ seq: i + 1, message: `evt-${i + 1}` }),
    );
    const { lastFrame, stdin } = render(
      <InterceptorLogModal {...defaultProps} events={events} />,
    );

    // Press G to jump to bottom (oldest events, since list is reversed)
    stdin.write("G");
    await tick();

    // evt-1 is the oldest, displayed last in the reversed list, so should be visible at the bottom
    expect(lastFrame()).toContain("evt-1");
    // The newest event at the top of the list should no longer be visible
    expect(lastFrame()).not.toContain("evt-40");
  });

  it("shows filtered event count in header", () => {
    const events = [
      makeTestEvent({ seq: 1, level: "info", message: "info one" }),
      makeTestEvent({ seq: 2, level: "error", message: "error one" }),
      makeTestEvent({ seq: 3, level: "error", message: "error two" }),
    ];
    const { lastFrame } = render(
      <InterceptorLogModal {...defaultProps} events={events} />,
    );

    // All 3 events
    expect(lastFrame()).toContain("3 events");
  });

  it("shows hint bar with / filter shortcut", () => {
    const { lastFrame } = render(
      <InterceptorLogModal {...defaultProps} events={[makeTestEvent()]} />,
    );
    const frame = lastFrame();
    expect(frame).toContain("/ filter");
  });

  it("shows empty state message with filter hint when active filter has no matches", async () => {
    const events = [
      makeTestEvent({ seq: 1, level: "info", message: "some info" }),
    ];
    const { lastFrame } = render(
      <InterceptorLogModal {...defaultProps} events={events} />,
    );
    // With all events visible, shouldn't show the "No matching events" message
    expect(lastFrame()).not.toContain("No matching events");
  });
});
