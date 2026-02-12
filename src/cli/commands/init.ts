import { Command } from "commander";

/**
 * Generate the shell function for procsi.
 * Maps the friendly `on`/`off` aliases to the underlying `vars` command
 * so that environment variables can be set in the current shell.
 */
export function generateShellFunction(): string {
  const lines = [
    "procsi() {",
    '  if [[ "$1" == "on" ]]; then',
    "    shift",
    '    eval "$(command procsi vars "$@")"',
    '  elif [[ "$1" == "off" ]]; then',
    "    shift",
    '    eval "$(command procsi vars --clear "$@")"',
    "  else",
    '    command procsi "$@"',
    "  fi",
    "}",
  ];
  return lines.join("\n");
}

export const initCommand = new Command("init")
  .description("Output shell wrapper function (enables procsi on/off to set env vars)")
  .action(() => {
    console.log(generateShellFunction());
  });
