# procsi Code Review - 2026-02-07

Review of three features: Pretty Print + Syntax Highlighting (F1), Request Filtering (F2), and Directory Scope Override + Global Instance (F3).

## Summary

| Dimension | Issues Found |
|-----------|-------------|
| 1. React/Ink Best Practices | 4 issues |
| 2. TypeScript Quality | 2 issues |
| 3. Code Completeness | 4 issues |
| 4. Test Coverage | 5 issues |
| 5. Project Organisation | 1 issue |
| 6. Security | 2 issues |
| 7. UX/UI Principles | 3 issues |
| 8. Performance | 3 issues |

---

## 1. React/Ink Best Practices

**Positive Observations:**
- FilterBar correctly uses `useInput` with `isActive` guard, preventing input leaks when inactive.
- App.tsx properly disables main input handler when filter/help/save overlays are open.
- `useMemo` used correctly in AccordionContent to avoid recomputing binary checks and text lines on every render.

---

- [ ] **F2.1: FilterBar state not reset when reopened**

  **Severity:** Medium

  **File:** `src/cli/tui/components/FilterBar.tsx:28-43`

  ```tsx
  const [search, setSearch] = useState(filter.search ?? "");
  const [methodIndex, setMethodIndex] = useState<number>(() => {
    if (filter.methods && filter.methods.length === 1) {
      const idx = METHOD_CYCLE.indexOf(filter.methods[0] as (typeof METHOD_CYCLE)[number]);
      return idx >= 0 ? idx + 1 : 0;
    }
    return 0;
  });
  ```

  **Issue:** `useState` initialisers only run on mount. If the user opens the filter bar, types a search term, presses Escape (cancel), then presses `/` again, the component is re-mounted by the conditional render in App.tsx so this happens to work. However, this is fragile -- if FilterBar is ever refactored to stay mounted (e.g. hidden via CSS/display), the stale state bug would surface. More critically, the initialiser reads `filter.methods[0]` with an `as` cast rather than validating the value is actually a member of `METHOD_CYCLE`.

  **Fix:** Either add a `useEffect` that syncs local state from props when `isActive` transitions to `true`, or add a comment documenting the assumption that the component is unmounted on close. Remove the `as` cast and use a proper type guard.

  **Quick win:** No -- needs a design decision about mount/unmount lifecycle.

---

- [ ] **F2.2: buildFilter in FilterBar uses useCallback but is recreated frequently**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.tsx:45-67`

  ```tsx
  const buildFilter = useCallback((): RequestFilter => {
    const result: RequestFilter = {};
    if (search.trim()) {
      result.search = search.trim();
    }
    // ...
  }, [search, methodIndex, statusIndex]);
  ```

  **Issue:** `buildFilter` depends on `search`, `methodIndex`, and `statusIndex`, which change on every keystroke. The `useCallback` wrapper provides no memoisation benefit here since it recreates the function every time any dependency changes.

  **Fix:** Either remove `useCallback` (it's a plain function called synchronously in the input handler) or compute the filter inline in the `useInput` handler using refs for the values. This is not a bug -- just unnecessary indirection.

  **Quick win:** Yes -- remove `useCallback` wrapper.

---

- [ ] **F1.1: BodyContent renders list items without React.memo**

  **Severity:** Low

  **File:** `src/cli/tui/components/AccordionContent.tsx:155-159`

  ```tsx
  {visibleLines.map((line, index) => (
    <Text key={index} wrap="truncate">
      {line}
    </Text>
  ))}
  ```

  **Issue:** Each `Text` element in the body content uses `index` as its key. If the body content changes (e.g. user selects a different request), React cannot correctly reconcile the list and will re-render all items. For syntax-highlighted bodies with many lines this could cause noticeable flicker.

  **Fix:** This is mitigated by the fact that `lines` is memoised via `useMemo` and the entire component re-renders when the selected request changes (which is expected). The `key={index}` is acceptable here since line content is stable within a given request. No action required unless performance issues are observed.

  **Quick win:** N/A -- acceptable as-is.

---

- [ ] **F2.3: useRequests filter change does not reset selection**

  **Severity:** Medium

  **File:** `src/cli/tui/hooks/useRequests.ts:68-71`

  ```tsx
  useEffect(() => {
    filterRef.current = filter;
    lastCountRef.current = 0;
  }, [filter]);
  ```

  **Issue:** When the filter changes, `lastCountRef` is reset to force a re-fetch, but the hook does not trigger an immediate fetch. The next fetch happens on the next poll interval (up to 2 seconds later). The App.tsx `onFilterChange` handler does `setSelectedIndex(0)` but the request list may not have updated yet, causing a brief mismatch between the selected index and the displayed list.

  **Fix:** Call `fetchRequests()` directly in the filter change effect, or expose a mechanism for the caller to trigger an immediate refresh when the filter changes. The App already has `refresh()` available -- chain it after `setFilter`.

  **Quick win:** Yes -- add `void fetchRequests()` after resetting `lastCountRef` in the filter effect.

---

## 2. TypeScript Quality

**Positive Observations:**
- `optionalFilter` in control.ts validates every field with proper type guards before constructing the `RequestFilter`. No blind casts on wire data.
- `RequestFilter` type in shared/types.ts is clean and minimal -- optional fields only, no union type abuse.
- The `as (typeof METHOD_CYCLE)[number]` cast in FilterBar.tsx:31 is the only `as` cast in the new feature code, and it's on local UI state rather than external data.
- `escapeLikeWildcards` in storage.ts correctly handles the backslash escape character itself first, preventing double-escaping.

---

- [ ] **F3.1: Repeated `as { dir?: string }` cast across all commands**

  **Severity:** Medium

  **File:** Multiple command files (status.ts:10, clear.ts:10, stop.ts:8, restart.ts:15, debug-dump.ts:112, project.ts:11, tui.ts:12, intercept.ts:49)

  ```typescript
  const globalOpts = command.optsWithGlobals() as { verbose?: number; dir?: string };
  ```

  **Issue:** Every command file casts `optsWithGlobals()` with an inline type assertion. This is duplicated across 8 files and could drift if a new global option is added. Commander's `optsWithGlobals()` returns `Record<string, unknown>` at runtime, so the cast is technically unsafe.

  **Fix:** Define a shared `GlobalOptions` interface in `helpers.ts` and create a `getGlobalOptions(command: Command): GlobalOptions` helper that validates the values at runtime (using the existing `optionalString`/`optionalNumber` pattern). This eliminates both the duplication and the unsafe cast.

  **Quick win:** No -- needs a small helper, but straightforward.

---

- [ ] **F3.2: findProjectRoot startDir parameter accepts undefined**

  **Severity:** Low

  **File:** `src/shared/project.ts:31`

  ```typescript
  export function findProjectRoot(startDir: string = process.cwd(), override?: string): string | undefined {
  ```

  **Issue:** All call sites in the command files pass `undefined` as startDir when using an override (`findProjectRoot(undefined, globalOpts.dir)`). TypeScript allows this because the parameter has a default value, but calling `findProjectRoot(undefined, override)` is a code smell -- it suggests the API should perhaps use an options object instead.

  **Fix:** Refactor to accept an options object: `findProjectRoot(options?: { startDir?: string; override?: string })`. Alternatively, accept the current API but document that `undefined` falls back to `process.cwd()`. Low priority since the default value handles it correctly at runtime.

  **Quick win:** Yes for the documentation approach. No for the refactor.

---

## 3. Code Completeness

**Positive Observations:**
- `highlightCode` correctly wraps the `highlight()` call in a try-catch, returning the original string on failure.
- `escapeLikeWildcards` handles all three SQL LIKE special characters (`\`, `%`, `_`) in the correct order.
- `applyFilterConditions` mutates arrays in place and is documented as doing so -- clear API contract.

---

- [ ] **F1.2: JSON pretty-print heuristic is too aggressive**

  **Severity:** Medium

  **File:** `src/cli/tui/components/AccordionContent.tsx:114-126`

  ```typescript
  const isJson =
    contentType?.includes("application/json") ||
    text.trimStart().startsWith("{") ||
    text.trimStart().startsWith("[");

  if (isJson) {
    try {
      const parsed = JSON.parse(text) as unknown;
      text = JSON.stringify(parsed, null, 2);
    } catch {
      // Not valid JSON, keep original text
    }
  }
  ```

  **Issue:** Any response body starting with `{` or `[` will be attempted as JSON, even if the content-type is `text/plain`, `text/html`, or similar. A malformed HTML page starting with `[` could trigger an unnecessary JSON.parse attempt. More importantly, a response with content-type `text/html` that happens to contain valid JSON (e.g. `<script>{"key":"value"}</script>`) won't match the heuristic, but `{"key":"value"}` as `text/html` would be reformatted, which is confusing.

  **Fix:** Only pretty-print when the content-type explicitly indicates JSON (e.g. `application/json`, `+json` suffix). Remove the `startsWith` heuristic, or gate it behind the absence of a known non-JSON content type.

  **Quick win:** Yes -- remove the two `startsWith` checks.

---

- [ ] **F2.4: statusRange parsing accepts invalid formats silently**

  **Severity:** Low

  **File:** `src/daemon/storage.ts:86-92`

  ```typescript
  if (filter.statusRange) {
    const firstDigit = parseInt(filter.statusRange.charAt(0), 10);
    if (!isNaN(firstDigit) && firstDigit >= 1 && firstDigit <= 5) {
      const lower = firstDigit * STATUS_RANGE_MULTIPLIER;
      const upper = (firstDigit + 1) * STATUS_RANGE_MULTIPLIER;
      conditions.push("response_status >= ? AND response_status < ?");
      params.push(lower, upper);
    }
  }
  ```

  **Issue:** If `statusRange` is `"2xx"`, this works correctly. But if someone passes `"299"` or `"2"` or `"2-anything"`, it silently accepts them as valid 2xx filters. The format `"Nxx"` is a convention but not enforced.

  **Fix:** Validate the format explicitly with a regex like `/^[1-5]xx$/`. If validation fails, either ignore the filter (current behaviour, acceptable) or throw. Since this is internal API data validated by `optionalFilter`, the risk is low -- the UI only produces values from `STATUS_CYCLE`.

  **Quick win:** Yes -- add a regex check.

---

- [ ] **F3.3: project init command bypasses resolveOverridePath**

  **Severity:** Medium

  **File:** `src/cli/commands/project.ts:12`

  ```typescript
  const projectRoot = globalOpts.dir ? path.resolve(globalOpts.dir) : process.cwd();
  ```

  **Issue:** The `project init` command handles `--dir` with a simple `path.resolve()`, which does not expand `~` to the home directory. Every other command uses `findProjectRoot` or `findOrCreateProjectRoot`, which call `resolveOverridePath` internally. This means `procsi -d ~/my-project project init` will create `.procsi` in a literal `~/my-project` directory relative to cwd rather than in the user's home directory.

  **Fix:** Use `resolveOverridePath` or create a `resolveDir` helper exported from project.ts. Alternatively, reuse `findOrCreateProjectRoot(undefined, globalOpts.dir)` and then call `ensureProcsiDir`.

  **Quick win:** Yes -- replace with `findOrCreateProjectRoot` + `ensureProcsiDir`.

---

- [ ] **F3.4: ControlClient not closed in several commands**

  **Severity:** Low

  **File:** `src/cli/commands/status.ts:23`, `src/cli/commands/clear.ts:21`

  ```typescript
  const client = new ControlClient(paths.controlSocketFile);
  const status = await client.status();
  // ... no client.close()
  ```

  **Issue:** Several CLI commands create a `ControlClient` but never call `close()` on it. Since the process exits immediately after, Node.js will clean up the socket, so this is not a resource leak in practice. However, it leaves the persistent connection open until GC or process exit, which could delay exit if there are pending operations.

  **Fix:** Add `client.close()` in a `finally` block. Alternatively, accept this as benign for short-lived CLI commands and add a comment.

  **Quick win:** Yes -- add `finally { client.close() }`.

---

## 4. Test Coverage

**Positive Observations:**
- FilterBar tests cover the full lifecycle: default rendering, keyboard cycling, search input, Enter to apply, Escape to cancel, and initial filter restoration.
- Storage filter tests are thorough: single method, multiple methods, status ranges, text search, SQL wildcard escaping (both `%` and `_`), combined filters, empty/undefined filters, and cross-method consistency (`listRequests`, `listRequestsSummary`, `countRequests`).
- Syntax highlight tests mock cli-highlight properly, isolating the language resolution logic from terminal colour support.
- Override parameter tests in project.test.ts cover `~` expansion, relative path resolution, and the fallback behaviours.

---

- [ ] **F1.3: No test for JSON pretty-printing in BodyContent**

  **Severity:** Medium

  **Issue:** `AccordionContent.tsx` contains JSON detection and pretty-printing logic (lines 114-126), but there are no component tests verifying that JSON bodies are formatted with indentation. The syntax-highlight tests cover the highlighting path, but not the JSON.parse/stringify transformation that precedes it.

  **Fix:** Add component tests for `BodyContent` using ink-testing-library that verify:
  - Compact JSON input is rendered with indentation
  - Invalid JSON is rendered as-is
  - Non-JSON content types are not reformatted even if they start with `{`

  **Quick win:** No -- needs new test file with ink-testing-library setup.

---

- [ ] **F2.5: No test for filter bar backspace behaviour**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.test.tsx`

  **Issue:** The test file covers typing characters and cycling methods/statuses, but does not test the backspace/delete key behaviour (FilterBar.tsx:93-96). A regression in backspace handling would go unnoticed.

  **Fix:** Add a test that types characters, sends a backspace, and verifies the search field is updated correctly.

  **Quick win:** Yes -- simple addition to existing test file.

---

- [ ] **F3.5: No tests for resolveOverridePath edge cases**

  **Severity:** Low

  **File:** `src/shared/project.test.ts`

  **Issue:** The override tests cover `~` expansion and relative paths, but do not test:
  - `~` alone (i.e. just the home directory)
  - Paths with spaces
  - Already-absolute paths (e.g. `/tmp/my-project`)
  - Empty string override

  **Fix:** Add test cases for these edge cases. The `~` alone case is particularly important since `resolveOverridePath` handles it explicitly (line 13).

  **Quick win:** Yes -- add a few more test cases.

---

- [ ] **F2.6: No test for isFilterActive utility**

  **Severity:** Low

  **File:** `src/cli/tui/App.tsx:44-49`

  ```typescript
  function isFilterActive(filter: RequestFilter): boolean {
    return (
      (filter.methods !== undefined && filter.methods.length > 0) ||
      filter.statusRange !== undefined ||
      (filter.search !== undefined && filter.search.length > 0)
    );
  }
  ```

  **Issue:** This utility function has branching logic but no dedicated test. It is used to drive the `[FILTERED]` badge in the status bar.

  **Fix:** Either extract to a shared utility and add unit tests, or test indirectly through an App component test that verifies the `[FILTERED]` badge appears when a filter is active.

  **Quick win:** Yes -- extract and add unit tests.

---

- [ ] **F2.7: FilterBar tests do not verify empty filter on Enter with no input**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.test.tsx`

  **Issue:** No test verifies what happens when the user presses Enter without typing anything or cycling any filters. The `buildFilter` function would return `{}`, which should clear any existing filter. This is an important user flow (clearing filters).

  **Fix:** Add a test that opens the filter bar, presses Enter immediately, and asserts `onFilterChange` is called with `{}`.

  **Quick win:** Yes.

---

## 5. Project Organisation

**Positive Observations:**
- Feature 3 correctly threads the `--dir` option through all commands via Commander's `optsWithGlobals()`, maintaining a consistent pattern.
- `helpers.ts` with `requireProjectRoot` and `getErrorMessage` keeps the command files focused on their domain logic.
- FilterBar is a self-contained component with clear props interface -- good separation of concerns.
- The `isFilterActive` utility is defined in App.tsx near its sole consumer rather than being over-extracted to a shared file.

---

- [ ] **F3.6: project init command duplicates override resolution logic**

  **Severity:** Medium

  **File:** `src/cli/commands/project.ts:12`

  ```typescript
  const projectRoot = globalOpts.dir ? path.resolve(globalOpts.dir) : process.cwd();
  ```

  **Issue:** This is the only command that resolves the `--dir` override inline rather than delegating to `findProjectRoot` or `findOrCreateProjectRoot`. This creates a second code path for directory resolution that doesn't benefit from the `~` expansion and other normalisation in `resolveOverridePath`. Related to F3.3 but noted here as an organisation concern -- the pattern is inconsistent with all other commands.

  **Fix:** Use `findOrCreateProjectRoot(undefined, globalOpts.dir)` to match the pattern used everywhere else.

  **Quick win:** Yes.

---

## 6. Security

**Positive Observations:**
- `escapeLikeWildcards` in storage.ts correctly prevents SQL LIKE injection via user search input.
- Parameterised queries used throughout -- filter conditions use `?` placeholders, not string interpolation.
- `optionalFilter` validates every field type before constructing the RequestFilter, preventing type confusion from malicious control messages.

---

- [ ] **F2.8: Search filter input not length-bounded**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.tsx:99-101`

  ```tsx
  if (input && !key.ctrl && !key.meta && input !== "m" && input !== "s") {
    setSearch((prev) => prev + input);
  }
  ```

  **Issue:** The search input in FilterBar has no maximum length. A user (or automated input) could create an extremely long search string that gets passed through to SQL LIKE queries. While SQLite handles long strings gracefully, an unbounded search string could cause performance issues with the LIKE pattern matching.

  **Fix:** Add a maximum search length constant (e.g. `MAX_SEARCH_LENGTH = 200`) and check before appending.

  **Quick win:** Yes -- add a length guard.

---

- [ ] **F3.7: --dir option not validated for path traversal**

  **Severity:** Low

  **File:** `src/shared/project.ts:12-21`

  ```typescript
  function resolveOverridePath(override: string): string {
    if (override.startsWith(HOME_DIR_PREFIX + path.sep) || override === HOME_DIR_PREFIX) {
      return path.join(os.homedir(), override.slice(HOME_DIR_PREFIX.length));
    }
    if (override.startsWith(HOME_DIR_PREFIX + "/")) {
      return path.join(os.homedir(), override.slice(2));
    }
    return path.resolve(override);
  }
  ```

  **Issue:** The `--dir` option accepts any path, including symlinks or paths that resolve outside the user's control (e.g. `/etc`). Since procsi creates directories (`.procsi/`) and writes files (database, CA certificates) in the resolved path, an attacker with control over the CLI arguments could cause writes to unintended locations.

  **Fix:** This is a very low risk since the user explicitly provides the `--dir` flag (it's not derived from untrusted input). Document that `--dir` should point to a project directory the user owns. No code change needed.

  **Quick win:** N/A -- documentation only.

---

## 7. UX/UI Principles

**Positive Observations:**
- The `/` keybinding for filter is intuitive (matches vim, less, and many other TUI tools).
- FilterBar shows inline help (`Enter=apply Esc=cancel`) so the user always knows how to proceed.
- The `[FILTERED]` badge in the status bar provides clear visual feedback that results are filtered.
- Method and status cycling in the filter bar is a clever space-efficient design for a terminal UI.

---

- [ ] **F2.9: Cannot type 'm' or 's' in the search field**

  **Severity:** High

  **File:** `src/cli/tui/components/FilterBar.tsx:82-101`

  ```tsx
  if (input === "m" && !key.ctrl && !key.meta) {
    setMethodIndex((prev) => (prev + 1) % (METHOD_CYCLE.length + 1));
    return;
  }

  if (input === "s" && !key.ctrl && !key.meta) {
    setStatusIndex((prev) => (prev + 1) % (STATUS_CYCLE.length + 1));
    return;
  }

  // ...
  if (input && !key.ctrl && !key.meta && input !== "m" && input !== "s") {
    setSearch((prev) => prev + input);
  }
  ```

  **Issue:** The letters `m` and `s` are intercepted for method/status cycling and cannot be typed into the search field. This means searches for common terms like "users", "messages", "session", "smtp", etc. are impossible. This is a significant usability problem.

  **Fix:** Use a modifier key for the cycling shortcuts (e.g. `Ctrl+m` / `Ctrl+s`, or `Alt+m` / `Alt+s`), or use `Tab` to switch between the search field and the method/status selectors, or use a dedicated mode switch.

  **Quick win:** No -- needs a UX design decision.

---

- [ ] **F2.10: No visual cursor in the search field**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.tsx:122-123`

  ```tsx
  <Text color="cyan" bold>/</Text>
  <Text> {search}</Text>
  ```

  **Issue:** The search field shows the typed text but has no blinking cursor or other indicator of the insertion point. In a terminal, users expect to see a cursor when they're in a text input mode.

  **Fix:** Append a block cursor character (e.g. `\u2588`) or an underscore after the search text when the filter bar is active.

  **Quick win:** Yes.

---

- [ ] **F3.8: No feedback when --dir points to non-existent directory**

  **Severity:** Medium

  **File:** `src/cli/commands/helpers.ts:7-12`

  ```typescript
  export function requireProjectRoot(override?: string): string {
    const projectRoot = findProjectRoot(undefined, override);
    if (!projectRoot) {
      console.error("Not in a project directory (no .procsi or .git found)");
      process.exit(1);
    }
    return projectRoot;
  }
  ```

  **Issue:** When `--dir /nonexistent/path` is passed, `findProjectRoot` returns `undefined` because neither `.procsi` nor `.git` exists at that path. The error message says "Not in a project directory" which doesn't mention the `--dir` flag, leaving the user confused about why their override didn't work.

  **Fix:** Check whether the override path exists first and provide a specific error message: `"Directory not found: /nonexistent/path"` or `"No .procsi or .git found at /nonexistent/path (specified via --dir)"`.

  **Quick win:** Yes.

---

## 8. Performance

**Positive Observations:**
- `applyFilterConditions` is shared between `listRequests`, `listRequestsSummary`, and `countRequests`, avoiding SQL construction duplication.
- The polling optimisation in useRequests (check count before fetching list) means filtered queries don't fetch data when the count hasn't changed.
- Syntax highlighting is gated behind content-type checks -- `highlightCode` returns immediately for unknown types without calling into cli-highlight.
- `useMemo` on the body content processing (lines computation, binary check) prevents re-running highlight.js on every render.

---

- [ ] **F1.4: Syntax highlighting runs on potentially large bodies**

  **Severity:** Medium

  **File:** `src/cli/tui/components/AccordionContent.tsx:106-131`

  ```typescript
  const lines = useMemo(() => {
    if (!body || body.length === 0) {
      return [];
    }

    let text = body.toString("utf-8");
    // ... JSON formatting ...
    text = highlightCode(text, contentType);
    return text.split("\n");
  }, [body, contentType]);
  ```

  **Issue:** The entire body is converted to a string, potentially JSON-formatted, then syntax-highlighted, then split into lines -- but only `maxLines` are displayed (typically a small number like 20-30). For a 1MB JSON response, this means:
  1. `toString("utf-8")` -- 1MB string allocation
  2. `JSON.parse` + `JSON.stringify` -- parse and re-serialise 1MB
  3. `highlightCode` -- run highlight.js tokeniser over the full formatted output
  4. `text.split("\n")` -- create array of all lines
  5. Only display first N lines

  **Fix:** Truncate the text to a reasonable preview size before processing. For example, only process the first ~10KB of body content for display purposes. The full body is still available for export/save operations.

  **Quick win:** Yes -- add a `const BODY_PREVIEW_LIMIT = 10 * 1024;` and truncate before processing.

---

- [ ] **F2.11: Filter change triggers unnecessary re-render cascade**

  **Severity:** Low

  **File:** `src/cli/tui/App.tsx:510-513`

  ```tsx
  onFilterChange={(newFilter) => {
    setFilter(newFilter);
    setSelectedIndex(0);
  }}
  ```

  **Issue:** `onFilterChange` is an inline arrow function that creates a new function reference on every render of AppContent. This means the FilterBar component receives new props on every parent render, though this is mitigated by the fact that FilterBar is only rendered conditionally when `showFilter` is true.

  **Fix:** Wrap in `useCallback`. Very low priority since FilterBar is only rendered when active.

  **Quick win:** Yes -- wrap in `useCallback`.

---

- [ ] **F2.12: No database index for method or response_status columns**

  **Severity:** Medium

  **File:** `src/daemon/storage.ts:37-39`

  ```sql
  CREATE INDEX IF NOT EXISTS idx_requests_timestamp ON requests(timestamp DESC);
  CREATE INDEX IF NOT EXISTS idx_requests_session ON requests(session_id);
  CREATE INDEX IF NOT EXISTS idx_requests_label ON requests(label);
  ```

  **Issue:** The new filter feature queries by `method IN (...)` and `response_status >= ? AND response_status < ?`, but neither column has an index. For small datasets this is fine, but as the request count grows (the default limit is 1000), full table scans on these columns will become increasingly slow.

  **Fix:** Add a composite index or individual indices for the commonly filtered columns. A migration adding `CREATE INDEX IF NOT EXISTS idx_requests_method ON requests(method)` and `CREATE INDEX IF NOT EXISTS idx_requests_status ON requests(response_status)` would help. Consider a composite index `(method, response_status)` if combined filters are the common case.

  **Quick win:** No -- requires a new migration.

---

## Quick Wins

| Issue | Description | Effort |
|-------|-------------|--------|
| F2.2 | Remove unnecessary `useCallback` from `buildFilter` | Minutes |
| F2.4 | Add regex validation for statusRange format | Minutes |
| F2.5 | Add backspace test for FilterBar | Minutes |
| F2.7 | Add empty-filter-on-Enter test | Minutes |
| F2.8 | Add max search length constant | Minutes |
| F2.10 | Add cursor indicator to search field | Minutes |
| F2.11 | Wrap onFilterChange in useCallback | Minutes |
| F3.3 | Fix project init to use resolveOverridePath / findOrCreateProjectRoot | Minutes |
| F3.4 | Add client.close() in command finally blocks | Minutes |
| F3.5 | Add edge case tests for resolveOverridePath | Minutes |
| F3.8 | Improve error message when --dir path not found | Minutes |

## High Impact

| Issue | Description | Impact |
|-------|-------------|--------|
| F2.9 | Cannot type 'm' or 's' in filter search field | Blocks common searches |
| F1.4 | Syntax highlighting on unbounded body size | Performance on large responses |
| F1.2 | JSON pretty-print heuristic too aggressive | Incorrect formatting |
| F2.3 | Filter change does not trigger immediate fetch | 2-second delay after applying filter |
| F2.12 | Missing indices for filtered columns | Performance at scale |
