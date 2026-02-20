/**
 * Generate Python requests library calls from captured requests.
 */

import type { CapturedRequest } from "../../../shared/types.js";
import { EXCLUDED_HEADERS } from "./export-shared.js";
import { isJsonContent } from "./content-type.js";

/**
 * Escape a string for use inside a Python single-quoted string literal.
 * Null bytes are stripped to prevent interpreter issues.
 */
export function escapePythonString(str: string): string {
  return str
    .replace(/\0/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/'/g, "\\'")
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Convert a JavaScript value to its Python repr equivalent.
 * Handles strings, numbers, booleans, null, arrays, and objects.
 */
export function pythonRepr(value: unknown): string {
  if (value === null || value === undefined) {
    return "None";
  }
  if (value === true) {
    return "True";
  }
  if (value === false) {
    return "False";
  }
  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "string") {
    return `'${escapePythonString(value)}'`;
  }
  if (Array.isArray(value)) {
    const items = value.map((item) => pythonRepr(item));
    return `[${items.join(", ")}]`;
  }
  if (typeof value === "object") {
    const entries = Object.entries(value);
    const pairs = entries.map(([k, v]) => `${pythonRepr(k)}: ${pythonRepr(v)}`);
    return `{${pairs.join(", ")}}`;
  }
  return String(value);
}

/**
 * Generate a Python requests call from a captured request.
 */
export function generatePythonRequests(request: CapturedRequest): string {
  const lines: string[] = ["import requests", ""];

  const method = request.method.toLowerCase();
  const args: string[] = [`'${escapePythonString(request.url)}'`];

  // Collect headers (excluding automatic ones)
  const headers: [string, string][] = [];
  const contentType = request.requestHeaders["content-type"];
  const usingJsonKwarg = isJsonContent(contentType);

  for (const [name, value] of Object.entries(request.requestHeaders)) {
    if (EXCLUDED_HEADERS.has(name.toLowerCase())) {
      continue;
    }
    // When using json= kwarg, requests sets content-type automatically
    if (usingJsonKwarg && name.toLowerCase() === "content-type") {
      continue;
    }
    headers.push([name, value]);
  }

  if (headers.length > 0) {
    const headerPairs = headers
      .map(([k, v]) => `    '${escapePythonString(k)}': '${escapePythonString(v)}'`)
      .join(",\n");
    args.push(`headers={\n${headerPairs}\n}`);
  }

  // Add body if present and method is not GET/HEAD
  if (
    request.requestBody &&
    request.requestBody.length > 0 &&
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
    const bodyStr = request.requestBody.toString("utf-8");

    if (usingJsonKwarg) {
      try {
        const parsed = JSON.parse(bodyStr) as unknown;
        args.push(`json=${pythonRepr(parsed)}`);
      } catch {
        // Invalid JSON — fall back to data kwarg
        args.push(`data='${escapePythonString(bodyStr)}'`);
      }
    } else {
      args.push(`data='${escapePythonString(bodyStr)}'`);
    }
  }

  const argsStr = args.length === 1 ? args[0] : `\n    ${args.join(",\n    ")}\n`;

  lines.push(`response = requests.${method}(${argsStr})`);

  return lines.join("\n");
}
