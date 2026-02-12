import { Command } from "commander";
import { findProjectRoot } from "../../shared/project.js";

export interface GlobalOptions {
  verbose: number;
  dir?: string;
}

/**
 * Validate and extract global CLI options from a Commander command.
 */
export function getGlobalOptions(command: Command): GlobalOptions {
  const raw = command.optsWithGlobals() as Record<string, unknown>;
  return {
    verbose: typeof raw["verbose"] === "number" ? raw["verbose"] : 0,
    dir: typeof raw["dir"] === "string" ? raw["dir"] : undefined,
  };
}

/**
 * Find the project root or exit with a friendly error message.
 */
export function requireProjectRoot(override?: string): string {
  const projectRoot = findProjectRoot(undefined, override);
  if (!projectRoot) {
    if (override) {
      console.error(`No .procsi or .git found at ${override} (specified via --dir)`);
    } else {
      console.error("Not in a project directory (no .procsi or .git found)");
    }
    process.exit(1);
  }
  return projectRoot;
}

/**
 * Extract a human-readable message from an unknown error value.
 */
export function getErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Unknown error";
}
