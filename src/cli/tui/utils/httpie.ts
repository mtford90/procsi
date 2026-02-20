/**
 * Generate HTTPie commands from captured requests.
 */

import type { CapturedRequest } from "../../../shared/types.js";
import { EXCLUDED_HEADERS } from "./export-shared.js";
import { isJsonContent } from "./content-type.js";

/**
 * Escape a string for use in a shell single-quoted context.
 * Same approach as curl: end the quote, insert an escaped single quote, reopen.
 * Null bytes are stripped to prevent shell truncation.
 */
function shellEscape(str: string): string {
  return str.replace(/\0/g, "").replace(/'/g, "'\"'\"'");
}

/**
 * Generate an HTTPie command from a captured request.
 */
export function generateHttpie(request: CapturedRequest): string {
  const parts: string[] = ["http"];

  // HTTPie uses the method as the first argument (defaults to GET without body, POST with body)
  // Always include the method for clarity
  parts.push(request.method);

  // Add URL
  parts.push(`'${shellEscape(request.url)}'`);

  // Add headers using Name:Value syntax
  for (const [name, value] of Object.entries(request.requestHeaders)) {
    if (EXCLUDED_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    parts.push(`'${shellEscape(name)}:${shellEscape(value)}'`);
  }

  // Add body if present and method is not GET/HEAD
  if (
    request.requestBody &&
    request.requestBody.length > 0 &&
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    const bodyStr = request.requestBody.toString("utf-8");
    const contentType = request.requestHeaders["content-type"];

    if (isJsonContent(contentType)) {
      try {
        const parsed = JSON.parse(bodyStr) as unknown;

        // Only use key=value / key:=value syntax for flat objects
        if (parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)) {
          const entries = Object.entries(parsed);
          const allFlat = entries.every(
            ([, v]) =>
              typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null
          );

          if (allFlat) {
            for (const [key, val] of entries) {
              if (typeof val === "string") {
                // key=value for strings
                parts.push(`'${shellEscape(key)}=${shellEscape(val)}'`);
              } else {
                // key:=value for non-strings (numbers, booleans, null)
                parts.push(`'${shellEscape(key)}:=${JSON.stringify(val)}'`);
              }
            }
          } else {
            // Non-flat object — use --raw
            parts.push(`--raw='${shellEscape(bodyStr)}'`);
          }
        } else {
          // Non-object JSON (array, primitive) — use --raw
          parts.push(`--raw='${shellEscape(bodyStr)}'`);
        }
      } catch {
        // Invalid JSON — use --raw
        parts.push(`--raw='${shellEscape(bodyStr)}'`);
      }
    } else {
      parts.push(`--raw='${shellEscape(bodyStr)}'`);
    }
  }

  return parts.join(" \\\n  ");
}
