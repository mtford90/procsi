# Task Plan: procsi - Terminal HTTP Toolkit

## Goal
Create a terminal-based HTTP interception/inspection tool with project-scoped isolation and a lazygit-style TUI

## Architecture

```
~/projects/client-a/
├── .procsi/
│   ├── proxy.port        # TCP port for HTTP_PROXY
│   ├── control.sock      # Unix socket for TUI <-> daemon
│   ├── requests.db       # SQLite - captured traffic
│   └── ca.pem            # CA certificate
└── src/...

┌─────────────────────────────────────────────────────────┐
│              procsi daemon (per-project)                  │
│  ├── MITM proxy (mockttp) on TCP port                   │
│  ├── SQLite storage for requests                        │
│  └── Control API on Unix socket                         │
└─────────────────────────────────────────────────────────┘
        ↑                                    ↑
   HTTP_PROXY                          Unix socket
        ↑                                    ↑
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ Terminal 1     │  │ Terminal 2     │  │ procsi tui       │
│ $ curl ...     │  │ $ npm install  │  │ (view traffic) │
│ --label=api    │  │ --label=deps   │  │                │
└────────────────┘  └────────────────┘  └────────────────┘
```

## Commands

| Command | Description |
|---------|-------------|
| `procsi init` | Output shell function for .zshrc/.bashrc (one-time setup) |
| `procsi intercept` | Intercept current shell (via shell function) |
| `procsi intercept --label=X` | With custom label |
| `procsi tui` | Browse captured traffic |
| `procsi status` | Show daemon status |
| `procsi stop` | Stop the daemon |

### Shell setup (one-time)
```bash
# Add to .zshrc / .bashrc
eval "$(procsi init)"
```

Then `procsi intercept` just works - no eval needed at call time.

## Technology Stack

- **Language**: TypeScript
- **Runtime**: Node.js (>=20)
- **CLI framework**: commander
- **TUI**: ink (React-like terminal UI)
- **Proxy**: mockttp (HTTP Toolkit's own library)
- **Storage**: better-sqlite3
- **Distribution**: npm package (pkg doesn't support ESM with top-level await used by ink/yoga-layout)
- **Testing**: Vitest

## Phases
- [x] Phase 1: Research
- [x] Phase 2: Architecture design
- [x] Phase 3: Implementation
- [ ] Phase 4: Polish & release

## Testing Strategy

**Framework:** Vitest

| Layer | Tools | What we test |
|-------|-------|--------------|
| Unit | vitest | Pure functions, SQLite repo, formatting |
| Integration | vitest, temp ports | Daemon lifecycle, proxy interception, control API |
| Shell | Bash scripts invoked by vitest | `procsi init`, `procsi intercept`, full flow |
| TUI | ink-testing-library | Component rendering, keyboard handling |

**Test execution:**
```bash
pnpm test           # run all tests
pnpm test:unit      # unit only
pnpm test:int       # integration only
pnpm test:shell     # shell script tests
```

## Implementation Checklist

### Phase 3a: Project scaffold ✅
- [x] Initialise Node.js project with TypeScript
- [x] Set up CLI structure (commander)
- [x] Create basic command stubs (init, intercept, tui, status, stop)
- [x] Set up Vitest
- [x] Add package.json scripts (build, test, lint)
- [x] Set up ESLint + Prettier

### Phase 3b: Core daemon ✅
- [x] Project root detection (find .procsi or git root)
- [x] Daemon lifecycle (start, stop, health check via child_process)
- [x] Port allocation (find free port, write to .procsi/proxy.port)
- [x] Unix socket control server (net module)
- [x] CA certificate generation (mockttp handles this)
- [x] MITM proxy with mockttp
- [x] Request/response capture to SQLite
- [x] **Tests:**
  - [x] Unit: project root detection logic (18 tests)
  - [x] Unit: SQLite repository (15 tests)
  - [x] Integration: daemon start/stop lifecycle
  - [x] Integration: make HTTP request through proxy, verify captured
  - [x] Integration: control API via Unix socket

### Phase 3c: Shell integration ✅
- [x] `procsi init` - output shell function for zsh/bash
- [x] `procsi intercept` - output env var exports (HTTP_PROXY, HTTPS_PROXY, CA vars)
- [x] Auto-start daemon if needed
- [x] Label support (--label flag)
- [x] Register session with daemon
- [x] **Tests:**
  - [x] Unit: env var output formatting
  - [x] Shell script: source `procsi init`, verify function exists
  - [x] Shell script: `procsi intercept` sets correct env vars
  - [x] Shell script: full flow - intercept → curl → verify captured

### Phase 3d: TUI ✅
- [x] Basic ink app structure
- [x] Two-panel layout (request list | details)
- [x] Request list with method, URL, status, timing
- [x] Request detail view (headers, body)
- [x] Response detail view
- [x] Keyboard navigation (j/k, enter, tab)
- [x] Export to curl (c key)
- [x] Export to HAR (h key)
- [x] Live updates (new requests appear)
- [x] Filter by label
- [x] **Tests:**
  - [x] Unit: curl export formatting
  - [x] Unit: HAR export formatting
  - [x] ink-testing-library: keyboard navigation
  - [x] ink-testing-library: selecting request shows details

### Phase 3e: Quality of life ✅
- [x] `procsi status` command
- [x] `procsi stop` command
- [x] Graceful shutdown (SIGTERM/SIGINT handlers)
- [x] Proper error messages (daemon startup errors now surface log output)
- [x] `procsi clear` command
- [x] **Tests:**
  - [x] Integration: status reports correct state
  - [x] Integration: stop cleanly shuts down daemon
  - [x] Shell: clear command clears requests

### Phase 3f: Distribution ✅
- [x] Configure npm package (package.json with files, prepublishOnly)
- [x] Test npm global install works
- [ ] Publish to npm (when ready)
- [ ] Homebrew formula (future - would require standalone binary)

## Decisions Made
- Project-scoped isolation via .procsi directory
- Unix socket for control API (no port conflicts)
- TCP for proxy (HTTP_PROXY requirement)
- SQLite for persistence
- Auto-start daemon on intercept
- Node.js + TypeScript (user expertise)
- mockttp for proxy (same as HTTP Toolkit)
- npm package distribution (pkg doesn't support ESM with top-level await used by ink/yoga-layout)

## Status
**Phase 3 Complete** - Ready for Phase 4 (Polish & release)
