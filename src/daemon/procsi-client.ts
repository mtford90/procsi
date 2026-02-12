import type { RequestRepository } from "./storage.js";
import type { ProcsiClient } from "../shared/types.js";

/**
 * Create an in-process ProcsiClient that wraps RequestRepository directly.
 * Used by interceptors running inside the daemon process.
 */
export function createProcsiClient(storage: RequestRepository): ProcsiClient {
  return {
    countRequests: async (filter) => storage.countRequests({ filter }),
    listRequests: async (options) =>
      storage.listRequestsSummary({
        filter: options?.filter,
        limit: options?.limit,
        offset: options?.offset,
      }),
    getRequest: async (id) => storage.getRequest(id) ?? null,
    searchBodies: async (options) =>
      storage.searchBodies({
        query: options.query,
        filter: options.filter,
        limit: options.limit,
      }),
    queryJsonBodies: async (options) =>
      storage.queryJsonBodies({
        jsonPath: options.jsonPath,
        filter: options.filter,
      }),
  };
}
