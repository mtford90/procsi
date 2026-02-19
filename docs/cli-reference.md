# CLI Reference

[Back to README](../README.md)

## Global Options

| Flag               | Description                                       |
| ------------------ | ------------------------------------------------- |
| `-v, --verbose`    | Increase log verbosity (stackable: `-vv`, `-vvv`) |
| `-d, --dir <path>` | Override project root directory                   |

## `procsi on`

Output shell `export` statements to start intercepting HTTP traffic. Use with `eval`:

```bash
eval "$(procsi on)"
```

If run directly in a TTY (without `eval`), shows usage instructions.

| Flag                  | Description                                   |
| --------------------- | --------------------------------------------- |
| `-l, --label <label>`  | Label this session (visible in TUI and MCP)              |
| `-s, --source <name>` | Label the source process (auto-detected from PID if omitted) |
| `--no-restart`         | Don't auto-restart daemon on version mismatch            |

## `procsi off`

Output shell `unset` statements to stop intercepting HTTP traffic. Use with `eval`:

```bash
eval "$(procsi off)"
```

## `procsi tui`

Open the interactive TUI. See [TUI documentation](tui.md) for keybindings and features.

| Flag   | Description                                 |
| ------ | ------------------------------------------- |
| `--ci` | CI mode: render once and exit (for testing) |

## `procsi status`

Show comprehensive status: daemon state, interception state, sessions, request count, loaded interceptors.

## `procsi daemon stop`

Stop the daemon.

## `procsi daemon restart`

Restart the daemon (or start it if not running).

## `procsi requests`

List and filter captured requests. Output is a colour-coded table with short IDs — pipe to other tools or use `--json` for structured output.

```bash
procsi requests                              # list recent (default limit 50)
procsi requests --method GET,POST            # filter by method
procsi requests --status 4xx                 # filter by status range
procsi requests --host api.example.com       # filter by host
procsi requests --path /api/v2               # filter by path prefix
procsi requests --search "keyword"           # substring match on URL
procsi requests --search "/users\\/\\d+/"    # regex literal match on URL
procsi requests --regex "users/\\d+$"       # regex pattern match on URL
procsi requests --since 5m                   # last 5 minutes
procsi requests --since yesterday            # since midnight yesterday
procsi requests --since 10am --before 11am   # time window
procsi requests --header "content-type:application/json"  # header filter
procsi requests --intercepted-by mock-users  # interceptor filter
procsi requests --saved                       # only saved/bookmarked requests
procsi requests --limit 100 --offset 50      # pagination
procsi requests --json                       # JSON output
```

| Flag                       | Description                                              |
| -------------------------- | -------------------------------------------------------- |
| `--method <methods>`       | Filter by HTTP method (comma-separated)                  |
| `--status <range>`         | Status range: `2xx`, `4xx`, exact `401`, etc.            |
| `--host <host>`            | Filter by hostname                                       |
| `--path <prefix>`          | Filter by path prefix                                    |
| `--search <text>`          | Substring match on URL, or `/pattern/flags` regex literal |
| `--regex <pattern>`        | JavaScript regex pattern match on URL                     |
| `--since <time>`           | Since time (5m, 2h, 10am, yesterday, monday, 2024-01-01) |
| `--before <time>`          | Before time (same formats as --since)                    |
| `--header <spec>`          | Header name or name:value                                |
| `--header-target <target>` | `request`, `response`, or `both` (default)               |
| `--saved`                  | Filter to saved/bookmarked requests only                 |
| `--source <name>`          | Filter by request source (e.g. node, python)             |
| `--intercepted-by <name>`  | Filter by interceptor name                               |
| `--limit <n>`              | Max results (default 50)                                 |
| `--offset <n>`             | Skip results (default 0)                                 |
| `--json`                   | JSON output                                              |

### `procsi requests search <query>`

Full-text search through body content.

```bash
procsi requests search "timeout"                        # search request + response bodies
procsi requests search "Bearer " --target request      # request body only
procsi requests search "error_code" --target response  # response body only
procsi requests search "Alice" --method POST --host api.example.com
```

| Flag              | Description                                           |
| ----------------- | ----------------------------------------------------- |
| `--target <kind>` | `request`, `response`, or `both` (default)            |
| `--limit <n>`     | Max results (default 50)                              |
| `--offset <n>`    | Skip results (default 0)                              |
| `--json`          | JSON output                                           |
| Common filters    | `--method`, `--status`, `--host`, `--path`, etc.      |

### `procsi requests query <jsonpath>`

Query JSON bodies using JSONPath expressions (e.g. `$.data.id`). Supports `--value`, `--target` (request/response/both).

### `procsi requests count`

Count requests matching the current filters.

### `procsi requests clear`

Clear all captured requests. Prompts for confirmation unless `--yes` is passed.

## `procsi request <id>`

View a single request in detail. Accepts full UUIDs or abbreviated prefixes (first 7+ characters).

```bash
procsi request a1b2c3d              # full detail view
procsi request a1b2c3d --json       # JSON output
```

### `procsi request <id> body`

Dump the response body to stdout (raw, pipeable). Use `--request` for the request body instead.

```bash
procsi request a1b2c3d body                # response body
procsi request a1b2c3d body --request      # request body
procsi request a1b2c3d body | jq .         # pipe to jq
```

### `procsi request <id> export <format>`

Export a request as `curl` or `har`.

```bash
procsi request a1b2c3d export curl
procsi request a1b2c3d export har
```

## `procsi sessions`

List active proxy sessions.

| Flag     | Description |
| -------- | ----------- |
| `--json` | JSON output |

## `procsi clear`

Clear all captured requests.

## `procsi debug-dump`

Collect diagnostics (system info, daemon status, recent logs) into `.procsi/debug-dump-<timestamp>.json`.

## `procsi mcp`

Start the MCP server (stdio transport). See [MCP documentation](mcp.md).

## `procsi interceptors`

List loaded interceptors, or manage them with subcommands. See [Interceptors documentation](interceptors.md).

### `procsi interceptors init`

Scaffold an example interceptor in `.procsi/interceptors/`.

### `procsi interceptors reload`

Reload interceptors from disk without restarting the daemon.

### `procsi interceptors logs`

View the interceptor event log. Events include match results, mock responses, errors, timeouts, and `ctx.log()` output.

```bash
procsi interceptors logs                         # recent events
procsi interceptors logs --name mock-users       # filter by interceptor
procsi interceptors logs --level error           # filter by level
procsi interceptors logs --limit 100             # more results
procsi interceptors logs --follow                # live tail (Ctrl+C to stop)
procsi interceptors logs --follow --json         # live tail as NDJSON
```

| Flag                   | Description                         |
| ---------------------- | ----------------------------------- |
| `--name <interceptor>` | Filter by interceptor name          |
| `--level <level>`      | Filter by level (info, warn, error) |
| `--limit <n>`          | Max events (default 50)             |
| `--follow`             | Live tail — poll for new events     |
| `--json`               | JSON output                         |

### `procsi interceptors logs clear`

Clear the interceptor event log.

## `procsi completions <shell>`

Generate shell completion scripts. Supports `zsh`, `bash`, and `fish`.

```bash
eval "$(procsi completions zsh)"    # add to .zshrc
eval "$(procsi completions bash)"   # add to .bashrc
procsi completions fish | source    # add to fish config
```
