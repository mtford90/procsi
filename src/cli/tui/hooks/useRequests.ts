/**
 * Hook for fetching and polling captured requests from the daemon.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type {
  BodySearchOptions,
  CapturedRequest,
  CapturedRequestSummary,
  RequestFilter,
} from "../../../shared/types.js";
import { ControlClient } from "../../../shared/control-client.js";
import { findProjectRoot, getProcsiPaths } from "../../../shared/project.js";

const DEFAULT_QUERY_LIMIT = 1000;
const DEFAULT_POLL_INTERVAL_MS = 2000;

interface UseRequestsOptions {
  pollInterval?: number;
  filter?: RequestFilter;
  bodySearch?: BodySearchOptions;
  projectRoot?: string;
}

interface UseRequestsResult {
  /** Request summaries for list display (excludes body/header data) */
  requests: CapturedRequestSummary[];
  isLoading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
  /** Fetch full request data including body/headers */
  getFullRequest: (id: string) => Promise<CapturedRequest | null>;
  /** Fetch all requests with full data (for exports) */
  getAllFullRequests: () => Promise<CapturedRequest[]>;
  /** Replay a captured request by ID. Returns the new replayed request ID on success. */
  replayRequest?: (id: string) => Promise<string | null>;
  /** Toggle the saved/bookmark state of a request */
  toggleSaved: (id: string, currentlySaved: boolean) => Promise<boolean>;
  /** Clear all unsaved requests */
  clearRequests: () => Promise<boolean>;
}

/**
 * Hook to fetch and poll for captured requests.
 */
export function useRequests(options: UseRequestsOptions = {}): UseRequestsResult {
  const { pollInterval = DEFAULT_POLL_INTERVAL_MS, filter, bodySearch, projectRoot } = options;

  const [requests, setRequests] = useState<CapturedRequestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<ControlClient | null>(null);
  const lastCountRef = useRef<number>(0);
  const requestsLengthRef = useRef<number>(0);
  const filterRef = useRef<RequestFilter | undefined>(filter);
  const bodySearchRef = useRef<BodySearchOptions | undefined>(bodySearch);

  // Initialise control client
  useEffect(() => {
    const resolvedRoot = projectRoot ?? findProjectRoot();
    if (!resolvedRoot) {
      setError("Not in a procsi project. Run 'eval \"$(procsi on)\"' first.");
      setIsLoading(false);
      return;
    }
    const paths = getProcsiPaths(resolvedRoot);
    clientRef.current = new ControlClient(paths.controlSocketFile);

    return () => {
      clientRef.current?.close();
    };
  }, [projectRoot]);

  // Keep ref in sync with requests length
  useEffect(() => {
    requestsLengthRef.current = requests.length;
  }, [requests.length]);

  // Fetch request summaries from daemon
  const fetchRequests = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }

    const currentFilter = filterRef.current;
    const currentBodySearch = bodySearchRef.current;

    try {
      if (currentBodySearch) {
        const newRequests = await client.searchBodies({
          query: currentBodySearch.query,
          target: currentBodySearch.target,
          limit: DEFAULT_QUERY_LIMIT,
          filter: currentFilter,
        });
        setRequests(newRequests);
        lastCountRef.current = newRequests.length;
      } else {
        // First check the count to avoid unnecessary data transfer
        const count = await client.countRequests({ filter: currentFilter });

        // Only fetch list if count changed or we have no requests yet
        if (count !== lastCountRef.current || requestsLengthRef.current === 0) {
          const newRequests = await client.listRequestsSummary({
            limit: DEFAULT_QUERY_LIMIT,
            filter: currentFilter,
          });
          setRequests(newRequests);
          lastCountRef.current = count;
        }
      }

      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect to daemon";
      if (message.includes("ENOENT") || message.includes("ECONNREFUSED")) {
        setError("Daemon not running. Start with 'eval \"$(procsi on)\"'.");
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Keep refs in sync and fetch immediately when search/filter changes
  useEffect(() => {
    filterRef.current = filter;
    bodySearchRef.current = bodySearch;
    lastCountRef.current = 0;
    void fetchRequests();
  }, [filter, bodySearch, fetchRequests]);

  // Manual refresh function
  const refresh = useCallback(async () => {
    setIsLoading(true);
    lastCountRef.current = 0; // Force full refresh
    await fetchRequests();
  }, [fetchRequests]);

  // Fetch full request data by ID
  const getFullRequest = useCallback(async (id: string): Promise<CapturedRequest | null> => {
    const client = clientRef.current;
    if (!client) {
      return null;
    }
    try {
      return await client.getRequest(id);
    } catch {
      return null;
    }
  }, []);

  // Fetch all requests with full data (for exports like HAR)
  const getAllFullRequests = useCallback(async (): Promise<CapturedRequest[]> => {
    const client = clientRef.current;
    if (!client) {
      return [];
    }
    try {
      return await client.listRequests({ limit: DEFAULT_QUERY_LIMIT });
    } catch {
      return [];
    }
  }, []);

  // Replay request and force refresh
  const replayRequest = useCallback(
    async (id: string): Promise<string | null> => {
      const client = clientRef.current;
      if (!client) {
        throw new Error("Not connected to daemon");
      }

      const replayed = await client.replayRequest({ id, initiator: "tui" });
      lastCountRef.current = 0;
      await fetchRequests();
      return replayed.requestId;
    },
    [fetchRequests]
  );

  // Toggle saved/bookmark state and force refresh
  const toggleSaved = useCallback(
    async (id: string, currentlySaved: boolean): Promise<boolean> => {
      const client = clientRef.current;
      if (!client) return false;
      try {
        const result = currentlySaved
          ? await client.unsaveRequest(id)
          : await client.saveRequest(id);
        if (result.success) {
          lastCountRef.current = 0; // Force full refresh
          await fetchRequests();
        }
        return result.success;
      } catch {
        return false;
      }
    },
    [fetchRequests]
  );

  // Clear all unsaved requests
  const clearRequests = useCallback(async (): Promise<boolean> => {
    const client = clientRef.current;
    if (!client) return false;
    try {
      await client.clearRequests();
      lastCountRef.current = 0;
      await fetchRequests();
      return true;
    } catch {
      return false;
    }
  }, [fetchRequests]);

  // Initial fetch
  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  // Polling
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchRequests();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [fetchRequests, pollInterval]);

  return {
    requests,
    isLoading,
    error,
    refresh,
    getFullRequest,
    getAllFullRequests,
    replayRequest,
    toggleSaved,
    clearRequests,
  };
}
