import * as fs from "node:fs";
import * as path from "node:path";
import { Command } from "commander";
import { ControlClient } from "../../shared/control-client.js";
import { getHtpxPaths } from "../../shared/project.js";
import { isDaemonRunning } from "../../shared/daemon.js";
import { requireProjectRoot, getErrorMessage, getGlobalOptions } from "./helpers.js";

const EXAMPLE_INTERCEPTOR_FILENAME = "example.ts";

const EXAMPLE_INTERCEPTOR_CONTENT = `// Example htpx interceptor
// Uncomment and modify one of the patterns below to get started.
//
// Run \`htpx interceptors reload\` after editing, or run \`htpx daemon restart\`.

import type { Interceptor } from "htpx-cli/interceptors";

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
//     response.headers = { ...response.headers, "x-debug": "htpx" };
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
  const paths = getHtpxPaths(projectRoot);

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
    const paths = getHtpxPaths(projectRoot);

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
    const paths = getHtpxPaths(projectRoot);

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
    console.log("  - Restart the daemon (htpx daemon restart)");
    console.log("  - Run: htpx interceptors reload");
  });

export const interceptorsCommand = new Command("interceptors")
  .description("Manage request interceptors")
  .addCommand(listSubcommand)
  .addCommand(reloadSubcommand)
  .addCommand(initSubcommand)
  .action(async (_, command: Command) => {
    // Default action when no subcommand is specified — behaves like `list`
    await listAction(command);
  });
