import { Command } from "commander";
import {
  formatUnsetVars,
  formatNodeOptionsRestore,
  formatPythonPathRestore,
  formatRubyOptRestore,
  formatPhpIniScanDirRestore,
} from "./on.js";

// Environment variables managed by procsi
const PROCSI_ENV_VARS = [
  "HTTP_PROXY",
  "HTTPS_PROXY",
  "http_proxy",
  "https_proxy",
  "SSL_CERT_FILE",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "NODE_EXTRA_CA_CERTS",
  "DENO_CERT",
  "CARGO_HTTP_CAINFO",
  "GIT_SSL_CAINFO",
  "AWS_CA_BUNDLE",
  "CGI_HTTP_PROXY",
  "GLOBAL_AGENT_HTTP_PROXY",
  "GLOBAL_AGENT_HTTPS_PROXY",
  "NODE_USE_ENV_PROXY",
  "PROCSI_SESSION_ID",
  "PROCSI_SESSION_TOKEN",
  "PROCSI_LABEL",
];

export const offCommand = new Command("off")
  .description("Output shell unset statements to stop intercepting HTTP traffic")
  .action(async () => {
    // If stdout is a TTY, user ran directly — show instructions instead
    if (process.stdout.isTTY) {
      console.log("To stop intercepting HTTP traffic, run:");
      console.log("");
      console.log('  eval "$(procsi off)"');
      return;
    }

    // Restore modified env vars before standard unsets
    console.log(formatNodeOptionsRestore());
    console.log(formatPythonPathRestore());
    console.log(formatRubyOptRestore());
    console.log(formatPhpIniScanDirRestore());

    // Output unset statements for eval
    console.log(formatUnsetVars(PROCSI_ENV_VARS));

    // Output confirmation as a comment (shown but not executed)
    console.log("# procsi: interception stopped");
  });
