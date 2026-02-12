# MCP Phase 1 Code Review — 2026-02-09

---

## Batch 1: Fixes, Housekeeping & Existing Tool Docs ✓

Small, targeted fixes. No new features.

- [x] **Signal handler race in `mcp.ts`** — double Ctrl+C calls `close()` twice with no guard. Add a `let closing = false` flag.
- [x] **`clampLimit` accepts fractional numbers** — `50.5` passes through to SQL LIMIT. Apply `Math.floor()`.
- [x] **Invalid `status_range` silently ignored** — agent passes `"invalid"`, no error reported. Validate format in `buildFilter` and return an error.
- [x] **No `offset` validation** — negative/fractional offsets pass through to SQL. Use `z.number().int().min(0).optional()`.
- [x] **`textResult` helper** — extract repeated `{ content: [{ type: "text" as const, text }] }` pattern (10 return sites) into a helper.
- [x] **`getRequest` null/undefined conversion comment** — `storage.getRequest()` returns `undefined`, control handler converts to `null` via `?? null`. Add comment explaining why.
- [x] **`formatRequest` should surface content-type** — add `**Request/Response Content-Type:**` as top-level fields for quick scanning without parsing full headers.
- [x] **`getTextContent` test helper** — should throw instead of returning empty string, to avoid confusing test failures.
- [x] **Improve tool descriptions** — list available filters in the main description text, not just parameter schemas. Agents see descriptions prominently.
- [x] **Improve parameter descriptions** — e.g. `search` says "Case-insensitive substring match against full URL and path."
- [x] **Tests** — updated unit tests for `clampLimit` change, `buildFilter` validation tests, `formatRequest` content-type tests, integration tests for invalid `status_range`, pagination, search filter, and status range filter

---

## Batch 2: Filtering Expansion ✓

Extend the filter pipeline through the full stack: `RequestFilter` → `applyFilterConditions` → control server → `ControlClient` → MCP schemas.

- [x] **Host/domain filtering** — dedicated `host` parameter (exact or suffix match with `.` prefix). DB index added (migration v4).
- [x] **Path prefix filtering** — `path` parameter with prefix matching (e.g. `/api/v2` matches `/api/v2/users`).
- [x] **Multiple method filtering** — comma-separated methods split/trimmed/uppercased in `buildFilter`.
- [x] **Exact status code filtering** — supports exact (`401`), range (`500-503`), and existing `Nxx` patterns.
- [x] **Time-based filtering** — `since` / `before` as ISO 8601 strings at MCP layer, converted to epoch ms.
- [x] **Tests** — 12 new storage filter tests, 18 new `buildFilter` tests, 3 new MCP integration tests

---

## Batch 3: Missing Tools & Richer List Output ✓

New tool registrations plus making list responses more useful.

- [x] **`procsi_count_requests`** — expose existing `ControlClient.countRequests()`. Accepts same filter params as `procsi_list_requests`.
- [x] **`procsi_clear_requests`** — expose existing `ControlClient.clearRequests()`. No params.
- [x] **`procsi_list_sessions`** — add `listSessions()` to `ControlClient` (handler already exists on control server).
- [x] **Batch `procsi_get_request`** — accept comma-separated IDs, return multiple formatted requests.
- [x] **Total count in list responses** — include total alongside paginated results ("Showing 50 of 1,234 request(s):").
- [x] **Richer summary format** — include timestamp, body sizes in `formatSummary`.
- [x] **Tests** — unit + integration tests for all new tools and updated format

---

## Batch 4: Output Quality ✓

Improve how data is presented to agents.

- [x] **Pretty-print JSON bodies** — detect JSON content-type in `formatRequest`, run through `JSON.stringify(..., null, 2)`.
- [x] **Binary body handling** — `bufferToString` blindly does `toString("utf-8")` on images. Show `[binary data, N bytes]` for non-text types.
- [x] **Structured JSON output option** — `format` parameter (`"text"` | `"json"`) on list/get/search/count tools.
- [x] **Tests** — unit tests for JSON pretty-print, binary detection, structured output format

---

## Batch 5: Header Filtering & JSON Body Querying

Advanced querying — both involve querying into JSON-encoded data in SQLite.

- [ ] **Header filtering** — `header_name` + optional `header_value` + optional `header_target` (`"request"` | `"response"` | `"both"`, default `"both"`). SQL: `json_extract` on request/response header blobs.
- [ ] **JSON body querying** — new tool `procsi_query_json` with `json_path` (e.g. `$.data.users`), optional `value`, `target` (`"request"` | `"response"` | `"both"`). Uses SQLite `json_extract()`.
- [ ] **Tests** — storage tests with JSON bodies, MCP unit + integration tests
