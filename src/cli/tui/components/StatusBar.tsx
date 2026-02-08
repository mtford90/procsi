/**
 * Status bar showing keybinding hints at the bottom of the TUI.
 */

import React from "react";
import { Box, Text } from "ink";

interface KeyHint {
  key: string;
  action: string;
}

const KEY_HINTS: KeyHint[] = [
  { key: "j/k/g/G", action: "nav" },
  { key: "^u/^d", action: "page" },
  { key: "Tab", action: "panel" },
  { key: "1-5", action: "section" },
  { key: "Enter", action: "expand" },
  { key: "c", action: "curl" },
  { key: "h", action: "HAR" },
  { key: "y", action: "yank" },
  { key: "s", action: "export" },
  { key: "u", action: "URL" },
  { key: "/", action: "filter" },
  { key: "i", action: "info" },
  { key: "?", action: "help" },
  { key: "q", action: "quit" },
];

interface StatusBarProps {
  message?: string;
  filterActive?: boolean;
}

export function StatusBar({ message, filterActive }: StatusBarProps): React.ReactElement {
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
      ) : (
        <>
          {filterActive && (
            <>
              <Text color="yellow" bold>[FILTERED]</Text>
              <Text dimColor> │ </Text>
            </>
          )}
          {KEY_HINTS.map((hint, index) => (
            <React.Fragment key={hint.key}>
              <Text color="cyan" bold>
                {hint.key}
              </Text>
              <Text dimColor> {hint.action}</Text>
              {index < KEY_HINTS.length - 1 && <Text dimColor> │ </Text>}
            </React.Fragment>
          ))}
        </>
      )}
    </Box>
  );
}
