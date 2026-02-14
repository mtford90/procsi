/**
 * Shared ANSI colour constants and helpers for CLI formatters.
 * Centralised to prevent duplication and ensure consistent NO_COLOR handling.
 */

export const GREEN = "\x1b[32m";
export const YELLOW = "\x1b[33m";
export const RED = "\x1b[31m";
export const CYAN = "\x1b[36m";
export const BOLD = "\x1b[1m";
export const DIM = "\x1b[2m";
export const RESET = "\x1b[0m";

/**
 * Whether colour output is enabled.
 * Returns false when NO_COLOR is set or stdout is not a TTY.
 */
export function useColour(): boolean {
  if (process.env["NO_COLOR"] !== undefined) return false;
  if (!process.stdout.isTTY) return false;
  return true;
}
