#!/usr/bin/env node

import { program } from "commander";
import { clearCommand } from "./commands/clear.js";
import { debugDumpCommand } from "./commands/debug-dump.js";
import { initCommand } from "./commands/init.js";
import { interceptCommand } from "./commands/intercept.js";
import { projectCommand } from "./commands/project.js";
import { restartCommand } from "./commands/restart.js";
import { tuiCommand } from "./commands/tui.js";
import { statusCommand } from "./commands/status.js";
import { stopCommand } from "./commands/stop.js";

program
  .name("htpx")
  .description("Terminal HTTP interception toolkit")
  .version("0.1.0")
  .option(
    "-v, --verbose",
    "increase verbosity (use -vv or -vvv for more)",
    (_, prev: number) => prev + 1,
    0
  );

program.addCommand(clearCommand);
program.addCommand(debugDumpCommand);
program.addCommand(initCommand);
program.addCommand(interceptCommand);
program.addCommand(projectCommand);
program.addCommand(restartCommand);
program.addCommand(tuiCommand);
program.addCommand(statusCommand);
program.addCommand(stopCommand);

program.parse();
