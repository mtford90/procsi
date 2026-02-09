# htpx Development Plan

## Completed

- [x] Add LICENSE file (MIT)
- [x] Add npm badges to README
- [x] Test global install (`npm install -g htpx-cli`)
- [x] Set up npm publish in CI (auto-publish on `v*` tags)
- [x] Improve `htpx intercept` UX - detect direct vs eval usage
- [x] Copy curl to clipboard instead of printing after TUI exit
- [x] **UX/UI fixes (7.1–7.8)**: Help overlay (?), extended navigation (g/G/Ctrl+u/Ctrl+d), loading spinner, minimum terminal size check, focus indicator (» + bold), empty state guidance, status indicators (✓/→/✗), DELETE method magenta colour
- [x] **Code review fixes (2026-02-07)**: All 24 items addressed — shared `getGlobalOptions` helper, FilterBar lifecycle/cast fixes, `isFilterActive` extraction + tests, JSON pretty-print tests, body preview truncation, DB indices, search length bounds, cursor indicator, and more
- [x] Full URL in request list — toggle with `u` key
- [x] Request/response body viewing — accordion UI in details pane
- [x] Request/response size display — payload sizes in list and details
- [x] Request filtering — fuzzy search, HTTP method, status codes
- [x] Publish proxy details — show connection details for use anywhere
- [x] Support any directory — climb to `~/` if no project/git root found
- [x] Directory scope override — `--dir` flag
- [x] Global htpx instance — `~/` scope
- [x] Mouse support — click to select requests, panels, etc.
- [x] JSON explorer — manipulate/explore request/response bodies
- [x] Export modal — open in editor, copy to clipboard, save to file
- [x] Pretty request/response with syntax highlighting
- [x] Copy request/response body when focused
- [x] Context-sensitive status bar hints
- [x] Text viewer modal

---

## Phase 1: Read-only MCP — Traffic Inspection

Let AI discover `.htpx/` and inspect captured traffic. No mocking yet — purely read-only.

**Tools to expose:**
- [ ] `htpx_list_requests` — search/filter captured requests (by URL, method, status, content-type, time range)
- [ ] `htpx_get_request` — fetch full request details (headers, body, timing)
- [ ] `htpx_search_bodies` — search through request/response body content
- [ ] `htpx_get_status` — proxy status, port, captured request count

**Architecture:**
- MCP server connects to the daemon's existing control socket
- Reuse existing SQLite query infrastructure from the TUI's data layer
- Ship as `htpx mcp` subcommand or stdio-based MCP server

---

## Phase 2: Config-as-code — Mocks & Interceptors

TypeScript config files inside `.htpx/` that define middleware/intercept/mock behaviour. The TUI visualises what's configured; logic lives in code.

**Core concepts:**
- `.htpx/interceptors.ts` (or similar) exports rules
- Each rule: match condition (URL pattern, method, headers) + handler (modify request, mock response, delay, etc.)
- Middleware receives an htpx client with full power (search, filter, modify)
- Hot-reload on file change
- Timeouts and safeguards to prevent lockups

**TUI integration:**
- Show active interceptors/mocks in a panel or indicator
- Highlight intercepted requests differently in the list

---

## Phase 3: MCP Write — Mock Management + Request Replay

Extend MCP with write operations so AI can manage mocks and replay requests.

**New MCP tools:**
- [ ] `htpx_create_mock` — create a mock/intercept rule programmatically
- [ ] `htpx_update_mock` / `htpx_delete_mock` — manage existing rules
- [ ] `htpx_replay_request` — replay a captured request with optional modifications (URL, headers, body, method)
- [ ] `htpx_list_mocks` — list active mock/intercept rules

**TUI replay:**
- Simple one-key resend of the selected request (no editing — cURL export covers modification use cases)

---

## Phase 4: Additional Export Formats

Extend the existing cURL export (`c` key) with more formats.

**Formats:**
- [ ] `fetch` — JavaScript Fetch API
- [ ] `requests` — Python requests library
- [ ] `httpie` — HTTPie CLI

**Implementation:**
- New formatter functions alongside existing `generateCurl()`
- Either a submenu on `c` key or separate keys/modal for format selection

---

## Phase 5: Remaining Features

- [ ] **WebSocket support** — Capture and display WebSocket traffic (frames, messages, connection lifecycle)
- [ ] **Launch Chromium** — `htpx chrome` spawns Chromium pre-configured to use the proxy
- [ ] **Cross-platform CI** — Run integration tests across platforms via GitHub Actions

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
