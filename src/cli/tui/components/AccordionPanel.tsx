/**
 * Container component managing 4 collapsible accordion sections for request details.
 * Sections: Request, Request Body, Response, Response Body
 *
 * Renders as a single cohesive panel with connected borders:
 * ┌─ ▶ [2] Request ──────────────────────────┐
 * ├─ ▶ [3] Request Body ─────────────────────┤
 * ├─ ▶ [4] Response ─────────────── 200 OK ──┤
 * ├─ ▶ [5] Response Body ─────────── html ───┤
 * │ content here...                          │
 * └──────────────────────────────────────────┘
 */

import React, { forwardRef, useMemo } from "react";
import { Box, Text, type DOMElement } from "ink";
import type { CapturedRequest } from "../../../shared/types.js";
import { AccordionSection } from "./AccordionSection.js";
import { formatSize } from "../utils/formatters.js";

// Box drawing characters for the bottom border
const BOX = {
  bottomLeft: "└",
  bottomRight: "┘",
  horizontal: "─",
} as const;

/**
 * Section indices (used for keyboard shortcuts 2-5)
 */
export const SECTION_REQUEST = 0;
export const SECTION_REQUEST_BODY = 1;
export const SECTION_RESPONSE = 2;
export const SECTION_RESPONSE_BODY = 3;

interface AccordionPanelProps {
  request: CapturedRequest | undefined;
  width: number;
  height: number;
  isActive: boolean;
  focusedSection: number;
  expandedSections: Set<number>;
}

/**
 * Extract short content type for display (e.g., "application/json" -> "json")
 */
function shortContentType(contentType: string | undefined): string {
  if (!contentType) return "";
  // Extract the main type (before any parameters like charset)
  const mainType = contentType.split(";")[0]?.trim() ?? "";
  // For common types, show just the subtype
  if (mainType.startsWith("application/")) {
    return mainType.replace("application/", "");
  }
  if (mainType.startsWith("text/")) {
    return mainType.replace("text/", "");
  }
  return mainType;
}

/**
 * Format headers for display
 */
function HeadersContent({
  headers,
  maxLines,
}: {
  headers: Record<string, string> | undefined;
  maxLines: number;
}): React.ReactElement {
  const entries = headers ? Object.entries(headers) : [];

  if (entries.length === 0) {
    return <Text dimColor>No headers</Text>;
  }

  const visibleEntries = entries.slice(0, maxLines);
  const remaining = entries.length - visibleEntries.length;

  return (
    <Box flexDirection="column">
      {visibleEntries.map(([name, value]) => (
        <Box key={name}>
          <Text color="cyan">{name}</Text>
          <Text>: </Text>
          <Text wrap="truncate">{value}</Text>
        </Box>
      ))}
      {remaining > 0 && <Text dimColor>... and {remaining} more</Text>}
    </Box>
  );
}

/**
 * Format body for display with JSON pretty-printing
 */
function BodyContent({
  body,
  contentType,
  maxLines,
}: {
  body: Buffer | undefined;
  contentType?: string;
  maxLines: number;
}): React.ReactElement {
  const lines = useMemo(() => {
    if (!body || body.length === 0) {
      return ["(empty)"];
    }

    const bodyStr = body.toString("utf-8");

    // Try JSON formatting
    const isJson =
      contentType?.includes("application/json") ||
      bodyStr.trimStart().startsWith("{") ||
      bodyStr.trimStart().startsWith("[");

    if (isJson) {
      try {
        const parsed = JSON.parse(bodyStr) as unknown;
        const formatted = JSON.stringify(parsed, null, 2);
        return formatted.split("\n");
      } catch {
        // Not valid JSON
      }
    }

    return bodyStr.split("\n");
  }, [body, contentType]);

  const visibleLines = lines.slice(0, maxLines);
  const remaining = lines.length - visibleLines.length;

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, index) => (
        <Text key={index} wrap="truncate">
          {line}
        </Text>
      ))}
      {remaining > 0 && <Text dimColor>... {remaining} more lines</Text>}
    </Box>
  );
}

/**
 * Calculate height distribution for sections.
 * Collapsed sections get 1 row, expanded sections share the remaining space equally.
 * Reserves 1 row for the bottom border.
 */
function calculateHeights(
  totalHeight: number,
  expandedSections: Set<number>,
  sectionCount: number,
): number[] {
  const collapsedCount = sectionCount - expandedSections.size;
  const expandedCount = expandedSections.size;

  // Reserve 1 row for bottom border
  const availableHeight = totalHeight - 1;

  // Each collapsed section takes 1 row
  const collapsedHeight = collapsedCount;
  const remainingHeight = availableHeight - collapsedHeight;

  // Minimum height for expanded sections
  const minExpandedHeight = 3;

  const heights: number[] = [];

  if (expandedCount === 0) {
    // All collapsed - each gets 1 row
    for (let i = 0; i < sectionCount; i++) {
      heights.push(1);
    }
  } else {
    // Distribute remaining height among expanded sections
    const expandedHeight = Math.max(minExpandedHeight, Math.floor(remainingHeight / expandedCount));

    for (let i = 0; i < sectionCount; i++) {
      if (expandedSections.has(i)) {
        heights.push(expandedHeight);
      } else {
        heights.push(1);
      }
    }
  }

  return heights;
}

export const AccordionPanel = forwardRef<DOMElement, AccordionPanelProps>(function AccordionPanel(
  { request, width, height, isActive, focusedSection, expandedSections },
  ref,
) {
  const sectionCount = 4;
  const heights = calculateHeights(height, expandedSections, sectionCount);

  // Extract content type and size info for section headers
  const reqContentType = request?.requestHeaders["content-type"];
  const resContentType = request?.responseHeaders?.["content-type"];
  const reqBodySize = request?.requestBody?.length;
  const resBodySize = request?.responseBody?.length;

  // Build right-aligned values for each section
  const requestRightValue = reqContentType ? shortContentType(reqContentType) : undefined;
  const requestBodyRightValue =
    reqContentType || reqBodySize
      ? `${shortContentType(reqContentType)}${reqBodySize ? ` ${formatSize(reqBodySize)}` : ""}`
      : undefined;
  const responseRightValue =
    request?.responseStatus !== undefined
      ? `${request.responseStatus} ${getStatusText(request.responseStatus)}`
      : undefined;
  const responseBodyRightValue =
    resContentType || resBodySize
      ? `${shortContentType(resContentType)}${resBodySize ? ` ${formatSize(resBodySize)}` : ""}`
      : undefined;

  // Calculate content lines available for each expanded section
  // Height includes header (1 row) and borders (2 rows for bottom)
  const getContentLines = (sectionHeight: number) => Math.max(1, sectionHeight - 3);

  // Determine border colour based on whether any section is focused
  const getBorderColour = (sectionIndex: number): string => {
    if (!isActive) return "gray";
    return focusedSection === sectionIndex ? "cyan" : "white";
  };

  // Build the bottom border line
  const bottomBorder = `${BOX.bottomLeft}${BOX.horizontal.repeat(width - 2)}${BOX.bottomRight}`;

  if (!request) {
    return (
      <Box ref={ref} flexDirection="column" width={width} height={height}>
        <Box flexGrow={1} alignItems="center" justifyContent="center">
          <Text dimColor>Select a request to view details</Text>
        </Box>
      </Box>
    );
  }

  return (
    <Box ref={ref} flexDirection="column" width={width} height={height}>
      {/* Section 0: Request (headers) */}
      <AccordionSection
        title="[2] Request"
        rightValue={requestRightValue}
        isExpanded={expandedSections.has(SECTION_REQUEST)}
        isFocused={isActive && focusedSection === SECTION_REQUEST}
        height={heights[SECTION_REQUEST] ?? 1}
        width={width}
        isFirst={true}
        borderColour={getBorderColour(SECTION_REQUEST)}
      >
        <Box flexDirection="column">
          <Box marginBottom={1}>
            <Text color="green" bold>
              {request.method}
            </Text>
            <Text> </Text>
            <Text wrap="truncate">{request.url}</Text>
          </Box>
          <HeadersContent headers={request.requestHeaders} maxLines={getContentLines(heights[SECTION_REQUEST] ?? 1) - 2} />
        </Box>
      </AccordionSection>

      {/* Section 1: Request Body */}
      <AccordionSection
        title="[3] Request Body"
        rightValue={requestBodyRightValue}
        isExpanded={expandedSections.has(SECTION_REQUEST_BODY)}
        isFocused={isActive && focusedSection === SECTION_REQUEST_BODY}
        height={heights[SECTION_REQUEST_BODY] ?? 1}
        width={width}
        isFirst={false}
        borderColour={getBorderColour(SECTION_REQUEST_BODY)}
      >
        {request.requestBody && request.requestBody.length > 0 ? (
          <BodyContent
            body={request.requestBody}
            contentType={reqContentType}
            maxLines={getContentLines(heights[SECTION_REQUEST_BODY] ?? 1)}
          />
        ) : (
          <Text dimColor>(no body)</Text>
        )}
      </AccordionSection>

      {/* Section 2: Response (headers) */}
      <AccordionSection
        title="[4] Response"
        rightValue={responseRightValue}
        isExpanded={expandedSections.has(SECTION_RESPONSE)}
        isFocused={isActive && focusedSection === SECTION_RESPONSE}
        height={heights[SECTION_RESPONSE] ?? 1}
        width={width}
        isFirst={false}
        borderColour={getBorderColour(SECTION_RESPONSE)}
      >
        {request.responseHeaders ? (
          <HeadersContent
            headers={request.responseHeaders}
            maxLines={getContentLines(heights[SECTION_RESPONSE] ?? 1)}
          />
        ) : (
          <Text dimColor>(pending response)</Text>
        )}
      </AccordionSection>

      {/* Section 3: Response Body */}
      <AccordionSection
        title="[5] Response Body"
        rightValue={responseBodyRightValue}
        isExpanded={expandedSections.has(SECTION_RESPONSE_BODY)}
        isFocused={isActive && focusedSection === SECTION_RESPONSE_BODY}
        height={heights[SECTION_RESPONSE_BODY] ?? 1}
        width={width}
        isFirst={false}
        borderColour={getBorderColour(SECTION_RESPONSE_BODY)}
      >
        {request.responseBody && request.responseBody.length > 0 ? (
          <BodyContent
            body={request.responseBody}
            contentType={resContentType}
            maxLines={getContentLines(heights[SECTION_RESPONSE_BODY] ?? 1)}
          />
        ) : (
          <Text dimColor>(no body)</Text>
        )}
      </AccordionSection>

      {/* Bottom border */}
      <Text color={isActive ? "white" : "gray"}>{bottomBorder}</Text>
    </Box>
  );
});

/**
 * Get HTTP status text for common status codes
 */
function getStatusText(status: number): string {
  const statusTexts: Record<number, string> = {
    200: "OK",
    201: "Created",
    204: "No Content",
    301: "Moved Permanently",
    302: "Found",
    304: "Not Modified",
    400: "Bad Request",
    401: "Unauthorized",
    403: "Forbidden",
    404: "Not Found",
    405: "Method Not Allowed",
    500: "Internal Server Error",
    502: "Bad Gateway",
    503: "Service Unavailable",
  };
  return statusTexts[status] ?? "";
}
