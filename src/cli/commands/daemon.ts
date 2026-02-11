import { Command } from "commander";
import {
  isDaemonRunning,
  stopDaemon,
  restartDaemon,
  startDaemon,
  getDaemonVersion,
} from "../../shared/daemon.js";
import { parseVerbosity } from "../../shared/logger.js";
import { getHtpxVersion } from "../../shared/version.js";
import { requireProjectRoot, getErrorMessage, getGlobalOptions } from "./helpers.js";

const stopSubCommand = new Command("stop")
  .description("Stop the daemon")
  .action(async (_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);

    // Check if daemon is running
    const running = await isDaemonRunning(projectRoot);
    if (!running) {
      console.log("Daemon is not running");
      process.exit(0);
    }

    try {
      await stopDaemon(projectRoot);
      console.log("Daemon stopped");
    } catch (err) {
      console.error(`Error stopping daemon: ${getErrorMessage(err)}`);
      process.exit(1);
    }
  });

const restartSubCommand = new Command("restart")
  .description("Restart the daemon")
  .action(async (_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const verbosity = globalOpts.verbose;
    const logLevel = parseVerbosity(verbosity);

    const projectRoot = requireProjectRoot(globalOpts.dir);

    try {
      const cliVersion = getHtpxVersion();

      if (await isDaemonRunning(projectRoot)) {
        const daemonVersion = await getDaemonVersion(projectRoot);
        const versionInfo =
          daemonVersion && daemonVersion !== cliVersion
            ? ` (${daemonVersion} -> ${cliVersion})`
            : "";

        console.log(`Restarting daemon${versionInfo}...`);
        const port = await restartDaemon(projectRoot, logLevel);
        console.log(`Daemon restarted on port ${port}`);
      } else {
        console.log("Daemon not running, starting...");
        const port = await startDaemon(projectRoot, { logLevel });
        console.log(`Daemon started on port ${port}`);
      }
    } catch (err) {
      console.error(`Failed to restart daemon: ${getErrorMessage(err)}`);
      process.exit(1);
    }
  });

export const daemonCommand = new Command("daemon")
  .description("Manage the htpx daemon")
  .addCommand(stopSubCommand)
  .addCommand(restartSubCommand);
