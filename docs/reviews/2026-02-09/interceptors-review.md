# procsi Code Review -- 2026-02-09

Review of the Phase 2 "Config-as-code Interceptors" feature: jiti-based TypeScript loader, deferred forward() pattern, runner lifecycle, ProcsiClient, CLI commands, MCP tools, TUI indicators, and storage extensions.

## Summary

| Dimension | Issues Found |
|-----------|-------------|
| 1. React/Ink Best Practices | 1 issue |
| 2. TypeScript Quality | 3 issues |
| 3. Code Completeness | 5 issues |
| 4. Test Coverage | 4 issues |
| 5. Project Organisation | 1 issue |
| 6. Security | 3 issues |
| 7. UX/UI Principles | 2 issues |
| 8. Performance | 2 issues |

---

## 1. React/Ink Best Practices

**Positive Observations:**
- `RequestListItem` is wrapped in `React.memo()` with a custom comparator that includes `interceptionType`, following the guideline to memoise list item components.
- The interception indicator is a pure function extracted from the component, making it easy to test and reason about.
- `StatusBar` uses `useMemo` correctly for the visible hints computation, preventing unnecessary recalculation on every render.
- `AccordionPanel` cleanly integrates the interception info into the existing section layout without adding new state or effects.

---

- [x] **INT.1.1: RequestListItem memo comparator is redundant for interceptionType**

  **Severity:** Low

  **File:** `src/cli/tui/components/RequestListItem.tsx:177-185`

  ```tsx
  }, (prevProps, nextProps) => {
    return (
      prevProps.request === nextProps.request &&
      prevProps.isSelected === nextProps.isSelected &&
      prevProps.width === nextProps.width &&
      prevProps.showFullUrl === nextProps.showFullUrl &&
      prevProps.searchTerm === nextProps.searchTerm &&
      prevProps.request.interceptionType === nextProps.request.interceptionType
    );
  });
  ```

  **Issue:** The last line (`prevProps.request.interceptionType === nextProps.request.interceptionType`) is redundant when `prevProps.request === nextProps.request` already passes -- if the request reference is identical then all its properties are identical. The extra check only adds value if the request object is reconstructed with the same data but a new reference *and* only interceptionType changes, which would be caught by the first comparison failing anyway. This is harmless but misleading -- it implies interceptionType can change independently of the request reference.

  **Fix:** Remove the redundant `interceptionType` comparison, or add a comment explaining that it is an intentional safety net for cases where the request object is reconstructed.

  **Quick win:** Yes

---

## 2. TypeScript Quality

**Positive Observations:**
- `isValidInterceptor` and `isValidInterceptorResponse` are proper runtime type guards that validate all fields without using `as` casts on user-provided data.
- The `extractInterceptors` function carefully handles both single-object and array exports, with error messages that describe what went wrong.
- `optionalFilter` in `control.ts` validates every field individually from untyped params rather than blindly casting.
- The `Deferred<T>` pattern in the runner is cleanly typed with generics.

---

- [ ] **INT.2.1: `as Record<string, unknown>` cast in isValidInterceptor**

  **Severity:** Low

  **File:** `src/daemon/interceptor-loader.ts:38`

  ```typescript
  const obj = value as Record<string, unknown>;
  ```

  **Issue:** After the `typeof value !== "object" || value === null` guard, the value is known to be `object & {}`. The cast to `Record<string, unknown>` is technically safe here, but the project guidelines state "never use `as` casts on external data". Since interceptor files are user-authored TypeScript loaded via jiti, the export *is* external data. Using bracket notation directly on `value` with a narrowing guard would be more consistent with the project's style in `control.ts` where `(value as Record<string, unknown>)["id"]` is used inline.

  **Fix:** Either use inline bracket access `(value as Record<string, unknown>)["handler"]` consistently (matching `control.ts` style), or extract a small `hasProperty` helper. This is a style nit rather than a correctness issue.

  **Quick win:** Yes

---

- [x] **INT.2.2: `reloadInterceptors` returns stale count due to fire-and-forget async**

  **Severity:** High

  **File:** `src/daemon/control.ts:273-279`

  ```typescript
  reloadInterceptors: (): { success: boolean; count: number } => {
    if (!interceptorLoader) return { success: false, count: 0 };
    interceptorLoader.reload();
    return {
      success: true,
      count: interceptorLoader.getInterceptors().length,
    };
  },
  ```

  **File:** `src/daemon/interceptor-loader.ts:296-307`

  ```typescript
  reload(): void {
    logger.info("Manual reload triggered");
    loadAll()
      .then(() => { ... })
      .catch((err: unknown) => { ... });
  },
  ```

  **Issue:** `reload()` is fire-and-forget -- it kicks off `loadAll()` asynchronously and returns immediately. The control handler then reads `getInterceptors().length`, which returns the *old* interceptor set because `loadAll()` hasn't completed yet. The returned count is stale and may mislead users. The integration test even acknowledges this: "reload() is fire-and-forget in the loader, so the count returned reflects the state at the time of the call". The CLI `interceptors reload` command displays this count to the user, giving them incorrect feedback.

  **Fix:** Make `reload()` return a `Promise<void>` (or `Promise<{ count: number }>`) so callers can await it. The control handler would need to become async (which is already supported -- `handleMessage` just needs to `await` the result). Alternatively, change `reload()` to be synchronous by using `jiti.import` synchronously if jiti supports it, but the async approach is cleaner.

  **Quick win:** No -- requires changing the `InterceptorLoader` interface and control handler plumbing.

---

- [x] **INT.2.3: `interception_type` column accepts arbitrary strings in the database**

  **Severity:** Medium

  **File:** `src/daemon/storage.ts:101-106`

  ```sql
  ALTER TABLE requests ADD COLUMN intercepted_by TEXT;
  ALTER TABLE requests ADD COLUMN interception_type TEXT;
  ```

  **File:** `src/daemon/storage.ts:501-512`

  ```typescript
  updateRequestInterception(
    id: string,
    interceptedBy: string,
    interceptionType: InterceptionType
  ): void {
    const stmt = this.db.prepare(`
      UPDATE requests SET intercepted_by = ?, interception_type = ? WHERE id = ?
    `);
    stmt.run(interceptedBy, interceptionType, id);
  }
  ```

  **Issue:** While the TypeScript function signature constrains `interceptionType` to `InterceptionType` ("modified" | "mocked"), the database column is an unconstrained `TEXT`. The `rowToRequest` and `rowToSummary` methods correctly validate the value on read (checking for "modified" or "mocked"), but there is no `CHECK` constraint in the database schema. If any future code path writes an invalid value directly via SQL (e.g. a migration or manual fix), it would be silently accepted and then silently dropped on read.

  **Fix:** Add a `CHECK` constraint to the migration: `ALTER TABLE requests ADD COLUMN interception_type TEXT CHECK(interception_type IN ('modified', 'mocked'))`. This is a defence-in-depth measure, not a current bug.

  **Quick win:** Yes

---

## 3. Code Completeness

**Positive Observations:**
- All timeout values (`HANDLER_TIMEOUT_MS`, `MATCH_TIMEOUT_MS`, `STALE_CLEANUP_INTERVAL_MS`, `WATCH_DEBOUNCE_MS`) are extracted as named constants.
- Error paths in the runner are comprehensive: match timeout, match throw, handler timeout, handler throw, invalid response, forward-after-complete -- all handled gracefully with pass-through semantics.
- The `warnDuplicateNames` helper proactively flags configuration issues without failing hard.
- `buildMockttpResponse` centralises the response shape conversion, avoiding duplication in the proxy.

---

- [x] **INT.3.1: jiti module cache is not cleared on reload**

  **Severity:** High

  **File:** `src/daemon/interceptor-loader.ts:140,170`

  ```typescript
  const jiti = createJiti(import.meta.url, { interopDefault: true });
  // ...
  const mod: unknown = await jiti.import(filePath);
  ```

  **Issue:** `jiti` caches modules internally. When `reload()` is called, `loadAll()` re-imports the same file paths, but jiti may return the cached version rather than re-reading the file from disk. This means hot-reload and manual `procsi interceptors reload` may silently return stale interceptor code. The file watcher will fire change events, but the actual module re-evaluation may not happen.

  **Fix:** Either create a fresh `jiti` instance on each `loadAll()` call, or use jiti's cache-busting mechanism (e.g. appending a query string `?t=${Date.now()}` to the file path, or calling `jiti.esmResolve` with cache invalidation). Investigate jiti's API for explicit cache clearing.

  **Quick win:** No -- requires understanding jiti's caching semantics.

---

- [x] **INT.3.2: `listInterceptorFiles` uses sync I/O (`readdirSync`)**

  **Severity:** Low

  **File:** `src/daemon/interceptor-loader.ts:59-70`

  ```typescript
  function listInterceptorFiles(dir: string): string[] {
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".ts"))
        .map((entry) => entry.name)
        .sort()
        .map((name) => path.join(dir, name));
    } catch {
      return [];
    }
  }
  ```

  **Issue:** The project guidelines say "Prefer async I/O on the hot path. Avoid `fs.*Sync` methods in code that runs frequently." While `listInterceptorFiles` is called during reload (not per-request), and the interceptors directory is expected to contain very few files, it is still on the async `loadAll` path. Using `readdirSync` inside an `async` function is inconsistent.

  **Fix:** Switch to `fs.promises.readdir`. Low priority since the directory is tiny and reloads are infrequent.

  **Quick win:** Yes

---

- [x] **INT.3.3: `fs.existsSync` calls in loader startup path**

  **Severity:** Low

  **File:** `src/daemon/interceptor-loader.ts:218,279`

  ```typescript
  if (!fs.existsSync(interceptorsDir)) {
    return;
  }
  // ...
  if (fs.existsSync(interceptorsDir)) {
    logger.info(`Interceptors directory found: ${interceptorsDir}`);
    await loadAll();
  }
  ```

  **Issue:** Same concern as INT.3.2 -- `fs.existsSync` in an async context. These are only called once at startup, so the impact is negligible, but for consistency they should use `fs.promises.access` or `fs.promises.stat`.

  **Fix:** Replace with async equivalents. Very low priority.

  **Quick win:** Yes

---

- [x] **INT.3.4: `intercept.ts` does not close the ControlClient on the interceptor info path**

  **Severity:** Medium

  **File:** `src/cli/commands/intercept.ts:98-112`

  ```typescript
  // Report interceptor status
  try {
    const interceptors = await client.listInterceptors();
    if (interceptors.length > 0) {
      // ...
    }
  } catch {
    // Interceptor info not available -- not critical
  }

  // Output env vars for eval
  console.log(formatEnvVars(envVars));
  // ...
  ```

  **Issue:** The `client` ControlClient is created at line 78 but is never explicitly closed. The socket will be cleaned up when the process exits (which happens shortly after this function), but if an error is thrown between `client.registerSession` and the end of the function, the socket may leak. Other CLI commands (e.g. `interceptors.ts`) consistently use `try/finally` with `client.close()`.

  **Fix:** Wrap the client usage in a `try/finally` block that calls `client.close()`, or close it after the last usage.

  **Quick win:** Yes

---

- [x] **INT.3.5: `Object.freeze` on request does not deep-freeze nested objects**

  **Severity:** Medium

  **File:** `src/daemon/interceptor-runner.ts:231-232`

  ```typescript
  Object.freeze(request.headers);
  Object.freeze(request);
  ```

  **Issue:** `Object.freeze` is shallow. The `request.body` field is a `Buffer`, which is not frozen -- an interceptor could call `request.body.fill(0)` to mutate the buffer in place, potentially corrupting the request body for storage or other interceptors. Similarly, if `request.headers` contained nested objects (unlikely given the `Record<string, string>` type, but possible if a buggy upstream passes nested values), those inner values would remain mutable.

  **Fix:** For the `body` field specifically, consider passing a `Buffer.from(body)` copy to the interceptor context rather than the original reference. Alternatively, document that `body` mutation is undefined behaviour and rely on the TypeScript `Readonly<>` type to discourage it.

  **Quick win:** No -- needs a design decision on whether to copy the buffer.

---

## 4. Test Coverage

**Positive Observations:**
- The interceptor runner tests are thorough and well-structured: mock, modify, observe, pass-through, error handling, forward() idempotency, cleanup/abort, request immutability, context.log, and context.procsi are all covered.
- The loader tests cover ESM default, CJS, arrays, alphabetical ordering, syntax errors, missing handlers, non-object exports, import throws, duplicate names, metadata, non-existent directories, unnamed interceptors, manual reload, and non-.ts file filtering.
- The integration tests spin up a real proxy + upstream server + interceptor loader to validate end-to-end mock, modify, pass-through, error recovery, and `interceptedBy` filtering.
- The MCP server tests cover the new `formatInterceptor`, `formatSummary` with interception fields, `serialiseRequest` with interception fields, and `buildFilter` with `intercepted_by`.

---

- [x] **INT.4.1: No test for handler timeout scenario**

  **Severity:** Medium

  **File:** `src/daemon/interceptor-runner.test.ts`

  **Issue:** The runner has a 30-second `HANDLER_TIMEOUT_MS` that causes pass-through when a handler takes too long. There is no unit test that verifies this timeout behaviour. While the 30-second default makes it impractical to test with real timers, the constants are exported and the test could use `vi.useFakeTimers()` or reduce the timeout via dependency injection.

  **Fix:** Add a test that verifies the handler timeout path. Either use fake timers to advance past `HANDLER_TIMEOUT_MS`, or refactor the runner to accept timeout values as options (they are already exported constants, so a simple override pattern would work).

  **Quick win:** No -- requires either fake timers or a refactor to inject timeout values.

---

- [x] **INT.4.2: No test for match timeout scenario**

  **Severity:** Medium

  **File:** `src/daemon/interceptor-runner.test.ts`

  **Issue:** The `MATCH_TIMEOUT_MS` (5 seconds) causes a match function that takes too long to be skipped. There is a test for match functions that throw, but not for match functions that hang. Same solution as INT.4.1.

  **Fix:** Add a test with a match function that never resolves and verify it is skipped after the timeout.

  **Quick win:** No

---

- [ ] **INT.4.3: No test for hot-reload (file watcher) behaviour**

  **Severity:** Medium

  **File:** `src/daemon/interceptor-loader.test.ts`

  **Issue:** The loader tests cover manual `reload()`, but there is no test that verifies the `fs.watch` file watcher triggers a reload when a `.ts` file changes. The debounce logic (`WATCH_DEBOUNCE_MS`) and the watcher error path are also untested.

  **Fix:** Add a test that writes a new file to the interceptors directory after initial load, waits for the debounce period, and verifies the interceptor set is updated. Consider using a spy on `onReload` to detect when the watcher-triggered reload completes.

  **Quick win:** No -- file watcher tests can be flaky and need careful timing.

---

- [x] **INT.4.4: `"silent"` log level used in tests is not a valid `LogLevel`**

  **Severity:** Low

  **File:** `src/daemon/interceptor-runner.test.ts`, `src/daemon/interceptor-loader.test.ts`

  ```typescript
  logLevel: "silent",
  ```

  **Issue:** The `LogLevel` type is `"error" | "warn" | "info" | "debug" | "trace"` -- there is no `"silent"` level. Test files are excluded from `tsconfig.json` type checking (`"exclude": ["src/**/*.test.ts"]`), so this does not cause build failures. However, it means the logger still writes at `"warn"` level (the default) since `"silent"` does not match any priority in `shouldLog`. The tests are not truly silent -- they produce log output to temp directories. If test files are ever included in type checking, these will all fail.

  **Fix:** Either add `"silent"` as a valid `LogLevel` with priority -1 (so nothing passes the `shouldLog` check), or use `"error"` in tests to minimise output without using an invalid value.

  **Quick win:** Yes

---

## 5. Project Organisation

**Positive Observations:**
- The `src/interceptors.ts` barrel file cleanly re-exports only the consumer-facing types (`Interceptor`, `InterceptorRequest`, `InterceptorResponse`, `InterceptorContext`, `ProcsiClient`), avoiding leaking internal types.
- The `package.json` `exports` field correctly uses `"types"` condition for the `./interceptors` subpath, ensuring TypeScript consumers get type definitions.
- `shared/types.ts` remains the single source of truth for all interceptor-related types -- loader, runner, and client all import from shared.
- `shared/` does not import from `daemon/` or `cli/` -- the module boundary is respected throughout.

---

- [ ] **INT.5.1: `procsi-client.ts` is in `daemon/` but implements a `shared/types.ts` interface**

  **Severity:** Low

  **File:** `src/daemon/procsi-client.ts`

  **Issue:** `createProcsiClient` lives in `daemon/` because it depends on `RequestRepository` (a daemon module). This is correct -- it cannot be in `shared/`. However, the `ProcsiClient` interface is exported from `shared/types.ts` and re-exported via `src/interceptors.ts` for external consumers. If a future consumer wants to create an `ProcsiClient` outside the daemon (e.g. in an MCP context or test harness), they have no factory function available from the public API. Currently this is fine because only the daemon creates `ProcsiClient` instances, but it is worth noting as a potential friction point.

  **Fix:** No action needed now. If the need arises, consider a factory function in `shared/` that accepts a generic storage interface rather than `RequestRepository` directly.

  **Quick win:** N/A -- informational note only.

---

## 6. Security

**Positive Observations:**
- The request object is frozen (`Object.freeze`) before being passed to interceptor handlers, preventing mutation of shared state.
- Interceptor responses are validated via `isValidInterceptorResponse` before being used, preventing handlers from returning malformed responses that could crash the proxy.
- All SQL uses parameterised queries -- the new `intercepted_by` filter in `applyFilterConditions` uses `?` placeholders.
- Match and handler functions are wrapped in `withTimeout` to prevent a rogue interceptor from blocking all traffic indefinitely.

---

- [ ] **INT.6.1: Arbitrary TypeScript code execution via interceptor files**

  **Severity:** High

  **File:** `src/daemon/interceptor-loader.ts:170`

  ```typescript
  const mod: unknown = await jiti.import(filePath);
  ```

  **Issue:** Interceptor files are loaded and executed via `jiti.import()` inside the daemon process. This is the intended design (config-as-code), but it means any TypeScript file placed in `.procsi/interceptors/` runs with full Node.js permissions in the daemon process. A malicious or buggy interceptor can read/write the filesystem, make network requests, access environment variables, or crash the daemon. The daemon runs under the user's UID, so the blast radius is limited to the user's permissions, but there is no sandboxing.

  **Fix:** This is a known trade-off of config-as-code. Consider:
  1. Documenting the security model clearly -- interceptors run with full privileges.
  2. Adding `.procsi/interceptors/` to the default `.gitignore` template (if not already) to reduce the risk of committing untrusted interceptor code.
  3. Long-term: investigate running interceptors in a worker thread or VM2/isolated-vm for partial sandboxing.

  **Quick win:** Yes (for documentation) / No (for sandboxing)

---

- [ ] **INT.6.2: MCP `procsi_reload_interceptors` tool allows remote code reload**

  **Severity:** Medium

  **File:** `src/mcp/server.ts:1025-1049`

  ```typescript
  server.tool(
    "procsi_reload_interceptors",
    "Reload interceptors from disk. Use after editing interceptor files to apply changes without restarting the daemon.",
    { format: FORMAT_SCHEMA },
    async (params) => {
      const result = await client.reloadInterceptors();
      // ...
    }
  );
  ```

  **Issue:** An MCP client (e.g. an AI agent) can trigger an interceptor reload via this tool. If the agent has also modified files in `.procsi/interceptors/` (either directly or via another tool), this effectively allows remote code injection into the daemon. The MCP tools were originally read-only, but `procsi_reload_interceptors` and `procsi_clear_requests` are mutating operations.

  **Fix:** Consider:
  1. Adding a "write operations" section to the MCP tool descriptions that clearly states the tool causes code execution.
  2. Adding a confirmation parameter (e.g. `confirm: true`) to prevent accidental invocation.
  3. Documenting that the MCP server should only be exposed to trusted clients.

  **Quick win:** Yes (for documentation)

---

- [ ] **INT.6.3: Interceptor handler has unrestricted access to `ProcsiClient`**

  **Severity:** Medium

  **File:** `src/daemon/procsi-client.ts:1-30`

  **Issue:** The `ProcsiClient` passed to interceptor handlers provides read access to all captured traffic, including request/response bodies, headers (which may contain auth tokens), and metadata. A malicious interceptor could exfiltrate all captured traffic. This is inherent to the design (interceptors need to query traffic to make decisions), but there is no mechanism to scope access -- every interceptor sees everything.

  **Fix:** For v1, document this clearly. For the future, consider allowing interceptors to declare required permissions or scoping the client to the current request's session.

  **Quick win:** Yes (for documentation) / No (for scoping)

---

## 7. UX/UI Principles

**Positive Observations:**
- The interception indicator ("M" for mocked, "I" for modified) in the request list is compact and colour-coded, providing at-a-glance visibility without cluttering the layout.
- The `StatusBar` interceptor count badge uses clear singular/plural handling and only appears when interceptors are active (count > 0).
- The `AccordionPanel` interception info is shown at the top of the Request section with clear labelling ("Intercepted by: X (type)"), making it immediately visible when viewing request details.
- The `procsi interceptors init` command scaffolds a well-commented example file covering all three patterns (mock, modify, observe).

---

- [x] **INT.7.1: `interceptors list` table format does not show full source paths**

  **Severity:** Low

  **File:** `src/cli/commands/interceptors.ts:59-70`

  ```typescript
  function formatInterceptorRow(
    name: string,
    sourceFile: string,
    hasMatch: boolean,
    error?: string,
  ): string {
    const nameCol = name.padEnd(24);
    const fileCol = sourceFile.padEnd(32);
    // ...
  }
  ```

  **Issue:** The `sourceFile` column shows the full absolute path (from `InterceptorInfo.sourceFile`), which can be very long and cause the table to overflow the terminal width. The MCP `formatInterceptor` function also shows the full path. For CLI output, a relative path or just the filename would be more readable.

  **Fix:** Use `path.relative(projectRoot, sourceFile)` or `path.basename(sourceFile)` for the CLI table display. The full path can remain in the `InterceptorInfo` type for programmatic access.

  **Quick win:** Yes

---

- [x] **INT.7.2: No feedback when `interceptors reload` is called but interceptors directory does not exist**

  **Severity:** Low

  **File:** `src/daemon/control.ts:273-279`

  ```typescript
  reloadInterceptors: (): { success: boolean; count: number } => {
    if (!interceptorLoader) return { success: false, count: 0 };
    interceptorLoader.reload();
    return { success: true, count: interceptorLoader.getInterceptors().length };
  },
  ```

  **File:** `src/cli/commands/interceptors.ts:131-145`

  ```typescript
  const result = await client.reloadInterceptors();
  if (result.success) {
    console.log(`Reloaded ${result.count} interceptor${result.count === 1 ? "" : "s"}`);
  } else {
    console.log("Reload failed");
    process.exit(1);
  }
  ```

  **Issue:** When the interceptor loader was never created (because the interceptors directory did not exist at daemon startup), `reloadInterceptors` returns `{ success: false, count: 0 }` and the CLI prints "Reload failed" with exit code 1. This is correct but unhelpful -- the user has no idea *why* it failed. A more informative message would explain that the interceptors directory was not found.

  **Fix:** Return an error message in the response (e.g. `{ success: false, count: 0, error: "Interceptors directory not found. Create .procsi/interceptors/ and restart the daemon." }`), and display it in the CLI.

  **Quick win:** Yes

---

## 8. Performance

**Positive Observations:**
- The runner's `pending` Map has periodic stale-entry cleanup (`STALE_CLEANUP_INTERVAL_MS`) with `cleanupInterval.unref()` to prevent keeping the process alive.
- The `findMatchingInterceptor` function short-circuits on the first match (first-match semantics), avoiding unnecessary evaluation of remaining interceptors.
- The `listRequestsSummary` query correctly includes `intercepted_by` and `interception_type` in the summary column list (no `SELECT *`), maintaining the lean query pattern.
- The `withTimeout` helper uses `clearTimeout` on the happy path, preventing leaked timers.

---

- [x] **INT.8.1: `findMatchingInterceptor` evaluates match functions sequentially**

  **Severity:** Low

  **File:** `src/daemon/interceptor-runner.ts:171-206`

  ```typescript
  async function findMatchingInterceptor(
    interceptors: LoadedInterceptor[],
    request: InterceptorRequest
  ): Promise<LoadedInterceptor | undefined> {
    for (const interceptor of interceptors) {
      if (!interceptor.match) {
        return interceptor;
      }
      try {
        const outcome = await withTimeout(
          Promise.resolve(interceptor.match(request)),
          MATCH_TIMEOUT_MS
        );
        // ...
      }
    }
  }
  ```

  **Issue:** Match functions are evaluated sequentially with `await`. If a user has many interceptors with async match functions (e.g. querying the database via `ctx.procsi`), the total matching time is the sum of all match evaluations, not the max. With the 5-second `MATCH_TIMEOUT_MS`, 10 interceptors with slow match functions could add up to 50 seconds of latency per request. This is unlikely in practice (match functions should be fast predicates), but the design allows it.

  **Fix:** This is inherent to first-match semantics -- you cannot evaluate in parallel because order matters. Document that match functions should be synchronous and fast. Consider logging a warning if total match evaluation time exceeds a threshold (e.g. 1 second).

  **Quick win:** Yes (for documentation/warning)

---

- [ ] **INT.8.2: `updateRequestInterception` is a separate SQL UPDATE per request**

  **Severity:** Low

  **File:** `src/daemon/proxy.ts:152-157,178-184,238-243,261-266`

  ```typescript
  storage.updateRequestInterception(
    ourId,
    result.interception.name,
    result.interception.type,
  );
  ```

  **Issue:** For intercepted requests, the proxy issues up to two separate `UPDATE` statements: one for interception metadata (`updateRequestInterception`) and one for response data (`updateRequestResponse`). In the mock path, both are called back-to-back. These could be combined into a single `UPDATE` to halve the SQLite write overhead for mocked requests.

  **Fix:** Add an optional `interceptedBy` and `interceptionType` parameter to `updateRequestResponse`, or create a combined update method. Low priority since SQLite is fast for single-row updates and WAL mode amortises the cost.

  **Quick win:** No -- requires API changes to `RequestRepository`.

---
