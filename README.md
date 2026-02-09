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

| Key | Action |
|-----|--------|
| `j`/`k` | Navigate up/down |
| `Tab` or `1`/`2` | Switch panels |
| `u` | Toggle full URL |
| `c` | Copy as curl |
| `h` | Export HAR |
| `r` | Refresh |
| `q` | Quit |

Mouse support: click to select requests, scroll wheel to navigate, click panels to focus.

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

### Project Isolation

htpx creates a `.htpx/` directory in your project root (detected by `.git` or existing `.htpx`):

```
your-project/
├── .htpx/
│   ├── proxy.port      # Proxy TCP port
│   ├── control.sock    # IPC socket
│   ├── requests.db     # Captured traffic
│   ├── ca.pem          # CA certificate
│   └── daemon.pid      # Process ID
└── src/...
```

Different projects have completely separate daemons, databases, and certificates.

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

Press `h` to export all captured requests as a HAR file, compatible with browser dev tools and HTTP analysis tools.

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

## CLI Reference

### `htpx init`

Output shell configuration for your `.zshrc`/`.bashrc`.

### `htpx intercept`

Start intercepting HTTP traffic.

### `htpx tui`

Open the interactive TUI.

### `htpx status`

Show daemon status, including proxy port, active sessions, and request count.

### `htpx stop`

Stop the daemon gracefully.

### `htpx clear`

Clear all captured requests from the database.

### `htpx mcp`

Start the MCP server (stdio transport) for AI tool integration. See [MCP Integration](#mcp-integration) for details.

### `htpx project init`

Manually initialise a `.htpx` directory in the current location.

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

### Requests not appearing

Ensure your HTTP client respects proxy environment variables. Some clients (like browsers) ignore `HTTP_PROXY` by default.

## Licence

MIT
