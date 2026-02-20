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
const ALWAYS_VISIBLE_KEYS = ["j/k", "Tab", "u", "/", "?", "q"];

describe("getVisibleHints", () => {
  it("returns all conditional hints as visible when no context props are passed (backwards compat)", () => {
    const hints = getVisibleHints({});
    const keys = hintKeys(hints);

    expect(keys).toContain("e");
    expect(keys).toContain("R");
    expect(keys).toContain("b");
    expect(keys).toContain("x");
    for (const key of ALWAYS_VISIBLE_KEYS) {
      expect(keys).toContain(key);
    }
    // Enter is hidden because onViewableBodySection defaults to false
    expect(keys).not.toContain("Enter");
  });

  it("always includes unconditional hints", () => {
    const hints = getVisibleHints({
      hasSelection: false,
      hasRequests: false,
    });
    const keys = hintKeys(hints);

    for (const key of ALWAYS_VISIBLE_KEYS) {
      expect(keys).toContain(key);
    }
  });

  it("shows Enter (view) when on viewable body section", () => {
    const hints = getVisibleHints({ onViewableBodySection: true });
    const keys = hintKeys(hints);
    const actions = hintActions(hints);
    expect(keys).toContain("Enter");
    expect(actions).toContain("view");
  });

  it("hides Enter (view) when not on viewable body section", () => {
    const keys = hintKeys(getVisibleHints({ onViewableBodySection: false }));
    expect(keys).not.toContain("Enter");
  });

  describe("hasSelection", () => {
    it("shows e (export) when true", () => {
      const actions = hintActions(getVisibleHints({ hasSelection: true }));
      expect(actions).toContain("export");
    });

    it("hides e (export) when false", () => {
      const keys = hintKeys(getVisibleHints({ hasSelection: false }));
      expect(keys).not.toContain("e");
    });

    it("shows R (replay) when true", () => {
      const keys = hintKeys(getVisibleHints({ hasSelection: true }));
      expect(keys).toContain("R");
    });

    it("hides R (replay) when false", () => {
      const keys = hintKeys(getVisibleHints({ hasSelection: false }));
      expect(keys).not.toContain("R");
    });

    it("shows b (bookmark) when true", () => {
      const keys = hintKeys(getVisibleHints({ hasSelection: true }));
      expect(keys).toContain("b");
    });

    it("hides b (bookmark) when false", () => {
      const keys = hintKeys(getVisibleHints({ hasSelection: false }));
      expect(keys).not.toContain("b");
    });
  });

  describe("hasRequests", () => {
    it("shows x (clear) when true", () => {
      const keys = hintKeys(getVisibleHints({ hasRequests: true }));
      expect(keys).toContain("x");
    });

    it("hides x (clear) when false", () => {
      const keys = hintKeys(getVisibleHints({ hasRequests: false }));
      expect(keys).not.toContain("x");
    });
  });

  it("? hint has action 'help'", () => {
    const hints = getVisibleHints({});
    const helpHint = hints.find((h) => h.key === "?");
    expect(helpHint?.action).toBe("help");
  });

  it("combined restrictive context hides all conditional hints", () => {
    const hints = getVisibleHints({
      hasSelection: false,
      hasRequests: false,
      onViewableBodySection: false,
    });
    const keys = hintKeys(hints);

    // Conditional hints should all be hidden
    expect(keys).not.toContain("Enter");
    expect(keys).not.toContain("e");
    expect(keys).not.toContain("R");
    expect(keys).not.toContain("b");
    expect(keys).not.toContain("x");
  });
});

describe("StatusBar component", () => {
  it("renders hint keys when no message is set", () => {
    const { lastFrame } = render(<StatusBar />);
    const frame = lastFrame();

    expect(frame).toMatch(/j\/k/);
    expect(frame).toContain("nav");
  });

  it("shows message instead of hints when message is set", () => {
    const { lastFrame } = render(<StatusBar message="Something happened" />);
    const frame = lastFrame();

    expect(frame).toContain("Something happened");
    expect(frame).not.toMatch(/j\/k/);
  });

  it("includes FILTE text when filterActive is true", () => {
    const { lastFrame } = render(<StatusBar filterActive />);
    const frame = lastFrame();

    expect(frame).toMatch(/FILTE/);
  });

  it("does not include FILTE text when filterActive is false", () => {
    const { lastFrame } = render(<StatusBar filterActive={false} />);
    const frame = lastFrame();

    expect(frame).not.toMatch(/FILTE/);
  });

  it("renders Enter view hint when on viewable body section", () => {
    const { lastFrame } = render(
      <StatusBar hasSelection={false} hasRequests={false} onViewableBodySection />,
    );
    const frame = lastFrame();

    expect(frame).toContain("Enter");
    expect(frame).toContain("view");
  });

  it("omits export key text when hasSelection is false", () => {
    const { lastFrame } = render(
      <StatusBar hasSelection={false} hasRequests />,
    );
    const frame = lastFrame();

    // "export" action text from the e hint should not appear since hasSelection is false
    // (the "export" in the hint line specifically comes from e key — not from other sources)
    expect(frame).not.toContain("e export");
  });

  describe("interceptorCount", () => {
    it("renders interceptor count badge when interceptorCount > 0", () => {
      const { lastFrame } = render(
        <StatusBar interceptorCount={3} hasSelection={false} hasRequests={false} />,
      );
      const frame = lastFrame();

      expect(frame).toContain("3 interceptors");
    });

    it("uses singular form when interceptorCount is 1", () => {
      const { lastFrame } = render(
        <StatusBar interceptorCount={1} hasSelection={false} hasRequests={false} />,
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
        <StatusBar interceptorErrorCount={3} hasSelection={false} hasRequests={false} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("error");
    });

    it("shows correct count in error badge", () => {
      const { lastFrame } = render(
        <StatusBar interceptorErrorCount={5} hasSelection={false} hasRequests={false} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("5");
    });

    it("uses singular form '1 error' when count is 1", () => {
      const { lastFrame } = render(
        <StatusBar interceptorErrorCount={1} hasSelection={false} hasRequests={false} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("1 error");
      expect(frame).not.toContain("1 errors");
    });

    it("hidden when interceptorErrorCount is 0", () => {
      const { lastFrame } = render(
        <StatusBar interceptorErrorCount={0} hasSelection={false} hasRequests={false} />,
      );
      const frame = lastFrame();
      expect(frame).not.toMatch(/\d+ error/);
    });

    it("hidden when interceptorErrorCount is undefined", () => {
      const { lastFrame } = render(
        <StatusBar hasSelection={false} hasRequests={false} />,
      );
      const frame = lastFrame();
      expect(frame).not.toMatch(/\d+ error/);
    });

    it("both error badge and interceptor count badge can appear simultaneously", () => {
      const { lastFrame } = render(
        <StatusBar interceptorErrorCount={2} interceptorCount={3} hasSelection={false} hasRequests={false} />,
      );
      const frame = lastFrame();
      expect(frame).toContain("2 errors");
      expect(frame).toContain("3 interceptors");
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

  describe("width-based hint truncation", () => {
    /**
     * ink-testing-library hardcodes stdout.columns to 100 via a getter.
     * To test wide-width rendering we must override it before rerendering.
     */
    function renderWide(element: React.ReactElement, columns: number) {
      const result = render(element);
      Object.defineProperty(result.stdout, "columns", {
        get: () => columns,
        configurable: true,
      });
      result.rerender(element);
      return result;
    }

    it("shows all unconditional hints when width is generous", () => {
      const { lastFrame } = renderWide(
        <StatusBar width={200} hasSelection={false} hasRequests={false} />,
        200,
      );
      const frame = lastFrame();

      // All unconditional hints should be visible
      expect(frame).toContain("j/k");
      expect(frame).toContain("Tab");
      expect(frame).toContain("u");
      expect(frame).toContain("filter");
      expect(frame).toContain("help");
      expect(frame).toContain("quit");
    });

    it("shows all hints including conditional ones when width is generous", () => {
      const { lastFrame } = renderWide(
        <StatusBar width={200} hasSelection hasRequests />,
        200,
      );
      const frame = lastFrame();

      expect(frame).toContain("export");
      expect(frame).toContain("replay");
      expect(frame).toContain("bookmark");
      expect(frame).toContain("clear");
      expect(frame).toContain("help");
      expect(frame).toContain("quit");
    });

    it("truncates trailing hints when width is narrow", () => {
      const { lastFrame } = render(
        <StatusBar width={80} interceptorCount={5} hasSelection hasRequests />,
      );
      const frame = lastFrame();

      // First hints should be visible
      expect(frame).toContain("j/k");
      expect(frame).toContain("Tab");
      // Trailing hints should be truncated at 80 cols with badge overhead
      expect(frame).not.toContain("quit");
    });

    it("shows all hints at wide width even with interceptor badge", () => {
      const { lastFrame } = renderWide(
        <StatusBar width={200} interceptorCount={5} hasSelection hasRequests />,
        200,
      );
      const frame = lastFrame();

      // Badge should be visible
      expect(frame).toContain("5 interceptors");
      // ALL hints should still fit at 200 cols
      expect(frame).toContain("j/k");
      expect(frame).toContain("export");
      expect(frame).toContain("URL");
      expect(frame).toContain("filter");
      expect(frame).toContain("help");
      expect(frame).toContain("quit");
    });
  });
});
