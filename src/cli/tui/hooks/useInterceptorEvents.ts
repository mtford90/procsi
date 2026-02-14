/**
 * Hook for polling interceptor runtime events from the daemon.
 * Follows the same ControlClient pattern as useRequests.
 */

import { useState, useEffect, useCallback, useRef } from "react";
import type { InterceptorEvent } from "../../../shared/types.js";
import { ControlClient } from "../../../shared/control-client.js";
import { findProjectRoot, getProcsiPaths } from "../../../shared/project.js";

const DEFAULT_POLL_INTERVAL_MS = 2000;

interface UseInterceptorEventsOptions {
  projectRoot?: string;
  pollInterval?: number;
}

interface InterceptorEventCounts {
  info: number;
  warn: number;
  error: number;
}

interface UseInterceptorEventsResult {
  /** All accumulated interceptor events, ordered by seq. */
  events: InterceptorEvent[];
  /** Aggregate counts by level across all events. */
  counts: InterceptorEventCounts;
  /** Total event count across all levels. */
  totalEventCount: number;
  /** Number of currently loaded interceptors. */
  interceptorCount: number;
  /** Force a full re-fetch (resets lastSeenSeq). */
  refresh: () => void;
}

const EMPTY_COUNTS: InterceptorEventCounts = { info: 0, warn: 0, error: 0 };

/**
 * Hook to poll for interceptor events from the daemon.
 * Accumulates events using delta fetching via afterSeq.
 */
export function useInterceptorEvents(
  options: UseInterceptorEventsOptions = {}
): UseInterceptorEventsResult {
  const { pollInterval = DEFAULT_POLL_INTERVAL_MS, projectRoot } = options;

  const [events, setEvents] = useState<InterceptorEvent[]>([]);
  const [counts, setCounts] = useState<InterceptorEventCounts>(EMPTY_COUNTS);
  const [interceptorCount, setInterceptorCount] = useState(0);

  const clientRef = useRef<ControlClient | null>(null);
  const lastSeenSeqRef = useRef<number>(0);

  // Initialise control client
  useEffect(() => {
    const resolvedRoot = projectRoot ?? findProjectRoot();
    if (!resolvedRoot) {
      return;
    }
    const paths = getProcsiPaths(resolvedRoot);
    clientRef.current = new ControlClient(paths.controlSocketFile);

    return () => {
      clientRef.current?.close();
    };
  }, [projectRoot]);

  // Fetch new events since lastSeenSeq
  const fetchEvents = useCallback(async () => {
    const client = clientRef.current;
    if (!client) {
      return;
    }

    try {
      const [result, status] = await Promise.all([
        client.getInterceptorEvents({
          afterSeq: lastSeenSeqRef.current,
        }),
        client.status(),
      ]);

      if (result.events.length > 0) {
        // Update lastSeenSeq to the highest seq we've seen
        const lastEvent = result.events[result.events.length - 1];
        if (lastEvent) {
          lastSeenSeqRef.current = lastEvent.seq;
        }

        setEvents((prev) => [...prev, ...result.events]);
      }

      setCounts(result.counts);
      setInterceptorCount(status.interceptorCount ?? 0);
    } catch {
      // Daemon may not be running or may not support interceptor events yet
    }
  }, []);

  // Full refresh: reset accumulated state and re-fetch everything
  const refresh = useCallback(() => {
    lastSeenSeqRef.current = 0;
    setEvents([]);
    setCounts(EMPTY_COUNTS);
    void fetchEvents();
  }, [fetchEvents]);

  // Initial fetch
  useEffect(() => {
    void fetchEvents();
  }, [fetchEvents]);

  // Polling
  useEffect(() => {
    const interval = setInterval(() => {
      void fetchEvents();
    }, pollInterval);

    return () => clearInterval(interval);
  }, [fetchEvents, pollInterval]);

  const totalEventCount = counts.info + counts.warn + counts.error;

  return {
    events,
    counts,
    totalEventCount,
    interceptorCount,
    refresh,
  };
}
