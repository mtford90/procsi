/**
 * Status bar showing keybinding hints at the bottom of the TUI.
 * Hints are filtered based on the current focus/selection context.
 */

import React, { useMemo } from "react";
import { Box, Text } from "ink";

interface StatusBarContext {
  activePanel: "list" | "accordion";
  hasSelection: boolean;
  hasRequests: boolean;
  onBodySection: boolean;
}

interface KeyHint {
  key: string;
  action: string;
  visible?: (ctx: StatusBarContext) => boolean;
}

const KEY_HINTS: KeyHint[] = [
  { key: "j/k/g/G", action: "nav" },
  { key: "^u/^d", action: "page", visible: (ctx) => ctx.activePanel === "list" },
  { key: "Tab", action: "panel" },
  { key: "1-5", action: "section" },
  { key: "Enter", action: "expand", visible: (ctx) => ctx.activePanel === "accordion" },
  { key: "c", action: "curl", visible: (ctx) => ctx.hasSelection },
  { key: "h", action: "HAR", visible: (ctx) => ctx.hasRequests },
  { key: "y", action: "yank", visible: (ctx) => ctx.onBodySection },
  { key: "s", action: "export", visible: (ctx) => ctx.onBodySection },
  { key: "u", action: "URL" },
  { key: "/", action: "filter" },
  { key: "i", action: "info" },
  { key: "?", action: "help" },
  { key: "q", action: "quit" },
];

export interface StatusBarProps {
  message?: string;
  filterActive?: boolean;
  /** When true the filter bar is open and capturing input, so main-view hints are suppressed. */
  filterOpen?: boolean;
  activePanel?: "list" | "accordion";
  hasSelection?: boolean;
  hasRequests?: boolean;
  onBodySection?: boolean;
}

/**
 * Returns hints visible for the given context. All new props default to true
 * so the component remains backwards-compatible when no context is passed.
 */
export function getVisibleHints({
  activePanel = "list",
  hasSelection = true,
  hasRequests = true,
  onBodySection = true,
}: Pick<StatusBarProps, "activePanel" | "hasSelection" | "hasRequests" | "onBodySection">): KeyHint[] {
  const ctx: StatusBarContext = { activePanel, hasSelection, hasRequests, onBodySection };
  return KEY_HINTS.filter((hint) => !hint.visible || hint.visible(ctx));
}

export function StatusBar({
  message,
  filterActive,
  filterOpen,
  activePanel,
  hasSelection,
  hasRequests,
  onBodySection,
}: StatusBarProps): React.ReactElement {
  const visibleHints = useMemo(
    () => getVisibleHints({ activePanel, hasSelection, hasRequests, onBodySection }),
    [activePanel, hasSelection, hasRequests, onBodySection],
  );

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
        <>
          {filterActive && (
            <>
              <Text color="yellow" bold>[FILTERED]</Text>
              <Text dimColor> │ </Text>
            </>
          )}
          {visibleHints.map((hint, index) => (
            <React.Fragment key={hint.key}>
              <Text color="cyan" bold>
                {hint.key}
              </Text>
              <Text dimColor> {hint.action}</Text>
              {index < visibleHints.length - 1 && <Text dimColor> │ </Text>}
            </React.Fragment>
          ))}
        </>
      )}
    </Box>
  );
}
