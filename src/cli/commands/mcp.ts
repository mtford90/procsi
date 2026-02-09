import { Command } from "commander";
import { createHtpxMcpServer } from "../../mcp/server.js";
import { getGlobalOptions, requireProjectRoot } from "./helpers.js";

export const mcpCommand = new Command("mcp")
  .description("Start the htpx MCP server (stdio transport for AI tool integration)")
  .action(async (_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);

    const mcp = createHtpxMcpServer({ projectRoot });

    let closing = false;
    const shutdown = async () => {
      if (closing) return;
      closing = true;
      await mcp.close();
      process.exit(0);
    };
    process.on("SIGINT", shutdown);
    process.on("SIGTERM", shutdown);

    await mcp.start();

    // Log to stderr (stdout is reserved for MCP JSON-RPC protocol)
    process.stderr.write(`htpx MCP server running (project: ${projectRoot})\n`);
  });
