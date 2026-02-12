/**
 * Full-screen export dialog for body content.
 *
 * Replaces the main TUI when active (terminals don't support true overlays).
 *
 * Provides five options:
 * [1] Copy to clipboard
 * [2] .procsi/exports/ - Project exports folder
 * [3] ~/Downloads/ - Downloads folder
 * [4] Custom path... - Text input
 * [5] Open externally - Default app
 */

import React, { useState } from "react";
import { Box, Text, useInput } from "ink";

export type ExportAction = "clipboard" | "exports" | "downloads" | "custom" | "open-external";

export interface ExportModalProps {
  /** Filename being exported */
  filename: string;
  /** File size for display */
  fileSize: string;
  /** Whether the body is binary content */
  isBinary: boolean;
  /** Screen width */
  width: number;
  /** Screen height */
  height: number;
  /** Called when user selects an export action */
  onExport: (action: ExportAction, customPath?: string) => void;
  /** Called when modal should close */
  onClose: () => void;
  /** Whether input is active (for testing) */
  isActive?: boolean;
}

interface Option {
  key: string;
  action: ExportAction;
  label: string;
  description: string;
}

const OPTIONS: Option[] = [
  {
    key: "1",
    action: "clipboard",
    label: "Copy to clipboard",
    description: "Copy body text to clipboard",
  },
  {
    key: "2",
    action: "exports",
    label: ".procsi/exports/",
    description: "Project exports folder",
  },
  {
    key: "3",
    action: "downloads",
    label: "~/Downloads/",
    description: "Downloads folder",
  },
  {
    key: "4",
    action: "custom",
    label: "Custom path...",
    description: "Enter a custom directory",
  },
  {
    key: "5",
    action: "open-external",
    label: "Open externally",
    description: "Open in default app",
  },
];

export function ExportModal({
  filename,
  fileSize,
  isBinary,
  width,
  height,
  onExport,
  onClose,
  isActive = true,
}: ExportModalProps): React.ReactElement {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [customPath, setCustomPath] = useState("");

  useInput(
    (input, key) => {
      if (showCustomInput) {
        if (key.return) {
          if (customPath.trim()) {
            onExport("custom", customPath.trim());
          }
        } else if (key.backspace || key.delete) {
          setCustomPath((prev) => prev.slice(0, -1));
        } else if (key.escape) {
          setShowCustomInput(false);
          setCustomPath("");
        } else if (input && !key.ctrl && !key.meta) {
          setCustomPath((prev) => prev + input);
        }
        return;
      }

      if (key.escape) {
        onClose();
      } else if (input === "j" || key.downArrow) {
        setSelectedIndex((prev) => Math.min(prev + 1, OPTIONS.length - 1));
      } else if (input === "k" || key.upArrow) {
        setSelectedIndex((prev) => Math.max(prev - 1, 0));
      } else if (input === "1") {
        onExport("clipboard");
      } else if (input === "2") {
        onExport("exports");
      } else if (input === "3") {
        onExport("downloads");
      } else if (input === "4") {
        setShowCustomInput(true);
      } else if (input === "5") {
        onExport("open-external");
      } else if (key.return) {
        const option = OPTIONS[selectedIndex];
        if (option) {
          if (option.action === "custom") {
            setShowCustomInput(true);
          } else {
            onExport(option.action);
          }
        }
      }
    },
    { isActive }
  );

  return (
    <Box
      flexDirection="column"
      width={width}
      height={height}
      alignItems="center"
      justifyContent="center"
    >
      {/* Title */}
      <Box marginBottom={1}>
        <Text color="cyan" bold>
          Export Body Content
        </Text>
      </Box>

      {/* File info */}
      <Box marginBottom={2}>
        <Text dimColor>
          {filename} ({fileSize})
        </Text>
      </Box>

      {showCustomInput ? (
        <Box flexDirection="column" alignItems="center">
          <Text>Enter directory path:</Text>
          <Box marginTop={1}>
            <Text color="cyan">&gt; </Text>
            <Text>{customPath}</Text>
            <Text color="cyan">_</Text>
          </Box>
          <Box marginTop={2}>
            <Text dimColor>Enter to save, Escape to go back</Text>
          </Box>
        </Box>
      ) : (
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text>Select export action:</Text>
          </Box>

          {OPTIONS.map((option, index) => (
            <Box key={option.key} marginLeft={2}>
              <Text color={index === selectedIndex ? "cyan" : undefined}>
                {index === selectedIndex ? "❯ " : "  "}
              </Text>
              <Text color="yellow" bold>
                [{option.key}]
              </Text>
              <Text color={index === selectedIndex ? "white" : "gray"}>
                {" "}
                {option.label}
              </Text>
              <Text dimColor> - {option.description}</Text>
              {option.action === "clipboard" && isBinary && (
                <Text dimColor italic> (binary — will copy raw bytes)</Text>
              )}
            </Box>
          ))}

          <Box marginTop={2}>
            <Text dimColor>j/k navigate │ Enter or number to select │ Escape to cancel</Text>
          </Box>
        </Box>
      )}
    </Box>
  );
}
