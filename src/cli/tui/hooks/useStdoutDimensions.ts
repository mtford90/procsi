/**
 * Hook for subscribing to stdout dimensions.
 *
 * Replaces ink-use-stdout-dimensions which has compatibility issues with
 * Node.js 24 due to CJS/ESM interop problems.
 */

import { useState, useEffect } from "react";
import { useStdout } from "ink";

const DEFAULT_COLUMNS = 80;
const DEFAULT_ROWS = 24;
const STARTUP_RECHECK_MS = 50;

/**
 * Returns [columns, rows] of the terminal, updating when the terminal is resized.
 *
 * Reads stdout.columns/rows synchronously on every render so the value is
 * always current — a resize-event counter forces React to re-render, but
 * the actual dimensions are never cached in state.
 */
export function useStdoutDimensions(): [number, number] {
  const { stdout } = useStdout();

  // Counter whose sole purpose is to trigger a re-render on resize
  const [, setResizeCount] = useState(0);

  useEffect(() => {
    const triggerRerender = () => setResizeCount((n) => n + 1);

    stdout.on("resize", triggerRerender);

    // Force a post-mount sync and one short delayed recheck.
    // Some terminals populate columns/rows shortly after the first paint
    // without emitting an initial "resize" event.
    triggerRerender();
    const startupRecheckTimer = setTimeout(triggerRerender, STARTUP_RECHECK_MS);

    return () => {
      clearTimeout(startupRecheckTimer);
      stdout.off("resize", triggerRerender);
    };
  }, [stdout]);

  // Always read current dimensions — never rely on stale state
  return [stdout.columns || DEFAULT_COLUMNS, stdout.rows || DEFAULT_ROWS];
}
