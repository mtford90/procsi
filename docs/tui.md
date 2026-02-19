# TUI

[Back to README](../README.md) | [CLI Reference](cli-reference.md)

Open the interactive TUI with `procsi tui`.

`j`/`k` to navigate, `Tab` to switch panels, `/` to filter, `c` to copy as curl, `Enter` to inspect bodies, `q` to quit.

Mouse support: click to select, scroll to navigate, click panels to focus.

## Main View

| Key                 | Action                                                                     |
| ------------------- | -------------------------------------------------------------------------- |
| `j`/`k` or `↑`/`↓`  | Navigate up/down                                                           |
| `g` / `G`           | Jump to first / last item                                                  |
| `Ctrl+u` / `Ctrl+d` | Half-page up / down                                                        |
| `Ctrl+f` / `Ctrl+b` | Full-page down / up                                                        |
| `Tab` / `Shift+Tab` | Next / previous panel                                                      |
| `1`-`5`             | Jump to section (list / request / request body / response / response body) |
| `Enter`             | Open body in full-screen viewer                                            |
| `/`                 | Open filter bar                                                            |
| `u`                 | Toggle full URL display                                                    |
| `c`                 | Copy request as curl                                                       |
| `y`                 | Copy body to clipboard                                                     |
| `s`                 | Export body (opens export modal)                                           |
| `H`                 | Export all as HAR                                                          |
| `r`                 | Refresh                                                                    |
| `?`                 | Help                                                                       |
| `i`                 | Proxy connection info                                                      |
| `q`                 | Quit                                                                       |

## Filter Bar (`/`)

| Key                 | Action                                                               |
| ------------------- | -------------------------------------------------------------------- |
| `Tab` / `Shift+Tab` | Cycle between search, method, status, saved, source fields                |
| `←` / `→`           | Cycle method/status/saved values when those fields are focused             |
| `Return`            | Close filter bar (filters are already applied live while typing)           |
| `Esc`               | Cancel and revert to the pre-open filter state                             |

Search field supports:

- URL search (default): `users api` or regex literal `/users\\/\\d+/i`
- Body search (both): `body:error`
- Request-body only: `body:req:error` (or `body:request:error`)
- Response-body only: `body:res:error` (or `body:response:error`)

Tip: when you type a `body:` filter, the `body:` prefix (and `req:`/`res:` target when present) is highlighted in the filter bar.

## JSON Explorer (Enter on a JSON body)

| Key         | Action                |
| ----------- | --------------------- |
| `j`/`k`     | Navigate nodes        |
| `Enter`/`l` | Expand/collapse node  |
| `h`         | Collapse node         |
| `e` / `c`   | Expand / collapse all |
| `/`         | Filter by path        |
| `n` / `N`   | Next / previous match |
| `y`         | Copy value            |
| `q` / `Esc` | Close                 |

## Text Viewer (Enter on a non-JSON body)

| Key         | Action                |
| ----------- | --------------------- |
| `j`/`k`     | Scroll line by line   |
| `Space`     | Page down             |
| `g` / `G`   | Top / bottom          |
| `/`         | Search text           |
| `n` / `N`   | Next / previous match |
| `y`         | Copy to clipboard     |
| `q` / `Esc` | Close                 |

## Export

### Copy as curl

Press `c` to copy a request as curl:

```bash
curl -X POST 'https://api.example.com/users' \
  -H 'Content-Type: application/json' \
  -H 'Authorization: Bearer token123' \
  -d '{"name": "test"}'
```

### Export as HAR

Press `H` to export all requests as a HAR file. Compatible with browser dev tools.

### Export body

Press `s` on a body to open the export modal — clipboard, `.procsi/exports/`, `~/Downloads/`, custom path, or open in default application.
