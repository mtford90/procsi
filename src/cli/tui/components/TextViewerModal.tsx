/**
 * Full-screen modal for viewing text body content in a less-style pager.
 * Supports syntax highlighting, line numbers, search, and keyboard navigation.
 * Replaces the main TUI when active (terminals don't support true overlays).
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import { highlightCode } from "../utils/syntax-highlight.js";
import { formatSize } from "../utils/formatters.js";
import { copyToClipboard } from "../utils/clipboard.js";

export interface TextViewerModalProps {
  text: string;
  title: string;
  contentType: string;
  bodySize: number;
  width: number;
  height: number;
  onClose: () => void;
  isActive?: boolean;
  onStatus?: (message: string) => void;
}

const STATUS_MESSAGE_TIMEOUT_MS = 3000;

/** Rows reserved for header (title + info/search + divider), hint bar, and borders */
const HEADER_ROWS = 3;
const FOOTER_ROWS = 2;

export function TextViewerModal({
  text,
  title,
  contentType,
  bodySize,
  width,
  height,
  onClose,
  isActive = true,
  onStatus,
}: TextViewerModalProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [searchMode, setSearchMode] = useState(false);
  const [searchText, setSearchText] = useState("");
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | undefined>();

  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
    };
  }, []);

  const showLocalStatus = useCallback((message: string) => {
    if (statusTimeoutRef.current) {
      clearTimeout(statusTimeoutRef.current);
    }
    setStatusMessage(message);
    statusTimeoutRef.current = setTimeout(() => setStatusMessage(undefined), STATUS_MESSAGE_TIMEOUT_MS);
  }, []);

  // Prepare highlighted lines
  const lines = useMemo(() => {
    const highlighted = highlightCode(text, contentType);
    return highlighted.split("\n");
  }, [text, contentType]);

  const totalLines = lines.length;
  const lineNumberWidth = String(totalLines).length;
  const availableHeight = height - HEADER_ROWS - FOOTER_ROWS;

  // Compute search match line indices
  const matchLineIndices = useMemo(() => {
    if (!searchText) return [];
    const lowerSearch = searchText.toLowerCase();
    const indices: number[] = [];
    // Search against raw text lines (not highlighted) for accurate matching
    const rawLines = text.split("\n");
    for (let i = 0; i < rawLines.length; i++) {
      const line = rawLines[i];
      if (line !== undefined && line.toLowerCase().includes(lowerSearch)) {
        indices.push(i);
      }
    }
    return indices;
  }, [text, searchText]);

  // Keep currentMatchIndex in bounds when matches change
  useEffect(() => {
    if (matchLineIndices.length > 0 && currentMatchIndex >= matchLineIndices.length) {
      setCurrentMatchIndex(0);
    }
  }, [matchLineIndices.length, currentMatchIndex]);

  // Scroll helpers
  const maxScrollOffset = Math.max(0, totalLines - availableHeight);

  const scrollTo = useCallback(
    (line: number) => {
      const clamped = Math.max(0, Math.min(line, maxScrollOffset));
      setScrollOffset(clamped);
    },
    [maxScrollOffset],
  );

  // Auto-scroll to current match when using n/N
  const scrollToMatch = useCallback(
    (matchIdx: number) => {
      if (matchLineIndices.length === 0) return;
      const lineIdx = matchLineIndices[matchIdx];
      if (lineIdx === undefined) return;

      // Centre the match in the viewport if possible
      const centreOffset = Math.max(0, lineIdx - Math.floor(availableHeight / 2));
      scrollTo(centreOffset);
    },
    [matchLineIndices, availableHeight, scrollTo],
  );

  useInput(
    (input, key) => {
      if (searchMode) {
        if (key.escape) {
          // Cancel search
          setSearchMode(false);
          setSearchText("");
          setCurrentMatchIndex(0);
          return;
        }

        if (key.return) {
          // Close search mode, jump to first match
          setSearchMode(false);
          if (matchLineIndices.length > 0) {
            setCurrentMatchIndex(0);
            scrollToMatch(0);
          }
          return;
        }

        if (key.backspace || key.delete) {
          setSearchText((prev) => prev.slice(0, -1));
          return;
        }

        // Only accept single printable characters
        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setSearchText((prev) => prev + input);
        }
        return;
      }

      // Normal mode
      if (key.escape || input === "q") {
        onClose();
        return;
      }

      if (input === "j" || key.downArrow) {
        setScrollOffset((prev) => Math.min(prev + 1, maxScrollOffset));
      } else if (input === "k" || key.upArrow) {
        setScrollOffset((prev) => Math.max(prev - 1, 0));
      } else if (input === "d" && key.ctrl) {
        const halfPage = Math.floor(availableHeight / 2);
        setScrollOffset((prev) => Math.min(prev + halfPage, maxScrollOffset));
      } else if (input === "u" && key.ctrl) {
        const halfPage = Math.floor(availableHeight / 2);
        setScrollOffset((prev) => Math.max(prev - halfPage, 0));
      } else if ((input === "f" && key.ctrl) || input === " ") {
        // Full-page down (Ctrl+f or Space)
        setScrollOffset((prev) => Math.min(prev + availableHeight, maxScrollOffset));
      } else if (input === "b" && key.ctrl) {
        // Full-page up
        setScrollOffset((prev) => Math.max(prev - availableHeight, 0));
      } else if (input === "g" && !key.shift) {
        setScrollOffset(0);
      } else if (input === "G") {
        setScrollOffset(maxScrollOffset);
      } else if (input === "/") {
        setSearchMode(true);
        setSearchText("");
        setCurrentMatchIndex(0);
      } else if (input === "n") {
        // Next match
        if (matchLineIndices.length > 0) {
          const nextIdx = (currentMatchIndex + 1) % matchLineIndices.length;
          setCurrentMatchIndex(nextIdx);
          scrollToMatch(nextIdx);
        }
      } else if (input === "N") {
        // Previous match
        if (matchLineIndices.length > 0) {
          const prevIdx = (currentMatchIndex - 1 + matchLineIndices.length) % matchLineIndices.length;
          setCurrentMatchIndex(prevIdx);
          scrollToMatch(prevIdx);
        }
      } else if (input === "y") {
        void copyToClipboard(text).then(
          () => {
            const msg = "Copied to clipboard";
            showLocalStatus(msg);
            onStatus?.(msg);
          },
          () => {
            const msg = "Failed to copy to clipboard";
            showLocalStatus(msg);
            onStatus?.(msg);
          },
        );
      }
    },
    { isActive },
  );

  // Content type short display
  const shortCt = contentType.split(";")[0]?.trim() ?? "";

  // Build visible row slice
  const visibleSlice = lines.slice(scrollOffset, scrollOffset + availableHeight);

  // Determine the current match line for highlighting
  const currentMatchLine = matchLineIndices.length > 0 ? matchLineIndices[currentMatchIndex] : undefined;

  // Set of all match lines for quick lookup
  const matchLineSet = useMemo(() => new Set(matchLineIndices), [matchLineIndices]);

  // Header border
  const headerRight = ` ${shortCt} ${formatSize(bodySize)} `;
  const titlePart = ` ${title} `;
  const headerBorderWidth = width - titlePart.length - headerRight.length - 2;
  const headerBorder = `\u250C\u2500${titlePart}${"\u2500".repeat(Math.max(0, headerBorderWidth))}${headerRight}\u2500\u2510`;

  // Divider
  const divider = `\u251C${"\u2500".repeat(width - 2)}\u2524`;

  // Footer border
  const footerBorder = `\u2514${"\u2500".repeat(width - 2)}\u2518`;

  // Content width available for text (minus line number column, separator, padding)
  const textAreaWidth = width - 4 - lineNumberWidth - 1;

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <Text color="cyan">{headerBorder}</Text>

      {/* Info row or search input */}
      <Box paddingX={1} height={1}>
        {searchMode ? (
          <Text>
            <Text color="yellow">search: </Text>
            <Text>{searchText}</Text>
            <Text color="gray">{"\u2588"}</Text>
          </Text>
        ) : (
          <Text dimColor wrap="truncate">
            {matchLineIndices.length > 0
              ? `Line ${scrollOffset + 1}/${totalLines} | ${matchLineIndices.length} match${matchLineIndices.length === 1 ? "" : "es"} (${currentMatchIndex + 1}/${matchLineIndices.length})`
              : `Line ${scrollOffset + 1}/${totalLines}`}
          </Text>
        )}
      </Box>

      <Text color="cyan">{divider}</Text>

      {/* Content area */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleSlice.map((line, idx) => {
          const globalLineIdx = scrollOffset + idx;
          const lineNumber = globalLineIdx + 1;
          const isMatch = matchLineSet.has(globalLineIdx);
          const isCurrentMatch = globalLineIdx === currentMatchLine;

          return (
            <TextLine
              key={globalLineIdx}
              lineNumber={lineNumber}
              lineNumberWidth={lineNumberWidth}
              text={line}
              textAreaWidth={textAreaWidth}
              isMatch={isMatch}
              isCurrentMatch={isCurrentMatch}
            />
          );
        })}
        {/* Fill remaining space */}
        {visibleSlice.length < availableHeight && <Box flexGrow={1} />}
      </Box>

      {/* Hint bar */}
      <Text color="cyan">{divider}</Text>
      <Box paddingX={1} height={1}>
        {statusMessage ? (
          <Text color="green">{statusMessage}</Text>
        ) : (
          <Text dimColor wrap="truncate">
            j/k nav {"\u2502"} ^u/^d/^f/^b page {"\u2502"} g/G top/bottom {"\u2502"} / search {"\u2502"} n/N match {"\u2502"} y copy {"\u2502"} q/Esc close
          </Text>
        )}
      </Box>
      <Text color="cyan">{footerBorder}</Text>
    </Box>
  );
}

/**
 * Single line of text with line number gutter.
 */
const TextLine = React.memo(function TextLine({
  lineNumber,
  lineNumberWidth,
  text,
  textAreaWidth,
  isMatch,
  isCurrentMatch,
}: {
  lineNumber: number;
  lineNumberWidth: number;
  text: string;
  textAreaWidth: number;
  isMatch: boolean;
  isCurrentMatch: boolean;
}) {
  const paddedLineNumber = String(lineNumber).padStart(lineNumberWidth, " ");
  // Truncate line if wider than available space
  const displayText = text.length > textAreaWidth ? text.slice(0, textAreaWidth) : text;

  return (
    <Text>
      <Text
        color={isCurrentMatch ? "yellow" : isMatch ? "yellow" : undefined}
        bold={isCurrentMatch}
        dimColor={!isMatch && !isCurrentMatch}
      >
        {paddedLineNumber}
      </Text>
      <Text dimColor> {"\u2502"} </Text>
      <Text>{displayText}</Text>
    </Text>
  );
});
