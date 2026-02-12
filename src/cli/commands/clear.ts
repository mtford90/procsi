import { Command } from "commander";
import { getProcsiPaths } from "../../shared/project.js";
import { isDaemonRunning } from "../../shared/daemon.js";
import { ControlClient } from "../../shared/control-client.js";
import { requireProjectRoot, getErrorMessage, getGlobalOptions } from "./helpers.js";

export const clearCommand = new Command("clear")
  .description("Clear all captured requests")
  .action(async (_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);
    const paths = getProcsiPaths(projectRoot);

    const running = await isDaemonRunning(projectRoot);
    if (!running) {
      console.log("Daemon is not running");
      process.exit(1);
    }

    const client = new ControlClient(paths.controlSocketFile);
    try {
      await client.clearRequests();
      console.log("Requests cleared");
    } catch (err) {
      console.error(`Error clearing requests: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });
