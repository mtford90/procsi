import { Command } from "commander";

/**
 * Generate the shell function for htpx.
 * This function wraps htpx on/off with eval so that environment
 * variables can be set in the current shell.
 */
export function generateShellFunction(): string {
  const lines = [
    "htpx() {",
    '  if [[ "$1" == "on" || "$1" == "off" ]]; then',
    '    eval "$(command htpx "$@")"',
    "  else",
    '    command htpx "$@"',
    "  fi",
    "}",
  ];
  return lines.join("\n");
}

export const initCommand = new Command("init")
  .description("Output shell function for .zshrc/.bashrc (one-time setup)")
  .action(() => {
    console.log(generateShellFunction());
  });
