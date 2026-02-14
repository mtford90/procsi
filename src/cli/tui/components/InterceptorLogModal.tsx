/**
 * Full-screen modal for viewing interceptor runtime events.
 * Shows a reverse-chronological, scrollable, filterable event log.
 * Replaces the main TUI when active (terminals don't support true overlays).
 */

import React, { useState, useMemo, useCallback, useRef } from "react";
import { Box, Text, useInput } from "ink";
import type { InterceptorEvent, InterceptorEventLevel } from "../../../shared/types.js";
import { HintContent, type HintItem } from "./HintContent.js";
import { EventFilterBar, type EventFilter } from "./EventFilterBar.js";

const LOG_MODAL_HINTS: HintItem[] = [
  { key: "j/k", action: "nav" },
  { key: "^u/^d", action: "half-page" },
  { key: "g/G", action: "top/bottom" },
  { key: "/", action: "filter" },
  { key: "q/Esc", action: "close" },
];

export interface InterceptorLogModalProps {
  events: InterceptorEvent[];
  width: number;
  height: number;
  onClose: () => void;
  isActive?: boolean;
}

/** Rows reserved for header (title + info + divider) */
const HEADER_ROWS = 3;
/** Rows reserved for footer (divider + hint bar + bottom border) */
const FOOTER_ROWS = 3;
/** Rows consumed by the filter bar when open */
const FILTER_BAR_ROWS = 2;

/**
 * Format a timestamp as HH:MM:SS.
 */
function formatTime(timestamp: number): string {
  const d = new Date(timestamp);
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  const ss = String(d.getSeconds()).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

/**
 * Get the display colour for a given event level.
 */
function levelColour(level: InterceptorEventLevel): string | undefined {
  switch (level) {
    case "error":
      return "red";
    case "warn":
      return "yellow";
    case "info":
      return undefined; // dim instead
  }
}

/**
 * Get a human label for the current filter state (shown in the header).
 */
function filterSummary(filter: EventFilter): string {
  const parts: string[] = [];
  if (filter.level === "error") parts.push("errors");
  else if (filter.level === "warn") parts.push("warn+");
  else parts.push("all");
  if (filter.interceptor) parts.push(filter.interceptor);
  if (filter.search) parts.push(`"${filter.search}"`);
  return parts.join(" ");
}

/**
 * Check whether an event passes the combined filter.
 */
function passesFilter(event: InterceptorEvent, filter: EventFilter): boolean {
  // Level filter
  if (filter.level === "error" && event.level !== "error") return false;
  if (filter.level === "warn" && event.level !== "warn" && event.level !== "error") return false;

  // Interceptor filter
  if (filter.interceptor && event.interceptor !== filter.interceptor) return false;

  // Search filter — case-insensitive substring match on message
  if (filter.search) {
    const needle = filter.search.toLowerCase();
    if (!event.message.toLowerCase().includes(needle)) return false;
  }

  return true;
}

/**
 * Build display lines for a single event.
 * Returns one or more lines: the main line and optionally multiple error detail lines
 * (e.g. stack trace frames).
 */
function eventLines(event: InterceptorEvent, maxWidth: number): { main: string; details: string[] } {
  const time = formatTime(event.timestamp);
  const level = event.level.toUpperCase().padEnd(5);
  const prefix = `[${time}] [${level}] [${event.interceptor}] `;
  const remaining = Math.max(0, maxWidth - prefix.length);
  const message = event.message.length > remaining
    ? event.message.slice(0, remaining - 1) + "\u2026"
    : event.message;
  const main = `${prefix}${message}`;

  const details: string[] = [];
  if (event.error) {
    const indent = "    ";
    const errorRemaining = Math.max(0, maxWidth - indent.length);
    const errorLines = event.error.split("\n");
    for (const line of errorLines) {
      const trimmed = line.length > errorRemaining
        ? line.slice(0, errorRemaining - 1) + "\u2026"
        : line;
      details.push(`${indent}${trimmed}`);
    }
  }

  return { main, details };
}

export function InterceptorLogModal({
  events,
  width,
  height,
  onClose,
  isActive = true,
}: InterceptorLogModalProps): React.ReactElement {
  const [scrollOffset, setScrollOffset] = useState(0);
  const [filter, setFilter] = useState<EventFilter>({});
  const [showFilter, setShowFilter] = useState(false);

  // Stores the filter state when the filter bar opens, so Escape can revert
  const preOpenFilterRef = useRef<EventFilter>({});

  // Unique interceptor names across all events (not just filtered ones)
  const interceptorNames = useMemo(() => {
    const names = new Set<string>();
    for (const event of events) {
      names.add(event.interceptor);
    }
    return [...names].sort();
  }, [events]);

  // Filter events, then reverse to newest-first
  const filteredEvents = useMemo(() => {
    const filtered = events.filter((e) => passesFilter(e, filter));
    return [...filtered].reverse();
  }, [events, filter]);

  // Build all display rows (each event may produce 1+ rows)
  const contentWidth = width - 4; // padding + borders
  const displayRows = useMemo(() => {
    const rows: { event: InterceptorEvent; text: string; isDetail: boolean }[] = [];
    for (const event of filteredEvents) {
      const { main, details } = eventLines(event, contentWidth);
      rows.push({ event, text: main, isDetail: false });
      for (const detail of details) {
        rows.push({ event, text: detail, isDetail: true });
      }
    }
    return rows;
  }, [filteredEvents, contentWidth]);

  const filterBarHeight = showFilter ? FILTER_BAR_ROWS : 0;
  const availableHeight = height - HEADER_ROWS - FOOTER_ROWS - filterBarHeight;
  const maxScrollOffset = Math.max(0, displayRows.length - availableHeight);

  const handleFilterChange = useCallback((newFilter: EventFilter) => {
    setFilter(newFilter);
    setScrollOffset(0);
  }, []);

  const handleFilterCancel = useCallback(() => {
    setFilter(preOpenFilterRef.current);
    setScrollOffset(0);
    setShowFilter(false);
  }, []);

  useInput(
    (input, key) => {
      if (key.escape || input === "q") {
        onClose();
        return;
      }

      if (input === "/") {
        preOpenFilterRef.current = filter;
        setShowFilter(true);
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
      } else if (input === "g" && !key.shift) {
        setScrollOffset(0);
      } else if (input === "G") {
        setScrollOffset(maxScrollOffset);
      }
    },
    { isActive: isActive && !showFilter },
  );

  // Header border
  const titlePart = " Interceptor Log ";
  const filterPart = ` ${filterSummary(filter)} `;
  const countPart = ` ${filteredEvents.length} event${filteredEvents.length === 1 ? "" : "s"} `;
  const headerBorderWidth = width - titlePart.length - filterPart.length - countPart.length - 4;
  const headerBorder = `\u250C\u2500${titlePart}${"\u2500".repeat(Math.max(0, headerBorderWidth))}${countPart}${filterPart}\u2500\u2510`;

  // Divider
  const divider = `\u251C${"\u2500".repeat(width - 2)}\u2524`;

  // Footer border
  const footerBorder = `\u2514${"\u2500".repeat(width - 2)}\u2518`;

  // Visible rows
  const visibleSlice = displayRows.slice(scrollOffset, scrollOffset + availableHeight);

  // Empty state
  if (filteredEvents.length === 0) {
    const hasActiveFilter = filter.level !== undefined || filter.interceptor !== undefined || (filter.search !== undefined && filter.search.length > 0);
    return (
      <Box flexDirection="column" width={width} height={height}>
        <Text color="cyan">{headerBorder}</Text>
        <Box paddingX={1} height={1}>
          <Text dimColor>
            {hasActiveFilter
              ? `No matching events | Press / to change filter`
              : "Waiting for interceptor events..."}
          </Text>
        </Box>
        <Text color="cyan">{divider}</Text>
        {showFilter && (
          <EventFilterBar
            isActive={isActive}
            filter={filter}
            onFilterChange={handleFilterChange}
            onClose={() => setShowFilter(false)}
            onCancel={handleFilterCancel}
            interceptorNames={interceptorNames}
            width={width}
          />
        )}
        <Box flexDirection="column" flexGrow={1} alignItems="center" justifyContent="center">
          <Text dimColor>No interceptor events</Text>
        </Box>
        <Text color="cyan">{divider}</Text>
        <Box paddingX={1} height={1}>
          <HintContent hints={LOG_MODAL_HINTS} availableWidth={width - 4} />
        </Box>
        <Text color="cyan">{footerBorder}</Text>
      </Box>
    );
  }

  return (
    <Box flexDirection="column" width={width} height={height}>
      {/* Header */}
      <Text color="cyan">{headerBorder}</Text>

      {/* Info row */}
      <Box paddingX={1} height={1}>
        <Text dimColor>
          {displayRows.length > availableHeight
            ? `Showing ${scrollOffset + 1}\u2013${Math.min(scrollOffset + availableHeight, displayRows.length)} of ${displayRows.length} rows`
            : `${displayRows.length} row${displayRows.length === 1 ? "" : "s"}`}
        </Text>
      </Box>

      <Text color="cyan">{divider}</Text>

      {/* Filter bar */}
      {showFilter && (
        <EventFilterBar
          isActive={isActive}
          filter={filter}
          onFilterChange={handleFilterChange}
          onClose={() => setShowFilter(false)}
          onCancel={handleFilterCancel}
          interceptorNames={interceptorNames}
          width={width}
        />
      )}

      {/* Content area */}
      <Box flexDirection="column" flexGrow={1} paddingX={1}>
        {visibleSlice.map((row, idx) => (
          <EventRow
            key={scrollOffset + idx}
            text={row.text}
            level={row.event.level}
            isDetail={row.isDetail}
          />
        ))}
        {/* Fill remaining space */}
        {visibleSlice.length < availableHeight && <Box flexGrow={1} />}
      </Box>

      {/* Hint bar */}
      <Text color="cyan">{divider}</Text>
      <Box paddingX={1} height={1}>
        <HintContent hints={LOG_MODAL_HINTS} availableWidth={width - 4} />
      </Box>
      <Text color="cyan">{footerBorder}</Text>
    </Box>
  );
}

/**
 * Single row in the event log. Memoised to avoid re-renders in the list.
 */
const EventRow = React.memo(function EventRow({
  text,
  level,
  isDetail,
}: {
  text: string;
  level: InterceptorEventLevel;
  isDetail: boolean;
}) {
  const colour = levelColour(level);

  if (isDetail) {
    return <Text color="red" dimColor>{text}</Text>;
  }

  if (level === "info") {
    return <Text dimColor>{text}</Text>;
  }

  return <Text color={colour}>{text}</Text>;
});
