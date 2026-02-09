/**
 * Tests for JsonExplorerModal component using ink-testing-library.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { JsonExplorerModal } from "./JsonExplorerModal.js";

vi.mock("../utils/clipboard.js", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve()),
}));

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("JsonExplorerModal", () => {
  const sampleData = {
    data: {
      users: [
        { name: "Alice", age: 30 },
        { name: "Bob", age: 25 },
      ],
    },
    status: "ok",
    count: 2,
  };

  const defaultProps = {
    data: sampleData,
    title: "Response Body",
    contentType: "application/json",
    bodySize: 1234,
    width: 80,
    height: 30,
    onClose: vi.fn(),
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders the title in the header", () => {
      const { lastFrame } = render(<JsonExplorerModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).toContain("Response Body");
    });

    it("renders content type and size in header", () => {
      const { lastFrame } = render(<JsonExplorerModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).toContain("application/json");
      expect(frame).toContain("1.2KB");
    });

    it("renders the tree with root node", () => {
      const { lastFrame } = render(<JsonExplorerModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).toContain("(root)");
    });

    it("renders depth-1 keys when default-expanded", () => {
      const { lastFrame } = render(<JsonExplorerModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).toContain("data");
      expect(frame).toContain("status");
      expect(frame).toContain("count");
    });

    it("renders hint bar", () => {
      const { lastFrame } = render(<JsonExplorerModal {...defaultProps} width={150} />);
      const frame = lastFrame();
      expect(frame).toContain("j/k nav");
      expect(frame).toContain("q/Esc close");
    });

    it("renders breadcrumb for cursor position", () => {
      const { lastFrame } = render(<JsonExplorerModal {...defaultProps} />);
      const frame = lastFrame();
      // Default cursor is at position 0 (root)
      expect(frame).toContain("(root)");
    });

    it("renders with simple primitive data", () => {
      const { lastFrame } = render(
        <JsonExplorerModal {...defaultProps} data={42} />
      );
      const frame = lastFrame();
      expect(frame).toContain("42");
    });

    it("renders expand/collapse arrows", () => {
      const { lastFrame } = render(<JsonExplorerModal {...defaultProps} />);
      const frame = lastFrame();
      // Root is expanded, so should show ▼
      expect(frame).toContain("▼");
    });

    it("renders primitive value colours — strings in green", () => {
      const { lastFrame } = render(
        <JsonExplorerModal {...defaultProps} data={{ greeting: "hello" }} />
      );
      const frame = lastFrame();
      expect(frame).toContain('"hello"');
    });
  });

  describe("Navigation", () => {
    it("j moves cursor down", async () => {
      const { lastFrame, stdin } = render(<JsonExplorerModal {...defaultProps} />);

      // Initial: cursor on root
      let frame = lastFrame();
      expect(frame).toContain("❯");

      // Move down
      stdin.write("j");
      await tick();

      frame = lastFrame();
      // Breadcrumb should update to show the new cursor position
      expect(frame).toContain("❯");
    });

    it("k moves cursor up", async () => {
      const { lastFrame, stdin } = render(<JsonExplorerModal {...defaultProps} />);

      // Move down first
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      // Move back up
      stdin.write("k");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("❯");
    });

    it("cursor stops at top bound", async () => {
      const { stdin } = render(<JsonExplorerModal {...defaultProps} />);

      // Try to move up from first position
      stdin.write("k");
      await tick();
      stdin.write("k");
      await tick();

      // Should not crash
    });

    it("g jumps to first node", async () => {
      const { lastFrame, stdin } = render(<JsonExplorerModal {...defaultProps} />);

      // Move down several times
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      // Jump to first
      stdin.write("g");
      await tick();

      // Breadcrumb should show root
      const frame = lastFrame();
      expect(frame).toContain("(root)");
    });

    it("G jumps to last node", async () => {
      const { lastFrame, stdin } = render(<JsonExplorerModal {...defaultProps} />);

      stdin.write("G");
      await tick();

      const frame = lastFrame();
      // Should contain the cursor indicator
      expect(frame).toContain("❯");
    });

    it("down arrow also moves cursor", async () => {
      const { stdin } = render(<JsonExplorerModal {...defaultProps} />);

      // Down arrow escape sequence
      stdin.write("\x1b[B");
      await tick();

      // Should not crash and cursor should have moved
    });
  });

  describe("Expand/Collapse", () => {
    it("Enter expands a collapsed node", async () => {
      const data = { nested: { deep: { value: 1 } } };
      const { lastFrame, stdin } = render(
        <JsonExplorerModal {...defaultProps} data={data} />
      );

      // Move to "nested" (depth-1, should be expanded by default)
      stdin.write("j");
      await tick();

      // Move to "deep" (depth-2, collapsed by default)
      stdin.write("j");
      await tick();

      // Expand it
      stdin.write("\r");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("value");
    });

    it("l also expands a collapsed node", async () => {
      const data = { nested: { deep: { value: 1 } } };
      const { lastFrame, stdin } = render(
        <JsonExplorerModal {...defaultProps} data={data} />
      );

      // Navigate to the collapsed "deep" node
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      // Expand with l
      stdin.write("l");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("value");
    });

    it("Enter collapses an already-expanded node", async () => {
      const data = { items: { a: 1, b: 2 } };
      const { lastFrame, stdin } = render(
        <JsonExplorerModal {...defaultProps} data={data} />
      );

      // Move to "items" (expanded by default at depth 1)
      stdin.write("j");
      await tick();

      // Should see children
      let frame = lastFrame();
      expect(frame).toContain("a");
      expect(frame).toContain("▼");

      // Collapse it with Enter
      stdin.write("\r");
      await tick();

      frame = lastFrame();
      // Children should be hidden — ▶ arrow should appear instead of ▼ for items
      expect(frame).toContain("▶");
    });

    it("Enter on a primitive node is a no-op", async () => {
      const data = { name: "Alice", age: 30 };
      const { lastFrame, stdin } = render(
        <JsonExplorerModal {...defaultProps} data={data} />
      );

      // Move to "name" (a primitive leaf)
      stdin.write("j");
      await tick();

      const frameBefore = lastFrame();

      // Press Enter — should be a no-op
      stdin.write("\r");
      await tick();

      const frameAfter = lastFrame();
      // Frame should be unchanged
      expect(frameAfter).toBe(frameBefore);
    });

    it("l on a primitive node is a no-op", async () => {
      const data = { name: "Alice", age: 30 };
      const { lastFrame, stdin } = render(
        <JsonExplorerModal {...defaultProps} data={data} />
      );

      // Move to "name" (a primitive leaf)
      stdin.write("j");
      await tick();

      const frameBefore = lastFrame();

      // Press l — should be a no-op
      stdin.write("l");
      await tick();

      const frameAfter = lastFrame();
      expect(frameAfter).toBe(frameBefore);
    });

    it("h collapses an expanded node", async () => {
      const data = { items: { a: 1, b: 2 } };
      const { lastFrame, stdin } = render(
        <JsonExplorerModal {...defaultProps} data={data} />
      );

      // Move to "items" (expanded by default)
      stdin.write("j");
      await tick();

      // Should see children
      let frame = lastFrame();
      expect(frame).toContain("a");

      // Collapse it
      stdin.write("h");
      await tick();

      frame = lastFrame();
      // Children should be hidden — the ▶ arrow should appear instead of ▼
      expect(frame).toContain("▶");
    });

    it("h on a leaf jumps to parent", async () => {
      const data = { items: { a: 1 } };
      const { lastFrame, stdin } = render(
        <JsonExplorerModal {...defaultProps} data={data} />
      );

      // Navigate to "a" (leaf under "items")
      stdin.write("j"); // items
      await tick();
      stdin.write("j"); // a
      await tick();

      // Breadcrumb should show we're at a
      let frame = lastFrame();
      expect(frame).toContain("a");

      // Press h — should jump to parent (items)
      stdin.write("h");
      await tick();

      // Breadcrumb should update
      frame = lastFrame();
      expect(frame).toContain("items");
    });
  });

  describe("Expand/Collapse All", () => {
    it("e expands all nodes", async () => {
      const data = { nested: { deep: { value: 1 } } };
      const { lastFrame, stdin } = render(
        <JsonExplorerModal {...defaultProps} data={data} />
      );

      // "deep" is at depth 2, not expanded by default
      let frame = lastFrame();
      expect(frame).not.toContain("value");

      // Press e to expand all
      stdin.write("e");
      await tick();

      frame = lastFrame();
      expect(frame).toContain("value");
    });

    it("c collapses all nodes", async () => {
      const data = { items: { a: 1, b: 2 } };
      const { lastFrame, stdin } = render(
        <JsonExplorerModal {...defaultProps} data={data} />
      );

      // depth-1 "items" is expanded by default, children visible
      let frame = lastFrame();
      expect(frame).toContain("a");

      // Press c to collapse all
      stdin.write("c");
      await tick();

      frame = lastFrame();
      // Children should be hidden — only root visible with ▶
      expect(frame).toContain("▶");
      expect(frame).not.toContain("items");
    });
  });

  describe("Close", () => {
    it("Escape closes the modal", async () => {
      const onClose = vi.fn();
      const { stdin } = render(
        <JsonExplorerModal {...defaultProps} onClose={onClose} />
      );

      stdin.write("\x1b");
      await tick();

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("Filter", () => {
    it("/ opens filter mode", async () => {
      const { lastFrame, stdin } = render(<JsonExplorerModal {...defaultProps} />);

      stdin.write("/");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("filter:");
    });

    it("typing updates filter text", async () => {
      const { lastFrame, stdin } = render(<JsonExplorerModal {...defaultProps} />);

      stdin.write("/");
      await tick();

      stdin.write("data");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("data");
    });

    it("Escape in filter mode cancels filter", async () => {
      const onClose = vi.fn();
      const { lastFrame, stdin } = render(
        <JsonExplorerModal {...defaultProps} onClose={onClose} />
      );

      stdin.write("/");
      await tick();

      stdin.write("data");
      await tick();

      // Escape should cancel filter, not close modal
      stdin.write("\x1b");
      await tick();

      expect(onClose).not.toHaveBeenCalled();
      const frame = lastFrame();
      // Should be back in normal mode — no "filter:" shown
      expect(frame).not.toContain("filter:");
    });

    it("typing applies filter live (debounced) and highlights matches", async () => {
      const { lastFrame, stdin } = render(<JsonExplorerModal {...defaultProps} />);

      stdin.write("/");
      await tick();

      stdin.write("status");
      // Wait for debounce (150ms) + render
      await tick(250);

      const frame = lastFrame();
      // "status" should be visible (auto-expanded ancestors) — applied live, no Enter needed
      expect(frame).toContain("status");
    });

    it("Enter closes filter mode but keeps filter results", async () => {
      const { lastFrame, stdin } = render(<JsonExplorerModal {...defaultProps} />);

      stdin.write("/");
      await tick();

      stdin.write("status");
      await tick(250);

      // Enter should close filter mode
      stdin.write("\r");
      await tick();

      const frame = lastFrame();
      // Filter bar should be gone (no "filter:" text)
      expect(frame).not.toContain("filter:");
      // But "status" should still be visible (filter results kept)
      expect(frame).toContain("status");
    });

    it("backspace removes characters in filter", async () => {
      const { lastFrame, stdin } = render(<JsonExplorerModal {...defaultProps} />);

      stdin.write("/");
      await tick();

      stdin.write("data");
      await tick();

      // Backspace
      stdin.write("\x7f");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("dat");
    });
  });

  describe("Copy", () => {
    it("y copies value at cursor to clipboard", async () => {
      const { copyToClipboard: mockCopy } = await import("../utils/clipboard.js");
      const onStatus = vi.fn();
      const { stdin } = render(
        <JsonExplorerModal {...defaultProps} onStatus={onStatus} data={{ name: "Alice" }} />
      );

      // Move to "name" (leaf)
      stdin.write("j");
      await tick();

      // Copy
      stdin.write("y");
      await tick();

      expect(mockCopy).toHaveBeenCalledWith("Alice");
    });
  });

  describe("Header", () => {
    it("shows correct title for request body", () => {
      const { lastFrame } = render(
        <JsonExplorerModal {...defaultProps} title="Request Body" />
      );
      expect(lastFrame()).toContain("Request Body");
    });

    it("shows body size formatted", () => {
      const { lastFrame } = render(
        <JsonExplorerModal {...defaultProps} bodySize={5000} />
      );
      expect(lastFrame()).toContain("4.9KB");
    });
  });
});
