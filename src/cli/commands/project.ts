import { Command } from "commander";
import { ensureProcsiDir, findOrCreateProjectRoot, getProcsiDir } from "../../shared/project.js";
import { getGlobalOptions } from "./helpers.js";

export const projectCommand = new Command("project").description(
  "Manage procsi project configuration"
);

projectCommand
  .command("init")
  .description("Initialise procsi in the current directory")
  .action((_, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = findOrCreateProjectRoot(undefined, globalOpts.dir ?? process.cwd());
    const procsiDir = getProcsiDir(projectRoot);

    ensureProcsiDir(projectRoot);
    console.log(`Created ${procsiDir}`);
  });
