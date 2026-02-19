/**
 * `procsi requests` — list, search, query, count, and clear captured requests.
 */

import { Command } from "commander";
import type { BodySearchTarget, RequestFilter } from "../../shared/types.js";
import { getErrorMessage, connectToDaemon } from "./helpers.js";
import { formatRequestTable } from "../formatters/table.js";
import { formatHint } from "../formatters/hints.js";
import { parseTime } from "../utils/parse-time.js";
import { normaliseRegexFilterInput, parseUrlSearchInput } from "../../shared/regex-filter.js";
import { BODY_SEARCH_TARGETS, parseBodySearchTarget } from "../../shared/body-search.js";

const DEFAULT_LIMIT = 50;

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];
const STATUS_RANGES = ["1xx", "2xx", "3xx", "4xx", "5xx"];

/**
 * Parse a numeric CLI flag, exiting with an error if the value is not a valid non-negative integer.
 */
function parseIntFlag(value: string, flagName: string): number {
  const parsed = parseInt(value, 10);
  if (isNaN(parsed) || parsed < 0) {
    console.error(`Invalid ${flagName} value: "${value}"`);
    process.exit(1);
  }
  return parsed;
}

export function parseSearchTarget(value: string): BodySearchTarget {
  const parsed = parseBodySearchTarget(value);
  if (!parsed) {
    throw new Error(`Invalid --target: "${value}". Use one of: ${BODY_SEARCH_TARGETS.join(", ")}.`);
  }
  return parsed;
}

export interface RequestsFlags {
  method?: string;
  status?: string;
  host?: string;
  path?: string;
  search?: string;
  regex?: string;
  since?: string;
  before?: string;
  header?: string;
  headerTarget?: string;
  interceptedBy?: string;
  saved?: boolean;
  source?: string;
  target?: string;
  limit?: string;
  offset?: string;
  json?: boolean;
}

/**
 * Build a RequestFilter from CLI flags.
 */
export function buildFilter(opts: RequestsFlags): RequestFilter {
  const filter: RequestFilter = {};

  if (opts.search && opts.regex) {
    throw new Error("Cannot combine --search and --regex. Use one or the other.");
  }

  if (opts.method) {
    filter.methods = opts.method.split(",").map((m) => m.trim().toUpperCase());
  }

  if (opts.status) {
    filter.statusRange = opts.status;
  }

  if (opts.host) {
    filter.host = opts.host;
  }

  if (opts.path) {
    filter.pathPrefix = opts.path;
  }

  if (opts.search) {
    const parsed = parseUrlSearchInput(opts.search);
    if (parsed.search) {
      filter.search = parsed.search;
    }
    if (parsed.regex) {
      filter.regex = parsed.regex.pattern;
      if (parsed.regex.flags) {
        filter.regexFlags = parsed.regex.flags;
      }
    }
  }

  if (opts.regex) {
    const regex = normaliseRegexFilterInput(opts.regex);
    filter.regex = regex.pattern;
    if (regex.flags) {
      filter.regexFlags = regex.flags;
    }
  }

  if (opts.since) {
    filter.since = parseTime(opts.since);
  }

  if (opts.before) {
    filter.before = parseTime(opts.before);
  }

  if (opts.header) {
    const colonIdx = opts.header.indexOf(":");
    if (colonIdx > 0) {
      filter.headerName = opts.header.slice(0, colonIdx);
      filter.headerValue = opts.header.slice(colonIdx + 1);
    } else {
      filter.headerName = opts.header;
    }
  }

  if (opts.headerTarget) {
    const validTargets = ["request", "response", "both"];
    if (!validTargets.includes(opts.headerTarget)) {
      console.error(
        `Invalid --header-target: "${opts.headerTarget}". Use: ${validTargets.join(", ")}`
      );
      process.exit(1);
    }
    filter.headerTarget = opts.headerTarget as "request" | "response" | "both";
  }

  if (opts.interceptedBy) {
    filter.interceptedBy = opts.interceptedBy;
  }

  if (opts.saved) {
    filter.saved = true;
  }

  if (opts.source) {
    filter.source = opts.source;
  }

  return filter;
}

/**
 * Add common filter flags to a command.
 */
function addFilterFlags(cmd: Command): Command {
  return cmd
    .option(
      "--method <methods>",
      `filter by HTTP method (comma-separated: ${HTTP_METHODS.join(",")})`
    )
    .option(
      "--status <range>",
      `filter by status range (${STATUS_RANGES.join(", ")}, or exact e.g. 401)`
    )
    .option("--host <host>", "filter by hostname")
    .option("--path <prefix>", "filter by path prefix")
    .option("--search <text>", "substring match on URL (or /pattern/ for regex)")
    .option("--regex <pattern>", "regex match on URL")
    .option("--since <time>", "filter from time (e.g. 5m, 2h, 10am, yesterday, 2024-01-01)")
    .option("--before <time>", "filter before time (same formats as --since)")
    .option("--header <spec>", "filter by header name or name:value")
    .option("--header-target <target>", "which headers to search (request, response, both)", "both")
    .option("--intercepted-by <name>", "filter by interceptor name")
    .option("--saved", "show only saved/bookmarked requests")
    .option("--source <name>", "filter by request source (e.g. node, python)");
}

// --- Subcommands ---

const searchSubcommand = new Command("search")
  .description("Full-text search through request/response bodies")
  .argument("<query>", "search string")
  .option("--target <target>", "body target (request, response, or both)", "both")
  .option("--limit <n>", "max results", String(DEFAULT_LIMIT))
  .option("--offset <n>", "skip results", "0")
  .option("--json", "JSON output");

addFilterFlags(searchSubcommand);

searchSubcommand.action(
  async (
    query: string,
    opts: RequestsFlags & { limit?: string; offset?: string },
    command: Command
  ) => {
    const { client } = await connectToDaemon(command);
    try {
      const filter = buildFilter(opts);
      const target = parseSearchTarget(opts.target ?? "both");
      const limit = parseIntFlag(opts.limit ?? String(DEFAULT_LIMIT), "--limit");
      const offset = parseIntFlag(opts.offset ?? "0", "--offset");

      const results = await client.searchBodies({ query, target, limit, offset, filter });

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`  No requests found matching "${query}"`);
        return;
      }

      console.log(formatRequestTable(results, results.length));

      const hint = formatHint(["procsi request <id> for detail", "--json for JSON output"]);
      if (hint) console.log(hint);
    } catch (err) {
      console.error(`Error searching requests: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  }
);

const querySubcommand = new Command("query")
  .description("Query JSON bodies using JSONPath")
  .argument("<jsonpath>", "JSONPath expression (e.g. $.data.id)")
  .option("--value <v>", "filter by extracted value")
  .option("--target <target>", "request, response, or both", "both")
  .option("--limit <n>", "max results", String(DEFAULT_LIMIT))
  .option("--offset <n>", "skip results", "0")
  .option("--json", "JSON output");

addFilterFlags(querySubcommand);

querySubcommand.action(
  async (
    jsonPath: string,
    opts: RequestsFlags & { value?: string; target?: string; limit?: string; offset?: string },
    command: Command
  ) => {
    const { client } = await connectToDaemon(command);
    try {
      const filter = buildFilter(opts);
      const limit = parseIntFlag(opts.limit ?? String(DEFAULT_LIMIT), "--limit");
      const offset = parseIntFlag(opts.offset ?? "0", "--offset");

      const validTargets = ["request", "response", "both"];
      const target = opts.target ?? "both";
      if (!validTargets.includes(target)) {
        console.error(`Invalid --target: "${target}". Use: ${validTargets.join(", ")}`);
        process.exit(1);
      }

      const results = await client.queryJsonBodies({
        jsonPath,
        value: opts.value,
        target: target as "request" | "response" | "both",
        limit,
        offset,
        filter,
      });

      if (opts.json) {
        console.log(JSON.stringify(results, null, 2));
        return;
      }

      if (results.length === 0) {
        console.log(`  No results for JSONPath "${jsonPath}"`);
        return;
      }

      // Show table with extracted values
      for (const result of results) {
        const shortId = result.id.slice(0, 7);
        const value = JSON.stringify(result.extractedValue);
        console.log(`  ${shortId}  ${result.method} ${result.path}  →  ${value}`);
      }
    } catch (err) {
      console.error(`Error querying requests: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  }
);

const countSubcommand = new Command("count")
  .description("Count requests matching filters")
  .option("--json", "JSON output");

addFilterFlags(countSubcommand);

countSubcommand.action(async (opts: RequestsFlags, command: Command) => {
  const { client } = await connectToDaemon(command);
  try {
    const filter = buildFilter(opts);
    const count = await client.countRequests({ filter });

    if (opts.json) {
      console.log(JSON.stringify({ count }));
      return;
    }

    console.log(`  ${count} request${count === 1 ? "" : "s"}`);
  } catch (err) {
    console.error(`Error counting requests: ${getErrorMessage(err)}`);
    process.exit(1);
  } finally {
    client.close();
  }
});

const clearSubcommand = new Command("clear")
  .description("Clear all captured requests")
  .option("--yes", "skip confirmation prompt")
  .action(async (opts: { yes?: boolean }, command: Command) => {
    const { client } = await connectToDaemon(command);
    try {
      if (!opts.yes && process.stdout.isTTY) {
        // Simple confirmation via stdin
        const readline = await import("node:readline");
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });
        const answer = await new Promise<string>((resolve) => {
          rl.question("  Clear all captured requests? [y/N] ", resolve);
        });
        rl.close();
        if (answer.toLowerCase() !== "y") {
          console.log("  Cancelled");
          return;
        }
      }

      await client.clearRequests();
      console.log("  Requests cleared");
    } catch (err) {
      console.error(`Error clearing requests: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  });

// --- Main `requests` command ---

export const requestsCommand = new Command("requests")
  .description("List and filter captured requests")
  .option("--limit <n>", "max results", String(DEFAULT_LIMIT))
  .option("--offset <n>", "skip results", "0")
  .option("--json", "JSON output")
  .addCommand(searchSubcommand)
  .addCommand(querySubcommand)
  .addCommand(countSubcommand)
  .addCommand(clearSubcommand);

addFilterFlags(requestsCommand);

requestsCommand.action(
  async (opts: RequestsFlags & { limit?: string; offset?: string }, command: Command) => {
    const { client } = await connectToDaemon(command);
    try {
      const filter = buildFilter(opts);
      const limit = parseIntFlag(opts.limit ?? String(DEFAULT_LIMIT), "--limit");
      const offset = parseIntFlag(opts.offset ?? "0", "--offset");

      // Fetch summaries and count in parallel
      const [summaries, total] = await Promise.all([
        client.listRequestsSummary({ limit, offset, filter }),
        client.countRequests({ filter }),
      ]);

      if (opts.json) {
        console.log(JSON.stringify({ requests: summaries, total, limit, offset }, null, 2));
        return;
      }

      if (summaries.length === 0) {
        console.log("  No requests captured");
        const hint = formatHint(["make HTTP requests while procsi is intercepting"]);
        if (hint) console.log(hint);
        return;
      }

      console.log(formatRequestTable(summaries, total));

      const hint = formatHint([
        "procsi request <id>",
        "--method, --status, --host, --since to filter",
        "--json for JSON",
      ]);
      if (hint) console.log(hint);
    } catch (err) {
      console.error(`Error listing requests: ${getErrorMessage(err)}`);
      process.exit(1);
    } finally {
      client.close();
    }
  }
);
