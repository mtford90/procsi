/**
 * Tabular request list formatter for CLI output.
 * Renders summaries as a compact table with short IDs, colour-coded
 * statuses, and interception indicators.
 */

import type { CapturedRequestSummary, InterceptionType } from "../../shared/types.js";
import {
  formatDuration,
  formatSize,
  truncate,
  padRight,
  padLeft,
} from "../tui/utils/formatters.js";
import { GREEN, YELLOW, RED, CYAN, DIM, RESET, useColour } from "./colour.js";

/** Length of abbreviated IDs shown in list views. */
export const SHORT_ID_LENGTH = 7;

/**
 * Colour a status code: green for 2xx, yellow for 3xx, red for 4xx/5xx.
 */
function colourStatus(status: number | undefined): string {
  if (status === undefined) return padLeft("...", 5);

  const str = String(status);
  if (!useColour()) return padLeft(str, 5);

  if (status >= 200 && status < 300)
    return padLeft(`${GREEN}${str}${RESET}`, 5 + GREEN.length + RESET.length);
  if (status >= 300 && status < 400)
    return padLeft(`${YELLOW}${str}${RESET}`, 5 + YELLOW.length + RESET.length);
  if (status >= 400) return padLeft(`${RED}${str}${RESET}`, 5 + RED.length + RESET.length);
  return padLeft(str, 5);
}

/**
 * Render an interception indicator: [M] for mocked, [I] for modified.
 */
function interceptionIndicator(type: InterceptionType | undefined): string {
  if (!type) return "   ";
  const colour = useColour();
  if (type === "mocked") return colour ? `${CYAN}[M]${RESET}` : "[M]";
  if (type === "modified") return colour ? `${YELLOW}[I]${RESET}` : "[I]";
  return "   ";
}

/**
 * Render a saved/bookmark indicator: [S] for saved requests.
 */
function savedIndicator(saved: boolean | undefined): string {
  if (!saved) return "   ";
  const colour = useColour();
  return colour ? `${YELLOW}[S]${RESET}` : "[S]";
}

/**
 * Render a replay indicator: [R] for replayed requests.
 */
function replayIndicator(replayedFromId: string | undefined): string {
  if (!replayedFromId) return "   ";
  const colour = useColour();
  return colour ? `${CYAN}[R]${RESET}` : "[R]";
}

export interface TableOptions {
  /** Maximum URL column width. Defaults to 50. */
  urlWidth?: number;
}

/**
 * Format a list of request summaries as a table string.
 */
export function formatRequestTable(
  summaries: CapturedRequestSummary[],
  total: number,
  options?: TableOptions
): string {
  const urlWidth = options?.urlWidth ?? 50;
  const colour = useColour();
  const lines: string[] = [];

  // Header
  const header =
    `  ${padRight("ID", SHORT_ID_LENGTH)}  ${padRight("Method", 7)}  ` +
    `${padLeft("Status", 6)}  ${padRight("URL", urlWidth)}  ` +
    `${padLeft("Duration", 10)}  ${padLeft("Size", 8)}`;
  lines.push(colour ? `${DIM}${header}${RESET}` : header);

  // Rows
  for (const req of summaries) {
    const shortId = req.id.slice(0, SHORT_ID_LENGTH);
    const method = padRight(req.method.toUpperCase(), 7);
    const status = colourStatus(req.responseStatus);
    const url = truncate(req.path, urlWidth);
    const paddedUrl = padRight(url, urlWidth);
    const duration = padLeft(formatDuration(req.durationMs), 10);
    const size = padLeft(formatSize(req.responseBodySize || undefined), 8);
    const indicator = interceptionIndicator(req.interceptionType);
    const saved = savedIndicator(req.saved);
    const replay = replayIndicator(req.replayedFromId);

    lines.push(
      `  ${shortId}  ${method}  ${status}  ${paddedUrl}  ${duration}  ${size} ${indicator}${saved}${replay}`
    );
  }

  // Summary line
  lines.push("");
  const showing = summaries.length;
  if (showing < total) {
    lines.push(`  Showing ${showing} of ${total} requests`);
  } else {
    lines.push(`  Showing ${showing} request${showing === 1 ? "" : "s"}`);
  }

  return lines.join("\n");
}
