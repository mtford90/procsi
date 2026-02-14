/**
 * `procsi sessions` — list active proxy sessions.
 */

import { Command } from "commander";
import { getErrorMessage, connectToDaemon } from "./helpers.js";
import { formatSessionTable } from "../formatters/detail.js";
import { formatHint } from "../formatters/hints.js";

export const sessionsCommand = new Command("sessions")
  .description("List active proxy sessions")
  .option("--json", "JSON output")
  .action(async (opts: { json?: boolean }, command: Command) => {
    const { client } = await connectToDaemon(command);
    try {
      const sessions = await client.listSessions();

      if (opts.json) {
        console.log(JSON.stringify(sessions, null, 2));
        return;
      }

      if (sessions.length === 0) {
        console.log("  No active sessions");
        return;
      }

      console.log(formatSessionTable(sessions));

      const hint = formatHint([
        "procsi requests to see captured traffic",
        "--json for JSON output",
      ]);
      if (hint) console.log(hint);
    } catch (err) {
      console.error(`Error listing sessions: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });
