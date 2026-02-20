/**
 * Shared constants for export format generators.
 */

/**
 * Headers that should be excluded from export output.
 * These are typically set automatically by the HTTP client or are connection-specific.
 */
export const EXCLUDED_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "accept-encoding",
  "transfer-encoding",
]);
