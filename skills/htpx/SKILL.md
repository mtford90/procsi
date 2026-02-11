# /htpx

Use htpx to inspect, filter, and intercept HTTP traffic. Activate when htpx MCP tools are available or when the user mentions HTTP traffic, API debugging, request interception, or mocking.

## Installation & Setup

If htpx is not installed or the daemon is not running, you can set it up:

1. **Install**: `npm install -g htpx-cli`
2. **Shell setup** (one-time): Add `eval "$(htpx init)"` to the user's shell config (`~/.zshrc` or `~/.bashrc`), then source it or ask them to restart their shell
3. **Start intercepting**: `htpx on` in the project directory
4. **MCP config**: Add htpx to the MCP configuration:
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

After setup, call `htpx_get_status` to verify the daemon is running.

## When to Use htpx

- **Debugging failing API calls** -- filter by status code, inspect headers and response bodies
- **Understanding traffic patterns** -- count requests, group by host/path/method
- **Writing mocks/interceptors** -- capture real traffic as a template, write TypeScript interceptors
- **Investigating auth issues** -- filter by `authorization` header, inspect tokens
- **Performance analysis** -- check response times (`durationMs`), body sizes

## Preflight

Always call `htpx_get_status` first to confirm the daemon is running. If it is not running, try to start it by running `htpx on` in the project directory. If htpx is not installed, follow the Installation & Setup steps above.

## MCP Tool Reference

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `htpx_get_status` | Check daemon is running, get proxy port and request count | -- |
| `htpx_list_requests` | Browse/filter captured traffic (returns summaries) | `method`, `status_range`, `search`, `host`, `path`, `header_name`, `header_value`, `header_target`, `intercepted_by`, `since`, `before`, `limit`, `offset`, `format` |
| `htpx_get_request` | Full request details -- headers, bodies, timing | `id` (single or comma-separated IDs), `format` |
| `htpx_search_bodies` | Full-text search in request/response bodies | `query`, plus all filter params |
| `htpx_query_json` | Extract JSON values with JSONPath (SQLite `json_extract`) | `json_path`, `value`, `target` (`request`/`response`/`both`), plus filters |
| `htpx_count_requests` | Count matching requests | All filter params, `format` |
| `htpx_clear_requests` | Delete all captured traffic (irreversible) | -- |
| `htpx_list_sessions` | List active proxy sessions | -- |
| `htpx_list_interceptors` | List loaded interceptors with status/errors | `format` |
| `htpx_reload_interceptors` | Hot-reload interceptors from disk | `format` |

### Output Formats

All query tools accept `format`:
- `"text"` (default) -- human-readable markdown summaries
- `"json"` -- structured JSON for programmatic processing

Use `"json"` when you need to process results (e.g. extract IDs, compare values). Use `"text"` when presenting to the user.

## Common Filter Patterns

```
status_range: "5xx"            # Server errors
status_range: "4xx"            # Client errors
status_range: "401"            # Exact status code
status_range: "500-503"        # Numeric range
method: "POST,PUT"             # Mutation requests only
host: ".api.example.com"       # Suffix match (note leading dot)
host: "api.example.com"        # Exact match
path: "/api/v2"                # Path prefix match
search: "api/users"            # URL substring match
header_name: "authorization"   # Requests with this header
header_name: "content-type", header_value: "application/json"  # Exact header match
header_target: "request"       # Only search request headers
intercepted_by: "my-mock"      # Requests handled by a specific interceptor
since: "2024-01-15T10:30:00Z"  # Time-bounded queries
```

Filters can be combined freely. All are optional.

## Workflow Patterns

### Pattern 1: Investigate a Bug

1. `htpx_list_requests` with relevant filters (status code, host, path) to find the request
2. `htpx_get_request` with the ID to inspect full headers, bodies, timing
3. If searching for specific content in bodies, use `htpx_search_bodies`

### Pattern 2: Write a Mock Interceptor

1. `htpx_list_requests` to understand the traffic pattern you want to mock
2. `htpx_get_request` to capture a real response as a template
3. Write a `.ts` file to `.htpx/interceptors/` (see interceptor patterns below)
4. `htpx_reload_interceptors` to activate
5. `htpx_list_interceptors` to verify it loaded without errors

### Pattern 3: Analyse API Usage

1. `htpx_count_requests` with various filters to understand volume
2. `htpx_query_json` to extract specific values from JSON bodies
3. `htpx_list_requests` with `format: "json"` for structured analysis

### Pattern 4: Debug Auth Issues

1. `htpx_list_requests` with `header_name: "authorization", header_target: "request"` to find authed requests
2. `htpx_list_requests` with `status_range: "401"` to find failures
3. `htpx_get_request` to compare auth headers between successful and failed requests

## Writing Interceptors

Interceptor files are TypeScript files placed in `.htpx/interceptors/`. Each file exports a default `Interceptor` object.

### Mock -- Return a Canned Response

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

Do not call `ctx.forward()` -- the request never reaches upstream. This is recorded as `interceptionType: "mocked"`.

### Modify -- Forward, Then Alter the Response

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

Calls `ctx.forward()` but returns a modified response. Recorded as `interceptionType: "modified"`.

### Observe -- Log Without Altering

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

Calls `ctx.forward()` and returns the response unchanged. Useful for debugging.

### InterceptorContext Properties

| Property | Type | Description |
|----------|------|-------------|
| `ctx.request` | `Readonly<InterceptorRequest>` | The incoming request (read-only) |
| `ctx.forward()` | `() => Promise<InterceptorResponse>` | Forward to upstream server, returns response |
| `ctx.log(msg)` | `(message: string) => void` | Write to `.htpx/htpx.log` (`console.log` is `/dev/null` in daemon) |
| `ctx.htpx` | `HtpxClient` | Full query API (see below) |

### InterceptorRequest Shape

| Property | Type |
|----------|------|
| `method` | `string` |
| `url` | `string` |
| `host` | `string` |
| `path` | `string` |
| `headers` | `Record<string, string>` |
| `body` | `Buffer \| undefined` |

### InterceptorResponse Shape

| Property | Type |
|----------|------|
| `status` | `number` |
| `headers` | `Record<string, string> \| undefined` |
| `body` | `string \| Buffer \| undefined` |

### HtpxClient API (available as `ctx.htpx`)

```typescript
ctx.htpx.countRequests(filter?)          // Promise<number>
ctx.htpx.listRequests({ filter, limit, offset })  // Promise<CapturedRequestSummary[]>
ctx.htpx.getRequest(id)                  // Promise<CapturedRequest | null>
ctx.htpx.searchBodies({ query, filter, limit })    // Promise<CapturedRequestSummary[]>
ctx.htpx.queryJsonBodies({ jsonPath, filter })      // Promise<JsonQueryResult[]>
```

This allows interceptors to make decisions based on previously captured traffic.

### Interceptor Rules

- Any `.ts` file in `.htpx/interceptors/` is loaded as an interceptor
- Files are loaded alphabetically; **first matching interceptor wins**
- `match` is optional -- omit it to match all requests
- `name` is optional but strongly recommended (used in `intercepted_by` filter)
- Use `satisfies Interceptor` for full type checking and intellisense
- Handler timeout: 30 seconds. Match timeout: 5 seconds.
- Errors in handlers result in graceful pass-through -- never crashes the proxy
- `ctx.log()` writes to `.htpx/htpx.log` (since `console.log` goes nowhere in the daemon)
- Hot-reload on file changes, or run `htpx interceptors reload` / `htpx_reload_interceptors` / `htpx daemon restart`

## Tips

- After writing an interceptor, always `htpx_reload_interceptors` then `htpx_list_interceptors` to verify it loaded without errors
- The `search` filter matches URL substrings -- useful for quick filtering when you do not know the exact host or path
- `htpx_query_json` uses SQLite `json_extract` syntax (e.g. `$.user.name`, `$.items[0].id`)
- Use `limit` and `offset` for pagination when there are many results (default limit: 50, max: 500)
- `htpx_get_request` accepts comma-separated IDs for batch fetching (e.g. `id: "id1,id2,id3"`)
- Host suffix matching requires a leading dot: `.example.com` matches `api.example.com` and `www.example.com`
- Time filters use ISO 8601 format: `since: "2024-01-15T10:30:00Z"`
