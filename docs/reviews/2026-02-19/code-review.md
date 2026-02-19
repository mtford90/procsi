# procsi Code Review -- 2026-02-19

Review of features added since commit `dec0143` (last code review, 2026-02-14): bookmarks, overrides (multi-language: PHP, Python, Ruby + enhanced Node), request source, persist preferred port, filter bar AND, regexp filtering, body search from within the TUI, and replay requests.

~7,800 lines added across 81 files.

## Summary

| Dimension | Issues Found |
|-----------|-------------|
| 1. React/Ink Best Practices | 8 issues |
| 2. TypeScript Quality | 11 issues |
| 3. Code Completeness | 18 issues |
| 4. Test Coverage | 13 issues |
| 5. Project Organisation | 9 issues |
| 6. Security | 9 issues |
| 7. UX/UI Principles | 14 issues |
| 8. Performance | 11 issues |
| **Total** | **93 issues** |

---

## 1. React/Ink Best Practices

**Positive Observations:**

- **Previous review issues addressed.** All three TUI issues from the 2026-02-14 review have been fixed: `InterceptorLogModal` now uses `maxScrollOffsetRef` and `availableHeightRef` to avoid stale closures (TUI.1.1), `EventRow` keys are stable via `row.key` derived from `event.seq` (TUI.1.2), and the unused `interceptorWarnCount` prop has been removed from `InfoBar` (TUI.1.3).
- **`RequestListItem` is properly wrapped in `React.memo()` with a custom comparison function** (line 197-204) that checks all five meaningful props. This prevents unnecessary re-renders for the most frequently rendered component in the TUI.
- **`EventRow`, `TextLine`, and `TreeNodeRowWithArrow` are all `React.memo()` wrapped.** Every list-item component rendered in a `.map()` is memoised, matching the project's code quality guideline.
- **`RequestList` uses `request.id` as keys** (line 70), providing stable identity that survives scroll offset changes.
- **`useInput` `isActive` threading is comprehensive.** `App.tsx` (line 637) composes all eight modal/filter booleans into the `isActive` condition. Each modal component accepts and passes `isActive` through to its own `useInput` call.
- **Filter bar cancel/revert pattern is correctly implemented.** Both `FilterBar` and `EventFilterBar` store pre-open state in refs (`preOpenFilterRef`) and revert on Escape.
- **`useRequests` keeps filter and bodySearch in refs** (lines 56-57) and syncs them via `useEffect` (lines 129-134). This avoids stale closures in the `fetchRequests` callback.
- **Timer cleanup is consistent.** `InfoBar` cleans up its uptime `setInterval`. `App.tsx` cleans up its status timeout ref. `TextViewerModal` and `JsonExplorerModal` both have unmount cleanup effects.
- **`useInterceptorEvents` parallelises its two requests** using `Promise.all` (line 77), addressing the previous review's CLI.8.1 performance concern.

---

- [ ] **TUI.1.1: `requests.length` captured by closure in `useInput` while `requestsLengthRef` exists for the same purpose**

  **Severity:** Low

  **File:** `src/cli/tui/App.tsx:397`

  ```tsx
  // Line 397 — inside useInput callback:
  setSelectedIndex((prev) => Math.min(prev + 1, requests.length - 1));

  // Lines 419, 434 — also inside useInput callback:
  setSelectedIndex((prev) => Math.min(prev + halfPage, requestsLengthRef.current - 1));
  ```

  **Issue:** The `useInput` callback uses `requests.length` directly at line 397 (j/down handler) but uses `requestsLengthRef.current` at lines 419 and 434 (Ctrl+d and G handlers). The inconsistency is confusing -- a future refactor that wraps the handler in `useCallback` to reduce re-subscriptions would silently introduce a stale closure at line 397 while the ref-based reads would remain correct. The same inconsistency applies to `requests.length > 0` checks at lines 552 and 615.

  **Fix:** Use `requestsLengthRef.current` consistently throughout the entire `useInput` callback.

  **Quick win:** Yes

---

- [ ] **TUI.1.2: `new Set([focusedSection])` creates a new object on every render, defeating memoisation in `AccordionPanel`**

  **Severity:** Low

  **File:** `src/cli/tui/App.tsx:830`

  ```tsx
  <AccordionPanel
    ref={accordionPanelRef}
    request={selectedFullRequest}
    isActive={activePanel === "accordion"}
    width={accordionWidth}
    height={contentHeight}
    focusedSection={focusedSection}
    expandedSections={new Set([focusedSection])}
  />
  ```

  **Issue:** `new Set([focusedSection])` creates a new `Set` object on every render. If `AccordionPanel` were ever wrapped in `React.memo` (as recommended by the project guidelines), the new `Set` identity would prevent the memo from working. Since `expandedSections` is always a single-element set derived from `focusedSection`, it could be replaced with just the `focusedSection` number.

  **Fix:** Memoize the set via `useMemo`:
  ```tsx
  const expandedSectionsSet = useMemo(() => new Set([focusedSection]), [focusedSection]);
  ```
  Or simplify the prop from `expandedSections: Set<number>` to just use `focusedSection` directly.

  **Quick win:** Yes

---

- [ ] **TUI.1.3: Multiple state values captured by closure in `useInput` without refs**

  **Severity:** Medium

  **File:** `src/cli/tui/App.tsx:355-638`

  **Issue:** The `useInput` callback captures approximately 15 state/derived values from the component scope. Currently works because ink's `useInput` re-subscribes when the `inputHandler` reference changes, and the inline function creates a new reference each render. However, this is fragile and imposes a hidden performance cost: every render causes ink to remove the old event listener and add a new one. The project's own code quality guidelines state "Use refs for values accessed in stable callbacks", and the codebase already follows this pattern for `contentHeightRef` and `requestsLengthRef` -- but inconsistently.

  **Fix:** Either wrap the handler in `useCallback` with explicit dependencies, or document the intentional trade-off with a comment explaining why refs are not used here.

  **Quick win:** No (documentation is quick; full refactor is not)

---

- [ ] **TUI.1.4: Stale `maxScrollOffset` and `availableHeight` closures in `TextViewerModal` `useInput`**

  **Severity:** Medium

  **File:** `src/cli/tui/components/TextViewerModal.tsx:112,136-228`

  ```tsx
  const maxScrollOffset = Math.max(0, totalLines - availableHeight);

  useInput(
    (input, key) => {
      setScrollOffset((prev) => Math.min(prev + 1, maxScrollOffset));
      const halfPage = Math.floor(availableHeight / 2);
      // ...
    },
    { isActive },
  );
  ```

  **Issue:** `maxScrollOffset` and `availableHeight` are captured by the `useInput` closure without refs. `InterceptorLogModal` was specifically refactored to use refs for the same values to address stale closures, as noted in the previous review (TUI.1.1). The `TextViewerModal` has the same pattern but was not given the same treatment.

  **Fix:** Add refs matching the `InterceptorLogModal` pattern:
  ```tsx
  const maxScrollOffsetRef = useRef(0);
  maxScrollOffsetRef.current = maxScrollOffset;
  const availableHeightRef = useRef(0);
  availableHeightRef.current = availableHeight;
  ```

  **Quick win:** Yes

---

- [ ] **TUI.1.5: Same stale closure pattern in `JsonExplorerModal` `useInput`**

  **Severity:** Medium

  **File:** `src/cli/tui/components/JsonExplorerModal.tsx:168,185-322`

  **Issue:** The `JsonExplorerModal` captures `visibleNodes.length`, `availableHeight`, `expandedPaths`, `cursorNode`, `cursorIndex`, `matchingPaths`, and `matchLineIndices` in its `useInput` closure without refs. The `InterceptorLogModal` in the same codebase uses refs for the equivalent values. Three modal components have three different approaches to the same problem.

  **Fix:** Same as TUI.1.4 -- add refs for derived values. At minimum, `availableHeight` and `visibleNodes.length` should be stored in refs for consistency.

  **Quick win:** Yes

---

- [ ] **TUI.1.6: `splitByMatch` segments use index-based keys inside `React.memo()` component**

  **Severity:** Low

  **File:** `src/cli/tui/components/RequestListItem.tsx:182-188`

  ```tsx
  {splitByMatch(paddedPath, searchTerm).map((seg, i) =>
    seg.isMatch ? (
      <Text key={i} color="yellow" bold>{seg.text}</Text>
    ) : (
      <Text key={i}>{seg.text}</Text>
    ),
  )}
  ```

  **Issue:** The `Text` elements rendered for search-match highlighting use index-based keys. Since these are simple stateless `Text` nodes within a memo'd parent, the visual impact is negligible -- but it is a code quality concern.

  **Fix:** Use content-based keys, or add a brief comment explaining why index keys are safe here.

  **Quick win:** Yes

---

- [ ] **TUI.1.7: Redundant unmount cleanup effect in `FilterBar`**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.tsx:225-232`

  **Issue:** This was flagged in the previous review (CLI.3.4) and has not been addressed. The second `useEffect` with an empty dependency array clears the same `debounceRef.current` that the first effect's cleanup already handles. React runs all effect cleanups on unmount regardless of dependency arrays.

  **Fix:** Remove the second `useEffect` (lines 226-232).

  **Quick win:** Yes

---

- [ ] **TUI.1.8: `setupMocksWithRequests` missing `toggleSaved` and `clearRequests` in mock return value**

  **Severity:** Low

  **File:** `src/cli/tui/App.test.tsx:126-137`

  **Issue:** The `UseRequestsResult` interface requires `toggleSaved` and `clearRequests` as non-optional properties. The `setupMocksWithRequests` helper does not include these. If any test exercises the bookmark (`*`) or clear (`C`) shortcuts through this helper, it will call `undefined` as a function.

  **Fix:** Add mock implementations:
  ```tsx
  const mockToggleSaved = vi.fn().mockResolvedValue(true);
  const mockClearRequests = vi.fn().mockResolvedValue(true);
  ```

  **Quick win:** Yes

---

## 2. TypeScript Quality

**Positive Observations:**

- The control server has a well-designed validation layer: `optionalString`, `optionalNumber`, `requireString`, `optionalStringArray`, `optionalStringRecord`, `optionalReplayInitiator`, `optionalBodySearchTarget`, and `optionalFilter` all validate at runtime instead of casting.
- The `ControlHandlers` interface is a proper typed handler map with explicit keys, replacing the `Record<string, Handler>` anti-pattern. The `handleMessage` function uses `method in handlers` as a guard before indexing.
- All database row shapes are named interfaces (`DbRequestRow`, `DbRequestSummaryRow`, `DbSessionRow`, `DbSessionAuthRow`, `DbJsonQueryRow`, `DbCountRow`).
- The `isControlMessage` and `isControlResponse` type guards properly validate JSON-parsed data with `typeof` checks on discriminating fields.
- The `rowToSummary` and `rowToRequest` methods validate `interception_type` and `replay_initiator` with explicit string comparisons rather than casting.
- The `reviveBuffers` function uses structural type checks before treating an object as a serialised Buffer.
- The `connectToDaemon` helper has been correctly extracted into `helpers.ts` (fixing CLI.3.1 from the previous review).
- `normaliseRegexFilterInput` and `validateRegexFilter` validate patterns by constructing a `RegExp` and catching errors, with descriptive error messages.
- `parseIntFlag` validates `parseInt` output with `isNaN` and exits with a clear error (fixing CLI.2.2).
- The `headerTarget` validation now validates against a `validTargets` array before casting (fixing CLI.2.1).

---

- [ ] **TS.2.1: `as never` casts used to circumvent type system in `queryJsonBodies`**

  **Severity:** Medium

  **File:** `src/daemon/storage.ts:909,914`

  ```typescript
  extractParts.push({ sql: reqExtract, ctParams: reqCt.params, column: "request" } as never);
  // ...
  extractParts.push({ sql: resExtract, ctParams: resCt.params, column: "response" } as never);

  // Then later:
  const extracts = extractParts as unknown as {
    sql: string;
    ctParams: string[];
    column: string;
  }[];
  ```

  **Issue:** `extractParts` is typed as `string[]` but used to hold structured objects. The code uses `as never` to push objects in, then `as unknown as { ... }[]` to cast them back out. This completely defeats the type system.

  **Fix:** Type `extractParts` correctly from the start:
  ```typescript
  interface ExtractPart {
    sql: string;
    ctParams: string[];
    column: "request" | "response";
  }
  const extractParts: ExtractPart[] = [];
  ```

  **Quick win:** Yes

---

- [ ] **TS.2.2: `as` cast on `optionalString` result for `level` and `type` in `getInterceptorEvents` handler**

  **Severity:** Medium

  **File:** `src/daemon/control.ts:544,546`

  ```typescript
  const level = optionalString(params, "level") as InterceptorEventLevel | undefined;
  const type = optionalString(params, "type") as InterceptorEventType | undefined;
  ```

  **Issue:** Cast to union types without validating the string is a valid member. A client sending `{ level: "banana" }` passes silently. The `SEVERITY` record lookup returns `undefined`, causing `<number> < undefined` to evaluate to `false`, effectively disabling the level filter.

  **Fix:** Add dedicated validators following the same pattern as `optionalReplayInitiator` and `optionalBodySearchTarget`.

  **Quick win:** Yes

---

- [ ] **TS.2.3: `as` cast on `target` in `queryJsonBodies` control handler**

  **Severity:** Medium

  **File:** `src/daemon/control.ts:402-406`

  ```typescript
  const target = optionalString(params, "target") as
    | "request"
    | "response"
    | "both"
    | undefined;
  ```

  **Issue:** Same pattern as TS.2.2. The `optionalBodySearchTarget` validator already exists and validates the same set of values, so it should be reused.

  **Fix:** `const target = optionalBodySearchTarget(params, "target");`

  **Quick win:** Yes

---

- [ ] **TS.2.4: `as` cast on `type` in MCP `procsi_get_interceptor_events` tool**

  **Severity:** Low

  **File:** `src/mcp/server.ts:1386`

  ```typescript
  type: params.type as InterceptorEventType | undefined,
  ```

  **Issue:** The `type` parameter is declared as `z.string().optional()` in the Zod schema, so Zod only validates it is a string. Unlike `level` which uses `z.enum()`, `type` has no enum validation.

  **Fix:** Change the Zod schema for `type` to use `z.enum()` with all valid `InterceptorEventType` values.

  **Quick win:** Yes

---

- [ ] **TS.2.5: `as Record<string, string>` cast on `JSON.parse` result in `safeParseHeaders`**

  **Severity:** Low

  **File:** `src/daemon/storage.ts:1143-1148`

  **Issue:** Trusts that stored JSON is a flat string-keyed object. If corrupted (e.g. a header value stored as a number, or headers stored as an array), the cast would silently produce incorrect types downstream.

  **Fix:** Add a structural check that validates the parsed object is a record of strings, coercing non-string values via `String(value)`.

  **Quick win:** Yes

---

- [ ] **TS.2.6: `as` cast on `target` in `requests.ts` query subcommand**

  **Severity:** Low

  **File:** `src/cli/commands/requests.ts:259`

  **Issue:** The validation correctly checks the value, but `validTargets` array type is disconnected from the union type. If a new target value were added to the union but not the array, validation would reject it without a type error.

  **Fix:** Use `as const` on the array and derive types from it, then use a type guard for narrowing.

  **Quick win:** Yes

---

- [ ] **TS.2.7: `ControlClient.request<T>` trusts daemon responses without validation**

  **Severity:** Medium

  **File:** `src/shared/control-client.ts:118-141`

  **Issue:** Every `ControlClient` method calls `this.request<T>()` and the response `parsed.result` (which is `unknown`) is resolved directly as `T`. No runtime validation that the daemon's response matches `T`. If the daemon returns malformed data (version mismatch, bug), the client code receives incorrectly-typed data that passes the compiler but fails at runtime.

  **Fix:** Add a `validate` option to `request<T>()` that accepts a type guard. Apply validators to the most critical methods first (e.g. `getRequest`, `status`).

  **Quick win:** No (requires response validators for each method)

---

- [ ] **TS.2.8: `as RequestInit & { dispatcher: ProxyAgent }` cast on fetch options in replay.ts**

  **Severity:** Low

  **File:** `src/daemon/replay.ts:133-140`

  **Issue:** The `dispatcher` property is not part of standard `RequestInit` but is valid for undici. A typo in the property name would not be caught.

  **Fix:** Create a typed `UndiciRequestInit` interface that extends `RequestInit` with `dispatcher`.

  **Quick win:** Yes

---

- [ ] **TS.2.9: `DbJsonQueryRow` missing `source` and `saved` fields**

  **Severity:** Low

  **File:** `src/daemon/storage.ts:1245-1259`

  **Issue:** The `JsonQueryResult` type extends `CapturedRequestSummary`, which includes `source`, `saved`, `interceptedBy`, `interceptionType`, `replayedFromId`, and `replayInitiator`. However, the SQL query does not select these columns, and the mapping does not populate them.

  **Fix:** Add the missing columns to the SQL query, `DbJsonQueryRow`, and the mapping. Or create a `JsonQueryResult` type that does not extend `CapturedRequestSummary`.

  **Quick win:** Yes

---

- [ ] **TS.2.10: `Reflect.get` used instead of standard property access in replay.ts**

  **Severity:** Low

  **File:** `src/daemon/replay.ts:19`

  ```typescript
  const maybeCause = Reflect.get(error, "cause");
  ```

  **Issue:** Unusual in this codebase and bypasses TypeScript's type narrowing. The `cause` property is standard in ES2022+.

  **Fix:** Use `"cause" in error ? error.cause : undefined` or just `error.cause`.

  **Quick win:** Yes

---

- [ ] **TS.2.11: `optsWithGlobals()` result cast is acceptable but noted**

  **Severity:** N/A

  **File:** `src/cli/commands/helpers.ts:15`

  **Issue:** The `as Record<string, unknown>` widening cast is safe because the subsequent field access uses runtime `typeof` checks. No action needed. Noted for completeness.

  **Quick win:** N/A (already correct)

---

## 3. Code Completeness

**Positive Observations:**

- All magic numbers are extracted as named constants throughout the new code: `REPLAY_TOKEN_TTL_MS`, `REPLAY_TRACKER_CLEANUP_INTERVAL_MS`, `REPLAY_TRACKER_MAX_ENTRIES`, `DEFAULT_REPLAY_TIMEOUT_MS`, `MIN_REPLAY_TIMEOUT_MS`, `MAX_REPLAY_TIMEOUT_MS`, `REPLAY_TOKEN_BYTES`, `FILTER_DEBOUNCE_MS`, `MAX_SEARCH_LENGTH`, `REGEX_CACHE_MAX_ENTRIES`, `PROCESS_NAME_TIMEOUT_MS`, `REPLAY_CONTROL_TIMEOUT_BUFFER_MS`, `SHORT_REQUEST_ID_LENGTH`, `DEFAULT_LIST_LIMIT`, `MAX_LIST_LIMIT`, `BODY_SCOPE_PREFIX`, `SESSION_TOKEN_BYTES`, `EVICTION_CHECK_INTERVAL`, and more.
- `parseIntFlag` properly validates parsed integers with `isNaN` and negativity checks (fixing CLI.2.2).
- `connectToDaemon` has been extracted to `helpers.ts` (fixing CLI.3.1).
- ANSI colour constants and `useColour()` extracted into `src/cli/formatters/colour.ts` (fixing CLI.5.1).
- `replayViaProxy` properly cleans up the `ProxyAgent` and timeout in a `finally` block.
- The `ReplayTracker` has periodic cleanup, max entry cap, and TTL for expired tokens.
- `clampReplayTimeout` bounds timeout values to a safe range.
- Body search properly handles all three scope targets and correctly narrows SQL to text content types only.

---

- [ ] **COMP.3.1: `replayRequest` handler searches for the replayed request using a hardcoded limit of 50**

  **Severity:** Medium

  **File:** `src/daemon/control.ts:472-478`

  ```typescript
  const recent = storage.listRequestsSummary({ limit: 50 });
  const replayed = recent.find(
    (request) =>
      request.replayedFromId === original.id &&
      request.replayInitiator === replayInitiator &&
      request.timestamp >= replayStart
  );
  ```

  **Issue:** The `50` is a magic number. More importantly, if the proxy is under heavy traffic (>50 requests arriving between `replayStart` and the search), the replayed request could be pushed beyond the window. This is a race condition under load.

  **Fix:** Extract `50` to a named constant. For a more robust solution, add a `since` filter or query directly by `replayed_from_id`.

  **Quick win:** Partially

---

- [ ] **COMP.3.2: `generateNodePreloadScript` silently swallows all errors from `global-agent` and `undici`**

  **Severity:** Low

  **File:** `src/overrides/node.ts:41-48`

  ```typescript
  "try {",
  `  require('${escapedGlobalAgentPath}').bootstrap();`,
  "} catch (_) {}",
  ```

  **Issue:** If dependencies fail to load, the user would see no proxy interception but no error message either, making debugging very difficult.

  **Fix:** Write errors to stderr: `"} catch (e) { process.stderr.write('procsi: global-agent bootstrap failed: ' + e.message + '\\n'); }"`

  **Quick win:** Yes

---

- [ ] **COMP.3.3: `writePhpOverride` and `writeRubyOverride` do not wrap file operations in try-catch**

  **Severity:** Low

  **File:** `src/overrides/php.ts:25-30` and `src/overrides/ruby.ts:52-57`

  **Issue:** Unlike `writePythonOverride` which correctly wraps in try-catch and rethrows with context, the PHP and Ruby overrides would produce unhelpful raw `EACCES` or `ENOSPC` errors.

  **Fix:** Apply the same pattern used in `writePythonOverride`.

  **Quick win:** Yes

---

- [ ] **COMP.3.4: `on.ts` calls all override writers without individual error handling**

  **Severity:** Medium

  **File:** `src/cli/commands/on.ts:205-208`

  **Issue:** All four override writers are called sequentially without individual try-catch. If the first fails, the remaining three are skipped. Since these are independent, a failure in one should not prevent the others.

  **Fix:** Wrap each writer in a try-catch, logging a warning for failures.

  **Quick win:** Yes

---

- [ ] **COMP.3.5: `daemon/index.ts` parses preferred port without range validation**

  **Severity:** Low

  **File:** `src/daemon/index.ts:103-105`

  **Issue:** A negative number in the port file would pass the truthy check. `parseInt("-1", 10)` returns `-1`, which is truthy.

  **Fix:** Add a range check: `rawPort > 0 && rawPort <= 65535`.

  **Quick win:** Yes

---

- [ ] **COMP.3.6: `startDaemon` reads `proxyPortFile` without `isNaN` guard**

  **Severity:** Low

  **File:** `src/shared/daemon.ts:118-119`

  **Issue:** If the port file contains invalid content, `parseInt` returns `NaN` which propagates as the proxy port.

  **Fix:** Use the existing `readProxyPort` helper, or add validation.

  **Quick win:** Yes

---

- [ ] **COMP.3.7: `proxy.ts` `new URL(request.url)` can throw on malformed URLs**

  **Severity:** Low

  **File:** `src/daemon/proxy.ts:147`

  **Issue:** Inside the `beforeRequest` callback, the URL constructor is called without try-catch. The `replayRequest` handler correctly wraps its `new URL()` call, showing this pattern is understood but not applied here.

  **Fix:** Wrap in try-catch with a fallback that skips the request.

  **Quick win:** Yes

---

- [ ] **COMP.3.8: `RegExp` constructor in `registerSqlFunctions` not wrapped in try-catch**

  **Severity:** Medium

  **File:** `src/daemon/storage.ts:410-411`

  **Issue:** `normaliseRegexFilterInput` can throw, and the exception would propagate as a SQLite error with a misleading prefix.

  **Fix:** Wrap in try-catch and return 0 (no match) on failure.

  **Quick win:** Yes

---

- [ ] **COMP.3.9: `requestInfo` Map in proxy never cleans up entries for timed-out or stalled requests**

  **Severity:** Low

  **File:** `src/daemon/proxy.ts:81-84`

  **Issue:** Entries are added in `beforeRequest` and removed in `beforeResponse` and `abort`. If a request completes without triggering either callback (e.g. connection timeout where mockttp does not fire `abort`), the entry leaks indefinitely.

  **Fix:** Add periodic cleanup that removes entries older than a threshold (e.g. 5 minutes).

  **Quick win:** Yes

---

- [ ] **COMP.3.10: `sessionSourceCache` and `sessionAuthCache` in proxy grow unboundedly**

  **Severity:** Low

  **File:** `src/daemon/proxy.ts:89,99`

  **Issue:** Both caches are populated on every unique session ID/token but never evicted. In practice session counts are small, but this violates the "clean up Maps/Sets" guideline.

  **Fix:** Cap cache sizes similar to `REGEX_CACHE_MAX_ENTRIES`.

  **Quick win:** Yes

---

- [ ] **COMP.3.11: `MAX_PREVIEW_LENGTH` defined inside function body instead of module scope**

  **Severity:** Low

  **File:** `src/cli/formatters/detail.ts:101`

  **Issue:** Defined inline, re-created on every invocation, not visible in module constants.

  **Fix:** Move to module scope.

  **Quick win:** Yes

---

- [ ] **COMP.3.12: Process name not validated before sending as session source**

  **Severity:** Low

  **File:** `src/shared/process-name.ts:15-27` and `src/daemon/control.ts:340-343`

  **Issue:** `resolveProcessName` returns the raw basename from `ps` output. The `normaliseRuntimeSource` function in `proxy.ts` validates against `RUNTIME_SOURCE_PATTERN`, but the control server registration path does not apply this validation.

  **Fix:** Apply the same normalisation used in `proxy.ts`.

  **Quick win:** Yes

---

- [ ] **COMP.3.13: `generatePythonOverrideScript` hardcodes a fallback port of 8080**

  **Severity:** Low

  **File:** `src/overrides/python.ts:46`

  ```typescript
  "                        parsed.port or 8080,",
  ```

  **Issue:** The procsi proxy never runs on 8080. The fallback should be 80 (HTTP default) or removed entirely.

  **Fix:** Change to `80` or remove the fallback.

  **Quick win:** Yes

---

- [ ] **COMP.3.14: `isFilterActive` does not check `headerName`, `headerValue`, or `interceptedBy` fields**

  **Severity:** Low

  **File:** `src/cli/tui/utils/filters.ts:6-19`

  **Issue:** If a filter has a header condition or interceptor filter set, the TUI's `[FILTERED]` indicator would not appear.

  **Fix:** Add `filter.headerName !== undefined || filter.interceptedBy !== undefined`.

  **Quick win:** Yes

---

- [ ] **COMP.3.15: Redundant unmount cleanup effect in FilterBar (from prior review)**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.tsx:226-232`

  **Issue:** Duplicate of TUI.1.7. Flagged in previous review as CLI.3.4, still present.

  **Fix:** Remove the second `useEffect`.

  **Quick win:** Yes

---

- [ ] **COMP.3.16: `queryJsonBodies` target parameter uses `as` cast on unvalidated input**

  **Severity:** Medium

  **File:** `src/daemon/control.ts:402-406`

  **Issue:** Duplicate of TS.2.3. Listed here for completeness in the completeness audit.

  **Quick win:** Yes

---

- [ ] **COMP.3.17: `getInterceptorEvents` casts level and type without validation**

  **Severity:** Low

  **File:** `src/daemon/control.ts:544-546`

  **Issue:** Duplicate of TS.2.2. Listed here for completeness.

  **Quick win:** Yes

---

- [ ] **COMP.3.18: `as never` casts in `queryJsonBodies`**

  **Severity:** Medium

  **File:** `src/daemon/storage.ts:909,914`

  **Issue:** Duplicate of TS.2.1. Listed here for completeness.

  **Quick win:** Yes

---

## 4. Test Coverage

**Positive Observations:**

- **`body-search.test.ts`** is thorough: covers full target names, short aliases, case insensitivity, whitespace handling, unsupported targets, body-scope prefix parsing with all variants, implicit "both" default, non-body input, and incomplete scopes.
- **`regex-filter.test.ts`** covers all four public functions with valid patterns, flags, invalid patterns, duplicate flags, unsupported flags, slash-delimited literals, plain text fallback, blank input, and normalisation paths.
- **`FilterBar.test.tsx`** is exceptionally comprehensive: all five field focuses, tab/shift-tab cycling, arrow keys, body search emission, regex detection, invalid regex fallback, and `getBodySearchDisplayParts` utility.
- **Override test files** (`php.test.ts`, `python.test.ts`, `ruby.test.ts`, `node.test.ts`) are well-structured with generated script content, path embedding, special character handling, and file writing tests.
- **`on.test.ts`** includes excellent shell-eval integration tests with `bash -c` verification of all four runtime overrides, including idempotency guards and shell injection prevention.
- **`storage.test.ts`** has extensive bookmark, source, replay metadata, and body search coverage.
- **Integration tests** cover the full replay lifecycle end-to-end.

---

- [ ] **TEST.4.1: No unit tests for `replay.ts` (`buildReplayHeaders`, `replayViaProxy`, `clampReplayTimeout`)**

  **Severity:** High

  **File:** Missing test for `src/daemon/replay.ts`

  **Issue:** `buildReplayHeaders` is a pure function with non-trivial logic (filters hop-by-hop headers, internal headers, strips content-length, applies setHeaders/removeHeaders, lowercases names). None of this has direct unit tests. `clampReplayTimeout`, `normaliseMethod`, and `canHaveRequestBody` are also untested.

  **What to test:**
  - `buildReplayHeaders` with mix of normal, hop-by-hop, and internal headers
  - `buildReplayHeaders` with `setHeaders` overriding existing headers
  - `buildReplayHeaders` with `removeHeaders` removing a header
  - `clampReplayTimeout` at boundaries: undefined, below min, above max, within range
  - `canHaveRequestBody` for GET, HEAD, POST, PUT, PATCH, DELETE

  **Quick win:** Yes -- pure functions

---

- [ ] **TEST.4.2: No unit tests for `replay-tracker.ts`**

  **Severity:** Medium

  **File:** Missing test for `src/daemon/replay-tracker.ts`

  **Issue:** `createReplayTracker` manages an in-memory token map with TTL, max entry eviction, and cleanup interval. None is unit-tested. Integration tests exercise the happy path but not: expired tokens being rejected, max entry eviction, double-consume, or `close()` cleanup.

  **What to test:**
  - `register` + `consume` happy path
  - `consume` for unknown/already-consumed token returns undefined
  - `register` beyond `REPLAY_TRACKER_MAX_ENTRIES` evicts oldest
  - Token expiry (with time mocking)
  - `close()` clears pending entries

  **Quick win:** Yes -- no I/O dependencies

---

- [ ] **TEST.4.3: `formatRequestDetail` has no tests for `replayedFromId`, `replayInitiator`, or `source` fields**

  **Severity:** Medium

  **File:** `src/cli/formatters/detail.test.ts`

  **Issue:** The rendering code for replay lineage and source attribution has zero test coverage in the unit tests.

  **What to test:**
  - Request with `replayedFromId` and `replayInitiator` shows "Replayed from: <id> (<initiator>)"
  - Request with `source` shows "Source: <name>"
  - Request without these fields does not show the labels

  **Quick win:** Yes

---

- [ ] **TEST.4.4: `isFilterActive` missing tests for `saved` and `source` conditions**

  **Severity:** Low

  **File:** `src/cli/tui/utils/filters.test.ts`

  **Issue:** `saved` and `source` conditions are untested despite being new filter dimensions.

  **Quick win:** Yes

---

- [ ] **TEST.4.5: `process-name.test.ts` tests are platform-dependent**

  **Severity:** Low

  **File:** `src/shared/process-name.test.ts`

  **Issue:** Relies on actual `ps` command and current PID with weak assertions. Consider adding a mock-based test that verifies `path.basename` stripping logic.

  **Quick win:** Yes

---

- [ ] **TEST.4.6: No unit tests for `splitByMatch` in `RequestListItem.tsx`**

  **Severity:** Low

  **File:** Missing test for `src/cli/tui/components/RequestListItem.tsx:105-127`

  **Issue:** Utility function for search term highlighting is not exported and has no tests.

  **What to test:** Empty search term, single match, case-insensitive matching, multiple matches, no match, search at start/end.

  **Quick win:** Partially

---

- [ ] **TEST.4.7: MCP integration test does not cover `procsi_save_request` or `procsi_unsave_request`**

  **Severity:** Medium

  **File:** `tests/integration/mcp.test.ts`

  **Issue:** The MCP tool wrappers for bookmarks -- including error handling, text formatting, and `success` flag interpretation -- are untested at the integration level.

  **Quick win:** Yes

---

- [ ] **TEST.4.8: `buildFilter` in `server.test.ts` does not test `saved` and `source` parameters**

  **Severity:** Low

  **File:** `src/mcp/server.test.ts`

  **Issue:** These new filter parameters have no test coverage in the MCP `buildFilter` test suite.

  **Quick win:** Yes

---

- [ ] **TEST.4.9: `formatSummary` in `server.test.ts` does not test `saved`, `replayedFromId`, or `source` tags**

  **Severity:** Low

  **File:** `src/mcp/server.test.ts`

  **Issue:** `formatSummary` appends `[S]`, `[R]`, and `[<source>]` tags but these are untested.

  **Quick win:** Yes

---

- [ ] **TEST.4.10: `serialiseRequest` and `formatRequest` in `server.test.ts` do not test replay/source fields**

  **Severity:** Low

  **File:** `src/mcp/server.test.ts`

  **Issue:** Conditional spread for `replayedFromId`, `replayInitiator`, `source` is untested. "Source:" rendering is untested.

  **Quick win:** Yes

---

- [ ] **TEST.4.11: No TUI component test for bookmark toggle (`*` key)**

  **Severity:** Medium

  **File:** `src/cli/tui/App.test.tsx`

  **Issue:** The `*` key toggles saved state but is never tested. The `toggleSaved` mock is never exercised. The `*` visual indicator for saved requests is also untested.

  **Quick win:** Yes

---

- [ ] **TEST.4.12: No TUI component test for clear requests (`C` key)**

  **Severity:** Low

  **File:** `src/cli/tui/App.test.tsx`

  **Issue:** The `C` key prompt, `y`/`n` handling, and status message have no coverage.

  **Quick win:** Yes

---

- [ ] **TEST.4.13: No `formatRequest` test for `source` field rendering**

  **Severity:** Low

  **File:** `src/mcp/server.test.ts`

  **Issue:** "**Source:** node" rendering is not tested.

  **Quick win:** Yes

---

## 5. Project Organisation

**Positive Observations:**

- The `shared/` module boundary is perfectly respected. All 13 changed files in `src/shared/` import exclusively from within `shared/` or standard library modules.
- `connectToDaemon` has been properly extracted into `src/cli/commands/helpers.ts` (fixing CLI.3.1/CLI.5.3).
- The new `src/overrides/` directory is well-organised with consistent per-runtime patterns.
- `replay.ts` and `replay-tracker.ts` have clean separation of concerns.
- New shared modules are correctly scoped.
- Test files remain co-located with their source files.

---

- [ ] **ORG.5.1: `src/mcp/server.ts` at 1443 lines is nearly 6x the ~250-line guideline**

  **Severity:** High

  **File:** `src/mcp/server.ts:1-1443`

  **Issue:** Contains MCP server creation, formatting helpers, data serialisation, filter building, path resolution, and 14 tool handler registrations. At least three distinct concerns are mixed.

  **Fix:** Split into: `src/mcp/formatters.ts` (~180 lines), `src/mcp/filters.ts` (~150 lines), `src/mcp/server.ts` (tool registrations, importing from above).

  **Quick win:** No (moderate refactor)

---

- [ ] **ORG.5.2: Identical Zod filter parameter blocks duplicated across 4 MCP tool definitions**

  **Severity:** Medium

  **File:** `src/mcp/server.ts:521-598, 716-788, 829-893, 937-993`

  **Issue:** Filter-related Zod schemas are defined identically in `procsi_list_requests`, `procsi_search_bodies`, `procsi_count_requests`, and `procsi_query_json`. Any change must be replicated in 4 places.

  **Fix:** Extract common filter parameters into a reusable object and spread into each tool definition.

  **Quick win:** Yes

---

- [ ] **ORG.5.3: `src/daemon/storage.ts` at 1263 lines exceeds guideline by 5x**

  **Severity:** Medium

  **File:** `src/daemon/storage.ts:1-1263`

  **Issue:** Contains schema, migrations, SQL functions, session management, request CRUD, body search, JSON queries, bookmarks, eviction, and 8 row interfaces.

  **Fix:** Extract migrations to `storage-migrations.ts` and row interfaces to `storage-types.ts`.

  **Quick win:** Partially

---

- [ ] **ORG.5.4: `src/cli/tui/App.tsx` at 882 lines is 3.5x the guideline**

  **Severity:** Medium

  **File:** `src/cli/tui/App.tsx:1-882`

  **Issue:** `AppContent` handles 30+ keybindings (280-line `useInput` callback), 20+ state variables, and rendering for 7 modal states.

  **Fix:** Extract keyboard handler into `useAppKeyboard` hook. Extract modal rendering to a `renderActiveModal` helper.

  **Quick win:** No

---

- [ ] **ORG.5.5: Environment variable list maintained in three places**

  **Severity:** Medium

  **File:** `src/cli/commands/on.ts:216-243`, `src/cli/commands/off.ts:11-31`, `src/shared/proxy-info.ts:13-24`

  **Issue:** Adding a new variable requires updating all three lists. If any is missed, the variable won't be unset on `procsi off` or won't appear in the info display.

  **Fix:** Define the canonical list in `src/shared/constants.ts`. Each consumer imports and applies its own formatting.

  **Quick win:** Yes

---

- [ ] **ORG.5.6: Shell export/restore pattern repeated four times with near-identical structure**

  **Severity:** Low

  **File:** `src/cli/commands/on.ts:61-155`

  **Issue:** Four runtime override functions follow an identical save-override-restore pattern. The only differences are variable names, separator, and prepend vs append. This is the "3+ places" threshold for extraction.

  **Fix:** Create a generic `formatEnvOverride` helper.

  **Quick win:** Yes

---

- [ ] **ORG.5.7: Control server validators could be extracted to own module**

  **Severity:** Low

  **File:** `src/daemon/control.ts:95-171`

  **Issue:** ~160 lines of validation helpers at the top of `control.ts`. Would reduce the file and improve signal-to-noise ratio.

  **Fix:** Extract to `src/daemon/control-validators.ts`.

  **Quick win:** Yes

---

- [ ] **ORG.5.8: `proxy-info.ts` is an incomplete subset of the env var logic in `on.ts`**

  **Severity:** Low

  **File:** `src/shared/proxy-info.ts:1-27`

  **Issue:** The env block omits `DENO_CERT`, `CARGO_HTTP_CAINFO`, `GIT_SSL_CAINFO`, `AWS_CA_BUNDLE`, and all runtime override variables. A user viewing the info modal sees an incomplete picture.

  **Fix:** Build env block from the canonical variable list recommended in ORG.5.5.

  **Quick win:** Yes (if combined with ORG.5.5)

---

- [ ] **ORG.5.9: Redundant unmount cleanup in FilterBar**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.tsx:225-232`

  **Issue:** Duplicate of TUI.1.7 / COMP.3.15. Noted here for organisational completeness.

  **Quick win:** Yes

---

## 6. Security

**Positive Observations:**

- **Parameterised SQL queries throughout.** All user-provided filter values flow through `?` placeholders. No raw string interpolation into SQL.
- **Control socket restricted to owner.** `fs.chmodSync(socketPath, 0o600)` immediately after `server.listen()`.
- **Bounded control socket buffers.** Both client and server enforce `MAX_BUFFER_SIZE` (1 MB) and destroy connections when exceeded.
- **Replay tokens are cryptographically random.** `randomBytes(16)`, single-use, 60-second TTL, 1000-entry cap.
- **Replay requests routed through loopback only.** `http://127.0.0.1:<port>`, not externally reachable.
- **Replay timeout clamped.** Min 1s, max 120s.
- **Hop-by-hop and internal headers stripped from replays.**
- **Session attribution requires token proof.**
- **Shell injection prevention** with proper escaping of dangerous characters in `escapeDoubleQuoted`.
- **Path traversal protection** for MCP interceptor writes via `path.relative()`.
- **Runtime source input validation** with strict allowlist pattern.
- **`execFileSync` used for process name resolution** (not `exec`), avoiding shell interpretation.
- **CA key restricted** with `fs.chmodSync(paths.caKeyFile, 0o600)`.
- **All MCP inputs validated with Zod schemas.**
- **Regex patterns validated** before use with descriptive error messages.
- **Binary body warning** detects null bytes and refuses TTY dump.

---

- [ ] **SEC.6.1: User-supplied regex patterns are not bounded in complexity (ReDoS risk)**

  **Severity:** Medium

  **File:** `src/shared/regex-filter.ts:41-52` and `src/daemon/storage.ts:396-425`

  **Issue:** `validateRegexFilter` only checks syntactic validity, not computational complexity. A pathological regex like `(a+)+$` causes catastrophic backtracking. The regex executes synchronously on the main thread via a custom SQLite function for every row in the result set. A ReDoS pattern would freeze the entire daemon -- blocking all control API requests, TUI updates, and proxy traffic capture.

  **Fix:** Use `re2` or `safe-regex2` library to reject super-linear patterns. Or wrap `regex.test()` in a timeout via worker thread. At minimum, add a heuristic check.

  **Quick win:** No

---

- [ ] **SEC.6.2: Unvalidated `as` cast on `target`, `level`, `type` parameters in control handlers**

  **Severity:** Medium

  **File:** `src/daemon/control.ts:402-406,544,546`

  **Issue:** Cross-reference of TS.2.2 and TS.2.3. Unvalidated casts on control API parameters.

  **Fix:** Add validation functions analogous to `optionalBodySearchTarget`.

  **Quick win:** Yes

---

- [ ] **SEC.6.3: Header name in JSON path not escaped for double-quote injection**

  **Severity:** Low

  **File:** `src/daemon/storage.ts:294-295`

  ```typescript
  const name = filter.headerName.toLowerCase();
  const jsonPath = `$."${name}"`;
  ```

  **Issue:** If a header name contains a double quote, the JSON path becomes malformed. No SQL injection risk (parameterised), but confusing errors. HTTP header names cannot contain quotes per RFC 7230, but the control API accepts any string.

  **Fix:** Escape double quotes: `name.replace(/"/g, '\\"')` or reject non-RFC-7230-compliant names.

  **Quick win:** Yes

---

- [ ] **SEC.6.4: `formatUnsetVars` does not validate variable names before shell interpolation**

  **Severity:** Low

  **File:** `src/cli/commands/on.ts:42-44`

  **Issue:** Variable names interpolated into `unset` without validation. Currently all callers pass hardcoded constants, so not exploitable. Latent weakness if called with dynamic input.

  **Fix:** Validate against POSIX shell variable name pattern `/^[A-Za-z_][A-Za-z0-9_]*$/`.

  **Quick win:** Yes

---

- [ ] **SEC.6.5: `formatEnvVars` does not validate variable name keys**

  **Severity:** Low

  **File:** `src/cli/commands/on.ts:31-35`

  **Issue:** Values are properly escaped, but keys are interpolated verbatim. Same latent risk as SEC.6.4.

  **Fix:** Same POSIX pattern validation on keys.

  **Quick win:** Yes

---

- [ ] **SEC.6.6: Replay feature allows SSRF to internal services via URL override**

  **Severity:** Medium

  **File:** `src/daemon/control.ts:434` and `src/daemon/replay.ts:118-157`

  **Issue:** The replay allows overriding the URL to any arbitrary URL. An MCP agent can replay to `http://169.254.169.254/latest/meta-data/` (AWS metadata), `http://localhost:6379/` (Redis), etc. Since procsi is a local dev tool and MCP is already trusted, this is not critical, but worth noting.

  **Fix:** Consider restricting URL overrides to the same host as the original request, or add an allowlist/denylist in config. At minimum, document this trust boundary.

  **Quick win:** No (design decision required)

---

- [ ] **SEC.6.7: `sessionAuthCache` grows without bound**

  **Severity:** Low

  **File:** `src/daemon/proxy.ts:99-114`

  **Issue:** Each unique `(sessionId, token)` pair creates a permanent cache entry. Brute-force attempts with random tokens would grow the cache.

  **Fix:** Add maximum size with LRU eviction.

  **Quick win:** Yes

---

- [ ] **SEC.6.8: PHP INI override path not escaped for INI injection**

  **Severity:** Low

  **File:** `src/overrides/php.ts:10-17`

  **Issue:** `caCertPath` interpolated directly into PHP INI directives. A path containing newlines could inject additional directives. On Linux, directory names can contain newlines.

  **Fix:** Reject newline characters in the path.

  **Quick win:** Yes

---

- [ ] **SEC.6.9: SQL condition builders interpolate column names without validation**

  **Severity:** Low

  **File:** `src/shared/content-type.ts:107-138,147-167`

  **Issue:** `column` parameter interpolated into SQL fragments. Currently all callers pass hardcoded literals, but the functions are exported from `shared/`.

  **Fix:** Validate column name matches `/^[a-z_][a-z0-9_]*$/`.

  **Quick win:** Yes

---

## 7. UX/UI Principles

**Positive Observations:**

- **Replay confirmation is exemplary.** Two-step `R` then `y` with clear status bar prompt. Success message includes short ID of the new request. Error messages propagate the underlying cause.
- **Bookmark visual indicator is well-designed.** `*` character next to cursor, yellow colour for unsaved bookmarked items.
- **Body search syntax is discoverable within the filter bar.** Colour-coded prefix rendering (cyan `body:`, yellow/magenta `req:`/`res:`) gives structural feedback as the user types.
- **Filter bar cancel (Escape) correctly reverts state.**
- **Regex fallback is graceful.** Incomplete regex falls back to plain text search.
- **CLI hint chain is complete.** Detail view hints at `body`, `export`, `save|unsave`.
- **Port persistence is invisible and correct.**
- **Binary body warning is user-friendly.** Pipe suggestion instead of terminal dump.
- **`procsi on` TTY detection is smart.**
- **Clear confirmation preserves bookmarks** and tells the user so.
- **Interception and replay indicators** consistent in both TUI and CLI.

---

- [ ] **UX.7.1: Replay has no loading/in-progress indicator during the network request**

  **Severity:** Medium

  **File:** `src/cli/tui/App.tsx:361-374`

  **Issue:** "Replaying..." appears immediately but the 3-second `statusTimeoutRef` in `showStatus` will clear it before the replay completes (default 10-second timeout). The user is left with no feedback.

  **Fix:** Change `showStatus("Replaying...")` to `setStatusMessage("Replaying...")` to prevent auto-clear. Use `showStatus` only for the final result.

  **Quick win:** Yes

---

- [ ] **UX.7.2: Help modal does not document the `source` filter field**

  **Severity:** Low

  **File:** `src/cli/tui/components/HelpModal.tsx:53`

  **Issue:** The `/` description mentions URL search, regex, and body search, but not `source`, `saved`, method, or status fields.

  **Fix:** Expand: `"Filter requests (URL, /regex/, body:query, method, status, saved, source)"`.

  **Quick win:** Yes

---

- [ ] **UX.7.3: No way to jump to the replayed request after replay**

  **Severity:** Low

  **File:** `src/cli/tui/App.tsx:363-368`

  **Issue:** After replay, the status bar shows "Replayed as a1b2c3d" but selection stays on the original. The user must scroll to find the new request.

  **Fix:** Auto-select the new request, or add a "Jump to replayed request?" prompt.

  **Quick win:** No

---

- [ ] **UX.7.4: `requests` list hint omits `--saved` and `--source` filters**

  **Severity:** Low

  **File:** `src/cli/commands/requests.ts:391-396`

  **Issue:** The hint mentions `--method`, `--status`, `--host`, `--since` but not the new `--saved`, `--source`, `--regex`, or `--search` flags.

  **Fix:** Update the hint.

  **Quick win:** Yes

---

- [ ] **UX.7.5: `procsi request <id>` detail view does not show bookmark state**

  **Severity:** Low

  **File:** `src/cli/formatters/detail.ts:24-115`

  **Issue:** Displays interception, replay, and source info, but not whether the request is bookmarked. The `saved` field exists but is not rendered.

  **Fix:** Add a "Bookmarked" indicator alongside the other metadata.

  **Quick win:** Yes

---

- [ ] **UX.7.6: Filter bar `source` field has no feedback when typed value matches nothing**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.tsx:398-406`

  **Issue:** Free-text field with no autocompletion, validation, or match count. A typo silently produces zero results.

  **Fix:** Show match count, or cycle through known values from the current session. Acceptable for initial implementation.

  **Quick win:** No

---

- [ ] **UX.7.7: `procsi on` does not hint at `procsi tui` or `procsi requests`**

  **Severity:** Medium

  **File:** `src/cli/commands/on.ts:276-280`

  **Issue:** After `eval "$(procsi on)"`, no hint about what to do next. This is the most critical discovery gap because `procsi on` is the first command every user runs.

  **Fix:** Add: `console.log("# Run 'procsi tui' for the interactive viewer, or 'procsi requests' to list traffic");`

  **Quick win:** Yes

---

- [ ] **UX.7.8: Body search with `body:` prefix and no query falls through to URL search**

  **Severity:** Low

  **File:** `src/shared/body-search.ts:57-60` and `src/cli/tui/components/FilterBar.tsx:143-150`

  **Issue:** Typing `body:` shows coloured prefix (suggesting recognition) but falls through to a URL substring search for "body:" since `parseBodyScopeInput` returns `undefined` for empty queries. Visual feedback mismatch.

  **Fix:** Align `getBodySearchDisplayParts` with `parseBodyScopeInput` so colouring only appears when the query would actually be treated as a body search.

  **Quick win:** Partially

---

- [ ] **UX.7.9: `procsi request <id> save` and `unsave` lack discovery hints**

  **Severity:** Low

  **File:** `src/cli/commands/request.ts:154-157,183-186`

  **Issue:** After saving, no hint about `procsi requests --saved` or `unsave`. Dead-ends in the discovery chain.

  **Fix:** Add hints after save/unsave output.

  **Quick win:** Yes

---

- [ ] **UX.7.10: Replay request from the CLI is not available as a subcommand**

  **Severity:** Medium

  **File:** `src/cli/commands/request.ts`

  **Issue:** Replay is available from TUI and MCP, but no `procsi request <id> replay` CLI command. Breaks the principle that all TUI actions should have CLI equivalents.

  **Fix:** Add a `replay` subcommand.

  **Quick win:** No

---

- [ ] **UX.7.11: Filter bar help text truncated at narrow terminal widths**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.tsx:21,407-408`

  **Issue:** Fixed-width help text doesn't adapt. At 60 columns the help text is cut off, leaving the user unable to discover how to close the bar.

  **Fix:** Minimal version at narrow widths, or move help to a second line.

  **Quick win:** No

---

- [ ] **UX.7.12: `saved` filter field says "YES" instead of a descriptive value**

  **Severity:** Low

  **File:** `src/cli/tui/components/FilterBar.tsx:336`

  **Issue:** Other fields use descriptive values ("GET", "2xx"), but `saved` cycles "ALL"/"YES". "YES" is vague.

  **Fix:** Change to "SAVED" or "BOOKMARKED".

  **Quick win:** Yes

---

- [ ] **UX.7.13: Replay indicator "R" in request list has no explanation**

  **Severity:** Low

  **File:** `src/cli/tui/components/RequestListItem.tsx:30-35`

  **Issue:** No legend for list indicators (`*`, `M`, `I`, `R`) in the help modal.

  **Fix:** Add a "List Indicators" section to the help modal.

  **Quick win:** Yes

---

- [ ] **UX.7.14: `procsi requests search` does not show total count or pagination hint**

  **Severity:** Low

  **File:** `src/cli/commands/requests.ts:208-216`

  **Issue:** Passes `results.length` as both data and total count. "Showing 50 of 50" even when more exist. No way to know results are truncated.

  **Fix:** When `results.length === limit`, show a hint: `"--offset to see more results"`.

  **Quick win:** Yes

---

## 8. Performance

**Positive Observations:**

- The regex cache in `registerSqlFunctions` is properly bounded with `REGEX_CACHE_MAX_ENTRIES = 100` and LRU-style eviction. `lastIndex` reset is correct.
- `listRequestsSummary` uses a column list, excluding large BLOB columns. Body sizes computed in SQL.
- `useRequests` count-then-fetch optimisation avoids re-transferring summaries when nothing has changed.
- `searchBodies` filters by content-type before the expensive BLOB scan.
- `ReplayTracker` has proper cleanup: periodic timer, max entry cap, `close()` method.
- `evictIfNeeded` only runs `COUNT(*)` every 100 inserts.
- `requestInfo` Map cleaned up on both response and abort.
- Session caches avoid repeated database queries on the hot path.
- `RequestListItem` uses custom `memo` comparison checking only relevant props.

---

- [ ] **PERF.8.1: `getRequest` uses `SELECT *` fetching all columns including large BLOBs**

  **Severity:** Low

  **File:** `src/daemon/storage.ts:662-663`

  **Issue:** Used by the replay handler which only needs `method`, `url`, `request_headers`, `request_body`. Response bodies (up to 10MB) are wastefully fetched.

  **Fix:** Add `getRequestForReplay(id)` that selects only needed columns.

  **Quick win:** Yes

---

- [ ] **PERF.8.2: `listRequests` uses `SELECT *` transferring full bodies over the control socket**

  **Severity:** Medium

  **File:** `src/daemon/storage.ts:702-703`

  **Issue:** Selects all columns for up to 1000 rows. HAR export with 1000 requests and 10MB bodies could attempt ~20GB of BLOB data in memory.

  **Fix:** Stream or batch: fetch IDs first, then full rows in smaller batches.

  **Quick win:** No

---

- [ ] **PERF.8.3: `status` handler fetches all sessions just to count them**

  **Severity:** Medium

  **File:** `src/daemon/control.ts:318-320`

  **Issue:** `storage.listSessions()` materialises all session rows, then only uses `.length`. Runs every 2 seconds via TUI polling.

  **Fix:** Add `countSessions()` method with `SELECT COUNT(*)`.

  **Quick win:** Yes

---

- [ ] **PERF.8.4: `replayRequest` handler scans 50 recent requests to find the replayed result**

  **Severity:** Medium

  **File:** `src/daemon/control.ts:472-478`

  **Issue:** Fetches 50 summaries and scans client-side. Under heavy traffic the replayed request may not be in the top 50. Also fetches unnecessary computed columns.

  **Fix:** Query directly: `WHERE replayed_from_id = ? AND replay_initiator = ? AND timestamp >= ? LIMIT 1`. Add index on `replayed_from_id` if needed.

  **Quick win:** Partially

---

- [ ] **PERF.8.5: `searchBodies` performs full-table BLOB scan without content-type index**

  **Severity:** Medium

  **File:** `src/daemon/storage.ts:835-842`

  **Issue:** `request_content_type` and `response_content_type` columns have no index. SQLite must sequential scan for the content-type condition before the BLOB scan.

  **Fix:** Add indexes:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_requests_req_content_type ON requests(request_content_type);
  CREATE INDEX IF NOT EXISTS idx_requests_res_content_type ON requests(response_content_type);
  ```

  **Quick win:** Yes

---

- [ ] **PERF.8.6: No index on `saved` column despite use in eviction, clear, and filter queries**

  **Severity:** Medium

  **File:** `src/daemon/storage.ts:124-125`

  **Issue:** `saved` is used in `evictIfNeeded()` (every 100 inserts), `clearRequests()`, and filter queries, all without an index.

  **Fix:** Add composite index:
  ```sql
  CREATE INDEX IF NOT EXISTS idx_requests_saved_timestamp ON requests(saved, timestamp ASC);
  ```

  **Quick win:** Yes

---

- [ ] **PERF.8.7: `resolveProcessName` calls `execFileSync` synchronously on session registration**

  **Severity:** Low

  **File:** `src/shared/process-name.ts:16-17` and `src/daemon/control.ts:341-342`

  **Issue:** Blocks the event loop while spawning `ps` and waiting up to 1 second. All other control API requests stall during execution.

  **Fix:** Replace `execFileSync` with async `execFile` and make `resolveProcessName` return a `Promise`.

  **Quick win:** Yes

---

- [ ] **PERF.8.8: `new Set([focusedSection])` creates a new object every render**

  **Severity:** Low

  **File:** `src/cli/tui/App.tsx:830`

  **Issue:** Cross-reference of TUI.1.2. New `Set` defeats potential memoisation.

  **Fix:** `useMemo(() => new Set([focusedSection]), [focusedSection])`.

  **Quick win:** Yes

---

- [ ] **PERF.8.9: `useRequests` body search path skips the count-then-fetch optimisation**

  **Severity:** Low

  **File:** `src/cli/tui/hooks/useRequests.ts:91-99`

  **Issue:** When `bodySearch` is active, the hook unconditionally fetches full results every 2 seconds without count-checking first. Body search is expensive (BLOB scan).

  **Fix:** Check `countRequests()` first and skip `searchBodies` if count unchanged.

  **Quick win:** Yes

---

- [ ] **PERF.8.10: Prepared statements are not cached**

  **Severity:** Low

  **File:** `src/daemon/storage.ts` (throughout)

  **Issue:** Every call to `bookmarkRequest`, `saveRequest`, etc. calls `this.db.prepare()`. While `better-sqlite3` has internal caching, the JS-side overhead (string hashing, cache lookup, Statement wrapper creation) runs on every call. For `saveRequest` on the hot path, this is unnecessary work.

  **Fix:** Cache prepared statements as class properties, initialised lazily.

  **Quick win:** Partially

---

- [ ] **PERF.8.11: `queryJsonBodies` subquery forces BLOB length computation for all rows**

  **Severity:** Low

  **File:** `src/daemon/storage.ts:965-966`

  **Issue:** `COALESCE(LENGTH(request_body), 0)` runs on every row in the inner query, even those eliminated by the outer filter. SQLite cannot push the predicate into the subquery.

  **Fix:** Accept as inherent to the subquery pattern. BLOB length only reads metadata, not full content. Low impact.

  **Quick win:** No

---

## Quick Wins Summary

Issues that can be fixed in minutes with minimal risk:

| Pillar | IDs |
|--------|-----|
| React/Ink | TUI.1.1, TUI.1.2, TUI.1.4, TUI.1.5, TUI.1.6, TUI.1.7, TUI.1.8 |
| TypeScript | TS.2.1, TS.2.2, TS.2.3, TS.2.4, TS.2.5, TS.2.6, TS.2.8, TS.2.9, TS.2.10 |
| Completeness | COMP.3.1, COMP.3.2, COMP.3.3, COMP.3.4, COMP.3.5, COMP.3.6, COMP.3.7, COMP.3.8, COMP.3.9, COMP.3.10, COMP.3.11, COMP.3.12, COMP.3.13, COMP.3.14, COMP.3.15 |
| Tests | TEST.4.1, TEST.4.2, TEST.4.3, TEST.4.4, TEST.4.7, TEST.4.8, TEST.4.9, TEST.4.10, TEST.4.11, TEST.4.12, TEST.4.13 |
| Organisation | ORG.5.2, ORG.5.5, ORG.5.6, ORG.5.7, ORG.5.8, ORG.5.9 |
| Security | SEC.6.2, SEC.6.3, SEC.6.4, SEC.6.5, SEC.6.7, SEC.6.8, SEC.6.9 |
| UX/UI | UX.7.1, UX.7.2, UX.7.4, UX.7.5, UX.7.7, UX.7.9, UX.7.12, UX.7.13, UX.7.14 |
| Performance | PERF.8.1, PERF.8.3, PERF.8.5, PERF.8.6, PERF.8.7, PERF.8.8, PERF.8.9 |

**Total quick wins: ~65 of 93 issues**
