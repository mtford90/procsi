/**
 * Tests for the EventFilterBar component.
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { EventFilterBar } from "./EventFilterBar.js";

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("EventFilterBar", () => {
  const defaultProps = {
    isActive: true,
    filter: {},
    onFilterChange: vi.fn(),
    onClose: vi.fn(),
    interceptorNames: ["interceptor-a", "interceptor-b", "interceptor-c"],
    width: 120,
  };

  it("renders the search prompt", () => {
    const { lastFrame } = render(<EventFilterBar {...defaultProps} />);
    expect(lastFrame()).toContain("/");
  });

  it("renders level and interceptor labels", () => {
    const { lastFrame } = render(<EventFilterBar {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain("level:");
    expect(frame).toContain("interceptor:");
  });

  it("shows ALL as default level and interceptor", () => {
    const { lastFrame } = render(<EventFilterBar {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain("ALL");
  });

  it("typing characters populates the search field", async () => {
    const { lastFrame, stdin } = render(<EventFilterBar {...defaultProps} />);

    stdin.write("m");
    await tick();
    stdin.write("a");
    await tick();
    stdin.write("t");
    await tick();
    stdin.write("c");
    await tick();
    stdin.write("h");
    await tick();

    expect(lastFrame()).toContain("match");
  });

  it("Tab cycles focus from search to level to interceptor", async () => {
    const { lastFrame, stdin } = render(<EventFilterBar {...defaultProps} />);

    // Initially focused on search — cursor should be visible
    expect(lastFrame()).toContain("█");

    // Tab to level field
    stdin.write("\t");
    await tick();
    // Cursor should disappear from search
    expect(lastFrame()).not.toContain("█");

    // Tab to interceptor field
    stdin.write("\t");
    await tick();

    // Tab wraps back to search
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("█");
  });

  it("right arrow cycles level when level field is focused", async () => {
    const { lastFrame, stdin } = render(<EventFilterBar {...defaultProps} />);

    // Tab to level field
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("ALL");

    // Right arrow cycles to ERROR
    stdin.write("\x1b[C"); // right arrow
    await tick();
    expect(lastFrame()).toContain("ERROR");

    // Right arrow cycles to WARN+
    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("WARN+");

    // Cycles back to ALL
    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("ALL");
  });

  it("left arrow cycles level backwards when level field is focused", async () => {
    const { lastFrame, stdin } = render(<EventFilterBar {...defaultProps} />);

    // Tab to level field
    stdin.write("\t");
    await tick();

    // Left arrow wraps to WARN+
    stdin.write("\x1b[D"); // left arrow
    await tick();
    expect(lastFrame()).toContain("WARN+");
  });

  it("right arrow cycles interceptor when interceptor field is focused", async () => {
    const { lastFrame, stdin } = render(<EventFilterBar {...defaultProps} />);

    // Tab to level, then Tab to interceptor
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    stdin.write("\x1b[C"); // right arrow
    await tick();
    expect(lastFrame()).toContain("interceptor-a");

    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("interceptor-b");

    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("interceptor-c");

    // Cycles back to ALL
    stdin.write("\x1b[C");
    await tick();
    const frame = lastFrame();
    expect(frame).not.toContain("interceptor-c");
    expect(frame).toContain("ALL");
  });

  it("left arrow cycles interceptor backwards when interceptor field is focused", async () => {
    const { lastFrame, stdin } = render(<EventFilterBar {...defaultProps} />);

    // Tab to level, then Tab to interceptor
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    // Left arrow wraps to interceptor-c
    stdin.write("\x1b[D"); // left arrow
    await tick();
    expect(lastFrame()).toContain("interceptor-c");
  });

  it("Escape calls onCancel when provided", async () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <EventFilterBar {...defaultProps} onClose={onClose} onCancel={onCancel} onFilterChange={onFilterChange} />,
    );

    stdin.write("a");
    await tick();
    stdin.write("\x1b");
    await tick();

    expect(onCancel).toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("Escape calls onClose when onCancel not provided", async () => {
    const onClose = vi.fn();
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <EventFilterBar {...defaultProps} onClose={onClose} onFilterChange={onFilterChange} />,
    );

    stdin.write("a");
    await tick();
    stdin.write("\x1b");
    await tick();

    expect(onClose).toHaveBeenCalled();
  });

  it("typing applies filter live (debounced)", async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <EventFilterBar {...defaultProps} onFilterChange={onFilterChange} />,
    );

    stdin.write("t");
    await tick();
    stdin.write("e");
    await tick();
    stdin.write("s");
    await tick();
    stdin.write("t");
    await tick();
    // Wait for debounce (150ms) + render
    await tick(250);

    expect(onFilterChange).toHaveBeenCalledWith({ search: "test" });
  });

  it("Enter closes the bar without additional onFilterChange call", async () => {
    const onFilterChange = vi.fn();
    const onClose = vi.fn();
    const { stdin } = render(
      <EventFilterBar {...defaultProps} onFilterChange={onFilterChange} onClose={onClose} />,
    );

    // Type a search term
    stdin.write("t");
    await tick();
    stdin.write("e");
    await tick();
    stdin.write("s");
    await tick();
    stdin.write("t");
    await tick();
    await tick(250);

    // Clear the mock to check Enter doesn't trigger another call
    onFilterChange.mockClear();

    // Press Enter
    stdin.write("\r");
    await tick();

    expect(onClose).toHaveBeenCalled();
  });

  it("level filter applies live (debounced)", async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <EventFilterBar {...defaultProps} onFilterChange={onFilterChange} />,
    );

    // Tab to level, cycle to ERROR
    stdin.write("\t");
    await tick();
    stdin.write("\x1b[C"); // right arrow
    // Wait for debounce
    await tick(250);

    expect(onFilterChange).toHaveBeenCalledWith({ level: "error" });
  });

  it("interceptor filter applies live (debounced)", async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <EventFilterBar {...defaultProps} onFilterChange={onFilterChange} />,
    );

    // Tab to level, Tab to interceptor, cycle to first interceptor
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();
    stdin.write("\x1b[C"); // right arrow
    // Wait for debounce
    await tick(250);

    expect(onFilterChange).toHaveBeenCalledWith({ interceptor: "interceptor-a" });
  });

  it("backspace removes the last character from search", async () => {
    const { lastFrame, stdin } = render(<EventFilterBar {...defaultProps} />);

    stdin.write("a");
    await tick();
    stdin.write("b");
    await tick();
    stdin.write("c");
    await tick();
    expect(lastFrame()).toContain("abc");

    stdin.write("\x7f"); // backspace
    await tick();
    expect(lastFrame()).toContain("ab");
    expect(lastFrame()).not.toContain("abc");
  });

  it("Enter with no input closes the bar", async () => {
    const onClose = vi.fn();
    const { stdin } = render(
      <EventFilterBar {...defaultProps} onClose={onClose} />,
    );

    stdin.write("\r");
    await tick();

    expect(onClose).toHaveBeenCalled();
  });

  it("renders correctly with initial filter", () => {
    const { lastFrame } = render(
      <EventFilterBar
        {...defaultProps}
        filter={{ search: "test", level: "error", interceptor: "interceptor-b" }}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("test");
    expect(frame).toContain("ERROR");
    expect(frame).toContain("interceptor-b");
  });

  it("renders correctly with initial warn level filter", () => {
    const { lastFrame } = render(
      <EventFilterBar
        {...defaultProps}
        filter={{ level: "warn" }}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("WARN+");
  });

  it("shows help text for key bindings", () => {
    const { lastFrame } = render(<EventFilterBar {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain("Enter=close");
    expect(frame).toContain("Esc=cancel");
    expect(frame).toContain("Tab=switch");
  });

  it("empty interceptorNames array shows ALL only for interceptor field", async () => {
    const { lastFrame, stdin } = render(
      <EventFilterBar {...defaultProps} interceptorNames={[]} />,
    );

    // Tab to level, then Tab to interceptor
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    // Right arrow should not change from ALL (no interceptors to cycle through)
    stdin.write("\x1b[C"); // right arrow
    await tick();
    expect(lastFrame()).toContain("ALL");

    // Left arrow should also not change from ALL
    stdin.write("\x1b[D"); // left arrow
    await tick();
    expect(lastFrame()).toContain("ALL");
  });

  it("typing in search does not affect level or interceptor", async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <EventFilterBar {...defaultProps} onFilterChange={onFilterChange} />,
    );

    // Type search text containing various characters
    for (const ch of "error warn") {
      stdin.write(ch);
      await tick();
    }

    // Wait for debounce
    await tick(250);

    // Should only have search, no level or interceptor filter
    expect(onFilterChange).toHaveBeenCalledWith({ search: "error warn" });
  });

  it("combined filters apply together", async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <EventFilterBar {...defaultProps} onFilterChange={onFilterChange} />,
    );

    // Type search text
    stdin.write("m");
    await tick();
    stdin.write("a");
    await tick();
    stdin.write("t");
    await tick();
    stdin.write("c");
    await tick();
    stdin.write("h");
    await tick();

    // Tab to level, cycle to ERROR
    stdin.write("\t");
    await tick();
    stdin.write("\x1b[C"); // right arrow
    await tick();

    // Tab to interceptor, cycle to first interceptor
    stdin.write("\t");
    await tick();
    stdin.write("\x1b[C"); // right arrow
    await tick();

    // Wait for debounce
    await tick(250);

    expect(onFilterChange).toHaveBeenCalledWith({
      search: "match",
      level: "error",
      interceptor: "interceptor-a",
    });
  });

  it("shows cursor only when search field is focused", async () => {
    const { lastFrame, stdin } = render(<EventFilterBar {...defaultProps} />);

    // Initially focused on search — cursor visible
    expect(lastFrame()).toContain("█");

    // Tab to level field — cursor disappears
    stdin.write("\t");
    await tick();
    expect(lastFrame()).not.toContain("█");

    // Tab to interceptor field — cursor still not visible
    stdin.write("\t");
    await tick();
    expect(lastFrame()).not.toContain("█");

    // Tab back to search — cursor reappears
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("█");
  });

  it("shift+tab cycles focus backwards", async () => {
    const { lastFrame, stdin } = render(<EventFilterBar {...defaultProps} />);

    // Initially focused on search
    expect(lastFrame()).toContain("█");

    // Shift+Tab wraps to interceptor field
    stdin.write("\x1b[Z"); // shift+tab
    await tick();
    expect(lastFrame()).not.toContain("█");

    // Shift+Tab to level field
    stdin.write("\x1b[Z");
    await tick();

    // Shift+Tab back to search
    stdin.write("\x1b[Z");
    await tick();
    expect(lastFrame()).toContain("█");
  });
});
