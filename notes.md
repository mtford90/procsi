# Research Notes: procsi

## Final Architecture

### Project-scoped isolation
Each project gets its own `.procsi/` directory containing:
- `proxy.port` - TCP port the proxy listens on
- `control.sock` - Unix socket for TUI <-> daemon communication
- `requests.db` - SQLite database of captured traffic
- `ca.pem` - CA certificate for HTTPS interception

### Why this design?
- Works naturally with zellij sessions per project
- Complete isolation between client projects
- Data lives with the project (gitignore-able)
- No cross-contamination of traffic
- Unix socket = no port conflicts for control API

## Node.js Dependencies

### CLI
- `commander` - Simple, widely used CLI framework
- Alternative: `oclif` - More batteries-included, but heavier

### TUI
- `ink` - React for CLIs, maintained by Sindre Sorhus
- `ink-testing-library` - Testing utilities for ink
- React-like model: components, hooks, etc.

### Proxy
- `mockttp` - HTTP Toolkit's own MITM proxy library
  - Handles CA certificate generation
  - HTTPS interception
  - Request/response hooks
  - Battle-tested

### Storage
- `better-sqlite3` - Synchronous SQLite (fast, simple API)
- Alternative: `sql.js` (pure JS, no native deps, but slower)

### Testing
- `vitest` - Fast, modern test runner with great TS support

### Distribution
- `pkg` - Compile Node.js to standalone binary
- ~~`bun compile`~~ - mockttp incompatible with Bun runtime

## mockttp Usage

```typescript
import * as mockttp from 'mockttp';

const proxy = mockttp.getLocal({
  https: {
    keyPath: './key.pem',
    certPath: './cert.pem',
  }
});

await proxy.start(8080);

// Intercept all requests
await proxy.forAnyRequest().thenPassThrough({
  beforeRequest: (req) => {
    console.log(`${req.method} ${req.url}`);
    // Save to SQLite here
    return req;
  },
  beforeResponse: (res) => {
    // Capture response
    return res;
  }
});
```

## ink TUI Example

```tsx
import React, { useState } from 'react';
import { render, Box, Text, useInput } from 'ink';

const App = () => {
  const [selected, setSelected] = useState(0);

  useInput((input, key) => {
    if (input === 'j' || key.downArrow) setSelected(s => s + 1);
    if (input === 'k' || key.upArrow) setSelected(s => s - 1);
  });

  return (
    <Box flexDirection="row">
      <Box flexDirection="column" width="50%">
        <Text>Requests</Text>
        {/* Request list */}
      </Box>
      <Box flexDirection="column" width="50%">
        <Text>Details</Text>
        {/* Request details */}
      </Box>
    </Box>
  );
};

render(<App />);
```

## Environment Variables to Set

```bash
# procsi intercept output (eval'd by user via shell function)
export HTTP_PROXY="http://127.0.0.1:9847"
export HTTPS_PROXY="http://127.0.0.1:9847"
export SSL_CERT_FILE="/Users/x/project/.procsi/ca.pem"
export NODE_EXTRA_CA_CERTS="/Users/x/project/.procsi/ca.pem"
export REQUESTS_CA_BUNDLE="/Users/x/project/.procsi/ca.pem"
export PROCSI_SESSION_ID="abc123"
export PROCSI_LABEL="my-session"
echo "procsi: intercepting traffic (label: my-session)"
```

## SQLite Schema

```sql
CREATE TABLE requests (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    label TEXT,
    timestamp INTEGER NOT NULL,
    method TEXT NOT NULL,
    url TEXT NOT NULL,
    host TEXT NOT NULL,
    path TEXT NOT NULL,
    request_headers TEXT,  -- JSON
    request_body BLOB,
    response_status INTEGER,
    response_headers TEXT,  -- JSON
    response_body BLOB,
    duration_ms INTEGER,
    created_at INTEGER DEFAULT (unixepoch())
);

CREATE INDEX idx_requests_timestamp ON requests(timestamp DESC);
CREATE INDEX idx_requests_session ON requests(session_id);
CREATE INDEX idx_requests_label ON requests(label);
```

## Export Formats

### curl
```bash
curl -X POST 'https://api.example.com/users' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer xxx' \
  -d '{"name": "test"}'
```

### HAR (HTTP Archive)
mockttp can export to HAR format directly.

## TUI Layout

```
┌─ Requests ─────────────────────┬─ Details ──────────────────────┐
│ ● POST /api/users      200  5ms│ Request                        │
│   GET  /api/users/1    200  3ms│ POST /api/users HTTP/1.1       │
│   GET  /static/app.js  200 12ms│ Host: api.example.com          │
│   GET  /api/health     200  1ms│ Content-Type: application/json │
│                                │                                │
│                                │ {"name": "test"}               │
│                                │                                │
│                                │ Response                       │
│                                │ HTTP/1.1 200 OK                │
│                                │ Content-Type: application/json │
│                                │                                │
│                                │ {"id": 1, "name": "test"}      │
├────────────────────────────────┴────────────────────────────────┤
│ j/k: navigate  enter: select  tab: switch pane  c: curl  q: quit│
└─────────────────────────────────────────────────────────────────┘
```

## Key Bindings

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down in list |
| `k` / `↑` | Move up in list |
| `enter` | Select request |
| `tab` | Switch between panes |
| `c` | Copy as curl |
| `h` | Export as HAR |
| `/` | Filter |
| `q` | Quit |
| `?` | Help |

## Project Structure (Draft)

```
procsi/
├── src/
│   ├── cli/
│   │   ├── index.ts          # CLI entry point
│   │   ├── commands/
│   │   │   ├── init.ts
│   │   │   ├── intercept.ts
│   │   │   ├── tui.ts
│   │   │   ├── status.ts
│   │   │   └── stop.ts
│   ├── daemon/
│   │   ├── index.ts          # Daemon entry point
│   │   ├── proxy.ts          # mockttp setup
│   │   ├── storage.ts        # SQLite operations
│   │   └── control.ts        # Unix socket API
│   ├── tui/
│   │   ├── App.tsx           # Main ink component
│   │   ├── components/
│   │   │   ├── RequestList.tsx
│   │   │   ├── RequestDetail.tsx
│   │   │   └── StatusBar.tsx
│   │   └── hooks/
│   │       └── useRequests.ts
│   ├── shared/
│   │   ├── types.ts
│   │   ├── project.ts        # Project root detection
│   │   └── export.ts         # curl/HAR formatters
├── tests/
│   ├── unit/
│   ├── integration/
│   └── shell/
├── package.json
├── tsconfig.json
└── vitest.config.ts
```
