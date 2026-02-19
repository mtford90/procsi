import type { BodySearchTarget } from "./types.js";

const BODY_SCOPE_PREFIX = "body:";

export const BODY_SEARCH_TARGETS = ["request", "response", "both"] as const;

export interface ParsedBodyScopeInput {
  query: string;
  target: BodySearchTarget;
}

/**
 * Parse a body search target value.
 *
 * Supports full names and TUI-friendly aliases:
 * - request | req
 * - response | res
 * - both
 */
export function parseBodySearchTarget(input: string): BodySearchTarget | undefined {
  const normalised = input.trim().toLowerCase();

  switch (normalised) {
    case "request":
    case "req":
      return "request";
    case "response":
    case "res":
      return "response";
    case "both":
      return "both";
    default:
      return undefined;
  }
}

/**
 * Parse TUI body-scope prefixes from filter-bar search text.
 *
 * Accepted forms:
 * - body:foo
 * - body:req:foo
 * - body:request:foo
 * - body:res:foo
 * - body:response:foo
 * - body:both:foo
 */
export function parseBodyScopeInput(input: string): ParsedBodyScopeInput | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;

  const lower = trimmed.toLowerCase();
  if (!lower.startsWith(BODY_SCOPE_PREFIX)) {
    return undefined;
  }

  const rest = trimmed.slice(BODY_SCOPE_PREFIX.length).trim();
  if (!rest) {
    return undefined;
  }

  const firstColon = rest.indexOf(":");
  if (firstColon === -1) {
    return { query: rest, target: "both" };
  }

  const maybeTarget = rest.slice(0, firstColon).trim();
  const target = parseBodySearchTarget(maybeTarget);

  if (!target) {
    return { query: rest, target: "both" };
  }

  const query = rest.slice(firstColon + 1).trim();
  if (!query) {
    return undefined;
  }

  return { query, target };
}
