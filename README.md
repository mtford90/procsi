# htpx

[![npm version](https://img.shields.io/npm/v/htpx-cli.svg)](https://www.npmjs.com/package/htpx-cli)
[![CI](https://github.com/mtford90/htpx/actions/workflows/ci.yml/badge.svg)](https://github.com/mtford90/htpx/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A terminal-based HTTP interception toolkit with project-scoped isolation and a lazygit-style TUI.

Capture HTTP/HTTPS traffic through a MITM proxy and inspect it in an interactive terminal interface. No browser extensions, no separate apps—just your terminal.

## Features

- **Project-scoped isolation** — Each project gets its own `.htpx/` directory, keeping traffic separate
- **Interactive TUI** — Browse, inspect, and export requests with vim-style keybindings and mouse support
- **Full HTTPS support** — Automatic CA certificate generation and trust
- **Export anywhere** — Generate curl commands or HAR files from captured requests
- **AI-native** — Built-in MCP server lets AI agents search, filter, and inspect your traffic
- **Config-as-code interceptors** — Mock, modify, or observe HTTP traffic with TypeScript files in `.htpx/interceptors/`
- **Zero config** — Works out of the box with curl, wget, Node.js, Python, and more

## Quick Start

```bash
# Install globally
npm install -g htpx-cli

# One-time shell setup (add to ~/.zshrc or ~/.bashrc)
eval "$(htpx init)"

# Start intercepting in your project directory
htpx intercept

# Make some requests...
curl https://api.example.com/users

# Open the TUI to inspect
htpx tui
```

## Installation

```bash
npm install -g htpx-cli
```

**Requirements:** Node.js 20 or later

### Shell Setup

Add the following to your `~/.zshrc` or `~/.bashrc`:

```bash
eval "$(htpx init)"
```

This creates a shell function that properly sets up proxy environment variables in your current session.

## Usage

### Start Intercepting

```bash
htpx intercept
```

This auto-starts the daemon, sets up the proxy, and configures your shell to route HTTP traffic through htpx.

### Browse Captured Traffic

```bash
htpx tui
```

### TUI Keybindings

Mouse support: click to select requests, click panels to focus, scroll wheel to navigate lists and sections.

**Main View:**

| Key | Action |
|-----|--------|
| `j`/`k` or `↑`/`↓` | Navigate up/down |
| `g` / `G` | Jump to first / last item |
| `Ctrl+u` / `Ctrl+d` | Half-page up / down |
| `Ctrl+f` / `Ctrl+b` | Full-page down / up |
| `Tab` / `Shift+Tab` | Next / previous panel |
| `1`–`5` | Jump to section (list / request / request body / response / response body) |
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

**Filter Bar** (`/`):

| Key | Action |
|-----|--------|
| `Tab` / `Shift+Tab` | Cycle between search, method, status fields |
| `←` / `→` | Cycle method (ALL/GET/POST/PUT/PATCH/DELETE) or status (ALL/2xx–5xx) |
| `Return` | Apply filter |
| `Esc` | Cancel and revert |

**JSON Explorer** (Enter on a JSON body):

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

**Text Viewer** (Enter on a non-JSON body):

| Key | Action |
|-----|--------|
| `j`/`k` | Scroll line by line |
| `Space` | Page down |
| `g` / `G` | Top / bottom |
| `/` | Search text |
| `n` / `N` | Next / previous match |
| `y` | Copy to clipboard |
| `q` / `Esc` | Close |

### Other Commands

```bash
htpx status    # Check daemon status
htpx stop      # Stop the daemon
htpx clear     # Clear captured requests
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

When you run `htpx intercept`:

1. A daemon starts in the background with a MITM proxy
2. Environment variables (`HTTP_PROXY`, `HTTPS_PROXY`, etc.) are set in your shell
3. HTTP clients that respect these variables route traffic through the proxy
4. Requests are captured and stored in a local SQLite database
5. The TUI connects via Unix socket to display captured traffic

### Environment Variables

`htpx intercept` sets the following in your shell:

| Variable | Purpose |
|----------|---------|
| `HTTP_PROXY` | Proxy URL for HTTP clients |
| `HTTPS_PROXY` | Proxy URL for HTTPS clients |
| `SSL_CERT_FILE` | CA certificate path (curl, git, etc.) |
| `REQUESTS_CA_BUNDLE` | CA certificate path (Python requests) |
| `NODE_EXTRA_CA_CERTS` | CA certificate path (Node.js) |
| `HTPX_SESSION_ID` | UUID identifying the current session |
| `HTPX_LABEL` | Session label (when `-l` flag used) |

### Project Isolation

htpx creates a `.htpx/` directory in your project root (detected by `.git` or existing `.htpx`):

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

Different projects have completely separate daemons, databases, and certificates.

### Configuration

Create `.htpx/config.json` to override default behaviour. All fields are optional:

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
| `maxStoredRequests` | `5000` | Maximum requests kept in the database. Oldest are evicted automatically. |
| `maxBodySize` | `10485760` (10 MB) | Maximum body size in bytes to capture per request/response. Larger bodies are still proxied but not stored. |
| `maxLogSize` | `10485760` (10 MB) | Maximum log file size in bytes before rotation. |
| `pollInterval` | `2000` | TUI polling interval in milliseconds. Lower values give faster updates at the cost of more IPC traffic. |

If the file is missing or contains invalid values, defaults are used.

## Interceptors

TypeScript files in `.htpx/interceptors/` that can mock, modify, or observe HTTP traffic.

### Getting Started

```bash
# Scaffold an example interceptor
htpx interceptors init

# Edit .htpx/interceptors/example.ts, then:
htpx interceptors reload
# Or just restart: htpx stop && htpx intercept
```

### Mock — Return a Response Without Hitting Upstream

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

### Modify — Forward to Upstream, Alter the Response

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

### Observe — Inspect Traffic Without Altering It

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

### Handler Context

| Property | Description |
|----------|-------------|
| `ctx.request` | The incoming request (frozen — read-only) |
| `ctx.forward()` | Forward to upstream, returns the response |
| `ctx.htpx` | Query API for captured traffic (see below) |
| `ctx.log(msg)` | Write to `.htpx/htpx.log` |

#### `ctx.htpx` — Query API

| Method | Description |
|--------|-------------|
| `countRequests(filter?)` | Count matching captured requests |
| `listRequests({ filter?, limit?, offset? })` | List request summaries |
| `getRequest(id)` | Fetch full request details by ID |
| `searchBodies({ query, ...filter? })` | Full-text search through bodies |
| `queryJsonBodies({ json_path, ...filter? })` | Extract values from JSON bodies using JSONPath |

### How It Works

- Any `.ts` file in `.htpx/interceptors/` is loaded as an interceptor
- Files are loaded alphabetically; the first matching interceptor wins
- `match` is optional — omit it to match all requests
- Interceptors hot-reload on file changes, or run `htpx interceptors reload`
- Handler timeout is 30s, match timeout is 5s
- Errors in interceptors result in graceful pass-through (never crashes the proxy)
- `ctx.log()` writes to `.htpx/htpx.log` (since `console.log` goes nowhere in the daemon)
- Use `satisfies Interceptor` for full intellisense

## Supported HTTP Clients

htpx works with any client that respects the `HTTP_PROXY` environment variable:

| Client | Support |
|--------|---------|
| curl | ✅ Automatic |
| wget | ✅ Automatic |
| Node.js (fetch, axios, etc.) | ✅ With `NODE_EXTRA_CA_CERTS` |
| Python (requests, httpx) | ✅ With `REQUESTS_CA_BUNDLE` |
| Go | ✅ Automatic |
| Rust (reqwest) | ✅ Automatic |

## Export Formats

### curl

Press `c` in the TUI to copy a request as a curl command:

```bash
curl -X POST 'https://api.example.com/users' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer token123' \
  -d '{"name": "test"}'
```

### HAR

Press `H` to export all captured requests as a HAR file, compatible with browser dev tools and HTTP analysis tools.

### Body Export

Press `s` on a body section to open the export modal:

1. **Copy to clipboard**
2. **Save to `.htpx/exports/`**
3. **Save to `~/Downloads/`**
4. **Custom path** — specify a directory
5. **Open externally** — open in default application

## MCP Integration

htpx includes a built-in [Model Context Protocol](https://modelcontextprotocol.io/) server, allowing AI agents and IDE integrations to search, filter, and inspect captured HTTP traffic programmatically.

### Setup

Add htpx to your MCP client configuration. For example, in Claude Desktop or Claude Code:

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

The MCP server connects to the same daemon that serves the TUI, so `htpx intercept` must be running in the project directory.

### Available Tools

| Tool | Description |
|------|-------------|
| `htpx_get_status` | Check if the daemon is running, get proxy port and request count |
| `htpx_list_requests` | Search and filter captured requests (returns summaries) |
| `htpx_get_request` | Fetch full request details by ID (headers, bodies, timing) |
| `htpx_search_bodies` | Full-text search through request/response body content |
| `htpx_query_json` | Extract values from JSON bodies using JSONPath expressions |
| `htpx_count_requests` | Count requests matching a filter |
| `htpx_clear_requests` | Delete all captured requests |
| `htpx_list_sessions` | List active proxy sessions |
| `htpx_list_interceptors` | List loaded interceptors with status and errors |
| `htpx_reload_interceptors` | Reload interceptors from disk |

### Filtering

Most tools support a common set of filters that can be combined:

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

`htpx_get_request` accepts comma-separated IDs (e.g. `"id1,id2,id3"`) for batch fetching.

`htpx_query_json` supports additional parameters:

| Parameter | Description | Example |
|-----------|-------------|---------|
| `target` | Which body to query: `"request"`, `"response"`, or `"both"` (default) | `"response"` |
| `value` | Filter for exact value match after JSONPath extraction | `"active"` |

### Output Formats

All query tools accept a `format` parameter:

- **`text`** (default) — Human/AI-readable markdown summaries
- **`json`** — Structured JSON for programmatic consumption

### Example Workflows

**Find all failed API requests:**

```
htpx_list_requests({ status_range: "5xx", path: "/api" })
```

**Search for a specific value in response bodies:**

```
htpx_search_bodies({ query: "error_code", method: "POST" })
```

**Extract user IDs from JSON responses:**

```
htpx_query_json({ json_path: "$.user.id", target: "response" })
```

**Find requests with a specific auth header:**

```
htpx_list_requests({ header_name: "authorization", header_target: "request" })
```

## Agent Skill

htpx ships with an agent skill that teaches AI assistants how to use htpx's MCP tools effectively. Install it to get better results from Claude Code, Cursor, and other AI coding tools.

### Claude Code Plugin

```bash
# In Claude Code, run:
/plugin marketplace add mtford90/htpx
/plugin install htpx
```

### npm-agentskills (cross-agent)

Works with Claude Code, Cursor, Copilot, Codex, and more:

```bash
# If htpx-cli is already installed in your project
npx agents export --target claude
```

## CLI Reference

### Global Options

| Flag | Description |
|------|-------------|
| `-v, --verbose` | Increase log verbosity (stackable: `-vv`, `-vvv`) |
| `-d, --dir <path>` | Override project root directory |

### `htpx init`

Output shell configuration for your `.zshrc`/`.bashrc`.

### `htpx intercept`

Start intercepting HTTP traffic.

| Flag | Description |
|------|-------------|
| `-l, --label <label>` | Label this session (visible in TUI and MCP) |
| `--no-restart` | Don't auto-restart daemon on version mismatch |

### `htpx tui`

Open the interactive TUI.

| Flag | Description |
|------|-------------|
| `--ci` | CI mode: render once and exit (for testing) |

### `htpx status`

Show daemon status, including proxy port, active sessions, and request count.

### `htpx stop`

Stop the daemon gracefully.

### `htpx restart`

Restart the daemon (or start it if not running).

### `htpx clear`

Clear all captured requests from the database.

### `htpx debug-dump`

Collect diagnostic information (system info, daemon status, recent logs) into `.htpx/debug-dump-<timestamp>.json`.

### `htpx mcp`

Start the MCP server (stdio transport) for AI tool integration. See [MCP Integration](#mcp-integration) for details.

### `htpx project init`

Manually initialise a `.htpx` directory in the current location.

### `htpx interceptors`

List loaded interceptors, or manage them with subcommands.

### `htpx interceptors init`

Create an example interceptor file in `.htpx/interceptors/`.

### `htpx interceptors reload`

Reload interceptors from disk without restarting the daemon.

## Development

```bash
# Clone and install
git clone https://github.com/mtford90/htpx.git
cd htpx
npm install

# Build
npm run build

# Run tests
npm test

# Type check and lint
npm run typecheck
npm run lint

# Development mode (watch)
npm run dev
```

## Troubleshooting

### Certificate errors

Some tools need explicit CA certificate configuration. htpx sets common environment variables automatically, but you may need to configure your specific tool:

```bash
# The CA certificate is at:
cat .htpx/ca.pem
```

### Daemon won't start

Check if another process is using the socket:

```bash
htpx status
htpx stop
htpx intercept
```

### Terminal too small

The TUI requires a minimum terminal size of 60 columns × 10 rows. If your terminal is smaller, it will display a resize prompt instead of the main interface.

### Requests not appearing

Ensure your HTTP client respects proxy environment variables. Some clients (like browsers) ignore `HTTP_PROXY` by default.

## Licence

MIT
