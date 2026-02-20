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
import { generateFetch } from "../tui/utils/fetch.js";
import { generatePythonRequests } from "../tui/utils/python-requests.js";
import { generateHttpie } from "../tui/utils/httpie.js";
import { generateHarString } from "../tui/utils/har.js";
import { SHORT_ID_LENGTH } from "../formatters/table.js";

const EXPORT_FORMATS = ["curl", "har", "fetch", "requests", "python", "httpie"];

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
      } else if (format === "fetch") {
        console.log(generateFetch(request));
      } else if (format === "requests" || format === "python") {
        console.log(generatePythonRequests(request));
      } else if (format === "httpie") {
        console.log(generateHttpie(request));
      }
    } catch (err) {
      console.error(`Error: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });

const saveSubcommand = new Command("save")
  .description("Save (bookmark) a request so it persists across clear operations")
  .action(async (_opts: Record<string, unknown>, command: Command) => {
    const parentOpts = command.parent?.args ?? [];
    const idPrefix = parentOpts[0];
    if (!idPrefix || typeof idPrefix !== "string") {
      console.error("Usage: procsi request <id> save");
      process.exit(1);
    }

    const { client } = await connectToDaemon(command);
    try {
      const request = await resolveRequest(client, idPrefix);
      const result = await client.saveRequest(request.id);
      if (result.success) {
        console.log(`  Request ${request.id.slice(0, SHORT_ID_LENGTH)} saved`);
      } else {
        console.error(`  Failed to save request`);
        process.exit(1);
      }
    } catch (err) {
      console.error(`Error: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });

const replaySubcommand = new Command("replay")
  .description("Replay the captured request through the proxy")
  .option("--method <method>", "override HTTP method")
  .option("--url <url>", "override target URL")
  .option("--set-header <header...>", "set/override headers (name:value)")
  .option("--remove-header <header...>", "remove headers by name")
  .option("--body <text>", "override request body (UTF-8 text)")
  .option("--body-base64 <data>", "override request body (base64-encoded)")
  .option("--timeout <ms>", "replay timeout in milliseconds")
  .option("--json", "JSON output")
  .action(
    async (
      opts: {
        method?: string;
        url?: string;
        setHeader?: string[];
        removeHeader?: string[];
        body?: string;
        bodyBase64?: string;
        timeout?: string;
        json?: boolean;
      },
      command: Command
    ) => {
      const parentOpts = command.parent?.args ?? [];
      const idPrefix = parentOpts[0];
      if (!idPrefix || typeof idPrefix !== "string") {
        console.error("Usage: procsi request <id> replay");
        process.exit(1);
      }

      const { client } = await connectToDaemon(command);
      try {
        const request = await resolveRequest(client, idPrefix);

        // Parse --set-header values into a record (split on first ":")
        let setHeaders: Record<string, string> | undefined;
        if (opts.setHeader && opts.setHeader.length > 0) {
          setHeaders = {};
          for (const header of opts.setHeader) {
            const colonIndex = header.indexOf(":");
            if (colonIndex === -1) {
              console.error(`Invalid header format: "${header}" (expected name:value)`);
              process.exit(1);
            }
            const name = header.slice(0, colonIndex).trim();
            const value = header.slice(colonIndex + 1).trim();
            setHeaders[name] = value;
          }
        }

        // Parse --timeout with validation
        let timeoutMs: number | undefined;
        if (opts.timeout !== undefined) {
          timeoutMs = Number(opts.timeout);
          if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
            console.error(`Invalid timeout: "${opts.timeout}" (expected positive number in ms)`);
            process.exit(1);
          }
        }

        const result = await client.replayRequest({
          id: request.id,
          method: opts.method,
          url: opts.url,
          setHeaders,
          removeHeaders: opts.removeHeader,
          body: opts.body,
          bodyBase64: opts.bodyBase64,
          timeoutMs,
          initiator: "cli",
        });

        if (opts.json) {
          console.log(JSON.stringify(result, null, 2));
        } else {
          const shortId = result.requestId.slice(0, SHORT_ID_LENGTH);
          console.log(`  Replayed ${request.method} ${request.url}`);
          console.log(`  New request ID: ${shortId}`);

          const hint = formatHint([`request ${shortId} to inspect the replayed request`]);
          if (hint) {
            console.log("");
            console.log(hint);
          }
        }
      } catch (err) {
        console.error(`Error: ${getErrorMessage(err)}`);
        process.exit(1);
      } finally {
        client.close();
      }
    }
  );

const unsaveSubcommand = new Command("unsave")
  .description("Remove the saved/bookmark flag from a request")
  .action(async (_opts: Record<string, unknown>, command: Command) => {
    const parentOpts = command.parent?.args ?? [];
    const idPrefix = parentOpts[0];
    if (!idPrefix || typeof idPrefix !== "string") {
      console.error("Usage: procsi request <id> unsave");
      process.exit(1);
    }

    const { client } = await connectToDaemon(command);
    try {
      const request = await resolveRequest(client, idPrefix);
      const result = await client.unsaveRequest(request.id);
      if (result.success) {
        console.log(`  Request ${request.id.slice(0, SHORT_ID_LENGTH)} unsaved`);
      } else {
        console.error(`  Failed to unsave request`);
        process.exit(1);
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
  .addCommand(saveSubcommand)
  .addCommand(unsaveSubcommand)
  .addCommand(replaySubcommand)
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
        "export curl|har|fetch|python|httpie",
        "save|unsave to bookmark",
        "replay to re-send",
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
