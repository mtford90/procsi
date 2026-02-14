import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { ControlClient } from "../../shared/control-client.js";
import { getProcsiPaths } from "../../shared/project.js";
import { isDaemonRunning } from "../../shared/daemon.js";
import type { InterceptorEventLevel } from "../../shared/types.js";
import { requireProjectRoot, getErrorMessage, getGlobalOptions } from "./helpers.js";
import { formatInterceptorEventTable } from "../formatters/detail.js";

const EXAMPLE_INTERCEPTOR_FILENAME = "example.ts";

const EXAMPLE_INTERCEPTOR_CONTENT = `// Example procsi interceptor
// Uncomment and modify one of the patterns below to get started.
//
// Run \`procsi interceptors reload\` after editing, or run \`procsi daemon restart\`.

import type { Interceptor } from "procsi/interceptors";

// --- Mock pattern: return a canned response without hitting the real server ---
//
// export default {
//   name: "mock-users-api",
//   match: (req) => req.path === "/api/users",
//   handler: async () => ({
//     status: 200,
//     headers: { "content-type": "application/json" },
//     body: JSON.stringify([{ id: 1, name: "Alice" }]),
//   }),
// } satisfies Interceptor;

// --- Modify pattern: forward the request then alter the response ---
//
// export default {
//   name: "inject-header",
//   match: (req) => req.host.includes("example.com"),
//   handler: async (ctx) => {
//     const response = await ctx.forward();
//     response.headers = { ...response.headers, "x-debug": "procsi" };
//     return response;
//   },
// } satisfies Interceptor;

// --- Observe pattern: log or inspect traffic without altering it ---
//
// export default {
//   name: "log-api-calls",
//   match: (req) => req.path.startsWith("/api/"),
//   handler: async (ctx) => {
//     ctx.log(\`\${ctx.request.method} \${ctx.request.url}\`);
//     const response = await ctx.forward();
//     ctx.log(\`  -> \${response.status}\`);
//     return response;
//   },
// } satisfies Interceptor;
`;

/**
 * Format interceptor info as a table row.
 */
function formatInterceptorRow(
  name: string,
  sourceFile: string,
  hasMatch: boolean,
  error?: string
): string {
  const nameCol = name.padEnd(24);
  const fileCol = sourceFile.padEnd(32);
  const matchCol = hasMatch ? "yes" : "no ";
  const errorCol = error ?? "";
  return `  ${nameCol} ${fileCol} ${matchCol}    ${errorCol}`;
}

/**
 * Shared implementation for the list action (used by both `interceptors` and `interceptors list`).
 */
async function listAction(command: Command): Promise<void> {
  const globalOpts = getGlobalOptions(command);
  const projectRoot = requireProjectRoot(globalOpts.dir);
  const paths = getProcsiPaths(projectRoot);

  const running = await isDaemonRunning(projectRoot);
  if (!running) {
    console.log("Daemon is not running");
    process.exit(0);
  }

  const client = new ControlClient(paths.controlSocketFile);
  try {
    const interceptors = await client.listInterceptors();

    if (interceptors.length === 0) {
      console.log("No interceptors loaded");
      return;
    }

    console.log(`  ${"Name".padEnd(24)} ${"Source".padEnd(32)} Match  Error`);
    console.log(`  ${"─".repeat(24)} ${"─".repeat(32)} ${"─".repeat(5)}  ${"─".repeat(20)}`);

    for (const info of interceptors) {
      const relativeSource = path.relative(projectRoot, info.sourceFile) || info.sourceFile;
      console.log(formatInterceptorRow(info.name, relativeSource, info.hasMatch, info.error));
    }
  } catch (err) {
    console.error(`Error listing interceptors: ${getErrorMessage(err)}`);
    process.exit(1);
  } finally {
    client.close();
  }
}

const listSubcommand = new Command("list")
  .description("List loaded interceptors")
  .action(async (_, command: Command) => {
    await listAction(command);
  });

const reloadSubcommand = new Command("reload")
  .description("Reload interceptors from disk")
  .action(async (_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);
    const paths = getProcsiPaths(projectRoot);

    const running = await isDaemonRunning(projectRoot);
    if (!running) {
      console.log("Daemon is not running");
      process.exit(0);
    }

    const client = new ControlClient(paths.controlSocketFile);
    try {
      const result = await client.reloadInterceptors();
      if (result.success) {
        console.log(`Reloaded ${result.count} interceptor${result.count === 1 ? "" : "s"}`);
      } else {
        console.log(result.error ?? "Reload failed");
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error reloading interceptors: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });

const initSubcommand = new Command("init")
  .description("Create example interceptor file")
  .action(async (_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);
    const paths = getProcsiPaths(projectRoot);

    const interceptorsDir = paths.interceptorsDir;

    if (!fs.existsSync(interceptorsDir)) {
      fs.mkdirSync(interceptorsDir, { recursive: true });
    }

    const exampleFile = path.join(interceptorsDir, EXAMPLE_INTERCEPTOR_FILENAME);

    if (fs.existsSync(exampleFile)) {
      console.log(`Example file already exists: ${exampleFile}`);
      return;
    }

    fs.writeFileSync(exampleFile, EXAMPLE_INTERCEPTOR_CONTENT, "utf-8");
    console.log(`Created ${exampleFile}`);
    console.log("");
    console.log("Edit the file to define your interceptor, then either:");
    console.log("  - Restart the daemon (procsi daemon restart)");
    console.log("  - Run: procsi interceptors reload");
  });

const FOLLOW_POLL_INTERVAL_MS = 1000;
const EVENT_LOG_LEVELS: InterceptorEventLevel[] = ["info", "warn", "error"];

const logsClearSubcommand = new Command("clear")
  .description("Clear interceptor event log")
  .action(async (_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);
    const paths = getProcsiPaths(projectRoot);

    const running = await isDaemonRunning(projectRoot);
    if (!running) {
      console.log("Daemon is not running");
      process.exit(0);
    }

    const client = new ControlClient(paths.controlSocketFile);
    try {
      await client.clearInterceptorEvents();
      console.log("  Interceptor events cleared");
    } catch (err) {
      console.error(`Error clearing events: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });

const logsSubcommand = new Command("logs")
  .description("View interceptor event log")
  .option("--name <interceptor>", "filter by interceptor name")
  .option("--level <level>", `filter by level (${EVENT_LOG_LEVELS.join(", ")})`)
  .option("--limit <n>", "max events", "50")
  .option("--follow", "live tail — poll for new events")
  .option("--json", "JSON output")
  .addCommand(logsClearSubcommand)
  .action(
    async (
      opts: {
        name?: string;
        level?: string;
        limit?: string;
        follow?: boolean;
        json?: boolean;
      },
      command: Command
    ) => {
      const globalOpts = getGlobalOptions(command);
      const projectRoot = requireProjectRoot(globalOpts.dir);
      const paths = getProcsiPaths(projectRoot);

      const running = await isDaemonRunning(projectRoot);
      if (!running) {
        console.log("Daemon is not running");
        process.exit(0);
      }

      const client = new ControlClient(paths.controlSocketFile);

      const parsedLimit = parseInt(opts.limit ?? "50", 10);
      if (isNaN(parsedLimit) || parsedLimit < 0) {
        console.error(`Invalid --limit value: "${opts.limit}"`);
        process.exit(1);
      }
      const limit = parsedLimit;

      const validLevels = ["info", "warn", "error"];
      if (opts.level && !validLevels.includes(opts.level)) {
        console.error(`Invalid --level: "${opts.level}". Use: ${validLevels.join(", ")}`);
        process.exit(1);
      }
      const level = opts.level as InterceptorEventLevel | undefined;

      try {
        const result = await client.getInterceptorEvents({
          limit,
          level,
          interceptor: opts.name,
        });

        if (opts.json && !opts.follow) {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        if (!opts.follow) {
          if (result.events.length === 0) {
            console.log("  No interceptor events");
            return;
          }
          console.log(formatInterceptorEventTable(result.events));
          return;
        }

        // --follow: print initial batch then poll for new events
        if (result.events.length > 0) {
          if (opts.json) {
            for (const event of result.events) {
              console.log(JSON.stringify(event));
            }
          } else {
            console.log(formatInterceptorEventTable(result.events));
          }
        }

        if (!opts.json) {
          console.log("  --- following events (Ctrl+C to stop) ---");
        }

        const lastInitialEvent = result.events[result.events.length - 1];
        let lastSeq = lastInitialEvent?.seq ?? 0;

        // Graceful shutdown on Ctrl+C
        let stopping = false;
        const cleanup = () => {
          stopping = true;
          client.close();
        };
        process.on("SIGINT", cleanup);
        process.on("SIGTERM", cleanup);

        while (!stopping) {
          await new Promise((resolve) => setTimeout(resolve, FOLLOW_POLL_INTERVAL_MS));
          if (stopping) break;

          try {
            const newResult = await client.getInterceptorEvents({
              afterSeq: lastSeq,
              level,
              interceptor: opts.name,
            });

            if (newResult.events.length > 0) {
              if (opts.json) {
                for (const event of newResult.events) {
                  console.log(JSON.stringify(event));
                }
              } else {
                console.log(formatInterceptorEventTable(newResult.events));
              }
              const lastNewEvent = newResult.events[newResult.events.length - 1];
              if (lastNewEvent) {
                lastSeq = lastNewEvent.seq;
              }
            }
          } catch {
            // Connection lost — stop polling
            if (!stopping) {
              console.error("  Lost connection to daemon");
            }
            break;
          }
        }
      } catch (err) {
        console.error(`Error fetching events: ${getErrorMessage(err)}`);
        process.exit(1);
      } finally {
        client.close();
      }
    }
  );

export const interceptorsCommand = new Command("interceptors")
  .description("Manage request interceptors")
  .addCommand(listSubcommand)
  .addCommand(reloadSubcommand)
  .addCommand(initSubcommand)
  .addCommand(logsSubcommand)
  .action(async (_, command: Command) => {
    // Default action when no subcommand is specified — behaves like `list`
    await listAction(command);
  });
