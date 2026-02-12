#!/usr/bin/env node

import { program } from "commander";
import { clearCommand } from "./commands/clear.js";
import { debugDumpCommand } from "./commands/debug-dump.js";
import { initCommand } from "./commands/init.js";
import { varsCommand } from "./commands/vars.js";
import { interceptorsCommand } from "./commands/interceptors.js";
import { mcpCommand } from "./commands/mcp.js";
import { projectCommand } from "./commands/project.js";
import { daemonCommand } from "./commands/daemon.js";
import { tuiCommand } from "./commands/tui.js";
import { statusCommand } from "./commands/status.js";
import { getProcsiVersion } from "../shared/version.js";

program
  .name("procsi")
  .description("Terminal HTTP interception toolkit")
  .version(getProcsiVersion())
  .option(
    "-v, --verbose",
    "increase verbosity (use -vv or -vvv for more)",
    (_, prev: number) => prev + 1,
    0
  )
  .option("-d, --dir <path>", "override project root directory");

program.addCommand(clearCommand);
program.addCommand(debugDumpCommand);
program.addCommand(initCommand);
program.addCommand(varsCommand);
program.addCommand(interceptorsCommand);
program.addCommand(mcpCommand);
program.addCommand(projectCommand);
program.addCommand(daemonCommand);
program.addCommand(tuiCommand);
program.addCommand(statusCommand);

program.addHelpText(
  "after",
  `
Quick start:
  procsi on    Start intercepting HTTP traffic
  procsi tui   Browse captured requests

Docs: https://github.com/mtford90/procsi`
);

program.parse();
