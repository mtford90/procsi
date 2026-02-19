/**
 * Shared constants used across daemon, CLI, and overrides.
 */

/** Internal header carrying the procsi session ID (injected by runtime overrides). */
export const PROCSI_SESSION_ID_HEADER = "x-procsi-internal-session-id";

/** Internal header carrying the procsi session token (injected by runtime overrides). */
export const PROCSI_SESSION_TOKEN_HEADER = "x-procsi-internal-session-token";

/** Internal header carrying a best-effort runtime source hint (e.g. "node"). */
export const PROCSI_RUNTIME_SOURCE_HEADER = "x-procsi-internal-runtime";

/** Internal header used to correlate daemon-initiated replay requests. */
export const PROCSI_REPLAY_TOKEN_HEADER = "x-procsi-internal-replay-token";
