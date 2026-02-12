/**
 * Left panel: scrollable list of captured requests.
 */

import React, { forwardRef } from "react";
import { Box, Text, type DOMElement } from "ink";
import type { CapturedRequestSummary } from "../../../shared/types.js";
import { RequestListItem } from "./RequestListItem.js";
import { Panel } from "./Panel.js";

interface RequestListProps {
  requests: CapturedRequestSummary[];
  selectedIndex: number;
  isActive: boolean;
  isHovered?: boolean;
  width: number;
  height: number;
  showFullUrl?: boolean;
  onItemClick?: (index: number) => void;
  scrollOffset?: number;
  searchTerm?: string;
}

export const RequestList = forwardRef<DOMElement, RequestListProps>(function RequestList(
  { requests, selectedIndex, isActive, isHovered, width, height, showFullUrl, onItemClick, scrollOffset: providedScrollOffset, searchTerm },
  ref,
) {
  // Calculate visible window (accounting for border - 2 lines for top/bottom)
  const visibleHeight = Math.max(1, height - 2);
  const halfWindow = Math.floor(visibleHeight / 2);

  // Use provided scroll offset, or fall back to selection-centred behaviour
  let effectiveScrollOffset = providedScrollOffset ?? 0;
  if (providedScrollOffset === undefined && requests.length > visibleHeight) {
    effectiveScrollOffset = Math.max(0, Math.min(selectedIndex - halfWindow, requests.length - visibleHeight));
  }

  const visibleRequests = requests.slice(effectiveScrollOffset, effectiveScrollOffset + visibleHeight);

  // Build title and right value
  const title = "[1] Requests";
  let rightValue: string | number = requests.length;
  if (requests.length > visibleHeight) {
    rightValue = `${effectiveScrollOffset + 1}-${Math.min(effectiveScrollOffset + visibleHeight, requests.length)}/${requests.length}`;
  }

  return (
    <Panel
      ref={ref}
      title={title}
      rightValue={rightValue}
      isActive={isActive}
      isHovered={isHovered}
      width={width}
      height={height}
    >
      {requests.length === 0 ? (
        <Box paddingX={1} paddingY={1} flexDirection="column">
          <Text dimColor>No requests captured yet.</Text>
          <Text dimColor> </Text>
          <Text>Run <Text color="cyan">eval $(procsi vars)</Text> in another terminal</Text>
          <Text dimColor>to start capturing traffic.</Text>
        </Box>
      ) : (
        <Box flexDirection="column" paddingX={1}>
          {visibleRequests.map((request, index) => {
            const absoluteIndex = effectiveScrollOffset + index;
            return (
              <RequestListItem
                key={request.id}
                request={request}
                isSelected={absoluteIndex === selectedIndex}
                width={width - 4} // Account for border and padding
                showFullUrl={showFullUrl}
                onClick={onItemClick ? () => onItemClick(absoluteIndex) : undefined}
                searchTerm={searchTerm}
              />
            );
          })}
        </Box>
      )}
    </Panel>
  );
});
