# htpx

[![npm version](https://img.shields.io/npm/v/htpx-cli.svg)](https://www.npmjs.com/package/htpx-cli)
[![CI](https://github.com/mtford90/htpx/actions/workflows/ci.yml/badge.svg)](https://github.com/mtford90/htpx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

HTTP interception for the terminal. Each project gets its own proxy, its own traffic database, its own mocks — all in a `.htpx/` directory that lives alongside your code.

![htpx demo](demo.gif)

No browser extensions, no global system proxy, no separate apps. A MITM proxy captures your traffic, a lazygit-style TUI lets you browse it, TypeScript files let you mock it, and AI agents can query and manipulate all of it via MCP.

## Quick Start

```bash
npm install -g htpx-cli

# One-time shell setup
eval "$(htpx init)"

# In your project directory
htpx on
curl https://api.example.com/users
htpx tui
```

Requires Node.js 20+.

### Shell Setup

Add this to your `~/.zshrc` or `~/.bashrc`:

```bash
eval "$(htpx init)"
```

This creates a shell function that sets proxy environment variables in your current session.

## Features

- **Project-scoped** — each project gets its own `.htpx/` directory with a separate daemon, database, CA cert and interceptors. No cross-project bleed.
- **TypeScript interceptors** — mock, modify or observe traffic with `.ts` files. Match on anything, query past traffic from within handlers, compose complex scenarios.
- **MCP server** — AI agents get full access to your captured traffic and can write interceptor files for you. Search, filter, inspect, mock — all via tool calls.
- **Terminal TUI** — vim-style keybindings, mouse support, JSON explorer, filtering. Stays in your terminal where you're already working.
- **HTTPS** — automatic CA certificate generation and trust
- **Export** — copy as curl, export as HAR, save bodies to disk
- **Zero config** — works with curl, wget, Node.js, Python, Go, Rust and anything else that respects `HTTP_PROXY`

## Project Isolation

htpx doesn't use a global system proxy. Each project gets its own `.htpx/` directory in the project root (detected by `.git` or an existing `.htpx/`):

```
your-project/
├── .htpx/
│   ├── interceptors/   # TypeScript interceptor files
│   ├── config.json     # Optional project config
│   ├── proxy.port      # Proxy TCP port
│   ├── control.sock    # IPC socket
│   ├── requests.db     # Captured traffic
│   ├── ca.pem          # CA certificate
│   └── daemon.pid      # Process ID
└── src/...
```

Separate daemon, separate database, separate certificates. You can run htpx in multiple projects at the same time without them interfering with each other.

## Interceptors

TypeScript files in `.htpx/interceptors/` that intercept HTTP traffic as it passes through the proxy. They can return mock responses, modify upstream responses, or just observe.

```bash
htpx interceptors init    # scaffold an example
htpx interceptors reload  # reload after editing
```

### Mock

Return a response without hitting upstream:

```typescript
import type { Interceptor } from "htpx-cli/interceptors";

export default {
  name: "mock-users",
  match: (req) => req.path === "/api/users",
  handler: async () => ({
    status: 200,
    headers: { "content-type": "application/json" },
    body: JSON.stringify([{ id: 1, name: "Alice" }]),
  }),
} satisfies Interceptor;
```

### Modify

Forward to upstream, then alter the response:

```typescript
import type { Interceptor } from "htpx-cli/interceptors";

export default {
  name: "inject-header",
  match: (req) => req.host.includes("example.com"),
  handler: async (ctx) => {
    const response = await ctx.forward();
    return { ...response, headers: { ...response.headers, "x-debug": "htpx" } };
  },
} satisfies Interceptor;
```

### Observe

Log traffic without altering it:

```typescript
import type { Interceptor } from "htpx-cli/interceptors";

export default {
  name: "log-api",
  match: (req) => req.path.startsWith("/api/"),
  handler: async (ctx) => {
    ctx.log(`${ctx.request.method} ${ctx.request.url}`);
    const response = await ctx.forward();
    ctx.log(`  -> ${response.status}`);
    return response;
  },
} satisfies Interceptor;
```

### Query Past Traffic

Interceptors can query the traffic database via `ctx.htpx`. This lets you build mocks that react to what's already happened — rate limiting, conditional failures, responses based on prior requests:

```typescript
import type { Interceptor } from "htpx-cli/interceptors";

export default {
  name: "rate-limit",
  match: (req) => req.path.startsWith("/api/"),
  handler: async (ctx) => {
    // Count how many requests this endpoint has seen in the last minute
    const since = new Date(Date.now() - 60_000).toISOString();
    const count = await ctx.htpx.countRequests({
      path: ctx.request.path,
      since,
    });

    if (count >= 10) {
      return {
        status: 429,
        headers: { "retry-after": "60" },
        body: JSON.stringify({ error: "rate_limited" }),
      };
    }

    return ctx.forward();
  },
} satisfies Interceptor;
```

### Handler Context

| Property | Description |
|----------|-------------|
| `ctx.request` | The incoming request (frozen, read-only) |
| `ctx.forward()` | Forward to upstream, returns the response |
| `ctx.htpx` | Query captured traffic (see below) |
| `ctx.log(msg)` | Write to `.htpx/htpx.log` |

#### `ctx.htpx`

| Method | Description |
|--------|-------------|
| `countRequests(filter?)` | Count matching requests |
| `listRequests({ filter?, limit?, offset? })` | List request summaries |
| `getRequest(id)` | Full request details by ID |
| `searchBodies({ query, ...filter? })` | Full-text search through bodies |
| `queryJsonBodies({ json_path, ...filter? })` | Extract values from JSON bodies via JSONPath |

### How Interceptors Work

- Any `.ts` file in `.htpx/interceptors/` is loaded automatically
- Files load alphabetically; first match wins
- `match` is optional — omit it to match everything
- Hot-reloads on file changes, or run `htpx interceptors reload`
- 30s handler timeout, 5s match timeout
- Errors fall through gracefully (never crashes the proxy)
- `ctx.log()` writes to `.htpx/htpx.log` since `console.log` goes nowhere in the daemon
- Use `satisfies Interceptor` for full intellisense

## MCP Integration

htpx has a built-in [MCP](https://modelcontextprotocol.io/) server that gives AI agents full access to your captured traffic and interceptor system. Agents can search through requests, inspect headers and bodies, and write interceptor files directly into `.htpx/interceptors/`.

This means you can ask things like:

- "Find all failing requests to the payments API and write mocks that return valid responses"
- "Make every 5th request to /api/users return a 429 so I can test rate limiting"
- "What's the average response time for requests to the auth service in the last hour?"
- "Write an interceptor that logs all requests with missing auth headers"

The agent reads your traffic, writes the TypeScript, and htpx hot-reloads it.

### Setup

Add htpx to your MCP client config:

```json
{
  "mcpServers": {
    "htpx": {
      "command": "htpx",
      "args": ["mcp"]
    }
  }
}
```

`htpx on` must be running — the MCP server connects to the same daemon as the TUI.

### Agent Skill

htpx also ships an agent skill that teaches AI assistants how to use the MCP tools properly. Gets you better results out of the box.

**Claude Code:**

```bash
/plugin marketplace add mtford90/htpx
/plugin install htpx
```

**npm-agentskills** (works with Cursor, Copilot, Codex, etc.):

```bash
npx agents export --target claude
```

### Available Tools

| Tool | Description |
|------|-------------|
| `htpx_get_status` | Daemon status, proxy port, request count |
| `htpx_list_requests` | Search and filter captured requests |
| `htpx_get_request` | Full request details by ID (headers, bodies, timing) |
| `htpx_search_bodies` | Full-text search through body content |
| `htpx_query_json` | Extract values from JSON bodies via JSONPath |
| `htpx_count_requests` | Count matching requests |
| `htpx_clear_requests` | Delete all captured requests |
| `htpx_list_sessions` | List active proxy sessions |
| `htpx_list_interceptors` | List loaded interceptors with status and errors |
| `htpx_reload_interceptors` | Reload interceptors from disk |

### Filtering

Most tools accept these filters:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `method` | HTTP method(s), comma-separated | `"GET,POST"` |
| `status_range` | Status code, Nxx pattern, or range | `"4xx"`, `"401"`, `"500-503"` |
| `search` | Substring match on URL/path | `"api/users"` |
| `host` | Exact or suffix match (prefix with `.`) | `"api.example.com"`, `".example.com"` |
| `path` | Path prefix match | `"/api/v2"` |
| `since` / `before` | Time window (ISO 8601) | `"2024-01-15T10:30:00Z"` |
| `header_name` | Filter by header existence or value | `"content-type"` |
| `header_value` | Exact header value (requires `header_name`) | `"application/json"` |
| `header_target` | Which headers to search | `"request"`, `"response"`, `"both"` |
| `intercepted_by` | Filter by interceptor name | `"mock-users"` |
| `offset` | Pagination offset (0-based) | `0` |
| `limit` | Max results (default 50, max 500) | `100` |

`htpx_get_request` accepts comma-separated IDs for batch fetching (e.g. `"id1,id2,id3"`).

`htpx_query_json` also takes:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `target` | Which body to query: `"request"`, `"response"`, or `"both"` (default) | `"response"` |
| `value` | Exact value match after JSONPath extraction | `"active"` |

### Output Formats

All query tools accept a `format` parameter:

- `text` (default) — markdown summaries, readable by humans and AI
- `json` — structured JSON for programmatic use

### Examples

```
htpx_list_requests({ status_range: "5xx", path: "/api" })
htpx_search_bodies({ query: "error_code", method: "POST" })
htpx_query_json({ json_path: "$.user.id", target: "response" })
htpx_list_requests({ header_name: "authorization", header_target: "request" })
```

## How It Works

```
┌─────────────────────────────────────────────────────────────┐
│  Your Shell                                                 │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  curl, wget, node, python...                        │   │
│  │          │                                          │   │
│  │          ▼                                          │   │
│  │  HTTP_PROXY=localhost:54321                         │   │
│  └─────────────────────────────────────────────────────┘   │
│                          │                                  │
└──────────────────────────┼──────────────────────────────────┘
                           ▼
┌─────────────────────────────────────────────────────────────┐
│  htpx daemon                                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ MITM Proxy  │───▶│   SQLite    │◀───│ Control API │     │
│  │  (mockttp)  │    │  requests   │    │ (unix sock) │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │
┌──────────────────────────┼──────────────────────────────────┐
│  htpx tui                │                                  │
│  ┌───────────────────────┴─────────────────────────────┐   │
│  │ ● POST /api/users   │ POST https://api.example.com  │   │
│  │   GET  /health      │ Status: 200 │ Duration: 45ms  │   │
│  │   POST /login       │                               │   │
│  │                     │ Request Headers:              │   │
│  │                     │   Content-Type: application/  │   │
│  └─────────────────────┴───────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

`htpx on` starts a daemon, sets `HTTP_PROXY`/`HTTPS_PROXY` in your shell, and captures everything that flows through. `htpx off` unsets them. The TUI connects to the daemon via Unix socket.

### Environment Variables

`htpx on` sets these in your shell (`htpx off` unsets them):

| Variable | Purpose |
|----------|---------|
| `HTTP_PROXY` | Proxy URL for HTTP clients |
| `HTTPS_PROXY` | Proxy URL for HTTPS clients |
| `SSL_CERT_FILE` | CA cert path (curl, git, etc.) |
| `REQUESTS_CA_BUNDLE` | CA cert path (Python requests) |
| `NODE_EXTRA_CA_CERTS` | CA cert path (Node.js) |
| `HTPX_SESSION_ID` | UUID identifying the current session |
| `HTPX_LABEL` | Session label (when `-l` flag used) |

## Configuration

Create `.htpx/config.json` to override defaults. All fields are optional:

```json
{
  "maxStoredRequests": 5000,
  "maxBodySize": 10485760,
  "maxLogSize": 10485760,
  "pollInterval": 2000
}
```

| Setting | Default | Description |
|---------|---------|-------------|
| `maxStoredRequests` | `5000` | Max requests in the database. Oldest evicted automatically. |
| `maxBodySize` | `10485760` (10 MB) | Max body size to capture. Larger bodies are proxied but not stored. |
| `maxLogSize` | `10485760` (10 MB) | Max log file size before rotation. |
| `pollInterval` | `2000` | TUI polling interval in ms. Lower = faster updates, more IPC traffic. |

Missing or invalid values fall back to defaults.

## Supported HTTP Clients

Anything that respects `HTTP_PROXY` works:

| Client | Support |
|--------|---------|
| curl | Automatic |
| wget | Automatic |
| Node.js (fetch, axios, etc.) | With `NODE_EXTRA_CA_CERTS` |
| Python (requests, httpx) | With `REQUESTS_CA_BUNDLE` |
| Go | Automatic |
| Rust (reqwest) | Automatic |

## Export

Press `c` to copy a request as curl:

```bash
curl -X POST 'https://api.example.com/users' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer token123' \
  -d '{"name": "test"}'
```

Press `H` to export all requests as a HAR file. Compatible with browser dev tools.

Press `s` on a body to open the export modal — clipboard, `.htpx/exports/`, `~/Downloads/`, custom path, or open in default application.

## TUI Keybindings

`j`/`k` to navigate, `Tab` to switch panels, `/` to filter, `c` to copy as curl, `Enter` to inspect bodies, `q` to quit.

Mouse support: click to select, scroll to navigate, click panels to focus.

<details>
<summary>Full keybinding reference</summary>

### Main View

| Key | Action |
|-----|--------|
| `j`/`k` or `↑`/`↓` | Navigate up/down |
| `g` / `G` | Jump to first / last item |
| `Ctrl+u` / `Ctrl+d` | Half-page up / down |
| `Ctrl+f` / `Ctrl+b` | Full-page down / up |
| `Tab` / `Shift+Tab` | Next / previous panel |
| `1`-`5` | Jump to section (list / request / request body / response / response body) |
| `Enter` | Open body in full-screen viewer |
| `/` | Open filter bar |
| `u` | Toggle full URL display |
| `c` | Copy request as curl |
| `y` | Copy body to clipboard |
| `s` | Export body (opens export modal) |
| `H` | Export all as HAR |
| `r` | Refresh |
| `?` | Help |
| `i` | Proxy connection info |
| `q` | Quit |

### Filter Bar (`/`)

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle between search, method, status fields |
| `←` / `→` | Cycle method (ALL/GET/POST/PUT/PATCH/DELETE) or status (ALL/2xx-5xx) |
| `Return` | Apply filter |
| `Esc` | Cancel and revert |

### JSON Explorer (Enter on a JSON body)

| Key | Action |
|-----|--------|
| `j`/`k` | Navigate nodes |
| `Enter`/`l` | Expand/collapse node |
| `h` | Collapse node |
| `e` / `c` | Expand / collapse all |
| `/` | Filter by path |
| `n` / `N` | Next / previous match |
| `y` | Copy value |
| `q` / `Esc` | Close |

### Text Viewer (Enter on a non-JSON body)

| Key | Action |
|-----|--------|
| `j`/`k` | Scroll line by line |
| `Space` | Page down |
| `g` / `G` | Top / bottom |
| `/` | Search text |
| `n` / `N` | Next / previous match |
| `y` | Copy to clipboard |
| `q` / `Esc` | Close |

</details>

## CLI Reference

### Global Options

| Flag | Description |
|------|-------------|
| `-v, --verbose` | Increase log verbosity (stackable: `-vv`, `-vvv`) |
| `-d, --dir <path>` | Override project root directory |

### `htpx init`

Output shell configuration for your `.zshrc`/`.bashrc`.

### `htpx on`

Start intercepting HTTP traffic. Sets proxy environment variables in your shell.

| Flag | Description |
|------|-------------|
| `-l, --label <label>` | Label this session (visible in TUI and MCP) |
| `--no-restart` | Don't auto-restart daemon on version mismatch |

### `htpx off`

Stop intercepting HTTP traffic. Unsets proxy environment variables.

### `htpx tui`

Open the interactive TUI.

| Flag | Description |
|------|-------------|
| `--ci` | CI mode: render once and exit (for testing) |

### `htpx status`

Show comprehensive status: daemon state, interception state, sessions, request count, loaded interceptors.

### `htpx daemon stop`

Stop the daemon.

### `htpx daemon restart`

Restart the daemon (or start it if not running).

### `htpx clear`

Clear all captured requests.

### `htpx debug-dump`

Collect diagnostics (system info, daemon status, recent logs) into `.htpx/debug-dump-<timestamp>.json`.

### `htpx mcp`

Start the MCP server (stdio transport). See [MCP Integration](#mcp-integration).

### `htpx project init`

Manually initialise a `.htpx` directory in the current location.

### `htpx interceptors`

List loaded interceptors, or manage them with subcommands.

### `htpx interceptors init`

Scaffold an example interceptor in `.htpx/interceptors/`.

### `htpx interceptors reload`

Reload interceptors from disk without restarting the daemon.

## Development

```bash
git clone https://github.com/mtford90/htpx.git
cd htpx
npm install

npm run build        # Compile TypeScript
npm test             # Run all tests
npm run typecheck    # Type checking only
npm run lint         # ESLint
npm run dev          # Watch mode
```

## Troubleshooting

### Certificate errors

htpx sets common CA environment variables automatically, but some tools need manual configuration:

```bash
cat .htpx/ca.pem
```

### Daemon won't start

Check if something else is using the socket:

```bash
htpx status
htpx daemon stop
htpx on
```

### Terminal too small

The TUI needs at least 60 columns by 10 rows.

### Requests not appearing

Your HTTP client needs to respect proxy environment variables. Browsers typically don't — use curl, wget, or language-level HTTP clients instead.

## Licence

MIT
