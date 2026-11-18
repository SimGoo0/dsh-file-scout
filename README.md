# dsh-file-scout

A DeepSeek Harness plugin that turns the host's packaged **ripgrep** into an
IDEA-style file palette for the Web GUI: one floating panel over your
workspace, opened from anywhere with two shortcuts.

- **Double Shift — the palette**: IDEA-style, opens over anything you are
  doing; `Tab` switches between name and content mode.
- **Name mode**: `rg --files` lists the workspace (native
  `.gitignore` rules apply), the query filters file names — or full relative
  paths when it contains `/`.
- **Content mode**: full ripgrep line matching with literal
  or regex queries, per-file grouped results with line numbers, `Aa` case and
  `.*` regex toggles, and an editable exclude-glob box.
- **Open at the line**: Enter or a click hands the file to
  **dsh-better-sidebar**'s editor with the 1-based match line, so search and
  reading stay in one surface.

Compared with walking the tree in JavaScript, the packaged rg binary makes
both searches fast and depth-independent, and the caps (100k listed files,
400 results, 30s deadline) are reported honestly as truncation.

## Requirements

- `dsh-better-sidebar` ≥ 0.4.0 — results open through its editor service.
  Without it the palette still searches but cannot open files.
- The packaged ripgrep binary from the Desktop installation; a plain `rg` on
  PATH is the fallback.

## Keys

| Action | Keys |
| --- | --- |
| Open the palette | **Double Shift** (IDEA-style) or a key recorded in Settings |
| Move selection | `↑` / `↓` |
| Open the selected result | `Enter` |
| Switch name/content mode | `Tab` |
| Close | `Esc`, the ✕ button, or a click outside |

The Double Shift detection is the plugin's own capture-phase keydown listener
(two Shift presses within 350 ms, no other key between, auto-repeat ignored)
and claims no binding in DSH's shortcut registry, so it cannot collide with
an official binding.

## Settings → 搜索设置 (Search settings)

The plugin contributes its own settings page with two groups:

- **快捷键 (Shortcuts)** — record a key combination for 文件搜索 (name search)
  and 文本搜索 (content search), and switch double-Shift on or off.
- **搜索内容 (Search scope)** — include hidden files (`.idea`, `.vscode`, …;
  on by default) and the comma-separated exclude globs used by ripgrep
  (default `node_modules,dist,build,.gradle`).

Everything is persisted in the browser's `localStorage` and applies the next
time the palette opens. The exclude box inside the palette writes to the same
setting.

## Install

**From this Git repository** (no npm account needed):

```sh
dsh plugin --profile <your-profile> add github:wrchuan/dsh-file-scout
```

**From a local directory**: in DSH open **Settings → Plugins → Add plugin** and
point it at this package directory, or

```sh
dsh plugin --profile desktop add <this directory>
```

**From the packed tarball**: `npm pack` in this directory, move the `.tgz` to
the target machine, then `dsh plugin add <path-to.tgz>`.

`dsh-better-sidebar` ≥ 0.4.0 is required for opening files at the match line;
without it the palette still searches and says so in the footer.

## How it works

The Host half serves `POST /file-scout/roots` and `POST /file-scout/search`
over a webServer prefix route (loopback/origin trust fence) and spawns the
packaged ripgrep with `node:child_process` — the same binary the built-in
Files sidebar search uses. The Client half registers one occupant in the
`shell.overlay` slot and talks to the route with same-origin `fetch`.
Everything is read-only.

MIT licensed.
