/**
 * Full-screen modal for exploring JSON bodies as a collapsible tree.
 * Replaces the main TUI when active (terminals don't support true overlays).
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { Box, Text, useInput } from "ink";
import {
  buildVisibleNodes,
  toggleNode,
  defaultExpansion,
  expandAll,
  collapseAll,
  filterByPath,
  getValueAtPath,
  buildBreadcrumb,
  parentPath,
  type JsonTreeNode,
} from "../utils/json-tree.js";
import { formatSize } from "../utils/formatters.js";
import { copyToClipboard } from "../utils/clipboard.js";

export interface JsonExplorerModalProps {
  /** Pre-parsed JSON data */
  data: unknown;
  /** Display title, e.g. "Response Body" */
  title: string;
  /** Content-type for display in header */
  contentType: string;
  /** Body size in bytes for display in header */
  bodySize: number;
  width: number;
  height: number;
  onClose: () => void;
  /** For TTY check (same pattern as other modals) */
  isActive?: boolean;
  /** Status message callback — used to show copy feedback */
  onStatus?: (message: string) => void;
}

const STATUS_MESSAGE_TIMEOUT_MS = 3000;
const FILTER_DEBOUNCE_MS = 150;

/** Rows reserved for header (title + breadcrumb + divider), hint bar, and borders */
const HEADER_ROWS = 3;
const FOOTER_ROWS = 2;
const INDENT_SIZE = 2;

const PrimitiveValue = React.memo(function PrimitiveValue({ value }: { value: string }) {
  if (value === "null") return <Text dimColor>null</Text>;
  if (value === "true" || value === "false") return <Text color="magenta">{value}</Text>;
  if (value.startsWith('"')) return <Text color="green">{value}</Text>;
  // Numbers
  return <Text color="yellow">{value}</Text>;
});

export function JsonExplorerModal({
  data,
  title,
  contentType,
  bodySize,
  width,
  height,
  onClose,
  isActive = true,
  onStatus,
}: JsonExplorerModalProps): React.ReactElement {
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(() => defaultExpansion(data));
  const [cursorIndex, setCursorIndex] = useState(0);
  const [scrollOffset, setScrollOffset] = useState(0);
  const [filterText, setFilterText] = useState("");
  const [filterMode, setFilterMode] = useState(false);
  const [matchingPaths, setMatchingPaths] = useState<Set<string>>(new Set());
  const [preFilterExpansion, setPreFilterExpansion] = useState<Set<string> | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | undefined>();

  const statusTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const filterDebounceRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (statusTimeoutRef.current) {
        clearTimeout(statusTimeoutRef.current);
      }
      if (filterDebounceRef.current) {
        clearTimeout(filterDebounceRef.current);
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

  // Live filter: debounce filterText changes while in filter mode
  useEffect(() => {
    if (!filterMode) return;

    if (filterDebounceRef.current) {
      clearTimeout(filterDebounceRef.current);
    }

    filterDebounceRef.current = setTimeout(() => {
      if (!filterText) {
        // Empty filter — restore pre-filter expansion
        setMatchingPaths(new Set());
        if (preFilterExpansion) {
          setExpandedPaths(preFilterExpansion);
        }
        return;
      }

      const result = filterByPath(data, filterText);
      if (result) {
        setMatchingPaths(result.matchingPaths);
        setExpandedPaths(result.expandedPaths);
        // Move cursor to first matching node
        const newNodes = buildVisibleNodes(data, result.expandedPaths);
        const firstMatchIdx = newNodes.findIndex((n) => result.matchingPaths.has(n.path));
        if (firstMatchIdx !== -1) {
          setCursorIndex(firstMatchIdx);
        }
      } else {
        setMatchingPaths(new Set());
        if (preFilterExpansion) {
          setExpandedPaths(preFilterExpansion);
        }
      }
    }, FILTER_DEBOUNCE_MS);

    return () => {
      if (filterDebounceRef.current) {
        clearTimeout(filterDebounceRef.current);
      }
    };
  }, [filterText, filterMode, data, preFilterExpansion]);

  const visibleNodes = useMemo(
    () => buildVisibleNodes(data, expandedPaths),
    [data, expandedPaths],
  );

  // Keep cursor in bounds when visible nodes change
  useEffect(() => {
    if (cursorIndex >= visibleNodes.length && visibleNodes.length > 0) {
      setCursorIndex(visibleNodes.length - 1);
    }
  }, [visibleNodes.length, cursorIndex]);

  const availableHeight = height - HEADER_ROWS - FOOTER_ROWS;

  // Auto-scroll to keep cursor visible
  useEffect(() => {
    if (cursorIndex < scrollOffset) {
      setScrollOffset(cursorIndex);
    } else if (cursorIndex >= scrollOffset + availableHeight) {
      setScrollOffset(cursorIndex - availableHeight + 1);
    }
  }, [cursorIndex, scrollOffset, availableHeight]);

  const cursorNode = visibleNodes[cursorIndex];
  const breadcrumb = useMemo(
    () => (cursorNode ? buildBreadcrumb(cursorNode.path) : ["(root)"]),
    [cursorNode?.path],
  );

  useInput(
    (input, key) => {
      if (filterMode) {
        if (key.escape) {
          // Close filter, restore pre-filter expansion
          setFilterMode(false);
          setFilterText("");
          setMatchingPaths(new Set());
          if (preFilterExpansion) {
            setExpandedPaths(preFilterExpansion);
            setPreFilterExpansion(null);
          }
          return;
        }

        if (key.return) {
          // Close filter mode — filter already applied live
          setFilterMode(false);
          return;
        }

        if (key.backspace || key.delete) {
          setFilterText((prev) => prev.slice(0, -1));
          return;
        }

        // Only accept single characters to filter out mouse escape sequences
        if (input && input.length === 1 && !key.ctrl && !key.meta) {
          setFilterText((prev) => prev + input);
        }
        return;
      }

      // Normal mode
      if (key.escape || input === "q") {
        onClose();
        return;
      }

      if (input === "j" || key.downArrow) {
        setCursorIndex((prev) => Math.min(prev + 1, visibleNodes.length - 1));
      } else if (input === "k" || key.upArrow) {
        setCursorIndex((prev) => Math.max(prev - 1, 0));
      } else if (input === "d" && key.ctrl) {
        // Half-page down
        const halfPage = Math.floor(availableHeight / 2);
        setCursorIndex((prev) => Math.min(prev + halfPage, visibleNodes.length - 1));
      } else if (input === "u" && key.ctrl) {
        // Half-page up
        const halfPage = Math.floor(availableHeight / 2);
        setCursorIndex((prev) => Math.max(prev - halfPage, 0));
      } else if (input === "f" && key.ctrl) {
        // Full-page down
        setCursorIndex((prev) => Math.min(prev + availableHeight, visibleNodes.length - 1));
      } else if (input === "b" && key.ctrl) {
        // Full-page up
        setCursorIndex((prev) => Math.max(prev - availableHeight, 0));
      } else if (key.return || input === "l") {
        // Toggle expand/collapse on node at cursor
        if (cursorNode?.expandable) {
          setExpandedPaths((prev) => toggleNode(prev, cursorNode.path));
        }
      } else if (input === "h") {
        // Collapse node at cursor, or jump to parent if leaf/already collapsed
        if (cursorNode) {
          if (cursorNode.expandable && expandedPaths.has(cursorNode.path)) {
            setExpandedPaths((prev) => toggleNode(prev, cursorNode.path));
          } else {
            // Jump to parent
            const parent = parentPath(cursorNode.path);
            if (parent) {
              const parentIdx = visibleNodes.findIndex((n) => n.path === parent);
              if (parentIdx !== -1) {
                setCursorIndex(parentIdx);
              }
            }
          }
        }
      } else if (input === "g" && !key.shift) {
        setCursorIndex(0);
      } else if (input === "G") {
        setCursorIndex(Math.max(0, visibleNodes.length - 1));
      } else if (input === "/") {
        // Save current expansion before filtering
        setPreFilterExpansion(new Set(expandedPaths));
        setFilterMode(true);
        setFilterText("");
      } else if (input === "e") {
        setExpandedPaths(expandAll(data));
      } else if (input === "c") {
        setExpandedPaths(collapseAll());
      } else if (input === "n") {
        // Jump to next filter match
        if (matchingPaths.size > 0) {
          const matchIndices = visibleNodes
            .map((n, i) => (matchingPaths.has(n.path) ? i : -1))
            .filter((i) => i !== -1);
          if (matchIndices.length > 0) {
            const nextIdx = matchIndices.find((i) => i > cursorIndex) ?? matchIndices[0];
            if (nextIdx !== undefined) {
              setCursorIndex(nextIdx);
            }
          }
        }
      } else if (input === "N") {
        // Jump to previous filter match
        if (matchingPaths.size > 0) {
          const matchIndices = visibleNodes
            .map((n, i) => (matchingPaths.has(n.path) ? i : -1))
            .filter((i) => i !== -1);
          if (matchIndices.length > 0) {
            const prevIdx = [...matchIndices].reverse().find((i) => i < cursorIndex)
              ?? matchIndices[matchIndices.length - 1];
            if (prevIdx !== undefined) {
              setCursorIndex(prevIdx);
            }
          }
        }
      } else if (input === "y") {
        if (cursorNode) {
          const value = getValueAtPath(data, cursorNode.path);
          const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
          void copyToClipboard(text).then(
            () => {
              const msg = "Value copied to clipboard";
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
      }
    },
    { isActive },
  );

  // Content type short display
  const shortCt = contentType.split(";")[0]?.trim() ?? "";

  // Build visible row slice
  const visibleSlice = visibleNodes.slice(scrollOffset, scrollOffset + availableHeight);

  // Header border
  const headerRight = ` ${shortCt} ${formatSize(bodySize)} `;
  const titlePart = ` ${title} `;
  const headerBorderWidth = width - titlePart.length - headerRight.length - 2;
  const headerBorder = `┌─${titlePart}${"─".repeat(Math.max(0, headerBorderWidth))}${headerRight}─┐`;

  // Divider
  const divider = `├${"─".repeat(width - 2)}┤`;

  // Footer border
  const footerBorder = `└${"─".repeat(width - 2)}┘`;

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <Text color="cyan">{headerBorder}</Text>

      {/* Breadcrumb or filter input */}
      <Box paddingX={1} height={1}>
        {filterMode ? (
          <Text>
            <Text color="yellow">filter: </Text>
            <Text>{filterText}</Text>
            <Text color="gray">█</Text>
          </Text>
        ) : (
          <Text dimColor wrap="truncate">
            {breadcrumb.join(" > ")}
          </Text>
        )}
      </Box>

      <Text color="cyan">{divider}</Text>

      {/* Tree content */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleSlice.map((node, idx) => {
          const globalIdx = scrollOffset + idx;
          const isCursor = globalIdx === cursorIndex;
          const isMatch = matchingPaths.has(node.path);
          const isExpanded = node.expandable ? expandedPaths.has(node.path) : undefined;

          return (
            <TreeNodeRowWithArrow
              key={node.path}
              node={node}
              isCursor={isCursor}
              isMatch={isMatch}
              isExpanded={isExpanded}
              maxWidth={width - 4}
            />
          );
        })}
        {/* Fill remaining space */}
        {visibleSlice.length < availableHeight && (
          <Box flexGrow={1} />
        )}
      </Box>

      {/* Hint bar */}
      <Text color="cyan">{divider}</Text>
      <Box paddingX={1} height={1}>
        {statusMessage ? (
          <Text color="green">{statusMessage}</Text>
        ) : (
          <Text dimColor wrap="truncate">
            j/k nav │ ^u/^d/^f/^b page │ Enter/l toggle │ h collapse │ e/c expand/collapse all │ / filter │ n/N match │ y copy │ q/Esc close
          </Text>
        )}
      </Box>
      <Text color="cyan">{footerBorder}</Text>
    </Box>
  );
}

/**
 * Tree node row that correctly shows ▶/▼ based on expansion state.
 */
const TreeNodeRowWithArrow = React.memo(function TreeNodeRowWithArrow({
  node,
  isCursor,
  isMatch,
  isExpanded,
  maxWidth,
}: {
  node: JsonTreeNode;
  isCursor: boolean;
  isMatch: boolean;
  isExpanded: boolean | undefined;
  maxWidth: number;
}) {
  const indent = " ".repeat(node.depth * INDENT_SIZE);
  const cursor = isCursor ? "❯ " : "  ";

  let arrow = "  ";
  if (node.expandable) {
    arrow = isExpanded ? "▼ " : "▶ ";
  }

  const keyPart = node.key;
  const valuePart = node.value;

  // Check if the line would exceed available width
  const prefix = `${cursor}${indent}${arrow}`;
  const fullLine = `${keyPart}: ${valuePart}`;
  const availableWidth = maxWidth - prefix.length;
  const isTruncated = fullLine.length > availableWidth;

  return (
    <Text bold={isCursor}>
      <Text>{cursor}</Text>
      <Text>{indent}</Text>
      <Text>{arrow}</Text>
      {isTruncated ? (
        <Text>{fullLine.substring(0, Math.max(0, availableWidth - 1))}…</Text>
      ) : (
        <>
          <Text color="cyan" bold={isCursor} underline={isMatch}>
            {keyPart}
          </Text>
          <Text>: </Text>
          {node.type === "primitive" ? (
            <PrimitiveValue value={valuePart} />
          ) : (
            <Text dimColor>{valuePart}</Text>
          )}
        </>
      )}
    </Text>
  );
});
