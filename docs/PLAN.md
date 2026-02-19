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
- Space-separated URL search terms now compose with AND semantics (applies across TUI/CLI/MCP list filtering)
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

<details>
<summary>Fake domains / virtual hosts</summary>

Validated support for mocking fully fictional hosts/paths through interceptors, without upstream DNS/TCP success.

- Integration coverage for mocked `http://my-fake-api.local/...` and `https://my-fake-api.local/...`
- Clean failure coverage for unmatched fake-host requests (proxy remains usable)
- Interceptor docs now include a virtual-host mocking example and HTTPS CA trust note

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

- [x] **Regexp filter** — support regex patterns in search/filter across all surfaces
  - **TUI:** detect `/pattern/` syntax in the filter bar search field, apply as regex match on URL
  - **CLI:** `--search` accepts `/pattern/` for regex, or a `--regex` flag
  - **MCP:** `regex` param on `procsi_list_requests` / `procsi_search_bodies`
  - **Implementation checklist:**
    - [x] **Shared filter contract + parser helpers**
      - Extend `RequestFilter` with `regex?: string`
      - Add shared helper(s) to parse `/pattern/` literals and validate regex safely (`try/catch`)
    - [x] **Daemon/control/storage support**
      - Accept `filter.regex` in `src/daemon/control.ts` (`optionalFilter`)
      - Add regex condition support in `src/daemon/storage.ts` filter application
      - Ensure invalid regex yields a clear error (no crash)
    - [x] **CLI wiring (`procsi requests`)**
      - Add `--regex <pattern>` flag in `src/cli/commands/requests.ts`
      - Support `/pattern/` auto-detection in `--search`
      - Keep non-regex search semantics unchanged (space-separated terms = AND)
    - [x] **TUI wiring (filter bar + list highlighting)**
      - Parse `/pattern/` in `src/cli/tui/components/FilterBar.tsx`
      - Preserve existing debounce/live-apply behaviour
      - Disable substring highlight in `RequestListItem` when search is in regex mode
    - [x] **MCP schema + filter builder updates**
      - Add `regex` param to `procsi_list_requests` + `procsi_search_bodies`
      - Pass through in `buildFilter(...)` in `src/mcp/server.ts`
    - [x] **Tests**
      - Daemon storage: regex match/no-match/invalid/combined filters
      - TUI FilterBar: `/pattern/` emits regex filter
      - MCP: `buildFilter` + integration coverage for `regex` param
      - CLI integration: `--search '/.../'` and `--regex` behaviour
    - [x] **Docs follow-up**
      - Update CLI/MCP filter docs + examples
      - Mark this item complete in `docs/PLAN.md` once shipped

- [x] **Targeted body search across all surfaces (request vs response)** — body search supports selecting request body, response body, or both
  - **Goal:** avoid wasteful dual-body scans when only one side is relevant, while preserving backwards compatibility
  - **Behaviour contract:**
    - `target=both` remains default (existing behaviour)
    - Explicit `target=request` and `target=response`
  - **CLI:** `procsi requests search <query> --target request|response|both`
  - **MCP:** `procsi_search_bodies` supports optional `target` enum (`request` | `response` | `both`)
  - **TUI:** no new keybinding; filter-bar scope syntax
    - Default (unchanged): `foo` → URL/path search
    - `body:foo` → body search (`both`)
    - `body:req:foo` / `body:request:foo` → request-body only
    - `body:res:foo` / `body:response:foo` → response-body only
  - **Implementation checklist:**
    - [x] Extend shared body-search contract to include `target?: "request" | "response" | "both"` (default `both`)
    - [x] Update daemon control API validation + forwarding for body-search target
    - [x] Update storage `searchBodies(...)` SQL builder to apply body-match conditions by target (request-only/response-only/both)
    - [x] Keep text-content-type safety rules per-side (don’t search binary content-types)
    - [x] CLI: add `--target` parsing/validation, wiring, and help text
    - [x] MCP: add `target` schema/docs in `procsi_search_bodies`, pass through to client
    - [x] TUI: add search-prefix parser for body scope + target, route to body-search path without adding a keybinding
    - [x] Keep existing debounce/live filter UX and regex error resilience
    - [x] Tests: storage target semantics, control-client/control-server wiring, CLI flag behaviour, MCP param behaviour, TUI scope parsing and rendering
    - [x] Docs: update CLI reference, MCP docs, TUI help/README/wiki examples

- [x] **TUI body-search discoverability polish (lightweight)** — make `body:` search obvious without adding keybindings or complex UI
  - **Constraints:** no new keybindings; keep interaction model simple
  - **Shipped:**
    - Highlight `body:` prefix (and optional target token like `req:`/`res:`) while typing in `/` filter bar
    - Improved filter-bar hint text with explicit body-search example (`body:req:error`)
    - Improved help/discovery copy (`/` action now mentions URL, regex, and body filter syntax)
    - Updated TUI docs with an explicit highlighting tip
  - **Out of scope (for this pass):** mode badges, extra panels, or advanced filter UX rework
  - **Validation:** TUI component tests for prefix parsing/rendering + help copy updates

- [x] **Remove `procsi init`** — replaced `init`/`vars` with `procsi on`/`procsi off` as real CLI subcommands

- [x] **Simplify README** — current README is ~700 lines; trim to quick-start + feature highlights + architecture diagram and move detailed reference (MCP tools/filters, full keybindings, CLI reference, interceptor cookbook) to a GitHub wiki. Inspiration: [sql-tap](https://github.com/mickamy/sql-tap) keeps its README short and scannable

- [x] **CLI query interface** — see Completed section above

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
