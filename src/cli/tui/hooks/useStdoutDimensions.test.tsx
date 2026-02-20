import React from "react";
import { render } from "ink-testing-library";
import { Text } from "ink";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useStdoutDimensions } from "./useStdoutDimensions.js";

const { stdoutMock, useStdoutMock } = vi.hoisted(() => {
  const resizeListeners = new Set<() => void>();

  const stdoutMock = {
    columns: undefined as number | undefined,
    rows: undefined as number | undefined,
    on(event: string, listener: () => void) {
      if (event === "resize") {
        resizeListeners.add(listener);
      }
      return this;
    },
    off(event: string, listener: () => void) {
      if (event === "resize") {
        resizeListeners.delete(listener);
      }
      return this;
    },
    emit(event: string) {
      if (event === "resize") {
        for (const listener of resizeListeners) {
          listener();
        }
      }
      return true;
    },
    removeAllListeners() {
      resizeListeners.clear();
      return this;
    },
  };

  const useStdoutMock = vi.fn(() => ({ stdout: stdoutMock }));

  return { stdoutMock, useStdoutMock };
});

vi.mock("ink", async () => {
  const actual = await vi.importActual<typeof import("ink")>("ink");
  return {
    ...actual,
    useStdout: useStdoutMock,
  };
});

function DimensionsProbe(): React.ReactElement {
  const [columns, rows] = useStdoutDimensions();
  return <Text>{`${columns}x${rows}`}</Text>;
}

function flushRender(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

describe("useStdoutDimensions", () => {
  beforeEach(() => {
    stdoutMock.removeAllListeners();
    stdoutMock.columns = undefined;
    stdoutMock.rows = undefined;
    useStdoutMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("falls back to defaults when stdout dimensions are missing", () => {
    const { lastFrame, unmount } = render(<DimensionsProbe />);

    expect(lastFrame()).toContain("80x24");

    unmount();
  });

  it("updates dimensions on resize events", async () => {
    stdoutMock.columns = 100;
    stdoutMock.rows = 30;

    const { lastFrame, unmount } = render(<DimensionsProbe />);
    expect(lastFrame()).toContain("100x30");

    stdoutMock.columns = 140;
    stdoutMock.rows = 44;
    stdoutMock.emit("resize");

    await flushRender();
    expect(lastFrame()).toContain("140x44");

    unmount();
  });

  it("re-checks dimensions shortly after mount without requiring a resize event", async () => {
    const STARTUP_RECHECK_WAIT_MS = 80;

    const { lastFrame, unmount } = render(<DimensionsProbe />);
    expect(lastFrame()).toContain("80x24");

    stdoutMock.columns = 172;
    stdoutMock.rows = 48;

    await new Promise((resolve) => setTimeout(resolve, STARTUP_RECHECK_WAIT_MS));

    expect(lastFrame()).toContain("172x48");

    unmount();
  });
});
