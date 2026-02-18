# procsi - Terminal HTTP Interception Toolkit

## Planning & Status

**[`docs/PLAN.md`](docs/PLAN.md) is the source of truth for all development work on this project.**

- Always check `docs/PLAN.md` before starting work to understand current priorities
- Update `docs/PLAN.md` when completing tasks (move to Completed section)
- Update `docs/PLAN.md` when discovering new tasks or requirements
- Keep task descriptions concise but informative
- Code reviews are stored in `docs/reviews/<date>/`

Published to npm as `procsi` (v0.1.0). The name `procsi` was taken.

## Project Overview

procsi is a terminal-based HTTP interception/inspection tool with project-scoped isolation and a lazygit-style TUI. It captures HTTP/HTTPS traffic through a MITM proxy and displays it in an interactive terminal interface.

## Product Vision

### Messaging Pillars

These define what procsi is and how it should feel — keep them in mind when making design and UX decisions:

- **Workspace-isolated** — per-project `.procsi/` directory, no cross-project bleed
- **Lives in your terminal** — TUI, not another GUI app; fits your existing workflow
- **AI-native** — MCP integration, AI writes your mocks, inspects your traffic
- **Config-as-code** — mocks and interceptors are TypeScript files, not GUI toggles
- **Zero-config** — `procsi on` and go; auto-starts daemon, auto-generates certs
- **Developer-first** — built for how you already work, not bolted on

### Strategic Direction

The long-term vision centres on **mocks & interceptors as code** — TypeScript config files inside `.procsi/` that define middleware/intercept/mock behaviour, with full programmatic access to the procsi client. The TUI visualises what's configured, but logic lives in code.

**MCP integration** is a first-class concern: AI agents should be able to discover `.procsi`, communicate with the proxy, search through captured traffic, and write/manage mock rules via the config-as-code system.

### CLI Design Philosophy — Gradual Discovery

The CLI follows a **gradual discovery** pattern — each command's output hints at what you can do next, so usage builds on itself naturally:

- **Resources as nouns**: `requests`, `sessions`, `interceptors` — collections are plural
- **Single resources by ID**: `request <id>` — singular with identifier
- **Actions as subcommands**: `export`, `search`, `query`, `count`, `clear`
- **Filters as flags**: `--method`, `--status`, `--host`, `--path`, etc.
- **Output drives next usage**: Every command's output includes contextual hints suggesting related commands. Short IDs in list views can be directly used in detail commands.
- **Human and agent friendly**: Human-readable tables and colours by default, `--json` for structured machine output. Colours and hints suppressed when stdout is piped.

## Architecture

```
~/projects/client-a/
├── .procsi/
│   ├── proxy.port        # TCP port for HTTP_PROXY
│   ├── control.sock      # Unix socket for TUI <-> daemon
│   ├── requests.db       # SQLite - captured traffic
│   └── ca.pem            # CA certificate
└── src/...
```

Key design decisions:
- **Project-scoped isolation** - each project gets its own `.procsi/` directory
- **Unix socket for control API** - avoids port conflicts
- **TCP for proxy** - required by HTTP_PROXY standard
- **SQLite for persistence** - simple, embedded storage
- **Auto-start daemon** - starts on first `procsi on`

## Technology Stack

- **Runtime**: Node.js (>=20)
- **Language**: TypeScript
- **CLI**: commander
- **TUI**: ink (React for terminals)
- **Proxy**: mockttp (HTTP Toolkit's MITM library)
- **Storage**: better-sqlite3
- **Testing**: Vitest

## Commands

```bash
npm run build      # Compile TypeScript
npm run typecheck  # Type checking only
npm run lint       # ESLint
npm test           # Run all tests
npm run dev        # Watch mode for development
```

## Testing

### Tools

- **Vitest** - Test runner (configured in `vitest.config.ts`)
- **ink-testing-library** - Component-level TUI testing with keyboard input simulation
- **cli-testing-library** - Full CLI process spawning for e2e tests

### Test Conventions

**Co-location:** Unit tests live next to the source file they test (e.g. `src/daemon/proxy.test.ts` tests `src/daemon/proxy.ts`). Integration and E2E tests stay in `tests/integration/` and `tests/e2e/` respectively.

**Module grouping:** Test files should map 1:1 to source modules. Don't create separate test files for individual exported functions — group all tests for a module in a single `<module>.test.ts` file.

### Test Types

#### Unit Tests (co-located in `src/`)
Pure functions with no external dependencies. Fast, isolated, deterministic.

**Use for**: Formatters, utilities, data transformations, SQLite operations (with temp files)

**Examples**: `src/daemon/storage.test.ts`, `src/cli/tui/utils/curl.test.ts`, `src/daemon/proxy.test.ts`

#### Component Tests (co-located in `src/cli/tui/`)
ink components tested with ink-testing-library. Can simulate keyboard input.

**Use for**: TUI component behaviour, keyboard interactions, state changes

**Key pattern** - Use `__testEnableInput` prop to bypass TTY check:
```tsx
const { lastFrame, stdin } = render(<App __testEnableInput />);
stdin.write("u");
await new Promise((resolve) => setTimeout(resolve, 50)); // Wait for re-render
expect(lastFrame()).toContain("expected text");
```

**Note**: `stdin.write()` requires async handling - React needs time to process state updates.

#### Integration Tests (`tests/integration/`)
Tests that spin up real daemon/proxy but don't spawn CLI processes.

**Use for**: Daemon lifecycle, proxy interception, control API communication, multi-component interactions

**Examples**: `daemon.test.ts`, `logging.test.ts`, `version-check.test.ts`

#### E2E Tests (`tests/e2e/`)
Full CLI process spawning with cli-testing-library. Tests the complete user flow.

**Use for**: CLI command output, full integration from CLI entry point to TUI render

**Limitations**: cli-testing-library doesn't support PTY/raw mode, so keyboard input tests belong in component tests instead.

**Example**: `tui.test.ts` - spawns `node dist/cli/index.js tui --ci`

### When to Write Which Test

| Scenario | Test Type |
|----------|-----------|
| New utility/formatter function | Unit |
| New TUI keyboard shortcut | Component (ink-testing-library) |
| New CLI command output | E2E |
| Daemon/proxy behaviour | Integration |
| Data persistence | Unit (SQLite with temp file) |

### Running Tests

```bash
npm test                           # All tests
npm run test:unit                  # Unit tests only (co-located in src/)
npm run test:int                   # Integration tests only
npm test -- src/daemon/proxy.test  # Specific file
npm run test:watch                 # Watch mode
```

Always run the full verification suite after making changes:
```bash
npm run typecheck && npm run lint && npm test
```

## Key Files

| Path | Purpose |
|------|---------|
| `src/cli/index.ts` | CLI entry point |
| `src/cli/commands/` | Command implementations |
| `src/daemon/` | Proxy daemon (mockttp, control API) |
| `src/tui/` | ink TUI components |
| `src/shared/project.ts` | Project root detection, .procsi paths |
| `src/shared/daemon.ts` | Daemon lifecycle management |

## Code Quality Guidelines

Rules derived from the [2026-02-05 code review](docs/reviews/2026-02-05/code-review.md). Follow these when writing new code.

### React/Ink

- **Always clean up timers and subscriptions.** Every `setTimeout`, `setInterval`, or event listener set inside a component or hook MUST have a corresponding cleanup in a `useEffect` return or equivalent. Store timer IDs in refs and clear them on unmount.
- **Use refs for values accessed in stable callbacks.** When a `useCallback` with an empty dependency array (or an event handler that shouldn't change identity) needs the latest value of state/props, sync that value into a ref via a separate effect. Never close over stale state in scroll/wheel/keyboard handlers.
- **Wrap list item components in `React.memo()`.** Any component rendered inside a `.map()` or list should be memoised to avoid unnecessary re-renders.
- **Calculate new state before using it.** When toggling state and also calling a side-effect with the new value, compute the new value first, then pass it to both `setState` and the side-effect — don't read state after setting it (stale closure).

### TypeScript

- **Never trust `JSON.parse` output.** Always validate parsed JSON with a type guard or validation helper before using it. This applies to IPC messages, API responses, and stored data.
- **Never use `as` casts on external data.** Data from the network, database, or user input must be validated at runtime. Use validation helpers (`requireString()`, `optionalNumber()`, etc.) instead of type assertions.
- **Use typed handler maps, not `Record<string, Handler>`.** Define explicit interfaces enumerating valid keys. Use `in` guards before indexing into handler maps.
- **Use named interfaces for database row shapes.** Even for internal databases, define `DbFooRow` interfaces rather than inline type assertions.

### Code Completeness

- **No magic numbers.** Extract numeric literals into named constants (e.g. `DEFAULT_QUERY_LIMIT`, `CONTROL_TIMEOUT_MS`). This includes timeouts, limits, port numbers, buffer sizes, etc.
- **No hardcoded versions.** Always read versions programmatically (e.g. from `package.json` or a `getVersion()` helper).
- **Wrap fallible operations in try-catch.** `URL` constructors, `JSON.parse`, file system operations — anything that can throw on bad input needs error handling.
- **Don't swallow errors silently.** Catch blocks must either re-throw, log meaningfully, or return a sensible default with a comment explaining why silence is acceptable.
- **Delete dead code.** Don't leave unused components, functions, or imports in the codebase. If it's not referenced, remove it.

### Security

- **Sanitise user-provided strings** that will be interpolated into shell commands, filenames, or SQL. Use proper escaping libraries rather than hand-rolled regex.
- **Bound all buffers.** Any buffer that accumulates data from an external source (sockets, streams) must have a maximum size. Disconnect or error when exceeded.
- **Use parameterised queries** for all SQL (already done — keep it that way).

### Performance

- **Only fetch what you need from the database.** Use column lists instead of `SELECT *`. For list views, create summary queries that exclude large fields (bodies, headers).
- **Clean up Maps/Sets that track in-flight operations.** If entries are added on request start and removed on completion, add periodic cleanup for entries where completion never fires (timeouts, dropped connections).
- **Prefer async I/O on the hot path.** Avoid `fs.*Sync` methods in code that runs frequently (e.g. logging). Use buffered writes or streams instead.
- **Minimise listener count in lists.** Use event delegation on the parent rather than attaching per-item handlers when rendering large lists.

### Project Organisation

- **Respect the module boundary: `shared/` must not import from `daemon/` or `cli/`.** Shared code is consumed by both layers; it cannot depend on either.
- **Keep components under ~250 lines.** When a component grows beyond this, extract sub-components or content renderers into separate files.
- **Extract repeated patterns into helpers.** If the same error-handling, setup, or teardown pattern appears in 3+ places, extract it (e.g. `requireProjectRoot()`, `getErrorMessage()`).

### Testing

- **Every new TUI component or keyboard shortcut needs a component test** using ink-testing-library.
- **Every new utility/formatter function needs unit tests**, including edge cases (zero values, negative numbers, empty strings, boundary values).
- **Don't write "coverage theatre" tests** that simply assert types exist or interfaces compile. Tests must exercise behaviour.
- **Test error paths, not just happy paths.** Include tests for malformed input, missing data, timeouts, and concurrent operations.

## Version Control — GitButler Virtual Branches

This repo uses **GitButler virtual branches**, which allow multiple features to be developed in parallel within the same workspace without polluting each other's history. The GitButler MCP server is available for managing branches.

### Workflow

- When a feature or task is complete, prompt the user and ask whether to **create a new virtual branch** or **add to an existing one**.
- Never commit without asking first — always confirm with the user before using the GitButler MCP to update branches.
- Use `mcp__gitbutler__gitbutler_update_branches` to assign changes to virtual branches with a summary of what changed and why.

## Development Notes

- The daemon runs as a child process and communicates via Unix socket
- mockttp handles CA certificate generation automatically
- Sessions are tracked by parent PID for automatic cleanup
- The TUI connects to the daemon's control socket for live updates

## Release Process

To publish a new version:
```bash
npm version patch  # or minor/major
git push && git push --tags
```

CI will automatically publish to npm on version tags (requires `NPM_TOKEN` secret in GitHub).

## Repository

- **npm**: https://www.npmjs.com/package/procsi
- **GitHub**: https://github.com/mtford90/procsi
