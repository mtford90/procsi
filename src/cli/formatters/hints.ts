/**
 * Contextual hint rendering for CLI output.
 * Hints are dim lines shown at the bottom of output to guide users
 * to related commands — the "gradual discovery" pattern.
 *
 * Only shown when stdout is a TTY and --json is not active.
 */

import { DIM, RESET } from "./colour.js";

/**
 * Whether hints should be displayed.
 * Suppressed when stdout is piped or NO_COLOR is set.
 */
export function shouldShowHints(): boolean {
  if (!process.stdout.isTTY) return false;
  if (process.env["NO_COLOR"] !== undefined) return false;
  return true;
}

/**
 * Render a hint line. Joins segments with " │ " separator and dims the output.
 */
export function formatHint(segments: string[]): string {
  if (!shouldShowHints()) return "";
  const joined = segments.join(" │ ");
  return `${DIM}  Hint: ${joined}${RESET}`;
}
