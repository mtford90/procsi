/**
 * Content-type detection utilities.
 */

/**
 * Check whether a content-type string indicates JSON content.
 */
export function isJsonContent(contentType: string | undefined): boolean {
  return !!(contentType?.includes("application/json") || contentType?.includes("+json"));
}
