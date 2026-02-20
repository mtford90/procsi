/**
 * Generate curl commands from captured requests.
 */

import type { CapturedRequest } from "../../../shared/types.js";
import { EXCLUDED_HEADERS } from "./export-shared.js";

/**
 * Escape a string for use in a shell single-quoted context.
 *
 * Within single quotes, the shell does not interpret any special characters
 * (`$`, `` ` ``, `\`, `!`, newlines, etc.) — the only character that cannot
 * appear inside single quotes is the single quote itself. We handle that by
 * ending the quote, inserting an escaped single quote, and reopening.
 *
 * Null bytes are stripped because some shells (e.g. bash) silently truncate
 * strings at `\0`, which could cause the remainder of a value to be lost.
 */
function shellEscape(str: string): string {
  return str.replace(/\0/g, "").replace(/'/g, "'\"'\"'");
}

/**
 * Generate a curl command from a captured request.
 */
export function generateCurl(request: CapturedRequest): string {
  const parts: string[] = ["curl"];

  // Add method if not GET
  if (request.method !== "GET") {
    parts.push(`-X ${request.method}`);
  }

  // Add URL
  parts.push(`'${shellEscape(request.url)}'`);

  // Add headers (excluding certain automatic ones)
  for (const [name, value] of Object.entries(request.requestHeaders)) {
    if (EXCLUDED_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    parts.push(`-H '${shellEscape(name)}: ${shellEscape(value)}'`);
  }

  // Add body if present and method supports it
  if (
    request.requestBody &&
    request.requestBody.length > 0 &&
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    const bodyStr = request.requestBody.toString("utf-8");
    parts.push(`-d '${shellEscape(bodyStr)}'`);
  }

  return parts.join(" \\\n  ");
}
