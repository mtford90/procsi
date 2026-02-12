/**
 * Tests for ExportModal component using ink-testing-library.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { ExportModal } from "./ExportModal.js";

// Helper to wait for React state updates
const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

describe("ExportModal", () => {
  const defaultProps = {
    filename: "test-file.json",
    fileSize: "1.5 KB",
    isBinary: false,
    width: 80,
    height: 24,
    onExport: vi.fn(),
    onClose: vi.fn(),
    isActive: true,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Rendering", () => {
    it("renders with filename and file size", () => {
      const { lastFrame } = render(<ExportModal {...defaultProps} />);
      const frame = lastFrame();

      expect(frame).toContain("test-file.json");
      expect(frame).toContain("1.5 KB");
    });

    it("renders all five export options", () => {
      const { lastFrame } = render(<ExportModal {...defaultProps} />);
      const frame = lastFrame();

      expect(frame).toContain("[1]");
      expect(frame).toContain("[2]");
      expect(frame).toContain("[3]");
      expect(frame).toContain("[4]");
      expect(frame).toContain("[5]");
      expect(frame).toContain("Copy to clipboard");
      expect(frame).toContain(".procsi/exports/");
      expect(frame).toContain("~/Downloads/");
      expect(frame).toContain("Custom path");
      expect(frame).toContain("Open externally");
    });

    it("shows Export Body Content title", () => {
      const { lastFrame } = render(<ExportModal {...defaultProps} />);
      const frame = lastFrame();

      expect(frame).toContain("Export Body Content");
    });

    it("shows binary hint when isBinary is true", () => {
      const { lastFrame } = render(<ExportModal {...defaultProps} isBinary={true} />);
      const frame = lastFrame();

      expect(frame).toContain("binary — will copy raw bytes");
    });
  });

  describe("Navigation with j/k", () => {
    it("j moves selection down", async () => {
      const { lastFrame, stdin } = render(<ExportModal {...defaultProps} />);

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
      const { stdin } = render(<ExportModal {...defaultProps} />);
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

    it("selection stops at bounds", async () => {
      const { stdin } = render(<ExportModal {...defaultProps} />);
      await tick();

      // Try to move up from first option (should stay at first)
      stdin.write("k");
      await tick();
      stdin.write("k");
      await tick();

      // Move to last option (5 options total)
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();
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

  describe("Direct option selection", () => {
    it("1 key calls onExport with clipboard", async () => {
      const onExport = vi.fn();
      const { stdin } = render(<ExportModal {...defaultProps} onExport={onExport} />);
      await tick();

      stdin.write("1");
      await tick();

      expect(onExport).toHaveBeenCalledWith("clipboard");
    });

    it("2 key calls onExport with exports", async () => {
      const onExport = vi.fn();
      const { stdin } = render(<ExportModal {...defaultProps} onExport={onExport} />);
      await tick();

      stdin.write("2");
      await tick();

      expect(onExport).toHaveBeenCalledWith("exports");
    });

    it("3 key calls onExport with downloads", async () => {
      const onExport = vi.fn();
      const { stdin } = render(<ExportModal {...defaultProps} onExport={onExport} />);
      await tick();

      stdin.write("3");
      await tick();

      expect(onExport).toHaveBeenCalledWith("downloads");
    });

    it("4 key switches to custom input mode", async () => {
      const { lastFrame, stdin } = render(<ExportModal {...defaultProps} />);
      await tick();

      stdin.write("4");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("Enter directory path");
    });

    it("5 key calls onExport with open-external", async () => {
      const onExport = vi.fn();
      const { stdin } = render(<ExportModal {...defaultProps} onExport={onExport} />);
      await tick();

      stdin.write("5");
      await tick();

      expect(onExport).toHaveBeenCalledWith("open-external");
    });
  });

  describe("Enter key confirmation", () => {
    it("Enter on first option calls onExport with clipboard", async () => {
      const onExport = vi.fn();
      const { stdin } = render(<ExportModal {...defaultProps} onExport={onExport} />);
      await tick();

      // First option is already selected (clipboard)
      stdin.write("\r");
      await tick();

      expect(onExport).toHaveBeenCalledWith("clipboard");
    });

    it("Enter on second option calls onExport with exports", async () => {
      const onExport = vi.fn();
      const { stdin } = render(<ExportModal {...defaultProps} onExport={onExport} />);
      await tick();

      // Navigate to exports option
      stdin.write("j");
      await tick();

      stdin.write("\r");
      await tick();

      expect(onExport).toHaveBeenCalledWith("exports");
    });

    it("Enter on Custom Path option switches to input mode", async () => {
      const { lastFrame, stdin } = render(<ExportModal {...defaultProps} />);
      await tick();

      // Navigate to Custom Path option (index 3, so 3 presses of j)
      stdin.write("j");
      await tick();
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
      const { lastFrame, stdin } = render(<ExportModal {...defaultProps} />);
      await tick();

      // Enter custom input mode
      stdin.write("4");
      await tick();

      // Type a path
      stdin.write("/home/user/downloads");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("/home/user/downloads");
    });

    it("backspace removes characters", async () => {
      const { lastFrame, stdin } = render(<ExportModal {...defaultProps} />);
      await tick();

      // Enter custom input mode
      stdin.write("4");
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

    it("Escape returns to selection mode", async () => {
      const { lastFrame, stdin } = render(<ExportModal {...defaultProps} />);
      await tick();

      // Enter custom input mode
      stdin.write("4");
      await tick();

      // Type something
      stdin.write("/test");
      await tick();

      // Press Escape
      stdin.write("\x1b");
      await tick();

      const frame = lastFrame();
      // Should be back in selection mode
      expect(frame).toContain("Select export action");
      expect(frame).not.toContain("Enter directory path");
    });

    it("Enter calls onExport with custom and path", async () => {
      const onExport = vi.fn();
      const { stdin } = render(<ExportModal {...defaultProps} onExport={onExport} />);
      await tick();

      // Enter custom input mode
      stdin.write("4");
      await tick();

      // Type a path
      stdin.write("/custom/path");
      await tick();

      // Press Enter to confirm
      stdin.write("\r");
      await tick();

      expect(onExport).toHaveBeenCalledWith("custom", "/custom/path");
    });

    it("Enter with empty path does not call onExport", async () => {
      const onExport = vi.fn();
      const { stdin } = render(<ExportModal {...defaultProps} onExport={onExport} />);
      await tick();

      // Enter custom input mode
      stdin.write("4");
      await tick();

      // Press Enter without typing anything
      stdin.write("\r");
      await tick();

      expect(onExport).not.toHaveBeenCalled();
    });

    it("clears custom path when returning to selection mode", async () => {
      const { lastFrame, stdin } = render(<ExportModal {...defaultProps} />);
      await tick();

      // Enter custom input mode
      stdin.write("4");
      await tick();

      // Type something
      stdin.write("/test/path");
      await tick();

      // Press Escape to return
      stdin.write("\x1b");
      await tick();

      // Enter custom input mode again
      stdin.write("4");
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
      const { stdin } = render(<ExportModal {...defaultProps} onClose={onClose} />);
      await tick();

      stdin.write("\x1b");
      await tick();

      expect(onClose).toHaveBeenCalled();
    });
  });
});
