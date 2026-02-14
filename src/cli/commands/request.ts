/**
 * `procsi request <id>` — view a single request in detail, dump body, or export.
 */

import { Command } from "commander";
import { ControlClient } from "../../shared/control-client.js";
import type { CapturedRequest } from "../../shared/types.js";
import { getErrorMessage, connectToDaemon } from "./helpers.js";
import { formatRequestDetail } from "../formatters/detail.js";
import { formatHint } from "../formatters/hints.js";
import { generateCurl } from "../tui/utils/curl.js";
import { generateHarString } from "../tui/utils/har.js";
import { SHORT_ID_LENGTH } from "../formatters/table.js";

const EXPORT_FORMATS = ["curl", "har"];

/** Max requests to fetch when searching by ID prefix. */
const PREFIX_MATCH_SEARCH_LIMIT = 1000;

/**
 * Resolve a potentially abbreviated ID to a full request.
 * Tries exact match first, then prefix match.
 */
async function resolveRequest(client: ControlClient, idPrefix: string): Promise<CapturedRequest> {
  // Try exact match first
  const exact = await client.getRequest(idPrefix);
  if (exact) return exact;

  // Prefix match — fetch all requests and filter client-side
  // (the control API doesn't have a prefix-search endpoint,
  //  so we use search with the ID as a substring match on url
  //  ... actually we need to list and filter by ID prefix)
  const summaries = await client.listRequestsSummary({ limit: PREFIX_MATCH_SEARCH_LIMIT });
  const matches = summaries.filter((s) => s.id.startsWith(idPrefix));

  if (matches.length === 0) {
    console.error(`  No request found matching "${idPrefix}"`);
    console.error("  Run 'procsi requests' to see captured requests");
    process.exit(1);
  }

  if (matches.length > 1) {
    console.error(`  Ambiguous ID "${idPrefix}" matches ${matches.length} requests:`);
    for (const m of matches.slice(0, 10)) {
      console.error(`    ${m.id.slice(0, SHORT_ID_LENGTH)}  ${m.method} ${m.path}`);
    }
    if (matches.length > 10) {
      console.error(`    ... and ${matches.length - 10} more`);
    }
    console.error("  Use a longer prefix to narrow down");
    process.exit(1);
  }

  // Exactly one match — fetch full detail
  const matchedId = matches[0]?.id ?? idPrefix;
  const full = await client.getRequest(matchedId);
  if (!full) {
    console.error(`  Request ${matchedId} not found`);
    process.exit(1);
  }
  return full;
}

// --- Subcommands ---

const bodySubcommand = new Command("body")
  .description("Dump request or response body (raw, pipeable)")
  .option("--request", "dump request body instead of response body")
  .action(async (opts: { request?: boolean }, command: Command) => {
    const parentOpts = command.parent?.args ?? [];
    const idPrefix = parentOpts[0];
    if (!idPrefix || typeof idPrefix !== "string") {
      console.error("Usage: procsi request <id> body");
      process.exit(1);
    }

    const { client } = await connectToDaemon(command);
    try {
      const request = await resolveRequest(client, idPrefix);
      const body = opts.request ? request.requestBody : request.responseBody;

      if (!body || body.length === 0) {
        // Write nothing — consistent with piping (empty output, not an error message)
        return;
      }

      // Warn when writing likely-binary data to a terminal
      if (process.stdout.isTTY) {
        const hasNullBytes = body.includes(0x00);
        if (hasNullBytes) {
          console.error("Binary body detected — pipe to a file instead:");
          console.error(`  procsi request ${idPrefix} body > output.bin`);
          return;
        }
      }

      // Write raw bytes to stdout, bypassing any encoding
      process.stdout.write(body);
    } catch (err) {
      console.error(`Error: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });

const exportSubcommand = new Command("export")
  .description("Export request in various formats")
  .argument("<format>", `output format (${EXPORT_FORMATS.join(", ")})`)
  .action(async (format: string, _opts: Record<string, unknown>, command: Command) => {
    if (!EXPORT_FORMATS.includes(format)) {
      console.error(`Unknown export format: "${format}"`);
      console.error(`Supported formats: ${EXPORT_FORMATS.join(", ")}`);
      process.exit(1);
    }

    const parentOpts = command.parent?.args ?? [];
    const idPrefix = parentOpts[0];
    if (!idPrefix || typeof idPrefix !== "string") {
      console.error("Usage: procsi request <id> export <format>");
      process.exit(1);
    }

    const { client } = await connectToDaemon(command);
    try {
      const request = await resolveRequest(client, idPrefix);

      if (format === "curl") {
        console.log(generateCurl(request));
      } else if (format === "har") {
        console.log(generateHarString([request]));
      }
    } catch (err) {
      console.error(`Error: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });

// --- Main `request` command ---

export const requestCommand = new Command("request")
  .description("View a single request in detail")
  .argument("<id>", "request ID (full or abbreviated prefix)")
  .option("--json", "JSON output")
  .addCommand(bodySubcommand)
  .addCommand(exportSubcommand)
  .action(async (id: string, opts: { json?: boolean }, command: Command) => {
    const { client } = await connectToDaemon(command);
    try {
      const request = await resolveRequest(client, id);

      if (opts.json) {
        console.log(JSON.stringify(request, null, 2));
        return;
      }

      console.log(formatRequestDetail(request));

      const hint = formatHint([
        "body for full body",
        "export curl|har",
        "body --request for request body",
      ]);
      if (hint) {
        console.log("");
        console.log(hint);
      }
    } catch (err) {
      console.error(`Error: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });
