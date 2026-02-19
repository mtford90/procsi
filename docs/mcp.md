# MCP Integration

[Back to README](../README.md) | [Interceptors](interceptors.md)

procsi has a built-in [MCP](https://modelcontextprotocol.io/) server that gives AI agents full access to your captured traffic and interceptor system. Agents can search through requests, inspect headers and bodies, and write interceptor files directly into `.procsi/interceptors/`.

This means you can ask things like:

- "Find all failing requests to the payments API and write mocks that return valid responses"
- "Make every 5th request to /api/users return a 429 so I can test rate limiting"
- "What's the average response time for requests to the auth service in the last hour?"
- "Write an interceptor that logs all requests with missing auth headers"
- "Send me a notification whenever an api request fails"

The agent reads your traffic, writes the TypeScript, and procsi hot-reloads it.

## Setup

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

## Agent Skill

procsi also ships an agent skill that teaches AI assistants how to use the MCP tools properly. Gets you better results out of the box.

**Claude Code:**

```bash
/plugin marketplace add mtford90/procsi
/plugin install procsi
```

**npm-agentskills** (works with Cursor, Copilot, Codex, etc.):

```bash
npx agents export --target claude
```

## Available Tools

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

## Filtering

Most tools accept these filters:

| Parameter          | Description                                 | Example                               |
| ------------------ | ------------------------------------------- | ------------------------------------- |
| `method`           | HTTP method(s), comma-separated             | `"GET,POST"`                          |
| `status_range`     | Status code, Nxx pattern, or range          | `"4xx"`, `"401"`, `"500-503"`         |
| `search`           | Substring match on URL/path                 | `"api/users"`                         |
| `regex`            | JavaScript regex match on full URL          | `"users/\\d+$"`, `"/users\\\\/\\\\d+/i"` |
| `host`             | Exact or suffix match (prefix with `.`)     | `"api.example.com"`, `".example.com"` |
| `path`             | Path prefix match                           | `"/api/v2"`                           |
| `since` / `before` | Time window (ISO 8601)                      | `"2024-01-15T10:30:00Z"`              |
| `header_name`      | Filter by header existence or value         | `"content-type"`                      |
| `header_value`     | Exact header value (requires `header_name`) | `"application/json"`                  |
| `header_target`    | Which headers to search                     | `"request"`, `"response"`, `"both"`   |
| `saved`            | Filter by saved/bookmarked state            | `true`, `false`                         |
| `source`           | Filter by request source                    | `"node"`, `"python"`                  |
| `intercepted_by`   | Filter by interceptor name                  | `"mock-users"`                        |
| `offset`           | Pagination offset (0-based)                 | `0`                                   |
| `limit`            | Max results (default 50, max 500)           | `100`                                 |

`procsi_get_request` accepts comma-separated IDs for batch fetching (e.g. `"id1,id2,id3"`).

`procsi_query_json` also takes:

| Parameter | Description                                                           | Example      |
| --------- | --------------------------------------------------------------------- | ------------ |
| `target`  | Which body to query: `"request"`, `"response"`, or `"both"` (default) | `"response"` |
| `value`   | Exact value match after JSONPath extraction                           | `"active"`   |

## Output Formats

All query tools accept a `format` parameter:

- `text` (default) — markdown summaries, readable by humans and AI
- `json` — structured JSON for programmatic use

## Examples

```
procsi_list_requests({ status_range: "5xx", path: "/api" })
procsi_search_bodies({ query: "error_code", method: "POST" })
procsi_list_requests({ regex: "users/\\d+$" })
procsi_query_json({ json_path: "$.user.id", target: "response" })
procsi_list_requests({ header_name: "authorization", header_target: "request" })
```
