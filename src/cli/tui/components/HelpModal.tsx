/**
 * Full-screen help overlay showing keyboard shortcuts and connection info.
 * Replaces the main TUI when active (terminals don't support true overlays).
 */

import React from "react";
import { Box, Text, useInput } from "ink";
import { buildProxyInfo } from "../../../shared/proxy-info.js";

export interface HelpModalProps {
  width: number;
  height: number;
  onClose: () => void;
  isActive?: boolean;
  /** Proxy port — when defined, connection info is shown. */
  proxyPort?: number;
  /** Path to the CA certificate file. */
  caCertPath?: string;
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
      { key: "g / G", description: "First / last item" },
      { key: "Ctrl+u / Ctrl+d", description: "Half page up / down" },
      { key: "Ctrl+f / Ctrl+b", description: "Full page down / up" },
      { key: "Tab / Shift+Tab", description: "Next / prev panel" },
      { key: "1-5", description: "Jump to section" },
    ],
  },
  {
    title: "Actions",
    entries: [
      { key: "Enter", description: "View body content" },
      { key: "e", description: "Export: cURL / Fetch / Python / HTTPie / HAR" },
      { key: "R", description: "Replay request" },
      { key: "y", description: "Copy body to clipboard" },
      { key: "s", description: "Export body content" },
      { key: "b", description: "Toggle bookmark" },
      { key: "x / D", description: "Clear requests" },
      { key: "u", description: "Toggle full URL" },
      { key: "/", description: "Filter (URL, /regex/, body:req:…)" },
      { key: "r", description: "Refresh" },
      { key: "L", description: "Interceptor events" },
      { key: "?", description: "Toggle help" },
      { key: "q", description: "Quit" },
    ],
  },
];

const KEY_COLUMN_WIDTH = 20;

export function HelpModal({
  width,
  height,
  onClose,
  isActive = true,
  proxyPort,
  caCertPath,
}: HelpModalProps): React.ReactElement {
  useInput(
    (_input, key) => {
      if (_input === "?" || key.escape) {
        onClose();
      }
    },
    { isActive }
  );

  // Fixed-width inner container, centred on screen
  const innerWidth = Math.min(64, width - 4);

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      alignItems="center"
      justifyContent="center"
    >
      {/* Single fixed-width container — everything left-aligns inside */}
      <Box flexDirection="column" width={innerWidth}>
        <Box marginBottom={1} justifyContent="center">
          <Text color="cyan" bold>Keyboard Shortcuts</Text>
        </Box>

        {HELP_SECTIONS.map((section) => (
          <Box key={section.title} flexDirection="column" marginBottom={1}>
            <Text bold color="yellow">{section.title}</Text>
            {section.entries.map((entry) => (
              <Box key={entry.key}>
                <Box width={KEY_COLUMN_WIDTH} flexShrink={0}>
                  <Text color="cyan">{entry.key}</Text>
                </Box>
                <Text>{entry.description}</Text>
              </Box>
            ))}
          </Box>
        ))}

        {/* Connection Info */}
        <ConnectionInfoSection proxyPort={proxyPort} caCertPath={caCertPath} />

        <Box marginTop={1} justifyContent="center">
          <Text dimColor>Press ? or Escape to close</Text>
        </Box>
      </Box>
    </Box>
  );
}

function ConnectionInfoSection({ proxyPort, caCertPath }: { proxyPort?: number; caCertPath?: string }): React.ReactElement {
  if (proxyPort === undefined) {
    return (
      <Box flexDirection="column" marginBottom={1}>
        <Text bold color="yellow">Connection Info</Text>
        <Text color="yellow">Proxy is not running</Text>
      </Box>
    );
  }

  const info = buildProxyInfo(proxyPort, caCertPath ?? "");

  return (
    <Box flexDirection="column" marginBottom={1}>
      <Text bold color="yellow">Connection Info</Text>
      <Text>
        <Text bold>Proxy  </Text>
        <Text color="green">{info.proxyUrl}</Text>
      </Text>
      <Text>
        <Text bold>CA     </Text>
        <Text color="green">{info.caCertPath}</Text>
      </Text>
    </Box>
  );
}
