#!/usr/bin/env node

import { program } from "commander";
import { clearCommand } from "./commands/clear.js";
import { debugDumpCommand } from "./commands/debug-dump.js";
import { initCommand } from "./commands/init.js";
import { onCommand } from "./commands/on.js";
import { offCommand } from "./commands/off.js";
import { interceptorsCommand } from "./commands/interceptors.js";
import { mcpCommand } from "./commands/mcp.js";
import { projectCommand } from "./commands/project.js";
import { daemonCommand } from "./commands/daemon.js";
import { tuiCommand } from "./commands/tui.js";
import { statusCommand } from "./commands/status.js";
import { getHtpxVersion } from "../shared/version.js";

program
  .name("htpx")
  .description("Terminal HTTP interception toolkit")
  .version(getHtpxVersion())
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
program.addCommand(onCommand);
program.addCommand(offCommand);
program.addCommand(interceptorsCommand);
program.addCommand(mcpCommand);
program.addCommand(projectCommand);
program.addCommand(daemonCommand);
program.addCommand(tuiCommand);
program.addCommand(statusCommand);

program.parse();
