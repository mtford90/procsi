import { Command } from "commander";
import { getHtpxPaths } from "../../shared/project.js";
import { isDaemonRunning } from "../../shared/daemon.js";
import { ControlClient } from "../../shared/control-client.js";
import { buildProxyInfo } from "../../shared/proxy-info.js";
import { requireProjectRoot, getErrorMessage, getGlobalOptions } from "./helpers.js";

export const statusCommand = new Command("status")
  .description("Show daemon status")
  .action(async (_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);
    const paths = getHtpxPaths(projectRoot);

    // Check if daemon is running
    const running = await isDaemonRunning(projectRoot);
    if (!running) {
      console.log("Daemon is not running");
      process.exit(0);
    }

    const client = new ControlClient(paths.controlSocketFile);
    try {
      const status = await client.status();

      console.log("Daemon is running");
      console.log(`  Proxy port: ${status.proxyPort}`);
      console.log(`  Sessions: ${status.sessionCount}`);
      console.log(`  Requests captured: ${status.requestCount}`);

      if (status.proxyPort) {
        const info = buildProxyInfo(status.proxyPort, paths.caCertFile);
        console.log("");
        console.log(`Proxy URL: ${info.proxyUrl}`);
        console.log(`CA certificate: ${info.caCertPath}`);
        console.log("");
        console.log("Environment variables:");
        for (const line of info.envBlock.split("\n")) {
          console.log(`  ${line}`);
        }
      }
    } catch (err) {
      console.error(`Error querying daemon: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });
