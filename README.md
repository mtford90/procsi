# procsi

[![npm version](https://img.shields.io/npm/v/procsi.svg)](https://www.npmjs.com/package/procsi)
[![CI](https://github.com/mtford90/procsi/actions/workflows/ci.yml/badge.svg)](https://github.com/mtford90/procsi/actions/workflows/ci.yml)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

Procsi is a terminal-based, project-isolated HTTP proxy with a powerful CLI & MCP server. Quickly intercept, inspect & rewrite HTTP traffic from the comfort of your terminal or favourite AI agent.

![procsi demo](demo.gif)

## Feature Highlights

- **Project isolation** — each project gets its own `.procsi/` directory with a separate daemon, database, CA cert and interceptors
- **MCP server** — AI agents get full access to your captured traffic and can write interceptor files for you. Search, filter, inspect, mock — all via tool calls.
- **Interceptors** — mock, modify or observe traffic with `.ts` files. Match on anything, query past traffic from within handlers, compose complex scenarios.

## Quick Start

```bash
npm install -g procsi

# Configure environment e.g. HTTP_PROXY
eval "$(procsi on)"

# Send a request
curl https://api.example.com/users

# Open UI
procsi tui
```

## Project Isolation

procsi doesn't use a global system proxy. Each project gets its own `.procsi/` directory in the project root (detected by `.git` or an existing `.procsi/`):

```
your-project/
├── .procsi/
│   ├── interceptors/   # TypeScript interceptor files
│   ├── config.json     # Optional project config
│   ├── proxy.port      # Proxy TCP port
│   ├── control.sock    # IPC socket
│   ├── requests.db     # Captured traffic
│   ├── ca.pem          # CA certificate
│   └── daemon.pid      # Process ID
└── src/...
```

Separate daemon, database, certificates etc. You can run procsi in multiple projects at the same time without them interfering with each other.

## Use cases

- AI analysis
- Chaos monkey
- Mock out APIs that do not yet exist

## MCP Integration

procsi has a built-in [MCP](https://modelcontextprotocol.io/) server that gives AI agents full access to your captured traffic and interceptor system.

### Setup

Add procsi to your MCP client config:

```json
{
  "mcpServers": {
    "procsi": {
      "command": "procsi",
      "args": ["mcp"]
    }
  }
}
```

The proxy must be running (`eval "$(procsi on)"`) — the MCP server connects to the same daemon as the TUI.

### Available Tools

| Tool                         | Description                                          |
| ---------------------------- | ---------------------------------------------------- |
| `procsi_get_status`          | Daemon status, proxy port, request count             |
| `procsi_list_requests`       | Search and filter captured requests                  |
| `procsi_get_request`         | Full request details by ID (headers, bodies, timing) |
| `procsi_search_bodies`       | Full-text search through body content                |
| `procsi_query_json`          | Extract values from JSON bodies via JSONPath         |
| `procsi_count_requests`      | Count matching requests                              |
| `procsi_clear_requests`      | Delete all captured requests                         |
| `procsi_list_sessions`       | List active proxy sessions                           |
| `procsi_list_interceptors`   | List loaded interceptors with status and errors      |
| `procsi_reload_interceptors` | Reload interceptors from disk                        |

See [full MCP documentation](docs/mcp.md) for filtering, output formats, and examples.

## Interceptors

TypeScript files in `.procsi/interceptors/` that intercept HTTP traffic as it passes through the proxy. They can return mock responses, modify upstream responses, or just observe.

```typescript
import type { Interceptor } from "procsi/interceptors";

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

See [full interceptors documentation](docs/interceptors.md) for modify, observe, querying past traffic, handler context, and how they work.

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
│  procsi daemon                                                │
│  ┌─────────────┐    ┌─────────────┐    ┌─────────────┐     │
│  │ MITM Proxy  │───▶│   SQLite    │◀───│ Control API │     │
│  │  (mockttp)  │    │  requests   │    │ (unix sock) │     │
│  └─────────────┘    └─────────────┘    └─────────────┘     │
└─────────────────────────────────────────────────────────────┘
                           ▲
                           │
┌──────────────────────────┼──────────────────────────────────┐
│  procsi tui                │                                  │
│  ┌───────────────────────┴─────────────────────────────┐   │
│  │ ● POST /api/users   │ POST https://api.example.com  │   │
│  │   GET  /health      │ Status: 200 │ Duration: 45ms  │   │
│  │   POST /login       │                               │   │
│  │                     │ Request Headers:              │   │
│  │                     │   Content-Type: application/  │   │
│  └─────────────────────┴───────────────────────────────┘   │
└─────────────────────────────────────────────────────────────┘
```

`eval "$(procsi on)"` starts a daemon, sets `HTTP_PROXY`/`HTTPS_PROXY` in your shell, and captures everything that flows through. `eval "$(procsi off)"` unsets them. The TUI connects to the daemon via Unix socket.

### Environment Variables

`eval "$(procsi on)"` sets these in your shell (`eval "$(procsi off)"` unsets them):

| Variable              | Purpose                              |
| --------------------- | ------------------------------------ |
| `HTTP_PROXY`          | Proxy URL for HTTP clients           |
| `HTTPS_PROXY`         | Proxy URL for HTTPS clients          |
| `SSL_CERT_FILE`       | CA cert path (curl, OpenSSL)         |
| `REQUESTS_CA_BUNDLE`  | CA cert path (Python requests)       |
| `CURL_CA_BUNDLE`      | CA cert path (curl/Python fallback)  |
| `NODE_EXTRA_CA_CERTS` | CA cert path (Node.js)               |
| `DENO_CERT`           | CA cert path (Deno)                  |
| `CARGO_HTTP_CAINFO`   | CA cert path (Rust Cargo)            |
| `GIT_SSL_CAINFO`      | CA cert path (Git)                   |
| `AWS_CA_BUNDLE`       | CA cert path (AWS CLI)               |
| `CGI_HTTP_PROXY`      | Proxy URL (PHP CGI, HTTPoxy-safe)    |
| `PROCSI_SESSION_ID`   | UUID identifying the current session |
| `PROCSI_LABEL`        | Session label (when `-l` flag used)  |

Additionally, `procsi on` sets `PYTHONPATH`, `RUBYOPT`, and `PHP_INI_SCAN_DIR` to load runtime-specific override scripts that ensure edge-case HTTP clients trust the proxy CA.

## Configuration

Create `.procsi/config.json` to override defaults:

```json
{
  "maxStoredRequests": 5000,
  "maxBodySize": 10485760,
  "maxLogSize": 10485760,
  "pollInterval": 2000
}
```

See [full configuration documentation](docs/configuration.md) for details on each setting.

## Supported HTTP Clients

Anything that respects `HTTP_PROXY` works. procsi sets the right CA cert env vars for each runtime automatically.

**Works automatically (env vars only):**

| Client                       | Support                    |
| ---------------------------- | -------------------------- |
| curl                         | Automatic                  |
| wget                         | Automatic                  |
| Go (`net/http`)              | Automatic                  |
| Rust (reqwest)               | Automatic                  |
| .NET (`HttpClient`)          | Automatic                  |
| Deno                         | Automatic (`DENO_CERT`)    |
| Bun                          | Automatic (`SSL_CERT_FILE`)|
| Git                          | Automatic (`GIT_SSL_CAINFO`)|
| AWS CLI                      | Automatic (`AWS_CA_BUNDLE`)|
| Cargo                        | Automatic (`CARGO_HTTP_CAINFO`)|

**Works with procsi overrides (injection scripts):**

| Client                       | Mechanism                                  |
| ---------------------------- | ------------------------------------------ |
| Node.js (fetch, axios, etc.) | `NODE_OPTIONS --require` preload script    |
| Python (requests, httplib2)  | `PYTHONPATH` sitecustomize.py              |
| Ruby (Net::HTTP, gems)       | `RUBYOPT -r` OpenSSL CA patch              |
| PHP (curl, streams)          | `PHP_INI_SCAN_DIR` custom INI              |

**Not currently supported (needs system-level config):**

| Runtime           | Reason                                           |
| ----------------- | ------------------------------------------------ |
| Java/JVM          | Needs `-javaagent` or JVM trust store config     |
| Swift             | Uses macOS Keychain only                         |
| Dart/Flutter      | Requires code changes for proxy                  |
| Elixir/Erlang     | Requires code changes for proxy                  |

## TUI

`j`/`k` to navigate, `Tab` to switch panels, `/` to filter, `c` to copy as curl, `Enter` to inspect bodies, `q` to quit. Mouse support included.

See [full TUI documentation](docs/tui.md) for all keybindings and export features.

## Documentation

- [CLI Reference](docs/cli-reference.md) — all commands, flags, and examples
- [Interceptors](docs/interceptors.md) — mock, modify, observe, query traffic, handler context
- [MCP Integration](docs/mcp.md) — tools, filtering, output formats, examples
- [TUI](docs/tui.md) — keybindings, export features
- [Configuration](docs/configuration.md) — `.procsi/config.json` options

## Development

```bash
git clone https://github.com/mtford90/procsi.git
cd procsi
npm install

npm run build        # Compile TypeScript
npm test             # Run all tests
npm run typecheck    # Type checking only
npm run lint         # ESLint
npm run dev          # Watch mode
```

## Troubleshooting

### Certificate errors

procsi sets common CA environment variables automatically, but some tools need manual configuration:

```bash
cat .procsi/ca.pem
```

### Daemon won't start

Check if something else is using the socket:

```bash
procsi status
procsi daemon stop
eval "$(procsi on)"
```

### Requests not appearing

Your HTTP client needs to respect proxy environment variables.

There are workarounds implemented for node - e.g. fetch override. Other libraries in different environments may need a similar treatment.

## Licence

AGPL-3.0-or-later
