import { Command } from "commander";
import { getProcsiPaths } from "../../shared/project.js";
import { isDaemonRunning } from "../../shared/daemon.js";
import { ControlClient } from "../../shared/control-client.js";
import { buildProxyInfo } from "../../shared/proxy-info.js";
import { requireProjectRoot, getErrorMessage, getGlobalOptions } from "./helpers.js";

export const statusCommand = new Command("status")
  .description("Show procsi status")
  .action(async (_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);
    const paths = getProcsiPaths(projectRoot);

    // Detect whether the current shell is intercepting
    const sessionId = process.env["PROCSI_SESSION_ID"];
    const intercepting = sessionId !== undefined && sessionId !== "";

    // Check if daemon is running
    const running = await isDaemonRunning(projectRoot);

    if (!running) {
      console.log("Daemon:        not running");
      console.log(`Intercepting:  no`);
      return;
    }

    const client = new ControlClient(paths.controlSocketFile);
    try {
      const status = await client.status();

      console.log("Daemon:        running");
      console.log(`Intercepting:  ${intercepting ? `yes (session ${sessionId})` : "no"}`);
      console.log(`Proxy port:    ${status.proxyPort}`);
      console.log(`Sessions:      ${status.sessionCount}`);
      console.log(`Requests:      ${status.requestCount}`);

      // Show interceptor info
      try {
        const interceptors = await client.listInterceptors();
        if (interceptors.length > 0) {
          const errorCount = interceptors.filter((i) => i.error).length;
          const loadedCount = interceptors.length - errorCount;
          if (errorCount > 0) {
            console.log(`Interceptors:  ${loadedCount} loaded (${errorCount} failed)`);
          } else {
            console.log(`Interceptors:  ${loadedCount} loaded`);
          }
        } else {
          console.log("Interceptors:  none");
        }
      } catch {
        // Interceptor info not available — not critical
      }

      if (status.proxyPort) {
        const info = buildProxyInfo(status.proxyPort, paths.caCertFile);
        console.log("");
        console.log(`Proxy URL:     ${info.proxyUrl}`);
        console.log(`CA cert:       ${info.caCertPath}`);
      }
    } catch (err) {
      console.error(`Error querying daemon: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });
