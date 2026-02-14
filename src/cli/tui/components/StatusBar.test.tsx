/**
 * Tests for the context-sensitive StatusBar hint filtering.
 */

import { describe, it, expect } from "vitest";
import React from "react";
import { render } from "ink-testing-library";
import { StatusBar, getVisibleHints } from "./StatusBar.js";

/** Helper — extract hint keys from the visible hints array */
const hintKeys = (hints: ReturnType<typeof getVisibleHints>): string[] =>
  hints.map((h) => h.key);

/** Helper — extract hint actions from the visible hints array */
const hintActions = (hints: ReturnType<typeof getVisibleHints>): string[] =>
  hints.map((h) => h.action);

// Keys that should always be visible regardless of context
const ALWAYS_VISIBLE_KEYS = ["j/k/g/G", "Tab", "1-5", "u", "/", "i", "?", "q"];

describe("getVisibleHints", () => {
  it("returns all conditional hints as visible when no context props are passed (backwards compat)", () => {
    // With defaults: activePanel="list" so ^f/^b shows, the rest default to true
    const hints = getVisibleHints({});
    const keys = hintKeys(hints);

    expect(keys).toContain("^f/^b");
    expect(keys).toContain("c");
    expect(keys).toContain("H");
    expect(keys).toContain("y");
    expect(keys).toContain("s");
    for (const key of ALWAYS_VISIBLE_KEYS) {
      expect(keys).toContain(key);
    }
    // Enter is hidden because onViewableBodySection defaults to false
    expect(keys).not.toContain("Enter");
    // But when it does appear, action should be "view"
  });

  it("always includes unconditional hints", () => {
    const hints = getVisibleHints({
      activePanel: "list",
      hasSelection: false,
      hasRequests: false,
      onBodySection: false,
    });
    const keys = hintKeys(hints);

    for (const key of ALWAYS_VISIBLE_KEYS) {
      expect(keys).toContain(key);
    }
  });

  describe("activePanel === 'list'", () => {
    it("shows ^f/^b (page)", () => {
      const keys = hintKeys(getVisibleHints({ activePanel: "list" }));
      expect(keys).toContain("^f/^b");
    });

    it("hides Enter (explore)", () => {
      const keys = hintKeys(getVisibleHints({ activePanel: "list" }));
      expect(keys).not.toContain("Enter");
    });
  });

  describe("activePanel === 'accordion'", () => {
    it("hides ^f/^b (page)", () => {
      const keys = hintKeys(getVisibleHints({ activePanel: "accordion" }));
      expect(keys).not.toContain("^f/^b");
    });

    it("hides Enter (view) when not on viewable body section", () => {
      const keys = hintKeys(getVisibleHints({ activePanel: "accordion", onViewableBodySection: false }));
      expect(keys).not.toContain("Enter");
    });

    it("shows Enter (view) when on viewable body section", () => {
      const hints = getVisibleHints({ activePanel: "accordion", onViewableBodySection: true });
      const keys = hintKeys(hints);
      const actions = hintActions(hints);
      expect(keys).toContain("Enter");
      expect(actions).toContain("view");
    });
  });

  describe("hasSelection", () => {
    it("shows c (curl) when true", () => {
      const keys = hintKeys(getVisibleHints({ hasSelection: true }));
      expect(keys).toContain("c");
    });

    it("hides c (curl) when false", () => {
      const keys = hintKeys(getVisibleHints({ hasSelection: false }));
      expect(keys).not.toContain("c");
    });
  });

  describe("hasRequests", () => {
    it("shows H (HAR) when true", () => {
      const keys = hintKeys(getVisibleHints({ hasRequests: true }));
      expect(keys).toContain("H");
    });

    it("hides H (HAR) when false", () => {
      const keys = hintKeys(getVisibleHints({ hasRequests: false }));
      expect(keys).not.toContain("H");
    });
  });

  describe("onBodySection", () => {
    it("shows y (yank) and s (export) when true", () => {
      const hints = getVisibleHints({ onBodySection: true });
      const keys = hintKeys(hints);
      const actions = hintActions(hints);
      expect(keys).toContain("y");
      expect(keys).toContain("s");
      expect(actions).toContain("yank");
      expect(actions).toContain("export");
    });

    it("hides y (yank) and s (export) when false", () => {
      const keys = hintKeys(getVisibleHints({ onBodySection: false }));
      expect(keys).not.toContain("y");
      expect(keys).not.toContain("s");
    });
  });

  it("combined restrictive context hides all conditional hints", () => {
    const hints = getVisibleHints({
      activePanel: "list",
      hasSelection: false,
      hasRequests: false,
      onBodySection: false,
    });
    const keys = hintKeys(hints);

    // Conditional hints should all be hidden
    expect(keys).not.toContain("Enter");
    expect(keys).not.toContain("c");
    expect(keys).not.toContain("H");
    expect(keys).not.toContain("y");
    expect(keys).not.toContain("s");

    // ^f/^b should still be visible (list panel)
    expect(keys).toContain("^f/^b");
  });

  describe("L (events) hint", () => {
    it("visible when hasEvents is true", () => {
      const actions = hintActions(getVisibleHints({ hasEvents: true }));
      expect(actions).toContain("events");
    });

    it("hidden when hasEvents is false", () => {
      const actions = hintActions(getVisibleHints({ hasEvents: false }));
      expect(actions).not.toContain("events");
    });

    it("hidden when hasEvents is undefined (defaults to false)", () => {
      const actions = hintActions(getVisibleHints({}));
      expect(actions).not.toContain("events");
    });
  });
});

describe("StatusBar component", () => {
  it("renders hint keys when no message is set", () => {
    const { lastFrame } = render(<StatusBar />);
    const frame = lastFrame();

    // Check for key labels that should always appear (using substrings
    // that survive truncation at narrow default test widths)
    expect(frame).toMatch(/j\/k/);
    // "q" may be truncated at the default 100-column test width
    expect(frame).toContain("nav");
  });

  it("shows message instead of hints when message is set", () => {
    const { lastFrame } = render(<StatusBar message="Something happened" />);
    const frame = lastFrame();

    expect(frame).toContain("Something happened");
    // Keys should not appear
    expect(frame).not.toMatch(/j\/k/);
  });

  it("includes FILTE text when filterActive is true", () => {
    const { lastFrame } = render(<StatusBar filterActive />);
    const frame = lastFrame();

    // The badge may be truncated at narrow widths, but the opening portion is visible
    expect(frame).toMatch(/FILTE/);
  });

  it("does not include FILTE text when filterActive is false", () => {
    const { lastFrame } = render(<StatusBar filterActive={false} />);
    const frame = lastFrame();

    expect(frame).not.toMatch(/FILTE/);
  });

  it("does not render Enter key when activePanel is list", () => {
    const { lastFrame } = render(
      <StatusBar activePanel="list" hasSelection={false} hasRequests={false} onBodySection={false} />,
    );
    const frame = lastFrame();

    // With fewer hints there's more room — "Enter" should not appear
    expect(frame).not.toContain("Enter");
    // But ^f/^b (page) key should appear
    expect(frame).toMatch(/\^f\/\^b/);
  });

  it("does not render ^f/^b key when activePanel is accordion", () => {
    const { lastFrame } = render(
      <StatusBar activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
    );
    const frame = lastFrame();

    // ^f/^b should not appear
    expect(frame).not.toMatch(/\^f\/\^b/);
    // Enter should not appear either (not on JSON body section)
    expect(frame).not.toContain("Enter");
  });

  it("renders Enter view hint when on viewable body section", () => {
    // Use minimal context so the hints fit within the default 100-column render width
    const { lastFrame } = render(
      <StatusBar activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} onViewableBodySection />,
    );
    const frame = lastFrame();

    expect(frame).toContain("Enter");
    expect(frame).toContain("view");
  });

  it("omits curl key text when hasSelection is false", () => {
    const { lastFrame } = render(
      <StatusBar activePanel="list" hasSelection={false} hasRequests hasOnBodySection={false} />,
    );
    const frame = lastFrame();

    // "curl" action text should not appear since hasSelection is false
    expect(frame).not.toContain("curl");
  });

  it("omits HAR key text when hasRequests is false", () => {
    const { lastFrame } = render(
      <StatusBar activePanel="list" hasSelection={false} hasRequests={false} onBodySection={false} />,
    );
    const frame = lastFrame();

    expect(frame).not.toContain("HAR");
  });

  describe("interceptorCount", () => {
    it("renders interceptor count badge when interceptorCount > 0", () => {
      // Use minimal context so the badge fits within the default 100-column render width
      const { lastFrame } = render(
        <StatusBar interceptorCount={3} activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
      );
      const frame = lastFrame();

      expect(frame).toContain("3 interceptors");
    });

    it("uses singular form when interceptorCount is 1", () => {
      const { lastFrame } = render(
        <StatusBar interceptorCount={1} activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
      );
      const frame = lastFrame();

      expect(frame).toContain("1 interceptor");
      expect(frame).not.toContain("1 interceptors");
    });

    it("does not render interceptor badge when interceptorCount is 0", () => {
      const { lastFrame } = render(<StatusBar interceptorCount={0} />);
      const frame = lastFrame();

      expect(frame).not.toContain("interceptor");
    });

    it("does not render interceptor badge when interceptorCount is undefined", () => {
      const { lastFrame } = render(<StatusBar />);
      const frame = lastFrame();

      expect(frame).not.toContain("interceptor");
    });
  });

  describe("interceptorErrorCount", () => {
    it("renders error badge when interceptorErrorCount > 0", () => {
      const { lastFrame } = render(
        <StatusBar interceptorErrorCount={3} activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("error");
    });

    it("shows correct count in error badge", () => {
      const { lastFrame } = render(
        <StatusBar interceptorErrorCount={5} activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("5");
    });

    it("uses singular form '1 error' when count is 1", () => {
      const { lastFrame } = render(
        <StatusBar interceptorErrorCount={1} activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("1 error");
      expect(frame).not.toContain("1 errors");
    });

    it("hidden when interceptorErrorCount is 0", () => {
      const { lastFrame } = render(
        <StatusBar interceptorErrorCount={0} activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
      );
      const frame = lastFrame();
      // Should not contain the error badge text (but may contain "error" in hints — use the badge pattern)
      expect(frame).not.toMatch(/\d+ error/);
    });

    it("hidden when interceptorErrorCount is undefined", () => {
      const { lastFrame } = render(
        <StatusBar activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
      );
      const frame = lastFrame();
      expect(frame).not.toMatch(/\d+ error/);
    });

    it("both error badge and interceptor count badge can appear simultaneously", () => {
      const { lastFrame } = render(
        <StatusBar interceptorErrorCount={2} interceptorCount={3} activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("2 errors");
      expect(frame).toContain("3 interceptors");
    });

    it("L key hint appears when hasEvents is true", () => {
      const { lastFrame } = render(
        <StatusBar hasEvents interceptorCount={1} activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("events");
    });

    it("L key hint does not appear when hasEvents is false", () => {
      const { lastFrame } = render(
        <StatusBar hasEvents={false} interceptorCount={0} interceptorErrorCount={0} activePanel="accordion" hasSelection={false} hasRequests={false} onBodySection={false} />,
      );
      const frame = lastFrame();
      expect(frame).not.toContain("events");
    });
  });

  describe("filterOpen", () => {
    it("shows only Esc hint when filter bar is open", () => {
      const { lastFrame } = render(<StatusBar filterOpen />);
      const frame = lastFrame();

      expect(frame).toContain("Esc");
      expect(frame).toContain("close filter");
      // Main-view hints should be suppressed
      expect(frame).not.toMatch(/j\/k/);
      expect(frame).not.toContain("quit");
    });

    it("suppresses hints even when filterActive is also true", () => {
      const { lastFrame } = render(<StatusBar filterOpen filterActive />);
      const frame = lastFrame();

      expect(frame).toContain("Esc");
      expect(frame).not.toMatch(/FILTE/);
      expect(frame).not.toMatch(/j\/k/);
    });

    it("message takes priority over filterOpen", () => {
      const { lastFrame } = render(<StatusBar filterOpen message="Busy" />);
      const frame = lastFrame();

      expect(frame).toContain("Busy");
      expect(frame).not.toContain("Esc");
    });
  });
});
