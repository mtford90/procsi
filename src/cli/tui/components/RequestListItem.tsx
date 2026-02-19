/**
 * Single request row in the request list.
 */

import React, { useRef, memo } from "react";
import { Box, Text, type DOMElement } from "ink";
import { useOnClick } from "@ink-tools/ink-mouse";
import type { CapturedRequestSummary, InterceptionType } from "../../../shared/types.js";
import { formatMethod, formatDuration, truncate } from "../utils/formatters.js";

/**
 * Get the 2-character interception indicator and its colour.
 * Returns "M " for mocked, "I " for modified, or "  " for normal requests.
 */
export function getInterceptionIndicator(type?: InterceptionType): { text: string; colour?: string } {
  switch (type) {
    case "mocked":
      return { text: "M ", colour: "magenta" };
    case "modified":
      return { text: "I ", colour: "cyan" };
    default:
      return { text: "  " };
  }
}

/**
 * Get the 2-character replay indicator and its colour.
 * Returns "R " for replayed requests, or "  " otherwise.
 */
export function getReplayIndicator(replayedFromId?: string): { text: string; colour?: string } {
  if (!replayedFromId) {
    return { text: "  " };
  }
  return { text: "R ", colour: "yellow" };
}

interface RequestListItemProps {
  request: CapturedRequestSummary;
  isSelected: boolean;
  width: number;
  showFullUrl?: boolean;
  onClick?: () => void;
  searchTerm?: string;
}

/**
 * Get colour for HTTP status code.
 */
export function getStatusColour(status: number | undefined): string {
  if (status === undefined) {
    return "gray";
  }
  if (status >= 200 && status < 300) {
    return "green";
  }
  if (status >= 300 && status < 400) {
    return "yellow";
  }
  if (status >= 400) {
    return "red";
  }
  return "white";
}

/**
 * Get a visual indicator character for an HTTP status code.
 */
export function getStatusIndicator(status: number | undefined): string {
  if (status === undefined) {
    return " ";
  }
  if (status >= 200 && status < 300) {
    return "✓";
  }
  if (status >= 300 && status < 400) {
    return "→";
  }
  return "✗";
}

/**
 * Get colour for HTTP method.
 */
export function getMethodColour(method: string): string {
  switch (method.toUpperCase()) {
    case "GET":
      return "green";
    case "POST":
      return "blue";
    case "PUT":
      return "yellow";
    case "PATCH":
      return "yellow";
    case "DELETE":
      return "magenta";
    default:
      return "white";
  }
}

/**
 * Split text into segments around case-insensitive matches of a search term.
 * Returns alternating [non-match, match, non-match, ...] segments.
 */
function splitByMatch(text: string, term: string): { text: string; isMatch: boolean }[] {
  if (!term) return [{ text, isMatch: false }];

  const segments: { text: string; isMatch: boolean }[] = [];
  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let pos = 0;

  while (pos < text.length) {
    const matchIdx = lowerText.indexOf(lowerTerm, pos);
    if (matchIdx === -1) {
      segments.push({ text: text.slice(pos), isMatch: false });
      break;
    }
    if (matchIdx > pos) {
      segments.push({ text: text.slice(pos, matchIdx), isMatch: false });
    }
    segments.push({ text: text.slice(matchIdx, matchIdx + term.length), isMatch: true });
    pos = matchIdx + term.length;
  }

  return segments.length > 0 ? segments : [{ text, isMatch: false }];
}

export const RequestListItem = memo(function RequestListItem({
  request,
  isSelected,
  width,
  showFullUrl,
  onClick,
  searchTerm,
}: RequestListItemProps): React.ReactElement {
  const ref = useRef<DOMElement>(null);

  useOnClick(ref, () => {
    if (onClick) {
      onClick();
    }
  });

  const interceptionWidth = 2; // "M " / "I " / "  "
  const replayWidth = 2; // "R " / "  "
  const methodWidth = 7;
  const statusWidth = 6;
  const durationWidth = 8;
  const separatorsWidth = 3; // Spaces between columns

  // Calculate remaining width for path
  const pathWidth = Math.max(
    10,
    width - interceptionWidth - replayWidth - methodWidth - statusWidth - durationWidth - separatorsWidth
  );
  const displayPath = truncate(showFullUrl ? request.url : request.path, pathWidth);
  const paddedPath = displayPath.padEnd(pathWidth);

  const statusText = request.responseStatus?.toString() ?? "...";
  const statusIndicator = getStatusIndicator(request.responseStatus);
  const duration = formatDuration(request.durationMs);

  const savedChar = request.saved ? "*" : " ";
  const indicator = isSelected ? `❯${savedChar}` : ` ${savedChar}`;
  const indicatorColour = isSelected ? "cyan" : request.saved ? "yellow" : undefined;
  const interception = getInterceptionIndicator(request.interceptionType);
  const replay = getReplayIndicator(request.replayedFromId);

  return (
    <Box ref={ref} width={width}>
      <Text wrap="truncate">
        <Text color={indicatorColour}>{indicator}</Text>
        <Text color={interception.colour}>{interception.text}</Text>
        <Text color={replay.colour}>{replay.text}</Text>
        <Text color={getMethodColour(request.method)}>{formatMethod(request.method)}</Text>
        <Text> </Text>
        <Text color={getStatusColour(request.responseStatus)}>{statusIndicator}{statusText.padStart(3)}</Text>
        <Text> </Text>
        {searchTerm ? (
          <Text dimColor={!isSelected}>
            {splitByMatch(paddedPath, searchTerm).map((seg, i) =>
              seg.isMatch ? (
                <Text key={i} color="yellow" bold>{seg.text}</Text>
              ) : (
                <Text key={i}>{seg.text}</Text>
              ),
            )}
          </Text>
        ) : (
          <Text dimColor={!isSelected}>{paddedPath}</Text>
        )}
        <Text dimColor>{duration.padStart(durationWidth)}</Text>
      </Text>
    </Box>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.request === nextProps.request &&
    prevProps.isSelected === nextProps.isSelected &&
    prevProps.width === nextProps.width &&
    prevProps.showFullUrl === nextProps.showFullUrl &&
    prevProps.searchTerm === nextProps.searchTerm
  );
});
