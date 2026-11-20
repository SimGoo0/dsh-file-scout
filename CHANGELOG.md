# Changelog

All notable changes to `dsh-file-scout` are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [0.2.2] - 2026-11-20

### Changed

- The type filter is a free-text mask box styled after IDEA's file mask:
  a label, a text input (`*.java, *.xml`) and a caret that opens a suggestion
  list drawn from the scan. Typing is authoritative — you can name a type the
  scan has not seen yet — and no file counts are shown anywhere.

## [0.2.1] - 2026-11-20

### Changed

- The file-type filter is now a dropdown instead of a chip strip. Common
  extensions (java, html, css, vue, js, ts, xml, sql, json, md, doc/docx,
  xls/xlsx, pdf, images, …) come first in a fixed order, with every other
  extension found by the scan grouped under "其他类型" and ordered by count.
  Each option shows its file count; the ⟳ rescan button stays.

## [0.2.0] - 2026-11-20

### Added

- **File-type filter.** The palette scans the workspace once (cached per
  workspace for a day, refreshable with ⟳) and buckets files by extension.
  A chip row shows the top types with their counts; picking one narrows the
  search to `--glob '*.ext'`, so ripgrep walks only those files instead of the
  whole tree. The chosen type applies to both name and content search.
- Host endpoint `POST /file-scout/types` returning `{ total, types: [{ext, count}] }`
  for the scan, and `types` accepted by the search endpoint.

### Changed

- Name-mode rows show the file path again (grey, right after the file name and
  type badge), truncated with a full-path tooltip; the path scrolls on hover.

## [0.1.2] - 2026-11-19

### Changed

- Recent searches are scoped to the active mode: the name tab lists only name
  searches, the content tab only content searches. The same filter applies to
  the suggestion chips shown while typing.
- The clear button now clears only the current mode's history; the other
  mode's entries are kept.
- The input placeholder no longer mentions the double-Shift shortcut
  (`按文件名或路径搜索…` / `按内容搜索，支持正则…`). The footer still lists the keys.

### Fixed

- `package.json` was briefly written with a UTF-8 BOM, which strict JSON
  parsers (including the DSH manifest reader) reject. The BOM is removed.

## [0.1.1] - 2026-11-19

### Changed

- Removed the duplicated empty-state hint: the status line stays empty until a
  query runs, and the results area renders nothing when there is no history to
  show. Previously `输入以开始搜索` appeared twice.

## [0.1.0] - 2026-11-18

### Added

- IDEA-style floating palette opened with a double Shift press, registered into
  the `shell.overlay` slot; draggable header and eight-direction resize grips.
- Name search over the workspace via the packaged ripgrep (`rg --files`), with
  workspace-relative paths and result rows showing the file name plus a type
  badge.
- Content search via `rg -n` with regex, case, and hidden-file toggles and an
  editable exclude-glob box; results are grouped per file with line numbers and
  highlighted matches.
- Opening a result hands the file to `dsh-better-sidebar`'s editor; content
  matches pass `line`/`lineEnd` so the editor lands on the match line and
  flashes it.
- An `@` action on each result inserts the file as a reference chip into the
  session composer (falls back to appending `@path` text).
- Per-workspace search history (20 entries) in `localStorage`, with a clear
  action.
- Settings → 搜索设置 page: record shortcuts for name/content search, switch
  double Shift on or off, toggle hidden files, and edit the exclude list. All
  values persist in `localStorage`.
- Host half serving `POST /file-scout/roots` and `POST /file-scout/search` on a
  webServer prefix route behind a loopback/origin fence, spawning the packaged
  ripgrep with bounded budgets (100k listed files, 400 results, 30 s deadline)
  and reporting truncation plus rg diagnostics honestly.

[0.2.2]: https://github.com/SimGoo0/dsh-file-scout/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/SimGoo0/dsh-file-scout/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/SimGoo0/dsh-file-scout/compare/v0.1.2...v0.2.0
[0.1.2]: https://github.com/SimGoo0/dsh-file-scout/compare/v0.1.1...v0.1.2
[0.1.1]: https://github.com/SimGoo0/dsh-file-scout/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/SimGoo0/dsh-file-scout/releases/tag/v0.1.0
