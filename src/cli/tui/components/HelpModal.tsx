/**
 * Full-screen help overlay showing all keyboard shortcuts.
 * Replaces the main TUI when active (terminals don't support true overlays).
 */

import React from "react";
import { Box, Text, useInput } from "ink";

export interface HelpModalProps {
  width: number;
  height: number;
  onClose: () => void;
  isActive?: boolean;
}

interface HelpEntry {
  key: string;
  description: string;
}

interface HelpSection {
  title: string;
  entries: HelpEntry[];
}

const HELP_SECTIONS: HelpSection[] = [
  {
    title: "Navigation",
    entries: [
      { key: "j / ↓", description: "Move down" },
      { key: "k / ↑", description: "Move up" },
      { key: "g", description: "Jump to first item" },
      { key: "G", description: "Jump to last item" },
      { key: "Ctrl+u", description: "Half page up" },
      { key: "Ctrl+d", description: "Half page down" },
      { key: "Tab", description: "Next panel/section" },
      { key: "Shift+Tab", description: "Previous panel/section" },
      { key: "1-5", description: "Jump to section" },
    ],
  },
  {
    title: "Actions",
    entries: [
      { key: "Enter", description: "Toggle section" },
      { key: "c", description: "Copy as cURL" },
      { key: "h", description: "Export HAR" },
      { key: "y", description: "Copy body to clipboard" },
      { key: "s", description: "Export body content" },
      { key: "u", description: "Toggle full URL" },
      { key: "/", description: "Filter requests" },
      { key: "r", description: "Refresh" },
    ],
  },
  {
    title: "General",
    entries: [
      { key: "i", description: "Proxy connection info" },
      { key: "?", description: "Toggle help" },
      { key: "q", description: "Quit" },
    ],
  },
];

const KEY_COLUMN_WIDTH = 16;

export function HelpModal({
  width,
  height,
  onClose,
  isActive = true,
}: HelpModalProps): React.ReactElement {
  useInput(
    (_input, key) => {
      if (_input === "?" || key.escape) {
        onClose();
      }
    },
    { isActive },
  );

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      alignItems="center"
      justifyContent="center"
    >
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Keyboard Shortcuts
        </Text>
      </Box>

      {HELP_SECTIONS.map((section) => (
        <Box key={section.title} flexDirection="column" marginBottom={1}>
          <Box marginBottom={0}>
            <Text bold color="yellow">
              {section.title}
            </Text>
          </Box>
          {section.entries.map((entry) => (
            <Box key={entry.key}>
              <Box width={KEY_COLUMN_WIDTH}>
                <Text color="cyan">{entry.key}</Text>
              </Box>
              <Text>{entry.description}</Text>
            </Box>
          ))}
        </Box>
      ))}

      <Box marginTop={1}>
        <Text dimColor>Press ? or Escape to close</Text>
      </Box>
    </Box>
  );
}
