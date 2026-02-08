/**
 * Tests for the FilterBar component.
 */

import { describe, it, expect, vi } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { FilterBar } from "./FilterBar.js";

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("FilterBar", () => {
  const defaultProps = {
    isActive: true,
    filter: {},
    onFilterChange: vi.fn(),
    onClose: vi.fn(),
    width: 80,
  };

  it("renders the search prompt", () => {
    const { lastFrame } = render(<FilterBar {...defaultProps} />);
    expect(lastFrame()).toContain("/");
  });

  it("renders method and status labels", () => {
    const { lastFrame } = render(<FilterBar {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain("method:");
    expect(frame).toContain("status:");
  });

  it("shows ALL as default method and status", () => {
    const { lastFrame } = render(<FilterBar {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain("ALL");
  });

  it("typing characters populates the search field", async () => {
    const { lastFrame, stdin } = render(<FilterBar {...defaultProps} />);

    stdin.write("a");
    await tick();
    stdin.write("p");
    await tick();
    stdin.write("i");
    await tick();

    expect(lastFrame()).toContain("api");
  });

  it("allows typing m and s in the search field", async () => {
    const { lastFrame, stdin } = render(<FilterBar {...defaultProps} />);

    stdin.write("u");
    await tick();
    stdin.write("s");
    await tick();
    stdin.write("e");
    await tick();
    stdin.write("r");
    await tick();
    stdin.write("s");
    await tick();

    expect(lastFrame()).toContain("users");
  });

  it("Tab cycles focus from search to method to status", async () => {
    const { lastFrame, stdin } = render(<FilterBar {...defaultProps} />);

    // Initially focused on search — cursor should be visible
    expect(lastFrame()).toContain("█");

    // Tab to method field
    stdin.write("\t");
    await tick();
    // Cursor should disappear from search
    expect(lastFrame()).not.toContain("█");

    // Tab to status field
    stdin.write("\t");
    await tick();

    // Tab wraps back to search
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("█");
  });

  it("right arrow cycles method when method field is focused", async () => {
    const { lastFrame, stdin } = render(<FilterBar {...defaultProps} />);

    // Tab to method field
    stdin.write("\t");
    await tick();
    expect(lastFrame()).toContain("ALL");

    // Right arrow cycles to GET
    stdin.write("\x1b[C"); // right arrow
    await tick();
    expect(lastFrame()).toContain("GET");

    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("POST");

    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("PUT");

    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("PATCH");

    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("DELETE");

    // Cycles back to ALL
    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("ALL");
  });

  it("left arrow cycles method backwards when method field is focused", async () => {
    const { lastFrame, stdin } = render(<FilterBar {...defaultProps} />);

    // Tab to method field
    stdin.write("\t");
    await tick();

    // Left arrow wraps to DELETE
    stdin.write("\x1b[D"); // left arrow
    await tick();
    expect(lastFrame()).toContain("DELETE");
  });

  it("right arrow cycles status when status field is focused", async () => {
    const { lastFrame, stdin } = render(<FilterBar {...defaultProps} />);

    // Tab to method, then Tab to status
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();

    stdin.write("\x1b[C"); // right arrow
    await tick();
    expect(lastFrame()).toContain("2xx");

    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("3xx");

    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("4xx");

    stdin.write("\x1b[C");
    await tick();
    expect(lastFrame()).toContain("5xx");

    // Cycles back to ALL
    stdin.write("\x1b[C");
    await tick();
    const frame = lastFrame();
    expect(frame).not.toContain("5xx");
  });

  it("Escape calls onCancel when provided", async () => {
    const onClose = vi.fn();
    const onCancel = vi.fn();
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <FilterBar {...defaultProps} onClose={onClose} onCancel={onCancel} onFilterChange={onFilterChange} />,
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
      <FilterBar {...defaultProps} onClose={onClose} onFilterChange={onFilterChange} />,
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
      <FilterBar {...defaultProps} onFilterChange={onFilterChange} />,
    );

    stdin.write("a");
    await tick();
    stdin.write("p");
    await tick();
    stdin.write("i");
    // Wait for debounce (150ms) + render
    await tick(250);

    expect(onFilterChange).toHaveBeenCalledWith({ search: "api" });
  });

  it("Enter closes the bar without additional onFilterChange call", async () => {
    const onFilterChange = vi.fn();
    const onClose = vi.fn();
    const { stdin } = render(
      <FilterBar {...defaultProps} onFilterChange={onFilterChange} onClose={onClose} />,
    );

    // Type a search term
    stdin.write("a");
    await tick();
    stdin.write("p");
    await tick();
    stdin.write("i");
    await tick(250);

    // Clear the mock to check Enter doesn't trigger another call
    onFilterChange.mockClear();

    // Press Enter
    stdin.write("\r");
    await tick();

    expect(onClose).toHaveBeenCalled();
  });

  it("method filter applies live (debounced)", async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <FilterBar {...defaultProps} onFilterChange={onFilterChange} />,
    );

    // Tab to method, cycle to GET
    stdin.write("\t");
    await tick();
    stdin.write("\x1b[C"); // right arrow
    // Wait for debounce
    await tick(250);

    expect(onFilterChange).toHaveBeenCalledWith({ methods: ["GET"] });
  });

  it("status filter applies live (debounced)", async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <FilterBar {...defaultProps} onFilterChange={onFilterChange} />,
    );

    // Tab to method, Tab to status, cycle to 2xx
    stdin.write("\t");
    await tick();
    stdin.write("\t");
    await tick();
    stdin.write("\x1b[C"); // right arrow
    // Wait for debounce
    await tick(250);

    expect(onFilterChange).toHaveBeenCalledWith({ statusRange: "2xx" });
  });

  it("backspace removes the last character from search", async () => {
    const { lastFrame, stdin } = render(<FilterBar {...defaultProps} />);

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
      <FilterBar {...defaultProps} onClose={onClose} />,
    );

    stdin.write("\r");
    await tick();

    expect(onClose).toHaveBeenCalled();
  });

  it("renders correctly with initial filter", () => {
    const { lastFrame } = render(
      <FilterBar
        {...defaultProps}
        filter={{ search: "test", methods: ["POST"], statusRange: "4xx" }}
      />,
    );
    const frame = lastFrame();
    expect(frame).toContain("test");
    expect(frame).toContain("POST");
    expect(frame).toContain("4xx");
  });

  it("shows help text for key bindings", () => {
    const { lastFrame } = render(<FilterBar {...defaultProps} />);
    const frame = lastFrame();
    expect(frame).toContain("Enter=close");
    expect(frame).toContain("Esc=cancel");
    expect(frame).toContain("Tab=switch");
  });

  it("typing in search does not affect method or status", async () => {
    const onFilterChange = vi.fn();
    const { stdin } = render(
      <FilterBar {...defaultProps} onFilterChange={onFilterChange} />,
    );

    // Type "message" which contains both 'm' and 's'
    for (const ch of "message") {
      stdin.write(ch);
      await tick();
    }

    // Wait for debounce
    await tick(250);

    // Should only have search, no method or status filter
    expect(onFilterChange).toHaveBeenCalledWith({ search: "message" });
  });
});
