# procsi Code Review -- 2026-02-20

Review of the export formats feature: adding Fetch, Python requests, and HTTPie export generators to the TUI and CLI, consolidating single-request exports under an `e` key with an inline format picker.

~650 lines added across 17 files (7 new, 10 modified).

## Summary

| Dimension | Issues Found |
|-----------|-------------|
| 1. React/Ink Best Practices | 1 issue |
| 2. TypeScript Quality | 2 issues |
| 3. Code Completeness | 4 issues |
| 4. Test Coverage | 4 issues |
| 5. Project Organisation | 0 issues |
| 6. Security | 2 issues |
| 7. UX/UI Principles | 2 issues |
| 8. Performance | 0 issues |
| **Total** | **15 issues** |

---

## 1. React/Ink Best Practices

**Positive Observations:**

- **`pendingExport` state correctly disables normal key handling.** The `useInput` callback checks `pendingExport` at the top of the handler (line 398), consuming the next keypress before falling through to navigation/action handlers. This prevents the format-picker key from being interpreted as a regular action (e.g. `h` for httpie would otherwise not trigger anything problematic, but `c` for curl could conflict with future bindings).
- **`useInput` `isActive` correctly gates all modal states.** The existing `isActive` condition (line 659) already includes all the relevant booleans, and `pendingExport` does not need to be added because the handler itself manages the state transition -- this is the same pattern used for `pendingClear` and `pendingReplayId`.
- **The `useExport` hook correctly wraps both functions in `useCallback` with empty dependency arrays**, since both delegate to module-level standalone functions (`exportFormatToClipboard`, `exportHarToFile`) that capture no component state.
- **The `exportFormat` function returned from `useExport` has a stable identity**, so passing it as a prop or dependency is safe.
- **StatusBar `getVisibleHints` is properly memoised** with all six dependencies listed (line 97-99), including `hasSelection` which gates the new `e` hint.

---

- [ ] **TUI.1.1: `selectedFullRequest` captured by closure in the `pendingExport` handler without a ref**

  **Severity:** Low

  **File:** `src/cli/tui/App.tsx:398-415`

  ```tsx
  if (pendingExport) {
    setPendingExport(false);
    const formatMap: Record<string, ExportFormat> = {
      c: "curl",
      f: "fetch",
      p: "python",
      h: "httpie",
    };
    const format = formatMap[input];
    if (format && selectedFullRequest) {
      void exportFormat(selectedFullRequest, format).then((result) => {
        showStatus(result.success ? result.message : `Error: ${result.message}`);
      });
    }
    // ...
  }
  ```

  **Issue:** This uses the same pattern as the existing `pendingClear` and `pendingReplayId` handlers, which is consistent. However, `selectedFullRequest` is a state value captured by the `useInput` closure. If the user presses `e`, then immediately navigates to a different request (j/k) before pressing the format key, the export would use whichever `selectedFullRequest` was captured when the closure last re-created -- likely the original one, but the timing depends on React's batching. This is the same class of stale-closure issue identified in the previous review (TUI.1.3) for the entire `useInput` callback. The risk is low because the format picker prompt appears in the status bar and the user is expected to immediately press a format key, but it is worth noting for consistency with the project guidelines.

  **Fix:** Store `selectedFullRequest` in a ref (as is already done for `contentHeightRef` and `requestsLengthRef`), or capture the request ID in `pendingExport` state (e.g. `setPendingExport(selectedFullRequest.id)`) and resolve it when the format key arrives.

  **Quick win:** Yes

---

## 2. TypeScript Quality

**Positive Observations:**

- **The `FORMAT_GENERATORS` map is correctly typed as `Record<ExportFormat, (request: CapturedRequest) => string>`** (line 29), ensuring at compile time that every `ExportFormat` variant has a corresponding generator. Adding a new format to the union without a generator entry would produce a type error.
- **The `FORMAT_LABELS` map follows the same pattern** with `Record<ExportFormat, string>`, keeping labels and generators in sync.
- **`pythonRepr` handles `unknown` values defensively**, including null, undefined, booleans, numbers, strings, arrays, and objects -- covering all JSON value types without unsafe casts.
- **`JSON.parse` results are typed as `unknown`** in all three generators (fetch.ts:59, python-requests.ts:103, httpie.ts:51), following the project guideline of never trusting parsed JSON output.
- **`ExportFormat` is a union type** rather than an open `string`, preventing typos in format identifiers throughout the codebase.

---

- [ ] **TS.2.1: `as Record<string, unknown>` cast in `pythonRepr` object branch**

  **Severity:** Low

  **File:** `src/cli/tui/utils/python-requests.ts:41`

  ```typescript
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    const pairs = entries.map(([k, v]) => `${pythonRepr(k)}: ${pythonRepr(v)}`);
    return `{${pairs.join(", ")}}`;
  }
  ```

  **Issue:** At this point in the function, `value` is known to be non-null (checked at line 14), non-array (checked at line 36), and `typeof value === "object"`. The cast `as Record<string, unknown>` is safe in practice because `Object.entries` operates on any object. However, the project guidelines state "Never use `as` casts on external data" and this function is called on `JSON.parse` output, which is external data. The cast could also hide issues if `value` were a `Date`, `RegExp`, or other non-plain object -- though `JSON.parse` never produces those.

  **Fix:** The cast is technically acceptable here since `Object.entries` accepts `{}` and `JSON.parse` only produces plain objects. However, for consistency with the guideline, use a type narrowing approach:
  ```typescript
  if (typeof value === "object") {
    const entries = Object.entries(value);
    // ...
  }
  ```
  `Object.entries` already accepts `{}` and returns `[string, unknown][]` when called on an `unknown` object -- no cast is needed.

  **Quick win:** Yes

---

- [ ] **TS.2.2: `as Record<string, unknown>` cast in `generateHttpie` for flat-object check**

  **Severity:** Low

  **File:** `src/cli/tui/utils/httpie.ts:55`

  ```typescript
  const entries = Object.entries(parsed as Record<string, unknown>);
  const allFlat = entries.every(([, v]) => typeof v === "string" || typeof v === "number" || typeof v === "boolean" || v === null);
  ```

  **Issue:** Same pattern as TS.2.1. `parsed` has already passed the `typeof parsed === "object"` and `!Array.isArray(parsed)` checks. The cast is safe in practice but redundant since `Object.entries` works on any `object`.

  **Fix:** Remove the cast: `const entries = Object.entries(parsed);`

  **Quick win:** Yes

---

## 3. Code Completeness

**Positive Observations:**

- **`EXCLUDED_HEADERS` is properly extracted into a shared module** (`export-shared.ts`), eliminating the previous duplication where curl.ts had its own inline set. All four generators now import from the single source of truth.
- **All generators handle edge cases consistently**: empty body, undefined body, GET/HEAD body suppression, invalid JSON fallback to raw string. This coverage is uniform across all four formats.
- **`shellEscape` in `httpie.ts` correctly strips null bytes** and uses the same quote-break-escape-reopen pattern as `curl.ts`.
- **`jsStringEscape` in `fetch.ts` covers all five problematic characters** (backslash, single quote, newline, carriage return, tab).
- **The `exportCurlToClipboard` backwards-compatibility wrapper** is retained (line 72), maintaining the existing public API while the implementation delegates to the new generic function.
- **The `EXPORT_FORMATS` array in `request.ts`** (line 18) correctly lists all five formats including the existing `har` and the new `fetch`, `requests`, `httpie`.
- **The CLI hint** (line 327) lists `curl|har|fetch|requests|httpie`, matching the `EXPORT_FORMATS` array.

---

- [ ] **COMP.3.1: `generateCurl` includes body for GET and HEAD requests, unlike the other three generators**

  **Severity:** Medium

  **File:** `src/cli/tui/utils/curl.ts:46-49`

  ```typescript
  // Add body if present
  if (request.requestBody && request.requestBody.length > 0) {
    const bodyStr = request.requestBody.toString("utf-8");
    parts.push(`-d '${shellEscape(bodyStr)}'`);
  }
  ```

  **Issue:** `generateFetch`, `generatePythonRequests`, and `generateHttpie` all explicitly skip the body for GET and HEAD requests (e.g. `request.method !== "GET" && request.method !== "HEAD"`). `generateCurl` does not apply this filter -- it includes `-d` for any request with a body, including GET. While curl technically allows sending a body with GET (using `-d`), this is inconsistent with the other three generators. More importantly, sending a body with GET is semantically unusual and could confuse users who export a GET request and see an unexpected `-d` flag.

  **Fix:** Add the same guard to `generateCurl`:
  ```typescript
  if (
    request.requestBody &&
    request.requestBody.length > 0 &&
    request.method !== "GET" &&
    request.method !== "HEAD"
  ) {
  ```

  **Quick win:** Yes

---

- [ ] **COMP.3.2: `formatMap` in the `pendingExport` handler is a local `Record<string, ExportFormat>`, not a typed handler map**

  **Severity:** Low

  **File:** `src/cli/tui/App.tsx:400-405`

  ```tsx
  const formatMap: Record<string, ExportFormat> = {
    c: "curl",
    f: "fetch",
    p: "python",
    h: "httpie",
  };
  const format = formatMap[input];
  ```

  **Issue:** The project guidelines state "Use typed handler maps, not `Record<string, Handler>`". Indexing into `Record<string, ExportFormat>` with an arbitrary `input` string returns `ExportFormat | undefined` at runtime but the type system says `ExportFormat`. This is handled safely because the subsequent `if (format && selectedFullRequest)` check catches `undefined`, but the type annotation is misleading -- `format` appears to be `ExportFormat` when it can actually be `undefined`.

  **Fix:** Either use a `Map<string, ExportFormat>` (where `.get()` returns `ExportFormat | undefined`), or type as `Partial<Record<string, ExportFormat>>`:
  ```tsx
  const formatMap: Partial<Record<string, ExportFormat>> = { ... };
  ```

  **Quick win:** Yes

---

- [ ] **COMP.3.3: Duplicated `pythonStringEscape` function when `pythonRepr` already handles string escaping**

  **Severity:** Low

  **File:** `src/cli/tui/utils/python-requests.ts:51-58`

  ```typescript
  function pythonStringEscape(str: string): string {
    return str
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }
  ```

  **Issue:** `pythonStringEscape` performs the exact same escape sequence as the string branch of `pythonRepr` (lines 28-33), minus the wrapping single quotes. Both functions exist in the same file. The duplication means a fix to one (e.g. adding unicode escape handling) must be applied to both.

  **Fix:** Extract the raw escaping into a single private function, then have `pythonRepr` call it:
  ```typescript
  function escapePythonString(str: string): string {
    return str.replace(/\\/g, "\\\\").replace(/'/g, "\\'").replace(/\n/g, "\\n").replace(/\r/g, "\\r").replace(/\t/g, "\\t");
  }
  ```
  Use `escapePythonString` in both `pythonRepr` and `generatePythonRequests`.

  **Quick win:** Yes

---

- [ ] **COMP.3.4: `generateFetch` JSON body indentation logic is dense and could produce misaligned output**

  **Severity:** Low

  **File:** `src/cli/tui/utils/fetch.ts:60`

  ```typescript
  options.push(`  body: JSON.stringify(${JSON.stringify(parsed, null, 2).split("\n").map((line, i) => (i === 0 ? line : `  ${line}`)).join("\n")})`);
  ```

  **Issue:** This single expression performs stringify, split, map with conditional indentation, and join. It is difficult to read and verify correctness. Specifically, the indentation assumes the `JSON.stringify` body will be nested at exactly two levels of indentation (the `body:` property inside the options object). If the surrounding template changes, this logic would silently produce misaligned output. Additionally, the line is 144 characters long, well beyond typical readability limits.

  **Fix:** Extract into a helper function:
  ```typescript
  function indentBlock(text: string, indent: string): string {
    return text.split("\n").map((line, i) => (i === 0 ? line : `${indent}${line}`)).join("\n");
  }
  ```

  **Quick win:** Yes

---

## 4. Test Coverage

**Positive Observations:**

- **All four generators have comprehensive unit tests** with consistent coverage patterns: basic GET, non-GET methods, headers, excluded headers, body handling, JSON vs non-JSON, escaping, empty/undefined body, and edge cases. This uniformity makes the test suite easy to navigate and maintain.
- **`pythonRepr` has dedicated tests** covering all JSON value types (true, false, null, undefined, numbers, strings, arrays, nested objects), which is thorough since this is a non-trivial recursive function.
- **`useExport.test.ts` covers all four format paths** through `exportFormatToClipboard`, verifying both the generated content and the status message for each format. The error path (clipboard failure) is also tested.
- **`App.test.tsx` covers the full `e` key interaction cycle**: the picker prompt appears, each format key dispatches correctly, unrecognised keys cancel, and the empty-selection case shows an error. This is thorough behavioural coverage of the TUI flow.
- **`StatusBar.test.tsx` verifies the `e` hint visibility** is gated by `hasSelection`, and the action text changes from "copy" (old) to "copy as" (new).
- **`HelpModal.test.tsx` verifies the updated help text** includes the new "Export as cURL / Fetch / Python / HTTPie" description.

---

- [ ] **TEST.4.1: No test for `createMockRequest` helpers missing required `CapturedRequest` fields**

  **Severity:** Low

  **File:** `src/cli/tui/utils/fetch.test.ts:5-17`, `python-requests.test.ts:5-17`, `httpie.test.ts:5-17`

  ```typescript
  function createMockRequest(overrides: Partial<CapturedRequest> = {}): CapturedRequest {
    return {
      id: "test-id",
      sessionId: "session-id",
      timestamp: Date.now(),
      method: "GET",
      url: "https://example.com/api/test",
      host: "example.com",
      path: "/api/test",
      requestHeaders: {},
      ...overrides,
    };
  }
  ```

  **Issue:** The mock factory returns a `CapturedRequest` but TypeScript allows this because the missing optional fields (`requestBody`, `responseStatus`, `responseHeaders`, `responseBody`, `durationMs`, etc.) are all optional in the interface. This is technically fine. However, the same factory is duplicated identically across four test files (fetch, python-requests, httpie, and the existing curl.test.ts). If the `CapturedRequest` interface gains a new required field, all four factories must be updated independently.

  **Fix:** Extract the factory into a shared test utility (e.g. `src/cli/tui/utils/__test-helpers.ts`) and import it from all four test files. This follows the "extract repeated patterns" guideline at the 3+ threshold.

  **Quick win:** Yes

---

- [ ] **TEST.4.2: `generateFetch` JSON indentation output is not verified by snapshot or exact-match**

  **Severity:** Low

  **File:** `src/cli/tui/utils/fetch.test.ts:66-76`

  ```typescript
  it("should use JSON.stringify for JSON bodies", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"name":"test"}'),
    });
    const output = generateFetch(request);

    expect(output).toContain("JSON.stringify(");
    expect(output).toContain('"name"');
  });
  ```

  **Issue:** The test verifies the output contains `JSON.stringify(` and `"name"` but does not verify the indentation or complete structure. Given the complexity of the indentation logic in `generateFetch` (the dense line at line 60), a snapshot or exact-match assertion would catch regressions in formatting.

  **Fix:** Add an exact-match test for a known JSON body:
  ```typescript
  it("should produce correctly indented JSON.stringify call", () => {
    const request = createMockRequest({
      method: "POST",
      requestHeaders: { "content-type": "application/json" },
      requestBody: Buffer.from('{"key":"value"}'),
    });
    const output = generateFetch(request);
    expect(output).toBe(
      `await fetch('https://example.com/api/test', {\n  method: 'POST',\n  body: JSON.stringify({\n    "key": "value"\n  })\n});`
    );
  });
  ```

  **Quick win:** Yes

---

- [ ] **TEST.4.3: No test for `generateHttpie` with content-type header suppression**

  **Severity:** Low

  **File:** `src/cli/tui/utils/httpie.test.ts`

  **Issue:** Unlike `generatePythonRequests` which explicitly tests that `content-type` is stripped when using `json=` kwarg (line 93-108), the HTTPie generator does not suppress `content-type` when using key=value/key:=value syntax. This may actually be a missing feature rather than a missing test -- HTTPie automatically sets `application/json` when using JSON syntax, so including the header is redundant. But it is not tested either way.

  **Fix:** Either add a test confirming the current behaviour (content-type header is included alongside key=value pairs), or, if the header should be suppressed to match HTTPie conventions, add the suppression logic and a test for it.

  **Quick win:** Yes

---

- [ ] **TEST.4.4: Null byte stripping not tested in `generateFetch` or `generatePythonRequests`**

  **Severity:** Low

  **File:** `src/cli/tui/utils/fetch.test.ts` and `src/cli/tui/utils/python-requests.test.ts`

  **Issue:** `curl.test.ts` (lines 277-306) and `httpie.test.ts` (lines 143-150) both include explicit null byte stripping tests. However, `generateFetch` and `generatePythonRequests` use `jsStringEscape` and `pythonStringEscape` respectively, neither of which strips null bytes. While null bytes in JavaScript strings or Python strings are less dangerous than in shell contexts (no truncation), they could still cause issues in terminal output or clipboard operations. The omission is consistent (the generators do not strip null bytes, and the tests do not test for it) but the asymmetry with the shell-based generators is worth noting.

  **Fix:** Either add null byte stripping to `jsStringEscape` and `pythonStringEscape` for consistency, or document why it is not needed for non-shell formats. If stripping is not added, this is informational only.

  **Quick win:** Yes (if adding stripping; informational if not)

---

## 5. Project Organisation

**Positive Observations:**

- **`export-shared.ts` is a well-scoped shared module.** It contains only the `EXCLUDED_HEADERS` constant, which is the only piece of data shared across all four generators. It does not import from any other module, keeping the dependency graph clean.
- **All four generator modules follow the same file structure**: JSDoc header, typed imports, escape helper (private), generator function (exported). This consistency makes the codebase navigable.
- **The new files are co-located with the existing `curl.ts`** in `src/cli/tui/utils/`, which is the correct location according to the project's conventions.
- **`useExport.ts` properly centralises the format dispatch** via `FORMAT_GENERATORS` and `FORMAT_LABELS`, avoiding per-format conditionals in the hook.
- **The `request.ts` CLI command correctly imports generators from the TUI utils directory** rather than duplicating the generation logic. The TUI and CLI share the same generator implementations.
- **The `shared/` module boundary is respected.** None of the new files import from `daemon/`, and `export-shared.ts` does not import from `cli/` or `daemon/`.
- **No file exceeds the ~250-line guideline.** The largest new file is `python-requests.test.ts` at 202 lines.

No issues found in this dimension.

---

## 6. Security

**Positive Observations:**

- **Shell escaping in `httpie.ts` uses the same proven `shellEscape` function as `curl.ts`**: null byte stripping followed by the quote-break-escape-reopen pattern. This is the correct approach for single-quoted shell strings.
- **`jsStringEscape` in `fetch.ts` correctly escapes all characters** that could break out of a JavaScript single-quoted string: backslash, single quote, newline, carriage return, and tab.
- **`pythonStringEscape` follows the same pattern** for Python single-quoted strings.
- **All generators use `request.requestBody.toString("utf-8")` to decode bodies**, which is safe -- `toString("utf-8")` replaces invalid byte sequences with the Unicode replacement character rather than producing corrupt output.
- **No user input reaches `eval`, `Function`, or shell execution** in any of the generators.

---

- [ ] **SEC.6.1: `jsStringEscape` and `pythonStringEscape` do not strip null bytes**

  **Severity:** Low

  **File:** `src/cli/tui/utils/fetch.ts:13-20` and `src/cli/tui/utils/python-requests.ts:51-58`

  **Issue:** The shell-based generators (`curl.ts`, `httpie.ts`) strip null bytes because shells truncate strings at `\0`. The JavaScript and Python generators do not strip null bytes. While null bytes in JS/Python string literals do not cause truncation, they could cause issues if the exported code is pasted into certain editors or terminals that treat `\0` as a string terminator. The risk is low because the output is copied to clipboard (not executed), but for consistency across formats it is worth considering.

  **Fix:** Add `.replace(/\0/g, "")` to both escape functions, or replace with `\\0` (the language-appropriate escape) so the null byte is represented but not literal:
  ```typescript
  .replace(/\0/g, "\\0")
  ```

  **Quick win:** Yes

---

- [ ] **SEC.6.2: `generateHttpie` does not escape non-string JSON values in `key:=value` syntax**

  **Severity:** Low

  **File:** `src/cli/tui/utils/httpie.ts:65`

  ```typescript
  parts.push(`'${shellEscape(key)}:=${JSON.stringify(val)}'`);
  ```

  **Issue:** For non-string JSON values (numbers, booleans, null), the key is shell-escaped but `JSON.stringify(val)` is trusted to produce safe output. For numbers, booleans, and null this is always safe (`42`, `true`, `null`). However, if `val` were somehow a string that slipped through (which cannot happen because the `allFlat` check with `typeof val === "string"` routes strings to the `key=value` path), or if the type narrowing were refactored incorrectly, the unescaped value could break the shell quoting. This is a defence-in-depth concern rather than a real vulnerability.

  **Fix:** Acceptable as-is since the type check at line 60-61 prevents strings from reaching this branch. For defence in depth, wrapping `JSON.stringify(val)` in `shellEscape` would be harmless since `JSON.stringify` output for non-string primitives never contains single quotes.

  **Quick win:** N/A (informational)

---

## 7. UX/UI Principles

**Positive Observations:**

- **The format picker UX is excellent.** Pressing `e` shows a clear prompt in the status bar: `Export: [c]url [f]etch [p]ython [h]ttpie`. Each key is a mnemonic first letter. An unrecognised key cancels silently with no error flash. This is clean and fast for power users while being discoverable for new users.
- **The `e` key hint in the status bar says "copy as"**, which is more descriptive than the old "copy" text and hints that there are multiple formats available.
- **The help modal correctly lists all four formats**: "Export as cURL / Fetch / Python / HTTPie" (line 45).
- **The CLI `request <id>` hint** (line 327) includes `export curl|har|fetch|requests|httpie`, maintaining the gradual discovery chain.
- **The Python export format name in the CLI is `requests`** (matching the library name), while the TUI uses `python` (matching the language). This is a pragmatic choice -- CLI users type `procsi request <id> export requests` which reads naturally, and TUI users see `[p]ython` which is unambiguous.
- **The format picker cancels on any unrecognised key**, not just Escape. This matches the existing patterns for `pendingClear` and `pendingReplayId`, keeping the interaction model consistent.

---

- [ ] **UX.7.1: Format picker prompt disappears on any key, including modifier keys and accidental presses**

  **Severity:** Low

  **File:** `src/cli/tui/App.tsx:398-415`

  ```tsx
  if (pendingExport) {
    setPendingExport(false);
    const formatMap: Record<string, ExportFormat> = { ... };
    const format = formatMap[input];
    if (format && selectedFullRequest) {
      // export...
    } else {
      setStatusMessage(undefined);
    }
    return;
  }
  ```

  **Issue:** Any key that is not `c`, `f`, `p`, or `h` cancels the format picker, including modifier keys. If the user accidentally presses Shift, or if a terminal sends an escape sequence (e.g. from a mouse event or resize), the picker is cancelled and the user must press `e` again. This is the same behaviour as `pendingClear` and `pendingReplayId`, so it is at least consistent. However, for the format picker, the cost of accidental cancellation is higher because the user may be thinking about which format to choose (unlike clear/replay where `y/n` is an immediate decision).

  **Fix:** Consider keeping `pendingExport` active when `input` is empty or when only modifier keys are detected (`key.escape` could be used as the explicit cancel). Alternatively, accept as-is for consistency with the existing confirmation pattern.

  **Quick win:** Partially (depends on whether consistency or robustness is prioritised)

---

- [ ] **UX.7.2: Naming mismatch between TUI format `python` and CLI format `requests`**

  **Severity:** Low

  **File:** `src/cli/tui/hooks/useExport.ts:16` vs `src/cli/commands/request.ts:18`

  ```typescript
  // useExport.ts
  export type ExportFormat = "curl" | "fetch" | "python" | "httpie";

  // request.ts
  const EXPORT_FORMATS = ["curl", "har", "fetch", "requests", "httpie"];
  ```

  **Issue:** The TUI uses `python` as the format identifier while the CLI uses `requests`. The status bar says "Python copied to clipboard" while the CLI docs say `export requests`. A user who learns the format name from the TUI status message and then tries `procsi request <id> export python` would get an error: `Unknown export format: "python"`. Conversely, a user who reads the CLI help and looks for a "requests" format in the TUI would not find it.

  **Fix:** Accept both names in the CLI (`requests` and `python` as aliases), or unify on one name. The simplest fix is to add `python` as an accepted alias in the CLI:
  ```typescript
  const EXPORT_FORMATS = ["curl", "har", "fetch", "requests", "python", "httpie"];
  // Then in the handler:
  const normalisedFormat = format === "python" ? "requests" : format;
  ```

  **Quick win:** Yes

---

## 8. Performance

**Positive Observations:**

- **The generator functions are pure and allocation-minimal.** Each builds an array of string parts and joins them once. No intermediate objects, streams, or buffers beyond the input `CapturedRequest`.
- **`FORMAT_GENERATORS` and `FORMAT_LABELS` are module-level constants**, not recreated per call. The lookup is O(1) by key.
- **The `formatMap` in the `pendingExport` handler is created inline inside the handler body**, which means it is only constructed when the user is in the format picker state (not on every render). Given that it contains only 4 entries and is created at most once per export interaction, this is negligible.
- **`pythonRepr` is recursive but bounded** by the depth of the JSON structure, which is capped by `JSON.parse` (no circular references). For typical API request bodies, this will never exceed a few levels.
- **`isJsonContent` is a simple string check** (two `includes` calls), not a regex or parse operation. It executes in microseconds.
- **No unnecessary database queries or network requests** are introduced by this feature. The export operates on the already-fetched `selectedFullRequest` in memory.

No issues found in this dimension.

---

## Quick Wins Summary

Issues that can be fixed in minutes with minimal risk:

| Pillar | IDs |
|--------|-----|
| React/Ink | TUI.1.1 |
| TypeScript | TS.2.1, TS.2.2 |
| Completeness | COMP.3.1, COMP.3.2, COMP.3.3, COMP.3.4 |
| Tests | TEST.4.1, TEST.4.2, TEST.4.3, TEST.4.4 |
| Security | SEC.6.1 |
| UX/UI | UX.7.2 |

**Total quick wins: 12 of 15 issues**

---

## Overall Assessment

This is a well-executed feature. The architecture decisions are sound: shared constants extracted to avoid duplication, a typed format registry in the hook, consistent generator interfaces, and proper integration with both the TUI picker flow and the CLI export subcommand. The test coverage is thorough with 90 passing tests across the five test files, covering happy paths, edge cases, escaping, and error scenarios.

The most significant issue is COMP.3.1 (curl generator inconsistency with GET/HEAD body handling), which is a functional correctness concern. The remaining issues are predominantly low-severity quality and consistency improvements.
