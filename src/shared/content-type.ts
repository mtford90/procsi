/**
 * Content-type detection and normalisation helpers.
 *
 * Used by both the TUI (binary detection) and daemon (storage layer)
 * to determine whether a MIME type represents text content.
 */

/**
 * Content type prefixes that indicate text content.
 * Entries ending with '/' are prefix matches; others are exact matches.
 */
export const TEXT_CONTENT_TYPES = [
  "text/",
  "application/json",
  "application/xml",
  "application/javascript",
  "application/x-www-form-urlencoded",
  "application/xhtml+xml",
  "application/ld+json",
  "application/manifest+json",
  "application/x-javascript",
] as const;

/**
 * Content type suffixes that indicate text (e.g. application/hal+json).
 */
export const TEXT_SUFFIXES = ["+json", "+xml", "+html", "+text"] as const;

/**
 * Content types that represent JSON data specifically.
 * Used for pretty-printing and structured output.
 */
export const JSON_CONTENT_TYPES = [
  "application/json",
  "application/ld+json",
  "application/manifest+json",
] as const;

export const JSON_SUFFIX = "+json";

/**
 * Check whether a MIME type represents JSON content.
 * Returns `true` for `application/json`, `application/ld+json`, `application/manifest+json`,
 * and any type with a `+json` suffix (e.g. `application/hal+json`, `application/vnd.api+json`).
 * Returns `false` for `undefined`, empty strings, and non-JSON types.
 */
export function isJsonContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;

  const normalised = normaliseContentType(contentType);
  if (!normalised) return false;

  for (const jsonType of JSON_CONTENT_TYPES) {
    if (normalised === jsonType) {
      return true;
    }
  }

  return normalised.endsWith(JSON_SUFFIX);
}

/**
 * Check whether a MIME type represents text content.
 * Returns `true` for types like `application/json`, `text/html`, `application/hal+json`.
 * Returns `false` for `undefined`, empty strings, and binary types like `image/png`.
 */
export function isTextContentType(contentType: string | undefined): boolean {
  if (!contentType) return false;

  const normalised = normaliseContentType(contentType);
  if (!normalised) return false;

  for (const prefix of TEXT_CONTENT_TYPES) {
    if (normalised.startsWith(prefix)) {
      return true;
    }
  }

  for (const suffix of TEXT_SUFFIXES) {
    if (normalised.endsWith(suffix)) {
      return true;
    }
  }

  return false;
}

/**
 * Normalise a raw Content-Type header value for storage/comparison.
 * Strips parameters (charset, boundary, etc.), trims whitespace, and lowercases.
 * Returns `null` for undefined or empty input.
 */
export function normaliseContentType(raw: string | undefined): string | null {
  if (!raw) return null;
  const base = raw.split(";")[0]?.trim().toLowerCase();
  return base || null;
}

/**
 * Build a SQL WHERE clause fragment that matches text-based content types.
 * Uses the same source-of-truth arrays as `isTextContentType`.
 *
 * @param column - The SQL column name to match against (e.g. 'request_content_type')
 * @returns An object with a `clause` string and `params` array for parameterised queries.
 *          The clause includes the `IS NULL` check for unknown content types.
 */
export function buildTextContentTypeSqlCondition(column: string): {
  clause: string;
  params: string[];
} {
  const conditions: string[] = [];
  const params: string[] = [];

  // NULL content type = unknown, might be text — include it
  conditions.push(`${column} IS NULL`);

  for (const entry of TEXT_CONTENT_TYPES) {
    if (entry.endsWith("/")) {
      // Prefix match (e.g. 'text/' matches 'text/html', 'text/plain', etc.)
      conditions.push(`${column} LIKE ?`);
      params.push(`${entry}%`);
    } else {
      // Exact match
      conditions.push(`${column} = ?`);
      params.push(entry);
    }
  }

  for (const suffix of TEXT_SUFFIXES) {
    conditions.push(`${column} LIKE ?`);
    params.push(`%${suffix}`);
  }

  return {
    clause: `(${conditions.join(" OR ")})`,
    params,
  };
}

/**
 * Build a SQL WHERE clause fragment that matches JSON-based content types.
 * Uses the same source-of-truth arrays as `isJsonContentType`.
 *
 * @param column - The SQL column name to match against (e.g. 'request_content_type')
 * @returns An object with a `clause` string and `params` array for parameterised queries.
 */
export function buildJsonContentTypeSqlCondition(column: string): {
  clause: string;
  params: string[];
} {
  const conditions: string[] = [];
  const params: string[] = [];

  for (const jsonType of JSON_CONTENT_TYPES) {
    conditions.push(`${column} = ?`);
    params.push(jsonType);
  }

  // +json suffix (e.g. application/hal+json, application/vnd.api+json)
  conditions.push(`${column} LIKE ?`);
  params.push(`%${JSON_SUFFIX}`);

  return {
    clause: `(${conditions.join(" OR ")})`,
    params,
  };
}
