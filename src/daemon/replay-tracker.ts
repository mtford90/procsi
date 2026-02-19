import type { ReplayInitiator } from "../shared/types.js";

const REPLAY_TOKEN_TTL_MS = 60_000;
const REPLAY_TRACKER_CLEANUP_INTERVAL_MS = 30_000;
const REPLAY_TRACKER_MAX_ENTRIES = 1000;

interface PendingReplay {
  replayedFromId: string;
  replayInitiator: ReplayInitiator;
  createdAt: number;
}

export interface ReplayTracker {
  register(token: string, replayedFromId: string, replayInitiator: ReplayInitiator): void;
  consume(token: string): { replayedFromId: string; replayInitiator: ReplayInitiator } | undefined;
  close(): void;
}

export function createReplayTracker(): ReplayTracker {
  const pending = new Map<string, PendingReplay>();

  function cleanupExpired(): void {
    const now = Date.now();
    for (const [token, replay] of pending) {
      if (now - replay.createdAt > REPLAY_TOKEN_TTL_MS) {
        pending.delete(token);
      }
    }
  }

  const cleanupTimer = setInterval(cleanupExpired, REPLAY_TRACKER_CLEANUP_INTERVAL_MS);

  return {
    register(token: string, replayedFromId: string, replayInitiator: ReplayInitiator): void {
      cleanupExpired();

      if (pending.size >= REPLAY_TRACKER_MAX_ENTRIES) {
        const oldestKey = pending.keys().next().value;
        if (typeof oldestKey === "string") {
          pending.delete(oldestKey);
        }
      }

      pending.set(token, {
        replayedFromId,
        replayInitiator,
        createdAt: Date.now(),
      });
    },

    consume(
      token: string
    ): { replayedFromId: string; replayInitiator: ReplayInitiator } | undefined {
      const replay = pending.get(token);
      if (!replay) {
        return undefined;
      }

      pending.delete(token);
      return {
        replayedFromId: replay.replayedFromId,
        replayInitiator: replay.replayInitiator,
      };
    },

    close(): void {
      clearInterval(cleanupTimer);
      pending.clear();
    },
  };
}
