/**
 * Generate JavaScript fetch() calls from captured requests.
 */

import type { CapturedRequest } from "../../../shared/types.js";
import { EXCLUDED_HEADERS } from "./export-shared.js";
import { isJsonContent } from "./content-type.js";

/**
 * Escape a string for use inside a JavaScript single-quoted string literal.
 * Null bytes are stripped to prevent truncation issues in some runtimes.
 */
function jsStringEscape(str: string): string {
  return str
    .replace(/\0/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Indent each line of a multi-line string by the given number of spaces.
 */
function indentBlock(text: string, spaces: number): string {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? line : `${pad}${line}`))
    .join("\n");
}

/**
 * Generate a JavaScript fetch() call from a captured request.
 */
export function generateFetch(request: CapturedRequest): string {
  const options: string[] = [];

  // Only include method if not GET (fetch defaults to GET)
  if (request.method !== "GET") {
    options.push(`  method: '${request.method}'`);
  }

  // Collect headers (excluding automatic ones)
  const headers: string[] = [];
  for (const [name, value] of Object.entries(request.requestHeaders)) {
    if (EXCLUDED_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    headers.push(`    '${jsStringEscape(name)}': '${jsStringEscape(value)}'`);
  }

  if (headers.length > 0) {
    options.push(`  headers: {\n${headers.join(",\n")}\n  }`);
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
        // Parse and re-stringify to get a clean representation
        const parsed = JSON.parse(bodyStr) as unknown;
        options.push(`  body: JSON.stringify(${indentBlock(JSON.stringify(parsed, null, 2), 2)})`);
      } catch {
        // Invalid JSON — use as raw string
        options.push(`  body: '${jsStringEscape(bodyStr)}'`);
      }
    } else {
      options.push(`  body: '${jsStringEscape(bodyStr)}'`);
    }
  }

  const url = `'${jsStringEscape(request.url)}'`;

  if (options.length === 0) {
    return `await fetch(${url});`;
  }

  return `await fetch(${url}, {\n${options.join(",\n")}\n});`;
}
