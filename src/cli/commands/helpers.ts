import { Command } from "commander";
import { findProjectRoot, getProcsiPaths } from "../../shared/project.js";
import { isDaemonRunning } from "../../shared/daemon.js";
import { ControlClient } from "../../shared/control-client.js";

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

/**
 * Connect to the running daemon and return a ControlClient.
 * Exits with error if the daemon is not running.
 */
export async function connectToDaemon(command: Command): Promise<{
  client: ControlClient;
  projectRoot: string;
}> {
  const globalOpts = getGlobalOptions(command);
  const projectRoot = requireProjectRoot(globalOpts.dir);
  const paths = getProcsiPaths(projectRoot);

  const running = await isDaemonRunning(projectRoot);
  if (!running) {
    console.error("Daemon is not running. Start it with: procsi on");
    process.exit(1);
  }

  const client = new ControlClient(paths.controlSocketFile);
  return { client, projectRoot };
}
