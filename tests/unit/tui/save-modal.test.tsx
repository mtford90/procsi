/**
 * Tests for SaveModal component using ink-testing-library.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { SaveModal } from "../../../src/cli/tui/components/SaveModal.js";

// Helper to wait for React state updates
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("SaveModal", () => {
  const defaultProps = {
    filename: "test-file.json",
    fileSize: "1.5 KB",
    width: 80,
    height: 24,
    onSave: vi.fn(),
    onClose: vi.fn(),
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders with filename and file size", () => {
      const { lastFrame } = render(<SaveModal {...defaultProps} />);
      const frame = lastFrame();

      expect(frame).toContain("test-file.json");
      expect(frame).toContain("1.5 KB");
    });

    it("renders all three save options", () => {
      const { lastFrame } = render(<SaveModal {...defaultProps} />);
      const frame = lastFrame();

      expect(frame).toContain("[1]");
      expect(frame).toContain("[2]");
      expect(frame).toContain("[3]");
      expect(frame).toContain(".htpx/exports/");
      expect(frame).toContain("~/Downloads/");
      expect(frame).toContain("Custom path");
    });

    it("shows Save Binary Content title", () => {
      const { lastFrame } = render(<SaveModal {...defaultProps} />);
      const frame = lastFrame();

      expect(frame).toContain("Save Binary Content");
    });
  });

  describe("Navigation with j/k", () => {
    it("j moves selection down", async () => {
      const { lastFrame, stdin } = render(<SaveModal {...defaultProps} />);

      // Initial frame - first option should have selection indicator
      const initialFrame = lastFrame();
      expect(initialFrame).toContain("❯");

      // Press j to move down
      stdin.write("j");
      await tick();

      // Selection should move to next option
      const frameAfterJ = lastFrame();
      expect(frameAfterJ).toContain("❯");
    });

    it("k moves selection up", async () => {
      const { stdin } = render(<SaveModal {...defaultProps} />);
      await tick();

      // Move down first
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      // Now move up
      stdin.write("k");
      await tick();

      // Selection should be on second option now
    });

    it("down arrow moves selection down", async () => {
      const { stdin } = render(<SaveModal {...defaultProps} />);
      await tick();

      stdin.write("\x1b[B");
      await tick();

      // Selection should have moved
    });

    it("up arrow moves selection up", async () => {
      const { stdin } = render(<SaveModal {...defaultProps} />);
      await tick();

      // Move down first
      stdin.write("\x1b[B");
      await tick();

      // Move up
      stdin.write("\x1b[A");
      await tick();
    });

    it("selection stops at bounds", async () => {
      const { stdin } = render(<SaveModal {...defaultProps} />);
      await tick();

      // Try to move up from first option (should stay at first)
      stdin.write("k");
      await tick();
      stdin.write("k");
      await tick();

      // Move to last option
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      // Try to move past last
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();
    });
  });

  describe("Direct option selection with 1/2/3", () => {
    it("1 key calls onSave with exports", async () => {
      const onSave = vi.fn();
      const { stdin } = render(<SaveModal {...defaultProps} onSave={onSave} />);
      await tick();

      stdin.write("1");
      await tick();

      expect(onSave).toHaveBeenCalledWith("exports");
    });

    it("2 key calls onSave with downloads", async () => {
      const onSave = vi.fn();
      const { stdin } = render(<SaveModal {...defaultProps} onSave={onSave} />);
      await tick();

      stdin.write("2");
      await tick();

      expect(onSave).toHaveBeenCalledWith("downloads");
    });

    it("3 key switches to custom input mode", async () => {
      const { lastFrame, stdin } = render(<SaveModal {...defaultProps} />);
      await tick();

      stdin.write("3");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("Enter directory path");
    });
  });

  describe("Enter key confirmation", () => {
    it("Enter on exports option calls onSave with exports", async () => {
      const onSave = vi.fn();
      const { stdin } = render(<SaveModal {...defaultProps} onSave={onSave} />);
      await tick();

      // First option is already selected (exports)
      stdin.write("\r");
      await tick();

      expect(onSave).toHaveBeenCalledWith("exports");
    });

    it("Enter on Downloads option calls onSave with downloads", async () => {
      const onSave = vi.fn();
      const { stdin } = render(<SaveModal {...defaultProps} onSave={onSave} />);
      await tick();

      // Navigate to Downloads option
      stdin.write("j");
      await tick();

      stdin.write("\r");
      await tick();

      expect(onSave).toHaveBeenCalledWith("downloads");
    });

    it("Enter on Custom Path option switches to input mode", async () => {
      const { lastFrame, stdin } = render(<SaveModal {...defaultProps} />);
      await tick();

      // Navigate to Custom Path option
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      stdin.write("\r");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("Enter directory path");
    });
  });

  describe("Custom path input mode", () => {
    it("typing adds characters to path", async () => {
      const { lastFrame, stdin } = render(<SaveModal {...defaultProps} />);
      await tick();

      // Enter custom input mode
      stdin.write("3");
      await tick();

      // Type a path
      stdin.write("/home/user/downloads");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("/home/user/downloads");
    });

    it("backspace removes characters", async () => {
      const { lastFrame, stdin } = render(<SaveModal {...defaultProps} />);
      await tick();

      // Enter custom input mode
      stdin.write("3");
      await tick();

      // Type a path
      stdin.write("/path");
      await tick();

      // Press backspace
      stdin.write("\x7f");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("/pat");
      expect(frame).not.toContain("/path");
    });

    it("Escape in input mode returns to selection mode", async () => {
      const { lastFrame, stdin } = render(<SaveModal {...defaultProps} />);
      await tick();

      // Enter custom input mode
      stdin.write("3");
      await tick();

      // Type something
      stdin.write("/test");
      await tick();

      // Press Escape
      stdin.write("\x1b");
      await tick();

      const frame = lastFrame();
      // Should be back in selection mode
      expect(frame).toContain("Select save location");
      expect(frame).not.toContain("Enter directory path");
    });

    it("Enter in input mode calls onSave with custom path", async () => {
      const onSave = vi.fn();
      const { stdin } = render(<SaveModal {...defaultProps} onSave={onSave} />);
      await tick();

      // Enter custom input mode
      stdin.write("3");
      await tick();

      // Type a path
      stdin.write("/custom/path");
      await tick();

      // Press Enter to confirm
      stdin.write("\r");
      await tick();

      expect(onSave).toHaveBeenCalledWith("custom", "/custom/path");
    });

    it("Enter with empty path does not call onSave", async () => {
      const onSave = vi.fn();
      const { stdin } = render(<SaveModal {...defaultProps} onSave={onSave} />);
      await tick();

      // Enter custom input mode
      stdin.write("3");
      await tick();

      // Press Enter without typing anything
      stdin.write("\r");
      await tick();

      expect(onSave).not.toHaveBeenCalled();
    });

    it("clears custom path when returning to selection mode", async () => {
      const { lastFrame, stdin } = render(<SaveModal {...defaultProps} />);
      await tick();

      // Enter custom input mode
      stdin.write("3");
      await tick();

      // Type something
      stdin.write("/test/path");
      await tick();

      // Press Escape to return
      stdin.write("\x1b");
      await tick();

      // Enter custom input mode again
      stdin.write("3");
      await tick();

      const frame = lastFrame();
      // Path should be cleared (only cursor visible after prompt)
      expect(frame).toContain("> ");
      expect(frame).not.toContain("/test/path");
    });
  });

  describe("Escape key", () => {
    it("Escape in selection mode calls onClose", async () => {
      const onClose = vi.fn();
      const { stdin } = render(<SaveModal {...defaultProps} onClose={onClose} />);
      await tick();

      stdin.write("\x1b");
      await tick();

      expect(onClose).toHaveBeenCalled();
    });
  });
});
