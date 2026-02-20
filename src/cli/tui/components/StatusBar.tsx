/**
 * Status bar showing keybinding hints at the bottom of the TUI.
 * Hints are filtered based on the current focus/selection context.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";
import { HintContent, type HintItem } from "./HintContent.js";

interface StatusBarContext {
  hasSelection: boolean;
  hasRequests: boolean;
  onViewableBodySection: boolean;
}

interface KeyHint extends HintItem {
  visible?: (ctx: StatusBarContext) => boolean;
}

const KEY_HINTS: KeyHint[] = [
  { key: "j/k", action: "nav" },
  { key: "Tab", action: "panel" },
  { key: "Enter", action: "view", visible: (ctx) => ctx.onViewableBodySection },
  { key: "e", action: "export", visible: (ctx) => ctx.hasSelection },
  { key: "R", action: "replay", visible: (ctx) => ctx.hasSelection },
  { key: "b", action: "bookmark", visible: (ctx) => ctx.hasSelection },
  { key: "x", action: "clear", visible: (ctx) => ctx.hasRequests },
  { key: "u", action: "URL" },
  { key: "/", action: "filter" },
  { key: "?", action: "help" },
  { key: "q", action: "quit" },
];

export interface StatusBarProps {
  message?: string;
  filterActive?: boolean;
  /** When true the filter bar is open and capturing input, so main-view hints are suppressed. */
  filterOpen?: boolean;
  hasSelection?: boolean;
  hasRequests?: boolean;
  onViewableBodySection?: boolean;
  /** Number of active interceptors; shown as a badge when > 0. */
  interceptorCount?: number;
  /** Number of interceptor error events; shown as a red badge when > 0. */
  interceptorErrorCount?: number;
  /** Terminal width in columns — used to constrain the hint bar. */
  width?: number;
}

/**
 * Returns hints visible for the given context. All new props default to true
 * so the component remains backwards-compatible when no context is passed.
 */
export function getVisibleHints({
  hasSelection = true,
  hasRequests = true,
  onViewableBodySection = false,
}: Pick<StatusBarProps, "hasSelection" | "hasRequests" | "onViewableBodySection">): KeyHint[] {
  const ctx: StatusBarContext = { hasSelection, hasRequests, onViewableBodySection };
  return KEY_HINTS.filter((hint) => !hint.visible || hint.visible(ctx));
}

const SEPARATOR_WIDTH = 3; // " │ "
const PADDING_WIDTH = 2; // paddingX={1} each side

export function StatusBar({
  message,
  filterActive,
  filterOpen,
  hasSelection,
  hasRequests,
  onViewableBodySection,
  interceptorCount,
  interceptorErrorCount,
  width,
}: StatusBarProps): React.ReactElement {
  const visibleHints = useMemo(
    () => getVisibleHints({ hasSelection, hasRequests, onViewableBodySection }),
    [hasSelection, hasRequests, onViewableBodySection],
  );

  // Calculate available width for hints, accounting for prefix badges
  const hintsAvailableWidth = useMemo(() => {
    if (!width) return undefined;

    let prefixWidth = 0;
    if (interceptorErrorCount !== undefined && interceptorErrorCount > 0) {
      const errorBadge = `[${interceptorErrorCount} error${interceptorErrorCount === 1 ? "" : "s"}]`;
      prefixWidth += errorBadge.length + SEPARATOR_WIDTH;
    }
    if (interceptorCount !== undefined && interceptorCount > 0) {
      const badge = `[${interceptorCount} interceptor${interceptorCount === 1 ? "" : "s"}]`;
      prefixWidth += badge.length + SEPARATOR_WIDTH;
    }
    if (filterActive) {
      prefixWidth += "[FILTERED]".length + SEPARATOR_WIDTH;
    }

    return width - PADDING_WIDTH - prefixWidth;
  }, [width, interceptorCount, interceptorErrorCount, filterActive]);

  return (
    <Box
      borderStyle="single"
      borderTop
      borderBottom={false}
      borderLeft={false}
      borderRight={false}
      paddingX={1}
      height={2}
    >
      {message ? (
        <Text color="yellow">{message}</Text>
      ) : filterOpen ? (
        <>
          <Text color="cyan" bold>Esc</Text>
          <Text dimColor> close filter</Text>
        </>
      ) : (
        <Text>
          {interceptorErrorCount !== undefined && interceptorErrorCount > 0 && (
            <>
              <Text color="red" bold>[{interceptorErrorCount} error{interceptorErrorCount === 1 ? "" : "s"}]</Text>
              <Text dimColor> │ </Text>
            </>
          )}
          {interceptorCount !== undefined && interceptorCount > 0 && (
            <>
              <Text color="magenta" bold>[{interceptorCount} interceptor{interceptorCount === 1 ? "" : "s"}]</Text>
              <Text dimColor> │ </Text>
            </>
          )}
          {filterActive && (
            <>
              <Text color="yellow" bold>[FILTERED]</Text>
              <Text dimColor> │ </Text>
            </>
          )}
          <HintContent hints={visibleHints} availableWidth={hintsAvailableWidth} />
        </Text>
      )}
    </Box>
  );
}
