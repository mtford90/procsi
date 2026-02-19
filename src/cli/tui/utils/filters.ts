import type { RequestFilter } from "../../../shared/types.js";

/**
 * Check whether a filter has any active conditions.
 */
export function isFilterActive(filter: RequestFilter): boolean {
  return (
    (filter.methods !== undefined && filter.methods.length > 0) ||
    filter.statusRange !== undefined ||
    (filter.search !== undefined && filter.search.length > 0) ||
    (filter.regex !== undefined && filter.regex.length > 0) ||
    filter.host !== undefined ||
    filter.pathPrefix !== undefined ||
    filter.since !== undefined ||
    filter.before !== undefined ||
    filter.saved !== undefined ||
    filter.source !== undefined
  );
}
