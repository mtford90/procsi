# procsi Code Review -- 2026-02-14

Review of two features: (1) Interceptor Events Integration in the TUI, and (2) the CLI Query Interface.

## Summary

| Dimension | Issues Found |
|-----------|-------------|
| 1. React/Ink Best Practices | 3 issues |
| 2. TypeScript Quality | 3 issues |
| 3. Code Completeness | 5 issues |
| 4. Test Coverage | 5 issues |
| 5. Project Organisation | 3 issues |
| 6. Security | 2 issues |
| 7. UX/UI Principles | 2 issues |
| 8. Performance | 2 issues |

---

## 1. React/Ink Best Practices

**Positive Observations:**
- `EventRow` in `InterceptorLogModal` is correctly wrapped in `React.memo()`, preventing unnecessary re-renders for list items.
- `EventFilterBar` uses a debounce ref with proper cleanup on both the dependency effect and the unmount effect, and stores `buildFilter` in a ref to avoid stale closures in the debounced callback.
- `InfoBar` properly cleans up its `setInterval` timer in the `useEffect` return callback.
- `useInterceptorEvents` cleans up the `ControlClient` on unmount and clears its polling interval -- no leaked resources.
- The `InterceptorLogModal` correctly disables `useInput` when the filter bar is active (`isActive: isActive && !showFilter`), preventing double-handling of keys.
- `App.tsx` properly threads `isActive` through to the `InterceptorLogModal`, and the modal replaces the main view (full-screen replacement pattern) rather than overlaying it.

---

- [ ] **TUI.1.1: `maxScrollOffset` and `availableHeight` captured by stale closure in `useInput`**

  **Severity:** Medium

  **File:** `src/cli/tui/components/InterceptorLogModal.tsx:168-213`

  ```tsx
  const filterBarHeight = showFilter ? FILTER_BAR_ROWS : 0;
  const availableHeight = height - HEADER_ROWS - FOOTER_ROWS - filterBarHeight;
  const maxScrollOffset = Math.max(0, displayRows.length - availableHeight);

  // ...

  useInput(
    (input, key) => {
      // Uses maxScrollOffset and availableHeight directly
      if (input === "j" || key.downArrow) {
        setScrollOffset((prev) => Math.min(prev + 1, maxScrollOffset));
      }
      // ...
    },
    { isActive: isActive && !showFilter },
  );
  ```

  **Issue:** `useInput` from ink re-creates the input handler only when `isActive` changes. The handler captures `maxScrollOffset` and `availableHeight` from the render scope, but these derived values change when `displayRows`, `height`, or `showFilter` change. If the event list grows (new events arriving via polling) without `isActive` toggling, the handler will use a stale `maxScrollOffset`, potentially preventing scrolling to newly arrived events or allowing over-scrolling. This is the same class of stale-closure bug that was fixed in App.tsx (review 2026-02-05, issue 1.5) where refs were introduced for values used inside `useOnWheel`.

  **Fix:** Store `maxScrollOffset` and `availableHeight` in refs (e.g. `maxScrollOffsetRef`, `availableHeightRef`) and sync them on every render, the same pattern used in `App.tsx` for `contentHeightRef` and `requestsLengthRef`. The `useInput` callback then reads from refs instead of closure-captured values.

  **Quick win:** Yes

---

- [ ] **TUI.1.2: `EventRow` list uses index-based keys that shift on scroll**

  **Severity:** Low

  **File:** `src/cli/tui/components/InterceptorLogModal.tsx:299-306`

  ```tsx
  {visibleSlice.map((row, idx) => (
    <EventRow
      key={scrollOffset + idx}
      text={row.text}
      level={row.event.level}
      isDetail={row.isDetail}
    />
  ))}
  ```

  **Issue:** Using `scrollOffset + idx` as the key means every `EventRow` gets a new key when the user scrolls, causing React to unmount and remount every row on every scroll step. This defeats the purpose of `React.memo` since the components are destroyed and recreated rather than updated. For a list of text-only components this is unlikely to cause visible performance issues, but it is architecturally wrong.

  **Fix:** Use a stable key derived from the event's `seq` number and the line index within that event (e.g. `${row.event.seq}-${isDetail ? 'd' : 'm'}-${detailIdx}`). Since `seq` is unique per event, this produces stable keys that survive scrolling.

  **Quick win:** Yes

---

- [ ] **TUI.1.3: `interceptorWarnCount` prop accepted but never used in `InfoBar`**

  **Severity:** Low

  **File:** `src/cli/tui/components/InfoBar.tsx:14,31-36`

  ```tsx
  export interface InfoBarProps {
    interceptorErrorCount: number;
    interceptorWarnCount: number;   // <-- defined in interface
    // ...
  }

  export function InfoBar({
    interceptorErrorCount,
    requestCount,
    interceptorCount,
    startTime,
  }: InfoBarProps): React.ReactElement {
    // interceptorWarnCount is destructured away but never referenced
  ```

  **Issue:** `interceptorWarnCount` is declared in the props interface and passed from `App.tsx` (line 753), but it is not destructured in the function parameters and is not used in the component body. This is dead code in the interface -- either it is intended for a future "warnings" display that was not implemented, or it was superseded by the error-only alert. Either way, it is unused prop baggage that adds confusion.

  **Fix:** If there is no plan to display warn counts separately, remove `interceptorWarnCount` from `InfoBarProps` and from the `App.tsx` call site. If it is planned for future use, add a comment indicating that.

  **Quick win:** Yes

---

## 2. TypeScript Quality

**Positive Observations:**
- The `RequestsFlags` interface in `requests.ts` uses explicit string types for all flag values, with proper parsing (`parseInt`) at the usage site rather than expecting Commander to return the correct type.
- `buildFilter` in `requests.ts` validates each field independently, checking for truthiness before assigning, rather than blindly spreading `opts` into the filter.
- The `resolveRequest` function in `request.ts` handles all three cases (exact match, unique prefix, ambiguous prefix) with clear error messages and exit codes.
- `EventFilter` in `EventFilterBar.tsx` uses `undefined` rather than empty strings for absent values, keeping the filter semantics clean.
- The `parseTime` function uses well-typed regex matches and validates parsed numeric values before use.
- `getGlobalOptions` in `helpers.ts` validates the Commander `optsWithGlobals()` output at runtime using `typeof` checks rather than blindly casting.

---

- [ ] **CLI.2.1: Unvalidated `as` casts on user-provided string values**

  **Severity:** Medium

  **File:** `src/cli/commands/requests.ts:81,207` and `src/cli/commands/interceptors.ts:235`

  ```typescript
  // requests.ts:81
  const target = opts.headerTarget as "request" | "response" | "both";

  // requests.ts:207
  const target = (opts.target ?? "both") as "request" | "response" | "both";

  // interceptors.ts:235
  const level = opts.level as InterceptorEventLevel | undefined;
  ```

  **Issue:** These cast user-provided CLI option strings to union types without runtime validation. A user typing `--header-target foo` or `--level banana` would pass the cast silently, sending an invalid value to the daemon. The daemon's `applyFilterConditions` may then behave unexpectedly (e.g. an unrecognised `headerTarget` silently matches nothing), and an invalid `level` would bypass all filtering. The project guidelines state "Never use `as` casts on external data."

  **Fix:** Validate the value at the CLI level before assigning. For example:
  ```typescript
  const VALID_TARGETS = ["request", "response", "both"] as const;
  const target = opts.headerTarget ?? "both";
  if (!VALID_TARGETS.includes(target as typeof VALID_TARGETS[number])) {
    console.error(`Invalid --header-target: "${target}". Use: ${VALID_TARGETS.join(", ")}`);
    process.exit(1);
  }
  ```
  Alternatively, use Commander's `.choices()` method to restrict the allowed values at the argument-parsing level.

  **Quick win:** Yes

---

- [ ] **CLI.2.2: `parseInt` without `isNaN` guard on `--limit` and `--offset`**

  **Severity:** Low

  **File:** `src/cli/commands/requests.ts:156-157,205-206,322-323`

  ```typescript
  const limit = parseInt(opts.limit ?? String(DEFAULT_LIMIT), 10);
  const offset = parseInt(opts.offset ?? "0", 10);
  ```

  **Issue:** If a user passes `--limit abc` or `--offset ""`, `parseInt` returns `NaN`, which propagates into the daemon query and produces undefined behaviour (SQLite treats NaN as NULL in a LIMIT clause, which means no limit). While Commander provides the default values when the flag is not used, it passes the raw string when the flag is used with an argument, so `--limit abc` would reach this code.

  **Fix:** Add `isNaN` checks with a friendly error message:
  ```typescript
  const limit = parseInt(opts.limit ?? String(DEFAULT_LIMIT), 10);
  if (isNaN(limit) || limit < 0) {
    console.error(`Invalid --limit value: "${opts.limit}"`);
    process.exit(1);
  }
  ```

  **Quick win:** Yes

---

- [ ] **CLI.2.3: `detail.test.ts` uses `as CapturedRequest` cast on partial test data**

  **Severity:** Low

  **File:** `src/cli/formatters/detail.test.ts:35`

  ```typescript
  function makeRequest(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
    return {
      // ...fields...
      ...overrides,
    } as CapturedRequest;
  }
  ```

  **Issue:** The `as CapturedRequest` cast silences type errors when optional fields like `requestBody`, `requestBodySize`, and `responseBodySize` are missing from the test fixture. The resulting object does not satisfy the full `CapturedRequest` interface -- `requestBodySize` and `responseBodySize` are required fields but are not provided in the defaults. If `formatRequestDetail` ever accesses these fields, the tests would not catch the resulting `undefined` access.

  **Fix:** Add the missing required fields to the base test fixture (`requestBodySize: 0`, `responseBodySize: 12`) so the `as` cast can be removed.

  **Quick win:** Yes

---

## 3. Code Completeness

**Positive Observations:**
- All magic numbers are extracted as named constants: `DEFAULT_LIMIT`, `SHORT_ID_LENGTH`, `HEADER_ROWS`, `FOOTER_ROWS`, `FILTER_BAR_ROWS`, `MAX_SEARCH_LENGTH`, `FILTER_DEBOUNCE_MS`, `FOLLOW_POLL_INTERVAL_MS`, `UPTIME_TICK_MS`, `DEFAULT_POLL_INTERVAL_MS`, `MAX_PREVIEW_LENGTH`.
- `parseTime` provides a comprehensive error message listing all supported formats when input is unrecognised, making the CLI self-documenting.
- `formatRequestDetail` handles the "pending" state (no response yet) gracefully, showing "pending" instead of crashing.
- `maskAuthValue` in `detail.ts` properly masks authorisation header values in CLI output, preventing accidental credential leakage in terminal scrollback.
- All subcommands in `requests.ts` and `request.ts` use `try/finally` to ensure `client.close()` is called on all code paths, including error exits.

---

- [ ] **CLI.3.1: `connectToDaemon` helper is duplicated verbatim between `requests.ts` and `request.ts`**

  **Severity:** Medium

  **File:** `src/cli/commands/requests.ts:95-111` and `src/cli/commands/request.ts:22-37`

  ```typescript
  // Identical in both files:
  async function connectToDaemon(command: Command): Promise<{
    client: ControlClient;
    projectRoot: string;
  }> {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);
    const paths = getProcsiPaths(projectRoot);

    const running = await isDaemonRunning(projectRoot);
    if (!running) {
      console.error("Daemon is not running. Start it with: procsi on");
      process.exit(1);
    }

    const client = new ControlClient(paths.controlSocketFile);
    return { client, projectRoot };
  }
  ```

  **Issue:** This is a textbook case of the "extract repeated patterns into helpers" guideline. The same function appears in two files, and `sessions.ts` and `interceptors.ts` contain near-identical inline versions of the same logic. Any change to the daemon-connection pattern (e.g. adding a timeout, changing the error message) must be replicated across 4+ files.

  **Fix:** Move `connectToDaemon` into `src/cli/commands/helpers.ts` alongside `requireProjectRoot` and `getErrorMessage`. Update all CLI command files to import from there.

  **Quick win:** Yes

---

- [ ] **CLI.3.2: `resolveRequest` fetches up to 1000 summaries for prefix matching**

  **Severity:** Medium

  **File:** `src/cli/commands/request.ts:48-53`

  ```typescript
  // Prefix match -- fetch all requests and filter client-side
  const summaries = await client.listRequestsSummary({ limit: 1000 });
  const matches = summaries.filter((s) => s.id.startsWith(idPrefix));
  ```

  **Issue:** When the exact match fails, the code fetches up to 1000 request summaries and filters client-side for ID prefix matches. The hardcoded limit of 1000 is both a magic number and an arbitrary cap that silently ignores requests beyond that point. A user with >1000 requests who types a short prefix may get a false "not found" error because the matching request is on page 2. The comment in the code even acknowledges this is a workaround for a missing server-side prefix-search endpoint.

  **Fix:** Extract `1000` into a named constant (e.g. `PREFIX_MATCH_SEARCH_LIMIT`). Longer-term, add a `searchByIdPrefix` method to the control API. As a short-term improvement, paginate through all results rather than capping at 1000, or at minimum warn the user when the result set is truncated.

  **Quick win:** Partially (constant extraction is a quick win; proper server-side support is not)

---

- [ ] **CLI.3.3: `parseTime` does not handle negative durations or overflow**

  **Severity:** Low

  **File:** `src/cli/utils/parse-time.ts:80-91`

  ```typescript
  const relMatch = RELATIVE_DURATION_RE.exec(trimmed);
  if (relMatch) {
    const amountStr = relMatch[1] ?? "0";
    const unit = relMatch[2] ?? "s";
    const amount = parseInt(amountStr, 10);
    const multiplier = DURATION_UNITS[unit];
    if (multiplier === undefined) {
      throw new Error(`Unknown duration unit: ${unit}`);
    }
    return currentMs - amount * multiplier;
  }
  ```

  **Issue:** Very large durations (e.g. `99999999999w`) will produce a negative epoch timestamp. While the regex only matches digits (`\d+`) so negative numbers are excluded, there is no upper bound check. `parseInt("99999999999", 10)` is valid JavaScript but `currentMs - 99999999999 * 604800000` produces a negative number, which would be a valid but nonsensical "since" filter (meaning "since before Unix epoch"). This is an edge case, but the error message would be confusing.

  **Fix:** Add a sanity check that the resulting timestamp is non-negative, or clamp to epoch 0. A friendlier approach would be to reject durations larger than a reasonable maximum (e.g. 1 year).

  **Quick win:** Yes

---

- [ ] **CLI.3.4: `EventFilterBar` has a redundant unmount cleanup effect**

  **Severity:** Low

  **File:** `src/cli/tui/components/EventFilterBar.tsx:96-119`

  ```tsx
  // Live debounced filter application
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
    }
    debounceRef.current = setTimeout(() => {
      onFilterChange(buildFilterRef.current());
    }, FILTER_DEBOUNCE_MS);

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, [search, levelIndex, interceptorIndex, onFilterChange]);

  // Cleanup debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);
  ```

  **Issue:** The second `useEffect` with an empty dependency array exists solely to clean up the debounce timer on unmount. However, the first `useEffect` already returns a cleanup function that fires on unmount (React runs all effect cleanups on unmount, regardless of dependency arrays). The second effect is therefore redundant -- it clears the same `debounceRef.current` that the first effect's cleanup already clears.

  **Fix:** Remove the second `useEffect`. The first effect's cleanup is sufficient.

  **Quick win:** Yes

---

- [ ] **CLI.3.5: `formatHint` double-checks `shouldShowHints` internally**

  **Severity:** Low

  **File:** `src/cli/formatters/hints.ts:25-29`

  ```typescript
  export function formatHint(segments: string[]): string {
    if (!shouldShowHints()) return "";
    const joined = segments.join(" \u2502 ");
    return `${DIM}  Hint: ${joined}${RESET}`;
  }
  ```

  **File:** `src/cli/commands/requests.ts:172-175` (and similar in other files)

  ```typescript
  if (shouldShowHints()) {
    console.log(formatHint(["procsi request <id> for detail", "--json for JSON output"]));
  }
  ```

  **Issue:** Every call site already checks `shouldShowHints()` before calling `formatHint()`. Inside `formatHint`, `shouldShowHints()` is checked again. This means the environment checks (isTTY, NO_COLOR) run twice on every hint render. The duplication also means callers can "forget" the outer check and still get correct behaviour, which makes the outer checks appear necessary but actually redundant. The design should be one or the other: either callers check and `formatHint` trusts them, or `formatHint` checks and callers always call it.

  **Fix:** Pick one pattern. The cleaner approach is to have `formatHint` handle the check internally (it already does), and remove the `shouldShowHints()` guards from all call sites. The returned empty string from `formatHint` would result in a `console.log("")` which is harmless, but for zero output, wrap the entire hint block:
  ```typescript
  const hint = formatHint(["..."]);
  if (hint) console.log(hint);
  ```

  **Quick win:** Yes

---

## 4. Test Coverage

**Positive Observations:**
- `EventFilterBar.test.tsx` is exceptionally thorough: it tests every field focus (search, level, interceptor), tab/shift-tab cycling, arrow key cycling in both directions for level and interceptor, backspace, escape with and without `onCancel`, enter, debounced live application, combined filters, cursor visibility, empty interceptor list, and search isolation from other fields. This is model test coverage for a TUI component.
- `InterceptorLogModal.test.tsx` covers rendering, empty states, error/warn events, multi-line stack traces, scroll navigation (j/k, g/G), filter bar activation, and event count display.
- `parse-time.test.ts` covers all supported formats with a fixed reference date, including edge cases (zero duration, whitespace, invalid input error messages, case insensitivity, 12am/12pm boundary conditions).
- The integration test (`cli-query.test.ts`) sets up a real control server + SQLite storage, seeds realistic test data, and exercises the full client->daemon path for list/filter/count/clear/search/query/session operations. This is solid integration coverage.
- `InfoBar.test.tsx` covers error mode singular/plural, info mode singular/plural, uptime formatting, and the empty state.

---

- [ ] **CLI.4.1: No test for `InterceptorLogModal` filter-then-cancel flow**

  **Severity:** Medium

  **File:** `src/cli/tui/components/InterceptorLogModal.test.tsx`

  **Issue:** The test file verifies that pressing `/` opens the filter bar, but there is no test that verifies the cancel behaviour: open filter, change the filter, press Escape, and verify that the previous filter state is restored via `preOpenFilterRef`. This is the core UX guarantee of the filter cancel feature (lines 137, 177-181, 191 of `InterceptorLogModal.tsx`).

  **Fix:** Add a test that:
  1. Renders with events that include both "info" and "error" levels
  2. Opens the filter bar with `/`
  3. Changes the filter (e.g. type a search term)
  4. Presses Escape
  5. Verifies that the unfiltered event list is restored

  **Quick win:** Yes

---

- [ ] **CLI.4.2: `hints.test.ts` never tests the positive (TTY) path for `formatHint`**

  **Severity:** Medium

  **File:** `src/cli/formatters/hints.test.ts:31-42`

  ```typescript
  describe("formatHint", () => {
    it("should join segments with separator", () => {
      // Force non-TTY so formatHint returns empty (tested separately for TTY)
      vi.stubGlobal("process", {
        ...process,
        stdout: { ...process.stdout, isTTY: false },
        env: { ...process.env },
      });
      // When hints are suppressed, should return empty string
      expect(formatHint(["a", "b", "c"])).toBe("");
    });
  });
  ```

  **Issue:** The only `formatHint` test verifies the suppressed case (non-TTY). The happy path -- where `formatHint` returns a formatted string with DIM codes and the "Hint:" prefix, joining segments with the separator -- is never tested. The comment says "tested separately for TTY" but no such test exists. This means the actual formatting logic has zero test coverage.

  **Fix:** Add a test that stubs `process.stdout.isTTY` as `true` and verifies the output contains `Hint:`, the joined segments, and the separator character.

  **Quick win:** Yes

---

- [ ] **CLI.4.3: No test for `parseTime` with invalid 12-hour time values**

  **Severity:** Low

  **File:** `src/cli/utils/parse-time.test.ts`

  **Issue:** The test file covers valid 12-hour times (10am, 2:30pm, 12am, 12pm) but does not test the validation error paths: `13am`, `0am`, `12:60pm`, or other invalid 12-hour inputs. The code at `parse-time.ts:114` validates `hours < 1 || hours > 12 || minutes < 0 || minutes > 59` and throws, but this branch is untested.

  **Fix:** Add test cases:
  ```typescript
  it("should throw on invalid 12-hour time (0am)", () => {
    expect(() => parseTime("0am", NOW)).toThrow("Invalid 12-hour time");
  });
  it("should throw on invalid 12-hour time (13pm)", () => {
    expect(() => parseTime("13pm", NOW)).toThrow("Invalid 12-hour time");
  });
  ```

  **Quick win:** Yes

---

- [ ] **CLI.4.4: No test for `parseTime` with invalid 24-hour time values**

  **Severity:** Low

  **File:** `src/cli/utils/parse-time.test.ts`

  **Issue:** Similarly, the 24-hour validation path (`hours < 0 || hours > 23 || minutes < 0 || minutes > 59`) at `parse-time.ts:135` is untested. Inputs like `25:00` or `14:99` would trigger the error, but no test exercises it.

  **Fix:** Add test cases for `25:00` and `14:99`.

  **Quick win:** Yes

---

- [ ] **CLI.4.5: No test for `completions` command output**

  **Severity:** Medium

  **File:** `src/cli/commands/completions.ts`

  **Issue:** The completion script generators (`generateZshCompletions`, `generateBashCompletions`, `generateFishCompletions`) have no unit tests at all. These functions produce shell scripts that will be `eval`'d by users' shells. A typo or missing escape in the generated script could break the user's shell session. At minimum, tests should verify: (a) the output contains the expected top-level command names, (b) no unescaped single quotes appear inside single-quoted strings, and (c) subcommand options are included.

  **Fix:** Add a co-located `completions.test.ts` that creates a minimal Commander program, calls each generator, and asserts on the output structure.

  **Quick win:** Yes

---

## 5. Project Organisation

**Positive Observations:**
- `shared/` module boundary is respected throughout all new code. The CLI commands import from `shared/control-client.js`, `shared/project.js`, `shared/daemon.js`, and `shared/types.js` without ever importing from `daemon/`.
- The formatter module split (`table.ts` for lists, `detail.ts` for single items, `hints.ts` for contextual hints) provides a clean separation of formatting concerns.
- `useInterceptorEvents` follows the same hook pattern as `useRequests` (ControlClient in ref, polling via interval, delta fetching), making the codebase consistent.
- The `InterceptorLogModal` is self-contained -- it receives events as a prop and handles its own scroll/filter state, with no global state dependencies.

---

- [ ] **CLI.5.1: ANSI colour constants duplicated across three formatter files**

  **Severity:** Medium

  **File:** `src/cli/formatters/table.ts:19-25`, `src/cli/formatters/detail.ts:13-20`, `src/cli/formatters/hints.ts:9-10`

  ```typescript
  // table.ts
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const RED = "\x1b[31m";
  const CYAN = "\x1b[36m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";

  // detail.ts
  const GREEN = "\x1b[32m";
  const YELLOW = "\x1b[33m";
  const RED = "\x1b[31m";
  const CYAN = "\x1b[36m";
  const BOLD = "\x1b[1m";
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";

  // hints.ts
  const DIM = "\x1b[2m";
  const RESET = "\x1b[0m";
  ```

  **Issue:** The same ANSI escape code constants are defined independently in three files. The `useColour()` function is also duplicated between `table.ts` and `detail.ts`. If a fourth formatter is added, or if NO_COLOR handling needs to change, the duplication multiplies.

  **Fix:** Extract ANSI codes and `useColour()` into a shared `src/cli/formatters/colour.ts` module. All formatter files then import from one place.

  **Quick win:** Yes

---

- [ ] **CLI.5.2: `formatInterceptorEventTable` and `formatSessionTable` are in `detail.ts` despite being table formatters**

  **Severity:** Low

  **File:** `src/cli/formatters/detail.ts:131,155`

  **Issue:** `detail.ts` is described as "Detailed request/session/event formatters" but it contains `formatSessionTable` and `formatInterceptorEventTable`, which are tabular list formatters, not single-item detail views. Meanwhile `table.ts` only contains request list formatting. This naming is misleading -- a developer looking for session table formatting would naturally look in `table.ts`.

  **Fix:** Either rename `detail.ts` to something broader (e.g. `formatters.ts` or `output.ts`), or move the table formatters for sessions and events into `table.ts` to keep it consistent (all tabular output in one file, all detail output in another).

  **Quick win:** Yes

---

- [ ] **CLI.5.3: `sessions.ts` inlines `connectToDaemon` logic rather than sharing with other commands**

  **Severity:** Low

  **File:** `src/cli/commands/sessions.ts:16-25`

  ```typescript
  .action(async (opts: { json?: boolean }, command: Command) => {
    const globalOpts = getGlobalOptions(command);
    const projectRoot = requireProjectRoot(globalOpts.dir);
    const paths = getProcsiPaths(projectRoot);

    const running = await isDaemonRunning(projectRoot);
    if (!running) {
      console.error("Daemon is not running. Start it with: procsi on");
      process.exit(1);
    }

    const client = new ControlClient(paths.controlSocketFile);
  ```

  **Issue:** This is the same `connectToDaemon` pattern as CLI.3.1, but here it is inlined rather than extracted into a local function. The same pattern also appears in `interceptors.ts` (multiple times). This compounds the duplication problem described in CLI.3.1.

  **Fix:** Same as CLI.3.1 -- extract to `helpers.ts`.

  **Quick win:** Yes

---

## 6. Security

**Positive Observations:**
- `formatRequestDetail` masks authorisation headers in CLI output (`maskAuthValue`), preventing credential leakage in terminal scrollback or pipe output.
- The `body` subcommand writes raw bytes directly to stdout (`process.stdout.write(body)`), which is safe and avoids any encoding-related data corruption.
- `parseTime` never `eval`s user input and uses strict regex matching, so there is no code injection vector.
- All database queries in the integration test use the existing parameterised query infrastructure -- no raw SQL interpolation.
- The confirmation prompt in `requests clear` correctly checks `process.stdout.isTTY` before prompting, avoiding hangs when piped.

---

- [ ] **CLI.6.1: Completion script generators interpolate descriptions without shell escaping**

  **Severity:** Medium

  **File:** `src/cli/commands/completions.ts:40-55,144-156`

  ```typescript
  // zsh:
  const globalOptions = program.options.map(
    (opt) => `'${opt.long ?? opt.short ?? ""}[${opt.description}]'`
  );
  // ...
  const cmdList = commands.map((c) => `'${c.name}:${c.description}'`).join(" \\\n    ");

  // fish:
  lines.push(
    `complete -c procsi -n '__fish_use_subcommand' -a '${cmd.name}' -d '${cmd.description}'`
  );
  ```

  **Issue:** Command names and descriptions are interpolated directly into single-quoted shell strings without escaping single quotes within the values. If a command description contains a single quote (e.g. `"don't"` or `"filter by 'host'"`) the generated completion script will have a syntax error that breaks the user's shell config. Since these descriptions come from Commander's `.description()` calls which are controlled by the procsi codebase, this is not exploitable by end users, but it is a latent bug that will trigger the moment someone writes a description containing an apostrophe.

  **Fix:** Add a `shellEscapeSingleQuote` function and apply it to all interpolated values:
  ```typescript
  function escapeForSingleQuote(str: string): string {
    return str.replace(/'/g, "'\\''");
  }
  ```
  Apply to `cmd.name`, `cmd.description`, `opt.flags`, and `opt.description` in all three generators.

  **Quick win:** Yes

---

- [ ] **CLI.6.2: `body` subcommand writes binary data to TTY without warning**

  **Severity:** Low

  **File:** `src/cli/commands/request.ts:106-107`

  ```typescript
  // Write raw bytes to stdout, bypassing any encoding
  process.stdout.write(body);
  ```

  **Issue:** When `procsi request <id> body` is run interactively (not piped), binary response bodies (e.g. images, gzip data) are written directly to the terminal. This can produce garbled output, trigger terminal escape sequences, and in rare cases alter terminal state (e.g. binary data that happens to contain ANSI escape codes). Tools like `cat` have the same behaviour, so this is not unusual, but developer tools like `curl` print a warning when writing binary to a TTY.

  **Fix:** When `process.stdout.isTTY` is true, check if the body contains non-UTF-8 bytes or has a binary content type, and either print a warning to stderr or refuse to dump (with a hint to pipe to a file). This matches curl's `--output` behaviour.

  **Quick win:** Yes

---

## 7. UX/UI Principles

**Positive Observations:**
- The "gradual discovery" pattern is consistently applied: every CLI command that produces output includes contextual hints pointing to related commands (e.g. `requests` hints at `request <id>`, `request` hints at `body` and `export`). Hints are suppressed when piped or when `NO_COLOR` is set.
- `--json` output is available on every command, making all output machine-parseable for scripting.
- The `requests clear` command requires confirmation by default, with `--yes` for scripted use and automatic skip when piped.
- Short ID prefixes (`a1b2c3d`) are used consistently across table output and `request <id>` resolution, reducing typing for the common case.
- The filter cancel pattern (Escape reverts to pre-open state) in both `EventFilterBar` and `FilterBar` provides a safe exploration experience.
- The `InfoBar` error mode is prominent (red, bold, with a hint to press L) without being intrusive, and degrades to an info-mode statistics display when there are no errors.

---

- [ ] **CLI.7.1: `procsi requests` shows `--method, --status, --host to filter` but does not mention `--since`/`--before`**

  **Severity:** Low

  **File:** `src/cli/commands/requests.ts:346-351`

  ```typescript
  if (shouldShowHints()) {
    console.log(
      formatHint([
        "procsi request <id>",
        "--method, --status, --host to filter",
        "--json for JSON",
      ])
    );
  }
  ```

  **Issue:** The time-based filters (`--since`, `--before`) are a major usability feature (especially `--since 5m` for recent debugging) but are not mentioned in the hint. Since the gradual discovery pattern is the primary way users learn about CLI capabilities, omitting this feature from hints reduces discoverability.

  **Fix:** Add `"--since 5m, --before yesterday for time filtering"` to the hint segments, or make a second hint line.

  **Quick win:** Yes

---

- [ ] **CLI.7.2: `procsi interceptors logs` with `--follow` has no visual indication that it is waiting**

  **Severity:** Low

  **File:** `src/cli/commands/interceptors.ts:257-312`

  **Issue:** After printing the initial batch of events, the `--follow` mode enters a silent polling loop. The user sees no indication that procsi is still running and waiting for new events. Compare with `tail -f` which is universally understood, or `kubectl logs --follow` which prints nothing but the command does not exit. For a less familiar tool, some visual feedback would help.

  **Fix:** Print a dim separator line after the initial batch (e.g. `--- following events (Ctrl+C to stop) ---`) to signal that the command is actively tailing. This is what `docker logs -f` does.

  **Quick win:** Yes

---

## 8. Performance

**Positive Observations:**
- `useInterceptorEvents` uses delta fetching via `afterSeq`, only requesting new events since the last seen sequence number. This avoids re-transferring the full event history on every poll cycle.
- `formatRequestTable` delegates to `formatDuration` and `formatSize` (already-optimised formatters) rather than reimplementing formatting.
- The `requests` command fetches summaries and count in parallel via `Promise.all`, halving the latency for the most common CLI operation.
- `InterceptorLogModal` computes `displayRows`, `filteredEvents`, and `interceptorNames` via `useMemo` with appropriate dependency arrays, avoiding recomputation on unrelated state changes.
- The `EventFilterBar` debounce (150ms) prevents excessive re-filtering while the user types rapidly.

---

- [ ] **CLI.8.1: `useInterceptorEvents` issues two requests per poll cycle**

  **Severity:** Medium

  **File:** `src/cli/tui/hooks/useInterceptorEvents.ts:76-95`

  ```typescript
  const result = await client.getInterceptorEvents({
    afterSeq: lastSeenSeqRef.current,
  });

  // ...

  // Also fetch interceptor count from status
  const status = await client.status();
  setInterceptorCount(status.interceptorCount ?? 0);
  ```

  **Issue:** Every poll cycle (every 2 seconds by default) makes two sequential requests to the daemon: one for events and one for status (to get the interceptor count). These are sequential `await`s, so the total poll latency is the sum of both round trips. With the persistent-connection ControlClient this is fast, but it is still double the necessary work. The interceptor count rarely changes (only on reload), yet it is fetched every 2 seconds.

  **Fix:** Either:
  1. Include `interceptorCount` in the `getInterceptorEvents` response from the daemon (most efficient -- one request, one response).
  2. Use `Promise.all` to parallelise the two requests.
  3. Fetch the status less frequently (e.g. every 10th poll cycle, or only on `refresh()`).

  **Quick win:** Option 2 is a quick win; option 1 is more architecturally correct.

---

- [ ] **CLI.8.2: `resolveRequest` prefix matching fetches 1000 summaries for a single lookup**

  **Severity:** Low

  **File:** `src/cli/commands/request.ts:52`

  ```typescript
  const summaries = await client.listRequestsSummary({ limit: 1000 });
  ```

  **Issue:** (Overlaps with CLI.3.2.) When the exact ID match fails, the code fetches up to 1000 summary objects over the control socket, parses them all as JSON, and then filters client-side by prefix. For most use cases (user types a 7-character prefix), only 0 or 1 results will match. This transfers ~100KB+ of data to find a single request. For a CLI tool this latency (tens of milliseconds) is unlikely to be noticeable, but it scales poorly with traffic volume.

  **Fix:** Add a server-side `searchByIdPrefix` handler in the control API that does `WHERE id LIKE ? || '%'` with a `LIMIT 2` (only need to know if 0, 1, or >1 match). This would reduce the data transfer from ~100KB to ~200 bytes.

  **Quick win:** No -- requires a new control API method.

---

## Quick Wins

Issues that can be fixed in minutes with minimal risk:

| ID | Summary |
|----|---------|
| TUI.1.1 | Use refs for `maxScrollOffset`/`availableHeight` in InterceptorLogModal |
| TUI.1.2 | Use stable keys based on `event.seq` for EventRow list |
| TUI.1.3 | Remove unused `interceptorWarnCount` prop from InfoBar |
| CLI.2.1 | Validate `--header-target` and `--level` before using |
| CLI.2.2 | Add `isNaN` guard on parsed `--limit`/`--offset` |
| CLI.2.3 | Add missing required fields to test fixture, remove `as` cast |
| CLI.3.1 | Extract `connectToDaemon` to `helpers.ts` |
| CLI.3.4 | Remove redundant unmount cleanup effect in EventFilterBar |
| CLI.3.5 | Consolidate `shouldShowHints` check into `formatHint` only |
| CLI.4.2 | Add positive-path test for `formatHint` |
| CLI.4.3 | Add tests for invalid 12-hour time values |
| CLI.4.4 | Add tests for invalid 24-hour time values |
| CLI.4.5 | Add basic unit tests for completion generators |
| CLI.5.1 | Extract ANSI codes and `useColour()` into shared module |
| CLI.6.1 | Escape single quotes in completion script generators |
| CLI.7.1 | Add `--since`/`--before` to request list hint |
| CLI.7.2 | Print "following" indicator in `--follow` mode |
