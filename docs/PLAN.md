# procsi Development Plan

## Completed

<details>
<summary>Core TUI & CLI (v0.1–v0.2)</summary>

- Request/response body viewing, size display, syntax highlighting
- Accordion UI, JSON explorer, text viewer, export modal (editor/clipboard/file)
- Request filtering (fuzzy search, method, status codes), full URL toggle (`u`)
- Extended navigation (g/G/Ctrl+u/Ctrl+d), mouse support, context-sensitive hints
- Help overlay, loading spinner, min terminal size, focus indicators, status indicators
- Copy body (`y`), copy cURL (`c`), HAR export (`H`)
- Project scoping (`.procsi/`), directory override (`--dir`), global instance (`~/`)
- CI publish, npm badges, LICENSE

</details>

<details>
<summary>Phase 1: Read-only MCP — Traffic Inspection</summary>

MCP server (`procsi mcp`) connecting to the daemon's control socket for AI-driven traffic inspection.

**Tools:** `procsi_get_status`, `procsi_list_requests`, `procsi_get_request`, `procsi_search_bodies`, `procsi_query_json`, `procsi_count_requests`, `procsi_clear_requests`, `procsi_list_sessions`

**Filtering:** method, status range, URL, host, path prefix, time window, header name/value/target. Text and JSON output formats.

</details>

<details>
<summary>Phase 2: Config-as-code — Mocks & Interceptors</summary>

TypeScript interceptor files in `.procsi/interceptors/` — mock, modify, or observe HTTP traffic via the `forward()` pattern.

- `jiti` TypeScript loader, hot-reload via `fs.watch`, first-match semantics
- `InterceptorContext` with frozen request, `forward()`, `procsi` client, `ctx.log()`
- Match timeout (5s), handler timeout (30s), response validation
- MCP tools: `procsi_list_interceptors`, `procsi_reload_interceptors`, `intercepted_by` filter
- CLI: `procsi interceptors list|reload|init`
- TUI: M/I indicators, interceptor badge, detail pane info
- `procsi/interceptors` barrel export for consumer types

</details>

<details>
<summary>Bug fixes</summary>

- Mouse wheel scroll confined to request list
- Terminal hyperlink suppression
- Method truncation on long URLs
- Source attribution hardening: internal session headers now require a per-session token, with runtime source taking precedence when available

</details>

<details>
<summary>CLI Query Interface</summary>

Scriptable CLI commands exposing the same search/filter/export capabilities as the TUI and MCP. Follows a "gradual discovery" pattern where each command's output hints at related commands.

- `procsi requests` — list/filter with `--method`, `--status`, `--host`, `--path`, `--since`/`--before`, `--header`, `--intercepted-by`, `--json`
- `procsi requests search <query>` — full-text body search
- `procsi requests query <jsonpath>` — JSONPath query on bodies
- `procsi requests count` — count matching requests
- `procsi requests clear` — clear captured requests (with confirmation)
- `procsi request <id>` — single request detail (supports abbreviated IDs)
- `procsi request <id> body` — dump response body (raw, pipeable); `--request` for request body
- `procsi request <id> export curl|har` — export in various formats
- `procsi sessions` — list active proxy sessions
- `procsi interceptors logs` — event log with `--name`, `--level`, `--follow` (live tail), `--json`
- `procsi interceptors logs clear` — clear event log
- `procsi completions zsh|bash|fish` — shell completion script generation
- Human-friendly time parser for `--since`/`--before` (5m, 2h, 10am, yesterday, monday, ISO dates)
- Colour-coded output with NO_COLOR/pipe detection; `--json` for machine output

</details>

---

## Up Next

Each feature should be considered across all three surfaces where applicable:

- **TUI** — interactive terminal UI (filter bar, keybindings, modals)
- **CLI** — REST-like commands (`procsi requests --flag`)
- **MCP** — AI-facing tools (`procsi_list_requests` etc.)

---

- [x] **Saved requests (bookmarks)** — save/bookmark individual requests for later reference, persisting them beyond `clear` operations
  - **Storage:** new `saved_requests` table in SQLite (or a `saved` flag on the requests table); saved requests excluded from `clear` by default
  - **TUI:** keybinding (e.g. `b`) to toggle bookmark on selected request, visual indicator on bookmarked rows, filter to show only saved requests
  - **CLI:** `procsi requests --saved` filter flag; `procsi request <id> save` / `procsi request <id> unsave` to toggle
  - **MCP:** `saved` filter param on `procsi_list_requests`, `procsi_save_request` / `procsi_unsave_request` tools

- [x] **Request sources** — automatically identify where requests come from, with optional user override
  - **Daemon:** resolve parent PID to process name on session creation; store `source` on the session; accept `--source` override via `procsi on`
  - **TUI:** ~~show source on request list rows~~ source shown in accordion detail panel (Request section); source field in filter bar
  - **CLI:** `--source` filter flag on `procsi requests` / `procsi sessions`; `procsi on --source "dev server"` to set manually
  - **MCP:** `source` filter param on `procsi_list_requests` / `procsi_list_sessions`

- [ ] **Regexp filter** — support regex patterns in search/filter across all surfaces
  - **TUI:** detect `/pattern/` syntax in the filter bar search field, apply as regex match on URL
  - **CLI:** `--search` accepts `/pattern/` for regex, or a `--regex` flag
  - **MCP:** `regex` param on `procsi_list_requests` / `procsi_search_bodies`

- [ ] **Multiple filters** — compose filters (e.g. filter by `bigcommerce` AND `variants`)
  - **TUI:** support space-separated terms in the search field as AND conditions; method + status already compose
  - **CLI:** already supports combining `--method`, `--status`, `--host`, `--path`, `--search` etc. — extend `--search` to support multiple terms (AND logic)
  - **MCP:** already supports multiple filter params — extend `search` param to support AND logic

- [ ] **Body search in TUI** — search through request/response bodies from within the TUI
  - **CLI:** already has `procsi requests search <query>` — done
  - **MCP:** already has `procsi_search_bodies` — done
  - **TUI:** new keybinding (e.g. `s`) to open body search modal, results shown as filtered request list

- [x] **Remove `procsi init`** — replaced `init`/`vars` with `procsi on`/`procsi off` as real CLI subcommands

- [ ] **Simplify README** — current README is ~700 lines; trim to quick-start + feature highlights + architecture diagram and move detailed reference (MCP tools/filters, full keybindings, CLI reference, interceptor cookbook) to a GitHub wiki. Inspiration: [sql-tap](https://github.com/mickamy/sql-tap) keeps its README short and scannable

- [x] **CLI query interface** — see Completed section above

- [ ] **Fake domains / virtual hosts** — interceptors should work with non-existent domains/paths so you can mock entirely fictional APIs (e.g. `curl http://my-fake-api.local/users`). Currently a request to a non-routable host would fail before the interceptor can respond. Needs some kind of pre-request hook so interceptors can catch and reply without ever hitting upstream — essentially turning procsi into a lightweight mock server for any domain you like
  - **Daemon:** pre-request interception hook; respond before upstream resolution
  - **TUI:** no special changes needed (intercepted requests already display)
  - **CLI:** no special changes needed
  - **MCP:** `procsi_write_interceptor` (Phase 3) covers creating these

---

## Phase 3: MCP Write — Request Replay + AI-driven Interceptors

**New MCP tools:**

- [ ] `procsi_replay_request` — replay a captured request with optional modifications (URL, headers, body, method)
- [ ] `procsi_write_interceptor` — AI writes/updates interceptor `.ts` files, triggers reload
- [ ] `procsi_delete_interceptor` — remove an interceptor file

**TUI replay:**

- Simple one-key resend of the selected request (no editing — cURL export covers modification use cases)

---

## Phase 4: Additional Export Formats

Extend the existing cURL export (`c` key) with more formats.

- [ ] `fetch` — JavaScript Fetch API
- [ ] `requests` — Python requests library
- [ ] `httpie` — HTTPie CLI

New formatter functions alongside existing `generateCurl()`. Submenu or modal for format selection.

---

## Phase 5: Remaining Features

- [ ] **WebSocket support** — Capture and display WebSocket traffic (frames, messages, connection lifecycle)
- [ ] **Launch browser** — `procsi browser [chrome|firefox|safari]` spawns a browser pre-configured to use the proxy with the CA cert trusted
  - **Chrome/Chromium:** `--proxy-server` and `--ignore-certificate-errors-spki-list` flags, isolated profile via `--user-data-dir`
  - **Firefox:** fresh profile with proxy prefs and CA cert injected via `user.js` / `certutil`
  - **Safari:** system proxy + Keychain trust for the CA cert (macOS only, requires elevated permissions)
  - Auto-detect installed browsers; default to first available if no argument given
- [ ] **Cross-platform CI** — Run integration tests across platforms via GitHub Actions

---

## Runtime-specific Proxy Overrides

Many runtimes don't respect `HTTP_PROXY`/`HTTPS_PROXY` out of the box. procsi injects preload scripts or agent configuration per-runtime to ensure traffic flows through the proxy.

| Runtime     | Mechanism                                                       | Status          | Notes                                                                    |
| ----------- | --------------------------------------------------------------- | --------------- | ------------------------------------------------------------------------ |
| **Node.js** | `NODE_OPTIONS --require` preload with `global-agent` + `undici` | **Done**        | Covers `http`/`https` modules + native `fetch()`                         |
| **Python**  | `PYTHONPATH` sitecustomize.py that patches `httplib2`           | **Done**        | `requests`/`urllib3` respect env vars; override handles httplib2          |
| **Ruby**    | `RUBYOPT -r` preload that patches `OpenSSL::X509::Store`       | **Done**        | Ensures gems with bundled CAs trust the proxy CA                         |
| **PHP**     | `PHP_INI_SCAN_DIR` with `curl.cainfo`/`openssl.cafile`         | **Done**        | Covers `curl_*()` functions and stream wrappers                          |
| **Go**      | Env vars only (`SSL_CERT_FILE`)                                 | **Done**        | Go's `net/http` respects `HTTP_PROXY`/`HTTPS_PROXY` natively             |
| **Rust**    | Env vars only (`CARGO_HTTP_CAINFO`)                             | **Done**        | `reqwest` respects env vars natively                                     |
| **Deno**    | Env vars only (`DENO_CERT`)                                     | **Done**        | Deno respects proxy env vars natively                                    |
| **Bun**     | Env vars only (`SSL_CERT_FILE`)                                 | **Done**        | Bun respects proxy env vars natively                                     |
| **Java**    | Not supported                                                   | Not planned     | Needs `-javaagent` or JVM trust store — can't solve via env vars alone   |
| **Swift**   | Not supported                                                   | Not planned     | Uses macOS Keychain only                                                 |
| **Dart**    | Not supported                                                   | Not planned     | Requires code changes for proxy                                          |
| **Elixir**  | Not supported                                                   | Not planned     | Requires code changes for proxy                                          |

---

## Maybe (parked)

- [ ] **Drop mockttp** — Replace with custom MITM for Bun portability
- [ ] **AI request visualisation** — Detect OpenAI/Anthropic/etc. API patterns; render token counts, model info, streaming chunks
- [ ] **Full system proxy** — Act as system-wide proxy, not just per-shell
- [ ] **OTEL support** — OpenTelemetry trace correlation

---

## Docs & Landing Page (separate effort, later)

- [ ] llms.txt
- [ ] Searchable docs
- [ ] Use cases (AI traffic analysis, debugging, etc.)
- [ ] Recipes — practical complex scenarios front and centre
