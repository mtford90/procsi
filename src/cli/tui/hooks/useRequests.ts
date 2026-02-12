/**
 * Hook for fetching and polling captured requests from the daemon.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type {
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
}

/**
 * Hook to fetch and poll for captured requests.
 */
export function useRequests(options: UseRequestsOptions = {}): UseRequestsResult {
  const { pollInterval = DEFAULT_POLL_INTERVAL_MS, filter, projectRoot } = options;

  const [requests, setRequests] = useState<CapturedRequestSummary[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const clientRef = useRef<ControlClient | null>(null);
  const lastCountRef = useRef<number>(0);
  const requestsLengthRef = useRef<number>(0);
  const filterRef = useRef<RequestFilter | undefined>(filter);

  // Initialise control client
  useEffect(() => {
    const resolvedRoot = projectRoot ?? findProjectRoot();
    if (!resolvedRoot) {
      setError("Not in an procsi project. Run 'procsi init' first.");
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

    try {
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

      setError(null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to connect to daemon";
      if (message.includes("ENOENT") || message.includes("ECONNREFUSED")) {
        setError("Daemon not running. Start with 'eval $(procsi vars)'.");
      } else {
        setError(message);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Keep filter ref in sync and fetch immediately when filter changes
  useEffect(() => {
    filterRef.current = filter;
    lastCountRef.current = 0;
    void fetchRequests();
  }, [filter, fetchRequests]);

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
  };
}
