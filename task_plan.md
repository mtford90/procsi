# Task Plan: htpx - Terminal HTTP Toolkit

## Goal
Create a terminal-based HTTP interception/inspection tool with project-scoped isolation and a lazygit-style TUI

## Architecture

```
~/projects/client-a/
├── .htpx/
│   ├── proxy.port        # TCP port for HTTP_PROXY
│   ├── control.sock      # Unix socket for TUI <-> daemon
│   ├── requests.db       # SQLite - captured traffic
│   └── ca.pem            # CA certificate
└── src/...

┌─────────────────────────────────────────────────────────┐
│              htpx daemon (per-project)                  │
│  ├── MITM proxy (mockttp) on TCP port                   │
│  ├── SQLite storage for requests                        │
│  └── Control API on Unix socket                         │
└─────────────────────────────────────────────────────────┘
        ↑                                    ↑
   HTTP_PROXY                          Unix socket
        ↑                                    ↑
┌────────────────┐  ┌────────────────┐  ┌────────────────┐
│ Terminal 1     │  │ Terminal 2     │  │ htpx tui       │
│ $ curl ...     │  │ $ npm install  │  │ (view traffic) │
│ --label=api    │  │ --label=deps   │  │                │
└────────────────┘  └────────────────┘  └────────────────┘
```

## Commands

| Command | Description |
|---------|-------------|
| `htpx init` | Output shell function for .zshrc/.bashrc (one-time setup) |
| `htpx intercept` | Intercept current shell (via shell function) |
| `htpx intercept --label=X` | With custom label |
| `htpx tui` | Browse captured traffic |
| `htpx status` | Show daemon status |
| `htpx stop` | Stop the daemon |

### Shell setup (one-time)
```bash
# Add to .zshrc / .bashrc
eval "$(htpx init)"
```

Then `htpx intercept` just works - no eval needed at call time.

## Technology Stack

- **Language**: TypeScript
- **Runtime**: Node.js (>=20)
- **CLI framework**: commander (simple) or oclif (batteries-included)
- **TUI**: ink (React-like terminal UI)
- **Proxy**: mockttp (HTTP Toolkit's own library)
- **Storage**: better-sqlite3
- **Distribution**: pkg (mockttp incompatible with Bun)
- **Testing**: Vitest

## Phases
- [x] Phase 1: Research
- [x] Phase 2: Architecture design
- [ ] Phase 3: Implementation
- [ ] Phase 4: Polish & release

## Testing Strategy

**Framework:** Vitest

| Layer | Tools | What we test |
|-------|-------|--------------|
| Unit | vitest | Pure functions, SQLite repo, formatting |
| Integration | vitest, temp ports | Daemon lifecycle, proxy interception, control API |
| Shell | Bash scripts invoked by vitest | `htpx init`, `htpx intercept`, full flow |
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
- [x] Project root detection (find .htpx or git root)
- [x] Daemon lifecycle (start, stop, health check via child_process)
- [x] Port allocation (find free port, write to .htpx/proxy.port)
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

### Phase 3c: Shell integration
- [ ] `htpx init` - output shell function for zsh/bash
- [ ] `htpx intercept` - output env var exports (HTTP_PROXY, HTTPS_PROXY, CA vars)
- [ ] Auto-start daemon if needed
- [ ] Label support (--label flag)
- [ ] Register session with daemon
- [ ] **Tests:**
  - [ ] Unit: env var output formatting
  - [ ] Shell script: source `htpx init`, verify function exists
  - [ ] Shell script: `htpx intercept` sets correct env vars
  - [ ] Shell script: full flow - intercept → curl → verify captured

### Phase 3d: TUI
- [ ] Basic ink app structure
- [ ] Two-panel layout (request list | details)
- [ ] Request list with method, URL, status, timing
- [ ] Request detail view (headers, body)
- [ ] Response detail view
- [ ] Keyboard navigation (j/k, enter, tab)
- [ ] Export to curl (c key)
- [ ] Export to HAR (h key)
- [ ] Live updates (new requests appear)
- [ ] Filter by label
- [ ] **Tests:**
  - [ ] Unit: curl export formatting
  - [ ] Unit: HAR export formatting
  - [ ] ink-testing-library: keyboard navigation
  - [ ] ink-testing-library: selecting request shows details

### Phase 3e: Quality of life
- [ ] `htpx status` command
- [ ] `htpx stop` command
- [ ] Graceful shutdown
- [ ] Clear old requests command
- [ ] Proper error messages
- [ ] **Tests:**
  - [ ] Integration: status reports correct state
  - [ ] Integration: stop cleanly shuts down daemon

### Phase 3f: Distribution
- [ ] Build standalone binary (pkg or bun compile)
- [ ] Test on macOS
- [ ] Homebrew formula (future)

## Decisions Made
- Project-scoped isolation via .htpx directory
- Unix socket for control API (no port conflicts)
- TCP for proxy (HTTP_PROXY requirement)
- SQLite for persistence
- Auto-start daemon on intercept
- Node.js + TypeScript (user expertise)
- mockttp for proxy (same as HTTP Toolkit)
- pkg for distribution (mockttp incompatible with Bun)

## Status
**Awaiting approval** - Ready to start implementation
