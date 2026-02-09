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
      { key: "Ctrl+u / Ctrl+d", description: "Half page up / down" },
      { key: "Ctrl+f / Ctrl+b", description: "Full page down / up" },
      { key: "Tab", description: "Next panel/section" },
      { key: "Shift+Tab", description: "Previous panel/section" },
      { key: "1-5", description: "Jump to section" },
    ],
  },
  {
    title: "Actions",
    entries: [
      { key: "Enter", description: "View body content" },
      { key: "c", description: "Copy as cURL" },
      { key: "H", description: "Export HAR" },
      { key: "y", description: "Copy body to clipboard" },
      { key: "s", description: "Export body content" },
      { key: "u", description: "Toggle full URL" },
      { key: "/", description: "Filter requests" },
      { key: "r", description: "Refresh" },
    ],
  },
  {
    title: "JSON Explorer",
    entries: [
      { key: "j / k", description: "Navigate tree" },
      { key: "Ctrl+u / Ctrl+d", description: "Half page up / down" },
      { key: "Ctrl+f / Ctrl+b", description: "Full page down / up" },
      { key: "Enter / l", description: "Toggle node" },
      { key: "h", description: "Collapse node" },
      { key: "e / c", description: "Expand / collapse all" },
      { key: "/", description: "Filter by path" },
      { key: "n / N", description: "Next / previous match" },
      { key: "y", description: "Copy value" },
      { key: "q / Esc", description: "Close explorer" },
    ],
  },
  {
    title: "Text Viewer",
    entries: [
      { key: "j / k", description: "Scroll line by line" },
      { key: "Ctrl+u / Ctrl+d", description: "Scroll half page" },
      { key: "Ctrl+f / Ctrl+b", description: "Full page down / up" },
      { key: "Space", description: "Page down" },
      { key: "g / G", description: "Jump to top / bottom" },
      { key: "/", description: "Search text" },
      { key: "n / N", description: "Next / previous match" },
      { key: "y", description: "Copy to clipboard" },
      { key: "q / Esc", description: "Close viewer" },
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
