/**
 * Detailed request/session/event formatters for CLI output.
 */

import type { CapturedRequest, InterceptorEvent, Session } from "../../shared/types.js";
import {
  formatDuration,
  formatSize,
  getStatusText,
  shortContentType,
} from "../tui/utils/formatters.js";
import { GREEN, YELLOW, RED, CYAN, BOLD, DIM, RESET, useColour } from "./colour.js";

function colourForStatus(status: number): string {
  if (status >= 200 && status < 300) return GREEN;
  if (status >= 300 && status < 400) return YELLOW;
  if (status >= 400) return RED;
  return "";
}

/**
 * Format the full detail view for a single request.
 */
export function formatRequestDetail(request: CapturedRequest): string {
  const colour = useColour();
  const lines: string[] = [];

  // Title line: GET https://example.com/path → 200 OK (45ms)
  const status = request.responseStatus;
  const statusText = status !== undefined ? `${status} ${getStatusText(status)}` : "pending";
  const arrow = colour ? `${DIM}→${RESET}` : "→";
  const durationStr =
    request.durationMs !== undefined ? ` (${formatDuration(request.durationMs)})` : "";

  let titleLine = `  ${request.method} ${request.url} ${arrow} `;
  if (colour && status !== undefined) {
    titleLine += `${colourForStatus(status)}${statusText}${RESET}${durationStr}`;
  } else {
    titleLine += `${statusText}${durationStr}`;
  }
  lines.push(titleLine);

  // Interception info
  if (request.interceptedBy) {
    const label = request.interceptionType === "mocked" ? "Mocked by" : "Modified by";
    const indicator = colour
      ? `${CYAN}${label}: ${request.interceptedBy}${RESET}`
      : `${label}: ${request.interceptedBy}`;
    lines.push(`  ${indicator}`);
  }

  lines.push("");

  // Request Headers
  const reqHeaderLabel = colour ? `${BOLD}  Request Headers${RESET}` : "  Request Headers";
  lines.push(reqHeaderLabel);
  for (const [name, value] of Object.entries(request.requestHeaders)) {
    // Mask authorisation headers
    const displayValue = name.toLowerCase() === "authorization" ? maskAuthValue(value) : value;
    lines.push(`    ${name}: ${displayValue}`);
  }

  lines.push("");

  // Response Headers
  if (request.responseHeaders) {
    const resHeaderLabel = colour ? `${BOLD}  Response Headers${RESET}` : "  Response Headers";
    lines.push(resHeaderLabel);
    for (const [name, value] of Object.entries(request.responseHeaders)) {
      lines.push(`    ${name}: ${value}`);
    }
    lines.push("");
  }

  // Response Body preview
  if (request.responseBody && request.responseBody.length > 0) {
    const contentType =
      request.responseHeaders?.["content-type"] ?? request.responseHeaders?.["Content-Type"];
    const shortCt = shortContentType(contentType);
    const sizeStr = formatSize(request.responseBody.length);
    const ctInfo = shortCt ? `, ${shortCt}` : "";
    const bodyLabel = colour
      ? `${BOLD}  Response Body${RESET} (${sizeStr}${ctInfo})`
      : `  Response Body (${sizeStr}${ctInfo})`;
    lines.push(bodyLabel);

    const MAX_PREVIEW_LENGTH = 2000;
    const bodyStr = request.responseBody.toString("utf-8");
    const preview =
      bodyStr.length > MAX_PREVIEW_LENGTH ? bodyStr.slice(0, MAX_PREVIEW_LENGTH) + "..." : bodyStr;
    // Indent each line of the body preview
    for (const line of preview.split("\n")) {
      lines.push(`    ${line}`);
    }
    if (request.responseBodyTruncated) {
      lines.push(`    ${colour ? DIM : ""}(body truncated at capture time)${colour ? RESET : ""}`);
    }
  }

  return lines.join("\n");
}

/**
 * Mask an authorisation header value, showing only the scheme.
 */
function maskAuthValue(value: string): string {
  const spaceIdx = value.indexOf(" ");
  if (spaceIdx > 0) {
    return value.slice(0, spaceIdx) + " ***";
  }
  return "***";
}

/**
 * Format a session list as a table.
 */
export function formatSessionTable(sessions: Session[]): string {
  const colour = useColour();
  const lines: string[] = [];

  const header = `  ${"ID".padEnd(38)}  ${"Label".padEnd(20)}  ${"PID".padEnd(8)}  Started`;
  lines.push(colour ? `${DIM}${header}${RESET}` : header);

  for (const session of sessions) {
    const label = session.label ?? "-";
    const startedAt = new Date(session.startedAt).toLocaleString();
    lines.push(
      `  ${session.id.padEnd(38)}  ${label.padEnd(20)}  ${String(session.pid).padEnd(8)}  ${startedAt}`
    );
  }

  lines.push("");
  lines.push(`  ${sessions.length} session${sessions.length === 1 ? "" : "s"}`);

  return lines.join("\n");
}

/**
 * Format interceptor events as a table.
 */
export function formatInterceptorEventTable(events: InterceptorEvent[]): string {
  const colour = useColour();
  const lines: string[] = [];

  for (const event of events) {
    const time = new Date(event.timestamp).toLocaleTimeString();
    const levelColour =
      colour && event.level === "error" ? RED : colour && event.level === "warn" ? YELLOW : "";
    const resetStr = levelColour ? RESET : "";
    const level = `${levelColour}${event.level.toUpperCase().padEnd(5)}${resetStr}`;
    const interceptor = event.interceptor.padEnd(24);
    const message = event.message;

    lines.push(`  ${time}  ${level}  ${interceptor}  ${message}`);
  }

  return lines.join("\n");
}
