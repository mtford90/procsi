/**
 * Tests for TextViewerModal component using ink-testing-library.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { TextViewerModal } from "./TextViewerModal.js";

vi.mock("../utils/clipboard.js", () => ({
  copyToClipboard: vi.fn(() => Promise.resolve()),
}));

const tick = (ms = 50) => new Promise((resolve) => setTimeout(resolve, ms));

/** Write a string character-by-character with ticks between each. */
async function typeString(
  stdin: { write: (s: string) => void },
  text: string,
) {
  for (const ch of text) {
    stdin.write(ch);
    await tick();
  }
}

describe("TextViewerModal", () => {
  const defaultProps = {
    text: "line one\nline two\nline three\nline four\nline five",
    title: "Response Body",
    contentType: "text/html",
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
      const { lastFrame } = render(<TextViewerModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).toContain("Response Body");
    });

    it("renders content type in the header", () => {
      const { lastFrame } = render(<TextViewerModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).toContain("text/html");
    });

    it("renders body size formatted in the header", () => {
      const { lastFrame } = render(<TextViewerModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).toContain("1.2KB");
    });

    it("renders text content with line numbers", () => {
      const { lastFrame } = render(<TextViewerModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).toContain("line one");
      expect(frame).toContain("line two");
      expect(frame).toContain("line three");
      // Line number separator
      expect(frame).toContain("\u2502");
    });

    it("renders the line position indicator", () => {
      const { lastFrame } = render(<TextViewerModal {...defaultProps} />);
      const frame = lastFrame();
      expect(frame).toContain("Line 1/5");
    });

    it("renders the hint bar", () => {
      const { lastFrame } = render(
        <TextViewerModal {...defaultProps} width={120} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("j/k nav");
      expect(frame).toContain("/ search");
      expect(frame).toContain("y copy");
      expect(frame).toContain("q/Esc close");
    });

    it("renders with different title", () => {
      const { lastFrame } = render(
        <TextViewerModal {...defaultProps} title="Request Body" />,
      );
      expect(lastFrame()).toContain("Request Body");
    });

    it("renders with different body size", () => {
      const { lastFrame } = render(
        <TextViewerModal {...defaultProps} bodySize={5000} />,
      );
      expect(lastFrame()).toContain("4.9KB");
    });

    it("strips content-type parameters for display", () => {
      const { lastFrame } = render(
        <TextViewerModal
          {...defaultProps}
          contentType="text/html; charset=utf-8"
        />,
      );
      const frame = lastFrame();
      expect(frame).toContain("text/html");
    });
  });

  describe("Navigation", () => {
    // Use 10 lines with a tall height so ink-testing-library renders all
    // chrome (info row, hint bar) without clipping. With height=30 and 10
    // lines, availableHeight=25, maxScrollOffset = max(0, 10-25) = 0, so
    // no scrolling at all. We need lines > availableHeight. Use 30 lines
    // with height=12 to get availableHeight=7, maxScrollOffset=23.
    //
    // ink-testing-library clips ~2 rows when content fills the viewport, so
    // we add 2 extra rows to compensate (height=14 => availableHeight=9).
    const navLines = Array.from(
      { length: 30 },
      (_, i) => `row-${String(i + 1).padStart(2, "0")}`,
    ).join("\n");
    const navHeight = 14;
    // availableHeight = 14 - 3 - 2 = 9
    // maxScrollOffset = 30 - 9 = 21

    it("j scrolls down one line", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={navLines}
          height={navHeight}
        />,
      );

      const frameBefore = lastFrame();

      stdin.write("j");
      await tick();

      const frameAfter = lastFrame();
      // Frame must change -- scrolling happened
      expect(frameAfter).not.toBe(frameBefore);
      // After scrolling down one, later rows should now be visible
      expect(frameAfter).toContain("row-03");
    });

    it("k scrolls up after scrolling down", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={navLines}
          height={navHeight}
        />,
      );

      // Scroll down three times
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      const frameAtThree = lastFrame();

      // Scroll back up
      stdin.write("k");
      await tick();

      const frameAfterUp = lastFrame();
      // Frame must change
      expect(frameAfterUp).not.toBe(frameAtThree);
    });

    it("k does not scroll above the first line", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={navLines}
          height={navHeight}
        />,
      );

      const frameBefore = lastFrame();

      // Try to scroll up from the top -- should be a no-op
      stdin.write("k");
      await tick();

      const frameAfter = lastFrame();
      expect(frameAfter).toBe(frameBefore);
    });

    it("j does not scroll past the last visible position", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={navLines}
          height={navHeight}
        />,
      );

      // Spam j well beyond the max scroll offset
      for (let i = 0; i < 40; i++) {
        stdin.write("j");
      }
      await tick();

      const frame = lastFrame();
      // Should be at max scroll -- last few rows visible
      expect(frame).toContain("row-29");
    });

    it("Ctrl+d scrolls down half a page", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={navLines}
          height={navHeight}
        />,
      );

      const frameBefore = lastFrame();

      // availableHeight=9, halfPage=4
      stdin.write("\x04");
      await tick();

      const frameAfter = lastFrame();
      expect(frameAfter).not.toBe(frameBefore);
      // After scrolling 4 lines down, later rows should be visible
      expect(frameAfter).toContain("row-06");
    });

    it("Ctrl+u scrolls up half a page", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={navLines}
          height={navHeight}
        />,
      );

      // Scroll down by a full page first (two Ctrl+d presses)
      stdin.write("\x04");
      await tick();
      stdin.write("\x04");
      await tick();

      const frameDown = lastFrame();

      // Scroll up half page
      stdin.write("\x15");
      await tick();

      const frameAfterUp = lastFrame();
      expect(frameAfterUp).not.toBe(frameDown);
    });

    it("g jumps to the top", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={navLines}
          height={navHeight}
        />,
      );

      const initialFrame = lastFrame();

      // Scroll down
      stdin.write("\x04");
      await tick();
      stdin.write("\x04");
      await tick();

      // Jump to top
      stdin.write("g");
      await tick();

      const frame = lastFrame();
      // Should be back to the initial state
      expect(frame).toBe(initialFrame);
    });

    it("G jumps to the bottom", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={navLines}
          height={navHeight}
        />,
      );

      stdin.write("G");
      await tick();

      const frame = lastFrame();
      // Should be at max scroll -- last few rows visible
      expect(frame).toContain("row-29");
    });

    it("down arrow scrolls down", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={navLines}
          height={navHeight}
        />,
      );

      const frameBefore = lastFrame();

      stdin.write("\x1b[B");
      await tick();

      const frameAfter = lastFrame();
      expect(frameAfter).not.toBe(frameBefore);
    });

    it("up arrow scrolls up after scrolling down", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={navLines}
          height={navHeight}
        />,
      );

      // Move down first
      stdin.write("j");
      await tick();
      stdin.write("j");
      await tick();

      const frameDown = lastFrame();

      stdin.write("\x1b[A");
      await tick();

      const frameAfterUp = lastFrame();
      expect(frameAfterUp).not.toBe(frameDown);
    });

    it("Line indicator updates with scroll position", async () => {
      // Use the default short text where the info row renders correctly
      const { lastFrame } = render(<TextViewerModal {...defaultProps} />);

      const frame = lastFrame();
      expect(frame).toContain("Line 1/5");
    });
  });

  describe("Search", () => {
    it("/ opens search mode", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} />,
      );

      stdin.write("/");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("search:");
    });

    it("typing updates the search text", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} />,
      );

      stdin.write("/");
      await tick();

      await typeString(stdin, "two");

      const frame = lastFrame();
      expect(frame).toContain("two");
    });

    it("Escape in search mode cancels search without closing modal", async () => {
      const onClose = vi.fn();
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} onClose={onClose} />,
      );

      stdin.write("/");
      await tick();

      await typeString(stdin, "two");

      // Cancel search
      stdin.write("\x1b");
      await tick();

      expect(onClose).not.toHaveBeenCalled();
      const frame = lastFrame();
      expect(frame).not.toContain("search:");
    });

    it("Escape in search mode clears the search text and match info", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} />,
      );

      stdin.write("/");
      await tick();

      await typeString(stdin, "two");

      // Cancel
      stdin.write("\x1b");
      await tick();

      const frame = lastFrame();
      // After cancellation, the info row should show the normal "Line X/Y"
      // without any match count info
      expect(frame).toContain("Line 1/5");
      expect(frame).not.toContain("matches");
    });

    it("Enter closes search mode and jumps to first match", async () => {
      const text = "alpha\nbeta\ngamma\nbeta again\nepsilon";
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} text={text} />,
      );

      stdin.write("/");
      await tick();

      await typeString(stdin, "beta");

      // Confirm search
      stdin.write("\r");
      await tick();

      const frame = lastFrame();
      // Search bar should be gone
      expect(frame).not.toContain("search:");
      // Match count should be visible in the info row
      expect(frame).toContain("2 matches");
    });

    it("backspace removes characters in search", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} />,
      );

      stdin.write("/");
      await tick();

      await typeString(stdin, "three");

      // Delete last char
      stdin.write("\x7f");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("thre");
    });

    it("n cycles to next match", async () => {
      const text = "apple\nbanana\napple pie\ncherry\napple sauce";
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} text={text} />,
      );

      // Search for "apple"
      stdin.write("/");
      await tick();
      await typeString(stdin, "apple");
      stdin.write("\r");
      await tick();

      let frame = lastFrame();
      expect(frame).toContain("3 matches");
      expect(frame).toContain("(1/3)");

      // Next match
      stdin.write("n");
      await tick();

      frame = lastFrame();
      expect(frame).toContain("(2/3)");
    });

    it("N cycles to previous match", async () => {
      const text = "apple\nbanana\napple pie\ncherry\napple sauce";
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} text={text} />,
      );

      // Search for "apple"
      stdin.write("/");
      await tick();
      await typeString(stdin, "apple");
      stdin.write("\r");
      await tick();

      // Move to second match
      stdin.write("n");
      await tick();

      let frame = lastFrame();
      expect(frame).toContain("(2/3)");

      // Go back
      stdin.write("N");
      await tick();

      frame = lastFrame();
      expect(frame).toContain("(1/3)");
    });

    it("n wraps around from last to first match", async () => {
      const text = "apple\nbanana\napple pie";
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} text={text} />,
      );

      stdin.write("/");
      await tick();
      await typeString(stdin, "apple");
      stdin.write("\r");
      await tick();

      // At (1/2), go to (2/2)
      stdin.write("n");
      await tick();

      let frame = lastFrame();
      expect(frame).toContain("(2/2)");

      // Wrap around
      stdin.write("n");
      await tick();

      frame = lastFrame();
      expect(frame).toContain("(1/2)");
    });

    it("N wraps around from first to last match", async () => {
      const text = "apple\nbanana\napple pie";
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} text={text} />,
      );

      stdin.write("/");
      await tick();
      await typeString(stdin, "apple");
      stdin.write("\r");
      await tick();

      // At (1/2), go back to wrap around
      stdin.write("N");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("(2/2)");
    });

    it("search is case-insensitive", async () => {
      const text = "Hello World\ngoodbye\nHELLO again";
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} text={text} />,
      );

      stdin.write("/");
      await tick();
      await typeString(stdin, "hello");
      stdin.write("\r");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("2 matches");
    });

    it("shows single match count without plural", async () => {
      const text = "unique line\nother\nanother";
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} text={text} />,
      );

      stdin.write("/");
      await tick();
      await typeString(stdin, "unique");
      stdin.write("\r");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("1 match (");
      expect(frame).not.toContain("1 matches");
    });

    it("n does nothing when there are no matches", async () => {
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} />,
      );

      // Search for something that does not exist
      stdin.write("/");
      await tick();
      await typeString(stdin, "zzzznotfound");
      stdin.write("\r");
      await tick();

      const frameBefore = lastFrame();

      // Press n -- should be a no-op
      stdin.write("n");
      await tick();

      const frameAfter = lastFrame();
      expect(frameAfter).toBe(frameBefore);
    });

    it("search scrolls viewport to show the first match", async () => {
      // 15 lines, tall height so all chrome renders. Match near the end
      // that would require scrolling. height=30 => availableHeight=25
      // which is more than 15 lines, so no scrolling needed and all lines
      // visible. We need more lines than availableHeight. Use 30 lines.
      const lines = Array.from({ length: 30 }, (_, i) =>
        i === 27 ? "MATCH_TARGET" : `filler-${i + 1}`,
      ).join("\n");

      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          text={lines}
          height={14}
        />,
      );
      // height=14, availableHeight=9
      // MATCH_TARGET is on line 28 (index 27), well beyond the initial viewport

      const initialFrame = lastFrame();
      // Initially should not show the target
      expect(initialFrame).not.toContain("MATCH_TARGET");

      // Search for it
      stdin.write("/");
      await tick();
      await typeString(stdin, "MATCH_TARGET");
      stdin.write("\r");
      await tick();

      const frame = lastFrame();
      // After search, viewport should have scrolled to show the match
      expect(frame).toContain("MATCH_TARGET");
    });
  });

  describe("Copy", () => {
    it("y copies full text to clipboard", async () => {
      const { copyToClipboard: mockCopy } = await import(
        "../utils/clipboard.js"
      );
      const onStatus = vi.fn();
      const { stdin } = render(
        <TextViewerModal {...defaultProps} onStatus={onStatus} />,
      );

      stdin.write("y");
      await tick();

      expect(mockCopy).toHaveBeenCalledWith(defaultProps.text);
    });

    it("y shows status message on success", async () => {
      const onStatus = vi.fn();
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} onStatus={onStatus} />,
      );

      stdin.write("y");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("Copied to clipboard");
      expect(onStatus).toHaveBeenCalledWith("Copied to clipboard");
    });

    it("y shows failure message when clipboard fails", async () => {
      const { copyToClipboard: mockCopy } = await import(
        "../utils/clipboard.js"
      );
      vi.mocked(mockCopy).mockRejectedValueOnce(new Error("no clipboard"));

      const onStatus = vi.fn();
      const { lastFrame, stdin } = render(
        <TextViewerModal {...defaultProps} onStatus={onStatus} />,
      );

      stdin.write("y");
      await tick();

      const frame = lastFrame();
      expect(frame).toContain("Failed to copy to clipboard");
      expect(onStatus).toHaveBeenCalledWith("Failed to copy to clipboard");
    });
  });

  describe("Close", () => {
    it("Escape closes the modal in normal mode", async () => {
      const onClose = vi.fn();
      const { stdin } = render(
        <TextViewerModal {...defaultProps} onClose={onClose} />,
      );

      stdin.write("\x1b");
      await tick();

      expect(onClose).toHaveBeenCalled();
    });

    it("Escape in search mode does not close the modal", async () => {
      const onClose = vi.fn();
      const { stdin } = render(
        <TextViewerModal {...defaultProps} onClose={onClose} />,
      );

      // Enter search mode
      stdin.write("/");
      await tick();

      // Escape cancels search, not close
      stdin.write("\x1b");
      await tick();

      expect(onClose).not.toHaveBeenCalled();
    });

    it("Escape after cancelling search closes the modal", async () => {
      const onClose = vi.fn();
      const { stdin } = render(
        <TextViewerModal {...defaultProps} onClose={onClose} />,
      );

      // Enter then cancel search
      stdin.write("/");
      await tick();
      stdin.write("\x1b");
      await tick();

      // Now Escape should close
      stdin.write("\x1b");
      await tick();

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe("isActive", () => {
    it("does not respond to input when isActive is false", async () => {
      const onClose = vi.fn();
      const { lastFrame, stdin } = render(
        <TextViewerModal
          {...defaultProps}
          isActive={false}
          onClose={onClose}
        />,
      );

      const frameBefore = lastFrame();

      stdin.write("j");
      await tick();
      stdin.write("\x1b");
      await tick();

      expect(onClose).not.toHaveBeenCalled();
      expect(lastFrame()).toBe(frameBefore);
    });
  });
});
