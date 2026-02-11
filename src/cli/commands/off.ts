import { Command } from "commander";

/**
 * Format environment variable unset statements for shell evaluation.
 * Each line is an unset statement for one variable.
 */
export function formatUnsetVars(vars: string[]): string {
  return vars.map((key) => `unset ${key}`).join("\n");
}

export const offCommand = new Command("off")
  .description("Stop intercepting HTTP traffic in this shell")
  .action(() => {
    // If stdout is a TTY, user ran directly - show instructions instead
    if (process.stdout.isTTY) {
      console.log("To stop intercepting HTTP traffic, run:");
      console.log("");
      console.log("  eval $(htpx off)");
      return;
    }

    // Environment variables set by htpx on
    const envVars = [
      "HTTP_PROXY",
      "HTTPS_PROXY",
      "SSL_CERT_FILE",
      "REQUESTS_CA_BUNDLE",
      "NODE_EXTRA_CA_CERTS",
      "HTPX_SESSION_ID",
      "HTPX_LABEL",
    ];

    // Output unset statements for eval
    console.log(formatUnsetVars(envVars));

    // Output confirmation as a comment (shown but not executed)
    console.log("# htpx: interception stopped");
  });
