/**
 * Helpers for parsing and validating regex-based URL filters.
 */

import safe from "safe-regex2";

const REGEX_LITERAL_PATTERN = /^\/((?:\\.|[^\\/])*)\/([dgimsuvy]*)$/;
const VALID_REGEX_FLAGS = new Set(["d", "g", "i", "m", "s", "u", "v", "y"]);

export interface RegexFilterSpec {
  pattern: string;
  flags: string;
}

export interface ParsedUrlSearchInput {
  search?: string;
  regex?: RegexFilterSpec;
}

function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function validateRegexFlags(flags: string): void {
  const seen = new Set<string>();

  for (const flag of flags) {
    if (!VALID_REGEX_FLAGS.has(flag)) {
      throw new Error(`Unsupported regex flag "${flag}".`);
    }

    if (seen.has(flag)) {
      throw new Error(`Duplicate regex flag "${flag}".`);
    }

    seen.add(flag);
  }
}

/**
 * Validate a regex pattern and flags, throwing a descriptive error on failure.
 */
export function validateRegexFilter(pattern: string, flags = ""): RegexFilterSpec {
  validateRegexFlags(flags);

  let compiled: RegExp;
  try {
    // Validate by constructing a RegExp instance.
    compiled = new RegExp(pattern, flags);
  } catch (err) {
    throw new Error(`Invalid regex pattern "${pattern}": ${getErrorMessage(err)}`);
  }

  if (!safe(compiled)) {
    throw new Error(
      `Regex pattern "${pattern}" is rejected: potential catastrophic backtracking. Simplify the pattern.`
    );
  }

  return { pattern, flags };
}

/**
 * Parse a slash-delimited regex literal (`/pattern/flags`).
 * Returns undefined when the input is not a regex literal.
 * Throws when literal syntax is present but invalid.
 */
export function parseRegexLiteral(input: string): RegexFilterSpec | undefined {
  const match = input.match(REGEX_LITERAL_PATTERN);
  if (!match) return undefined;

  const pattern = match[1] ?? "";
  const flags = match[2] ?? "";

  return validateRegexFilter(pattern, flags);
}

/**
 * Parse TUI/CLI URL search input.
 * - `/.../flags` => regex mode
 * - otherwise => plain text search
 */
export function parseUrlSearchInput(input: string): ParsedUrlSearchInput {
  const trimmed = input.trim();
  if (!trimmed) {
    return {};
  }

  const parsedRegex = parseRegexLiteral(trimmed);
  if (parsedRegex) {
    return { regex: parsedRegex };
  }

  return { search: trimmed };
}

/**
 * Normalise regex filter input from external callers.
 *
 * - If flags are provided, treat `regex` as the raw pattern.
 * - If flags are omitted, accept either a raw pattern or `/pattern/flags` literal.
 */
export function normaliseRegexFilterInput(regex: string, flags?: string): RegexFilterSpec {
  const providedFlags = flags ?? "";

  if (providedFlags.length > 0) {
    return validateRegexFilter(regex, providedFlags);
  }

  const literal = parseRegexLiteral(regex);
  if (literal) {
    return literal;
  }

  return validateRegexFilter(regex, "");
}
