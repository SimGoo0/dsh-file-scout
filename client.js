/**
 * dsh-file-scout — Client half: the global command palette.
 *
 * One occupant in the frame-wide `shell.overlay` slot plus one trigger beside
 * the sidebar's settings gear. Double Shift opens it (IDEA-style; own
 * capture-phase listener, no DSH registry binding).
 *
 * UI: draggable header, bottom-right resize grip, a segmented name/content
 * switch, workspace-scoped per-workspace history (localStorage, 20 entries),
 * and click-to-open in dsh-better-sidebar's editor with the match line
 * highlighted.
 *
 * Transport: same-origin POST /file-scout/{roots,search}.
 */
window.__ModuleLoader__.load({
  id: 'dsh-file-scout',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useEffect, useMemo, useRef, useState, useCallback } = React
    let SearchIcon = null
    try {
      const UiPrimitives = require('@deepseek-ai/dsh-client-ui-primitives') || {}
      SearchIcon = UiPrimitives.IconSearchOutlineRegular || UiPrimitives.IconSearchOutline || null
    } catch {
      // Optional seed module; a text glyph stands in.
    }

    const NS = 'fileScout'
    const OPEN_EVENT = 'dsh-file-scout:open'
    /** Common extensions listed first in the type picker, in this order. */
    const COMMON_TYPES = [
      'java', 'html', 'css', 'vue', 'js', 'ts', 'jsx', 'tsx', 'xml', 'sql', 'json', 'md',
      'yml', 'yaml', 'properties', 'jsp', 'ftl', 'py', 'sh', 'bat',
      'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'txt',
      'png', 'jpg', 'jpeg', 'gif', 'svg',
    ]
    const MIN_W = 460
    const MIN_H = 300
    const DEFAULT_W = 860
    const DEFAULT_H = 540

    function requestOpen(mode) {
      try {
        window.dispatchEvent(new CustomEvent(OPEN_EVENT, { detail: { mode: mode === 'content' ? 'content' : 'name' } }))
      } catch {
        // Hidden window; nothing to open.
      }
    }

    const DICTS = {
      zh: {
        title: '工作区速查',
        nameMode: '文件名',
        contentMode: '内容',
        placeholderName: '按文件名或路径搜索…',
        placeholderContent: '按内容搜索，支持正则…',
        caseToggle: '区分大小写',
        regexToggle: '正则表达式',
        hiddenToggle: '包含隐藏文件（.idea 等）',
        excludeLabel: '排除目录',
        hint: '双击 Shift 唤起 · ↑↓ 选择 · Enter 打开 · Tab 切模式 · Esc 关闭',
        noResults: '没有匹配结果',
        busy: '搜索中…',
        emptyQuery: '输入以开始搜索',
        noRoot: '没有可用的工作区',
        noSidebar: '未检测到 dsh-better-sidebar，无法打开文件',
        regexError: '正则表达式无效',
        scope: '范围',
        history: '最近搜索',
        clear: '清空',
        shortcutName: '文件搜索（File Scout）',
        shortcutContent: '文本搜索（File Scout）',
        settingsTitle: '搜索设置',
        settingsShortcutHead: '快捷键',
        settingsFileName: '文件搜索',
        settingsFileContent: '文本搜索',
        settingsRecord: '点击录制',
        settingsRecording: '按下组合键…（Esc 取消）',
        settingsNotSet: '未设置',
        settingsDoubleShift: '双击 Shift 唤起',
        settingsGroupKeys: '快捷键',
        settingsGroupScope: '搜索内容',
        settingsHidden: '包含隐藏文件（.idea 等）',
        settingsExclude: '排除目录（逗号分隔，rg glob）',
        settingsHint: '修改即时保存，下次打开面板生效；自定义快捷键与双击 Shift 可同时使用。',
        settingsReset: '恢复默认',
        reference: '发送到聊天框（@ 引用）',
        allTypes: '全部',
        commonTypes: '常用类型',
        otherTypes: '其他类型',
        typeLabel: '文件掩码',
        typeRescan: '重扫文件类型',
        typeScanning: '扫描类型中…',
      },
      en: {
        title: 'File Scout',
        nameMode: 'Name',
        contentMode: 'Content',
        placeholderName: 'Search files by name or path…',
        placeholderContent: 'Search contents, regex supported…',
        caseToggle: 'Match case',
        regexToggle: 'Regular expression',
        hiddenToggle: 'Include hidden files (.idea etc.)',
        excludeLabel: 'Exclude',
        hint: 'Double Shift to open · ↑↓ select · Enter open · Tab switch mode · Esc close',
        noResults: 'No matches',
        busy: 'Searching…',
        emptyQuery: 'Type to search',
        noRoot: 'No workspace available',
        noSidebar: 'dsh-better-sidebar not detected; files cannot open',
        regexError: 'Invalid regular expression',
        scope: 'Scope',
        history: 'Recent',
        clear: 'Clear',
        shortcutName: 'Search files by name (File Scout)',
        shortcutContent: 'Search file contents (File Scout)',
        settingsTitle: 'Search settings',
        settingsShortcutHead: 'Shortcuts',
        settingsFileName: 'Search by name',
        settingsFileContent: 'Search contents',
        settingsRecord: 'Record',
        settingsRecording: 'Press a key combination… (Esc cancels)',
        settingsNotSet: 'Not set',
        settingsDoubleShift: 'Open with double Shift',
        settingsGroupKeys: 'Shortcuts',
        settingsGroupScope: 'Search scope',
        settingsHidden: 'Include hidden files (.idea etc.)',
        settingsExclude: 'Exclude directories (comma-separated, rg globs)',
        settingsHint: 'Changes save immediately and apply the next time the palette opens; recorded keys and double Shift work together.',
        settingsReset: 'Reset to defaults',
        reference: 'Reference in chat (@)',
        allTypes: 'All',
        commonTypes: 'Common',
        otherTypes: 'Other',
        typeLabel: 'Mask',
        typeRescan: 'Rescan file types',
        typeScanning: 'Scanning types…',
      },
    }

    function pickDict() {
      try {
        if ((navigator.language || 'en').toLowerCase().startsWith('zh')) return DICTS.zh
      } catch {
        // Navigator unavailable.
      }
      return DICTS.en
    }

    // ── highlight helpers ────────────────────────────────────────────────────
    function highlightSegments(text, query, regexMode, caseSensitive) {
      const spans = []
      if (!query || query.trim() === '' || !text) return [{ text, hit: false }]
      if (regexMode) {
        let re
        try {
          re = new RegExp(query, (caseSensitive ? '' : 'i') + 'g')
        } catch {
          return [{ text, hit: false }]
        }
        let last = 0
        let m
        while ((m = re.exec(text)) !== null) {
          if (m[0].length === 0) {
            re.lastIndex += 1
            if (re.lastIndex > text.length) break
            continue
          }
          if (m.index > last) spans.push({ text: text.slice(last, m.index), hit: false })
          spans.push({ text: m[0], hit: true })
          last = m.index + m[0].length
          if (last >= text.length) break
        }
        if (last < text.length) spans.push({ text: text.slice(last), hit: false })
        return spans
      }
      const hay = caseSensitive ? text : text.toLowerCase()
      const needle = caseSensitive ? query : query.toLowerCase()
      let at = 0
      let idx
      while ((idx = hay.indexOf(needle, at)) !== -1) {
        if (idx > at) spans.push({ text: text.slice(at, idx), hit: false })
        spans.push({ text: text.slice(idx, idx + needle.length), hit: true })
        at = idx + needle.length
      }
      if (at < text.length) spans.push({ text: text.slice(at), hit: false })
      return spans
    }

    function Highlighted({ text, query, regexMode, caseSensitive }) {
      return h(React.Fragment, null,
        highlightSegments(text, query, regexMode, caseSensitive).map((s, i) =>
          s.hit ? h('span', { key: i, className: 'dfs-hl' }, s.text) : s.text))
    }

    // ── history (per workspace, localStorage) ────────────────────────────────
    const HISTORY_LIMIT = 20

    function historyKey(root) {
      return `file-scout:history:${root || ''}`
    }

    function loadHistory(root) {
      try {
        const raw = localStorage.getItem(historyKey(root))
        const parsed = raw ? JSON.parse(raw) : []
        if (!Array.isArray(parsed)) return []
        return parsed.filter((item) => item && typeof item.query === 'string').slice(0, HISTORY_LIMIT)
      } catch {
        return []
      }
    }

    function saveHistory(root, entries) {
      try {
        localStorage.setItem(historyKey(root), JSON.stringify(entries.slice(0, HISTORY_LIMIT)))
      } catch {
        // Storage full or disabled — history is a convenience only.
      }
    }

    // ── project type index (scanned once per workspace) ──────────────────────
    const TYPES_TTL = 24 * 60 * 60 * 1000

    function typesKey(root) {
      return `file-scout:types:${root || ''}`
    }

    function loadTypeIndex(root) {
      try {
        const raw = localStorage.getItem(typesKey(root))
        const parsed = raw ? JSON.parse(raw) : null
        if (!parsed || !Array.isArray(parsed.types)) return null
        return parsed
      } catch {
        return null
      }
    }

    function saveTypeIndex(root, value) {
      try {
        localStorage.setItem(typesKey(root), JSON.stringify({ ...value, at: Date.now() }))
      } catch {
        // The index is a cache; losing it only costs one rescan.
      }
    }

    function isTypeIndexStale(record) {
      return !record || typeof record.at !== 'number' || Date.now() - record.at > TYPES_TTL
    }

    // ── settings (persisted, shared by palette + settings page) ──────────────
    const SETTINGS_KEY = 'file-scout:settings'
    const DEFAULT_SETTINGS = {
      exclude: 'node_modules,dist,build,.gradle',
      doubleShift: true,
      includeHidden: true,
      nameKey: '',
      contentKey: '',
    }

    function readSettings() {
      try {
        const raw = localStorage.getItem(SETTINGS_KEY)
        const parsed = raw ? JSON.parse(raw) : {}
        return { ...DEFAULT_SETTINGS, ...(parsed && typeof parsed === 'object' ? parsed : {}) }
      } catch {
        return { ...DEFAULT_SETTINGS }
      }
    }

    let cachedSettings = null
    const settingsListeners = new Set()

    function currentSettings() {
      if (cachedSettings === null) cachedSettings = readSettings()
      return cachedSettings
    }

    function updateSettings(patch) {
      const next = { ...currentSettings(), ...patch }
      cachedSettings = next
      try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(next))
      } catch {
        // Persistence is best effort; the in-memory value still applies.
      }
      for (const listener of settingsListeners) {
        try {
          listener(next)
        } catch {
          // One broken listener must not block the rest.
        }
      }
      return next
    }

    function subscribeSettings(listener) {
      settingsListeners.add(listener)
      return () => settingsListeners.delete(listener)
    }

    /** Physical combination of one keydown as our stored shortcut string. */
    function comboOf(event) {
      const mods = []
      if (event.ctrlKey) mods.push('ctrl')
      if (event.altKey) mods.push('alt')
      if (event.shiftKey) mods.push('shift')
      if (event.metaKey) mods.push('meta')
      const key = typeof event.key === 'string' && event.key.length === 1 ? event.key.toLowerCase() : event.key
      return [...mods, key].join('+')
    }

    function formatCombo(combo) {
      if (typeof combo !== 'string' || combo === '') return ''
      return combo.split('+').map((part) => {
        if (part === 'ctrl') return 'Ctrl'
        if (part === 'alt') return 'Alt'
        if (part === 'shift') return 'Shift'
        if (part === 'meta') return 'Meta'
        if (part.length === 1) return part.toUpperCase()
        return part
      }).join(' + ')
    }

    // ── transport ────────────────────────────────────────────────────────────
    async function post(endpoint, payload) {
      const res = await fetch(`/file-scout/${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      })
      const body = await res.json().catch(() => null)
      if (!body) throw new Error(`HTTP ${res.status}`)
      if (!body.ok) throw new Error(body.error?.message || 'search failed')
      return body.value
    }

    /** Current session's workspace, best effort through client services. */
    function detectWorkspace(ctx) {
      try {
        const sidebar = ctx.get('betterSidebar')
        const snapshot = sidebar?.getSnapshot?.()
        const sessionId = snapshot?.sessionId
        if (sessionId) {
          const sessions = ctx.get('sessions')
          const record = sessions?.list?.getSnapshot?.()?.byId?.[sessionId]
          const cwd = record?.cwd ?? snapshot?.cwd
          if (typeof cwd === 'string' && cwd !== '') return { root: cwd, sessionId }
        }
      } catch {
        // Fall back to the host's workspace list.
      }
      return null
    }

    // ── @reference into the composer ─────────────────────────────────────────
    /** Absolute path relative to the workspace root, in `/` spelling. */
    function workspaceRelative(root, absPath) {
      if (typeof root !== 'string' || root === '') return undefined
      const normalize = (value) => String(value).replace(/\\/g, '/').replace(/\/+$/, '')
      const base = normalize(root)
      const target = normalize(absPath)
      if (target === base) return ''
      const prefix = `${base}/`
      const caseless = /^[A-Za-z]:\//.test(base) || base.startsWith('//')
      const head = target.slice(0, prefix.length)
      const same = caseless ? head.toLowerCase() === prefix.toLowerCase() : head === prefix
      return same ? target.slice(prefix.length) : undefined
    }

    /** Parse a free-text mask list (`*.java, xml`) into bare extensions. */
    function parseTypeMasks(text) {
      return String(text || '')
        .split(/[,;\s]+/u)
        .map((part) => part.trim().replace(/^\*?\.?/u, ''))
        .filter((ext) => /^[A-Za-z0-9_+-]{1,16}$/u.test(ext))
    }

    /** DSH `@` spelling for one relative path: quoted when it contains whitespace. */
    function mentionOf(relative) {      const target = String(relative).replace(/[\\/]+$/, '')
      if (/[\u0000-\u001f\u007f-\u009f"]/u.test(target)) return undefined
      return /\s/u.test(target) ? `@"${target}"` : `@${target}`
    }

    /**
     * Insert one file as an `@` reference chip in the session's composer.
     * Uses the host's own `insertReference` facade and degrades to appending
     * the plain mention when the chip channel is unavailable.
     * @returns { ok: boolean, reason?: string } — reasons are shown in the palette.
     */
    function referenceIntoChat(ctx, sessionId, root, absPath) {
      const fail = (reason) => {
        console.warn('[dsh-file-scout] reference insert failed:', reason)
        return { ok: false, reason }
      }
      if (!sessionId) return fail('未找到当前会话')
      const relative = workspaceRelative(root, absPath)
      if (relative === undefined || relative === '') return fail('文件不在当前工作区内')
      const mention = mentionOf(relative)
      if (mention === undefined) return fail('路径包含无法引用的字符')
      const label = relative.slice(relative.lastIndexOf('/') + 1)
      try {
        const actx = ctx?.get?.('sessions')?.scope?.(sessionId)
        if (!actx) return fail('会话未激活（sessions.scope 为空）')
        const conversation = ctx.get('conversation')
        if (!conversation) return fail('会话服务不可用（conversation）')
        const input = conversation.input?.for?.(actx)
        if (!input) return fail('输入框不可用（input）')
        const snapshot = input.state?.getSnapshot?.()
        if (!snapshot || snapshot.draftRev === undefined) return fail('输入框状态不可读')
        if (snapshot.phase === 'adjudicating' || snapshot.phase === 'submitting') return fail('输入框正在提交')
        const at = typeof snapshot.draft === 'string' ? snapshot.draft.length : 0
        if (typeof input.insertReference === 'function') {
          const applied = input.insertReference({
            source: 'reference',
            ref: mention,
            label,
            clipboardText: mention,
            appearance: 'file',
          }, { draftRev: snapshot.draftRev, start: at, end: at })
          if (applied) return { ok: true }
          console.warn('[dsh-file-scout] insertReference refused; falling back to text')
        }
        actx.emit?.('slash/input-insert-text', {
          text: `${mention} `,
          span: { draftRev: snapshot.draftRev, start: at, end: at },
        })
        return { ok: true }
      } catch (error) {
        return fail(`异常：${error?.message ?? String(error)}`)
      }
    }

    /** Best-effort current session id, shared by opening and referencing. */
    function resolveSessionId(ctx, root) {
      try {
        const snapshot = ctx.get('betterSidebar')?.getSnapshot?.()
        if (snapshot?.sessionId) return snapshot.sessionId
      } catch {
        // Continue with the workspace/session stores.
      }
      const normalize = (value) => String(value || '').replace(/\\/g, '/').replace(/\/+$/, '')
      try {
        const list = ctx.get('workspaces')?.list?.getSnapshot?.()
        const items = Array.isArray(list?.items) ? list.items : []
        const wanted = normalize(root)
        const workspace = items.find((item) => item && wanted !== '' && normalize(item.path) === wanted)
          ?? items[0]
        const ids = Array.isArray(workspace?.sessionIds) ? workspace.sessionIds : []
        if (ids.length > 0) return ids[ids.length - 1]
      } catch {
        // Continue with the session store.
      }
      try {
        const byId = ctx.get('sessions')?.list?.getSnapshot?.()?.byId ?? {}
        const ids = Object.keys(byId)
        if (ids.length > 0) return ids[ids.length - 1]
      } catch {
        // No session identity available.
      }
      return undefined
    }

    // ── palette ──────────────────────────────────────────────────────────────
    function Palette({ ctx }) {
      const t = useMemo(() => {
        const bound = ctx?.locale?.bind?.(NS)
        const fallback = pickDict()
        return bound ? (key) => bound(key) ?? fallback[key] ?? key : (key) => fallback[key] ?? key
      }, [ctx])

      const [open, setOpen] = useState(false)
      const [mode, setMode] = useState('name')
      const [query, setQuery] = useState('')
      const [caseSensitive, setCaseSensitive] = useState(false)
      const [regexMode, setRegexMode] = useState(false)
      const [includeHidden, setIncludeHidden] = useState(currentSettings().includeHidden !== false)
      const [exclude, setExclude] = useState(currentSettings().exclude)
      const [typeIndex, setTypeIndex] = useState(null)
      const [typeLoading, setTypeLoading] = useState(false)
      const [typeText, setTypeText] = useState('')
      const [typeOpen, setTypeOpen] = useState(false)
      const [root, setRoot] = useState(null)
      const [sessionId, setSessionId] = useState(null)
      const [busy, setBusy] = useState(false)
      const [error, setError] = useState(null)
      const [matches, setMatches] = useState(null)
      const [meta, setMeta] = useState(null)
      const [selected, setSelected] = useState(0)
      const [history, setHistory] = useState([])
      const [pos, setPos] = useState(null)
      const [size, setSize] = useState({ w: DEFAULT_W, h: DEFAULT_H })

      const inputRef = useRef(null)
      const listRef = useRef(null)
      const overlayRef = useRef(null)
      const searchToken = useRef(0)
      const dragRef = useRef(null)

      // ── open/focus/root ────────────────────────────────────────────────────
      useEffect(() => {
        const onOpen = (event) => {
          setMode(event.detail?.mode === 'content' ? 'content' : 'name')
          setOpen(true)
        }
        window.addEventListener(OPEN_EVENT, onOpen)
        return () => window.removeEventListener(OPEN_EVENT, onOpen)
      }, [])

      useEffect(() => {
        if (!open) return undefined
        setPos((current) => current ?? {
          x: Math.max(24, Math.round((window.innerWidth - size.w) / 2)),
          y: Math.max(48, Math.round(window.innerHeight * 0.1)),
        })
        const id = window.setTimeout(() => inputRef.current?.focus(), 0)
        return () => window.clearTimeout(id)
      }, [open, mode, size.w])

      useEffect(() => {
        if (!open) return undefined
        setExclude(currentSettings().exclude)
        setIncludeHidden(currentSettings().includeHidden !== false)
        let alive = true
        const detected = detectWorkspace(ctx)
        if (detected) {
          setSessionId(detected.sessionId)
          setRoot(detected.root)
          return () => {
            alive = false
          }
        }
        setSessionId(null)
        post('roots', {}).then((value) => {
          if (!alive) return
          setRoot(value.roots?.[0]?.path ?? '')
        }).catch(() => {
          if (alive) setRoot('')
        })
        return () => {
          alive = false
        }
      }, [open, ctx])

      // One scan per workspace (cached for a day) gives the type filter its
      // buckets; later searches pass the chosen extension straight to rg.
      const scanTypesNow = useCallback(() => {
        if (!root) return
        const snapshot = currentSettings()
        setTypeLoading(true)
        post('types', {
          root,
          includeHidden: snapshot.includeHidden !== false,
          exclude: snapshot.exclude,
        }).then((value) => {
          const record = { at: Date.now(), total: value.total, types: value.types }
          saveTypeIndex(root, record)
          setTypeIndex(record)
        }).catch((error) => {
          console.warn('[dsh-file-scout] type scan failed:', error?.message ?? error)
        }).finally(() => {
          setTypeLoading(false)
        })
      }, [root])

      useEffect(() => {
        if (!open || !root) {
          setTypeIndex(null)
          return undefined
        }
        const cached = loadTypeIndex(root)
        setTypeIndex(cached)
        if (isTypeIndexStale(cached)) scanTypesNow()
        return undefined
      }, [open, root, scanTypesNow])

      useEffect(() => {
        if (!open) return
        setHistory(loadHistory(root))
      }, [open, root])

      // ── search ─────────────────────────────────────────────────────────────
      useEffect(() => {
        if (!open || root === null || root === '' || query.trim() === '') {
          searchToken.current += 1
          setBusy(false)
          setError(null)
          setMatches(null)
          setMeta(null)
          return undefined
        }
        if (regexMode) {
          try {
            new RegExp(query) // eslint-disable-line no-new
          } catch {
            setError(t('regexError'))
            setMatches(null)
            setBusy(false)
            return undefined
          }
        }
        const token = searchToken.current + 1
        searchToken.current = token
        // Drop the other mode's stale rows immediately; otherwise a switch
        // renders content-shaped matches in name mode (empty names → a blank
        // block the size of the previous results).
        setMatches(null)
        setMeta(null)
        setSelected(0)
        setBusy(true)
        setError(null)
        const timer = window.setTimeout(() => {
          post('search', {
            root,
            mode,
            query: query.trim(),
            caseSensitive,
            regex: regexMode,
            includeHidden,
            exclude,
            types: parseTypeMasks(typeText),
          }).then((value) => {
            if (searchToken.current !== token) return
            setBusy(false)
            setMatches(value.matches)
            setMeta(value)
            setSelected(0)
            if (query.trim().length >= 2) {
              const entry = { query: query.trim(), mode, at: Date.now() }
              const next = [entry, ...loadHistory(root).filter((i) => !(i.query === entry.query && i.mode === entry.mode))]
              saveHistory(root, next)
              setHistory(next.slice(0, HISTORY_LIMIT))
            }
          }).catch((err) => {
            if (searchToken.current !== token) return
            setBusy(false)
            setMatches(null)
            setMeta(null)
            setError(err?.message ?? 'search failed')
          })
        }, 200)
        return () => window.clearTimeout(timer)
      }, [open, root, mode, query, caseSensitive, regexMode, includeHidden, exclude, typeText, t])

      // ── rows ───────────────────────────────────────────────────────────────
      const rows = useMemo(() => {
        if (!matches) return []
        if (mode === 'name') {
          return matches.map((m) => {
            const rel = m.name ?? ''
            const slash = rel.lastIndexOf('/')
            const base = slash === -1 ? rel : rel.slice(slash + 1)
            const dot = base.lastIndexOf('.')
            const ext = dot > 0 ? base.slice(dot + 1).toUpperCase() : ''
            return { path: m.path, base, ext }
          })
        }
        return matches.map((m) => ({ path: m.path, rel: m.rel, line: m.line, text: m.text }))
      }, [matches, mode])

      const openMatch = useCallback((row) => {
        if (!row) return
        const path = String(row.path ?? '').replace(/\\/g, '/')
        if (path === '') return
        const sidebar = ctx?.get?.('betterSidebar')
        if (!sidebar) return
        const title = path.slice(path.lastIndexOf('/') + 1)
        const options = typeof row.line === 'number' && row.line > 0
          ? { line: row.line, lineEnd: row.line }
          : undefined
        const scope = sessionId ? { sessionId } : undefined
        if (typeof sidebar.openFile === 'function') {
          sidebar.openFile(scope, path, title, options)
        } else if (typeof sidebar.openTab === 'function') {
          const seed = { type: 'editor', path, title }
          if (options) seed.line = options.line
          sidebar.openTab(seed)
        }
        setOpen(false)
      }, [ctx, sessionId])

      const move = (delta) => {
        if (rows.length === 0) return
        setSelected((current) => (current + delta + rows.length) % rows.length)
      }

      useEffect(() => {
        const list = listRef.current
        if (!list) return
        list.querySelector(`[data-idx="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
      }, [selected, rows])

      const runHistory = (item) => {
        setMode(item.mode === 'content' ? 'content' : 'name')
        setQuery(item.query)
      }

      const onKeyDownInput = (event) => {
        if (event.key === 'Escape') {
          event.preventDefault()
          setOpen(false)
          return
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          move(1)
        } else if (event.key === 'ArrowUp') {
          event.preventDefault()
          move(-1)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          if (rows.length > 0) {
            openMatch(rows[selected])
          } else if (mode === 'name' && query.trim() !== '') {
            // No hits yet: leave the query as typed.
          }
        } else if (event.key === 'Tab') {
          event.preventDefault()
          setMode((current) => (current === 'name' ? 'content' : 'name'))
        }
      }

      // ── drag & resize ──────────────────────────────────────────────────────
      const beginDrag = (event) => {
        if (event.button !== 0) return
        if (event.target.closest?.('.dfs-resize') || event.target.closest?.('button')) return
        dragRef.current = {
          kind: 'move', startX: event.clientX, startY: event.clientY,
          originX: pos?.x ?? 0, originY: pos?.y ?? 0,
        }
        event.preventDefault()
      }

      const beginResize = (event, dir) => {
        if (event.button !== 0) return
        dragRef.current = {
          kind: 'resize', dir, startX: event.clientX, startY: event.clientY,
          origin: {
            x: pos?.x ?? 0, y: pos?.y ?? 0, w: size.w, h: size.h,
          },
        }
        event.preventDefault()
        event.stopPropagation()
      }

      useEffect(() => {
        if (!open) return undefined
        const onMove = (event) => {
          const drag = dragRef.current
          if (!drag) return
          if (drag.kind === 'move') {
            const maxX = window.innerWidth - 80
            const maxY = window.innerHeight - 60
            setPos({
              x: Math.min(Math.max(0, drag.originX + event.clientX - drag.startX), maxX),
              y: Math.min(Math.max(0, drag.originY + event.clientY - drag.startY), maxY),
            })
            return
          }
          const dx = event.clientX - drag.startX
          const dy = event.clientY - drag.startY
          const dir = drag.dir
          const o = drag.origin
          let x = o.x
          let y = o.y
          let w = o.w
          let h = o.h
          const right = o.x + o.w
          const bottom = o.y + o.h
          if (dir.includes('e')) w = Math.max(MIN_W, Math.min(o.w + dx, window.innerWidth - x - 8))
          if (dir.includes('s')) h = Math.max(MIN_H, Math.min(o.h + dy, window.innerHeight - y - 8))
          if (dir.includes('w')) {
            x = Math.min(Math.max(0, o.x + dx), right - MIN_W)
            w = right - x
          }
          if (dir.includes('n')) {
            y = Math.min(Math.max(0, o.y + dy), bottom - MIN_H)
            h = bottom - y
          }
          setPos({ x, y })
          setSize({ w, h })
        }
        const onUp = () => {
          dragRef.current = null
        }
        window.addEventListener('mousemove', onMove)
        window.addEventListener('mouseup', onUp)
        return () => {
          window.removeEventListener('mousemove', onMove)
          window.removeEventListener('mouseup', onUp)
        }
      }, [open])

      if (!open) return null

      const modeHistory = history.filter((item) => item.mode === mode)
      const scannedTypes = (typeIndex?.types ?? []).map((item) => item.ext)
      const suggestedTypes = [
        ...COMMON_TYPES.filter((ext) => scannedTypes.includes(ext)),
        ...scannedTypes.filter((ext) => !COMMON_TYPES.includes(ext)),
      ].slice(0, 40)
      const suggestions = query.trim() === ''
        ? []
        : modeHistory
          .filter((item) => item.query.toLowerCase().includes(query.trim().toLowerCase()) && item.query !== query.trim())
          .slice(0, 5)

      const groups = []
      if (mode === 'content' && matches) {
        let current = null
        for (const m of matches) {
          if (!current || current.rel !== m.rel) {
            current = { rel: m.rel, path: m.path, matches: [] }
            groups.push(current)
          }
          current.matches.push(m)
        }
      }

      let rowIdx = -1
      let status = busy
        ? t('busy')
        : error !== null
          ? `${t('title') ? '错误' : 'Error'}: ${error}`
          : matches === null
            ? root === ''
              ? t('noRoot')
              : ''
            : rows.length === 0
              ? t('noResults')
              : `${rows.length}${meta?.truncated ? '+' : ''} · ${meta?.elapsedMs ?? ''}ms${meta?.truncated ? ' · …' : ''}`
      if (typeof meta?.diagnostics === 'string' && meta.diagnostics !== '') {
        status += ` · ${meta.diagnostics}`
      }

      const sidebarMissing = ctx?.get?.('betterSidebar') === undefined

      const rowClass = (idx) => `dfs-row${idx === selected ? ' dfs-row-on' : ''}`

      return h(React.Fragment, null,
        h('div', { className: 'dfs-scrim', onMouseDown: () => setOpen(false) }),
        h('div', {
          ref: overlayRef,
          className: 'dfs-overlay',
          role: 'dialog',
          'aria-label': t('title'),
          style: {
            left: `${pos?.x ?? 80}px`,
            top: `${pos?.y ?? 80}px`,
            width: `${size.w}px`,
            height: `${size.h}px`,
          },
        },
          h('div', { className: 'dfs-head', onMouseDown: beginDrag },
            h('div', { className: 'dfs-title' },
              SearchIcon ? h(SearchIcon, { size: 14 }) : '⌕',
              h('span', null, t('title'))),
            h('div', { className: 'dfs-modes', role: 'tablist' },
              h('button', {
                type: 'button',
                role: 'tab',
                'aria-selected': mode === 'name',
                className: `dfs-mode${mode === 'name' ? ' dfs-mode-on' : ''}`,
                onClick: () => setMode('name'),
              }, t('nameMode')),
              h('button', {
                type: 'button',
                role: 'tab',
                'aria-selected': mode === 'content',
                className: `dfs-mode${mode === 'content' ? ' dfs-mode-on' : ''}`,
                onClick: () => setMode('content'),
              }, t('contentMode'))),
            h('button', {
              type: 'button',
              className: 'dfs-close',
              title: '关闭 (Esc)',
              'aria-label': 'Close',
              onMouseDown: (event) => event.stopPropagation(),
              onClick: (event) => {
                event.stopPropagation()
                setOpen(false)
              },
            }, '✕')),
          h('div', { className: 'dfs-inputrow' },
            h('input', {
              ref: inputRef,
              className: 'dfs-input',
              type: 'text',
              value: query,
              placeholder: mode === 'name' ? t('placeholderName') : t('placeholderContent'),
              spellCheck: false,
              onChange: (e) => setQuery(e.target.value),
              onKeyDown: onKeyDownInput,
            }),
            mode === 'content' ? h('button', {
              type: 'button',
              title: t('caseToggle'),
              className: `dfs-toggle${caseSensitive ? ' dfs-toggle-on' : ''}`,
              onClick: () => setCaseSensitive(!caseSensitive),
            }, 'Aa') : null,
            mode === 'content' ? h('button', {
              type: 'button',
              title: t('regexToggle'),
              className: `dfs-toggle${regexMode ? ' dfs-toggle-on' : ''}`,
              onClick: () => setRegexMode(!regexMode),
            }, '.*') : null,
            h('button', {
              type: 'button',
              title: t('hiddenToggle'),
              className: `dfs-toggle${includeHidden ? ' dfs-toggle-on' : ''}`,
              onClick: () => {
                setIncludeHidden(!includeHidden)
                updateSettings({ includeHidden: !includeHidden })
              },
            }, '👁')),
          mode === 'content' ? h('input', {
            className: 'dfs-exclude',
            type: 'text',
            value: exclude,
            title: t('excludeLabel'),
            spellCheck: false,
            onChange: (e) => {
              setExclude(e.target.value)
              updateSettings({ exclude: e.target.value })
            },
          }) : null,
          h('div', { className: 'dfs-types' },
            h('span', { className: 'dfs-types-label' }, t('typeLabel')),
            h('div', { className: 'dfs-combo' },
              h('input', {
                className: 'dfs-type-input',
                type: 'text',
                value: typeText,
                placeholder: '*.java, *.xml',
                spellCheck: false,
                onChange: (e) => setTypeText(e.target.value),
                onFocus: () => setTypeOpen(true),
                onBlur: () => window.setTimeout(() => setTypeOpen(false), 120),
                onKeyDown: (event) => {
                  if (event.key === 'Escape') {
                    event.stopPropagation()
                    setTypeText('')
                    setTypeOpen(false)
                  }
                },
              }),
              h('button', {
                type: 'button',
                className: 'dfs-combo-caret',
                title: t('typeLabel'),
                onMouseDown: (event) => event.preventDefault(),
                onClick: () => setTypeOpen(!typeOpen),
              }, '▾'),
              typeOpen && suggestedTypes.length > 0
                ? h('div', { className: 'dfs-type-menu' },
                  suggestedTypes.map((ext) => h('button', {
                    key: ext,
                    type: 'button',
                    className: 'dfs-type-item',
                    onMouseDown: (event) => event.preventDefault(),
                    onClick: () => {
                      setTypeText((current) => {
                        const parts = parseTypeMasks(current)
                        if (parts.includes(ext)) return current
                        return current.trim() === '' ? ext : `${current.trim()}, ${ext}`
                      })
                      setTypeOpen(false)
                    },
                  }, ext)))
                : null),
            h('button', {
              type: 'button',
              className: 'dfs-type-rescan',
              title: typeLoading ? t('typeScanning') : t('typeRescan'),
              onClick: () => scanTypesNow(),
            }, typeLoading ? '…' : '⟳')),
          suggestions.length > 0 ? h('div', { className: 'dfs-suggest' },
            h('span', { className: 'dfs-suggest-label' }, t('history')),
            suggestions.map((item) => h('button', {
              key: `${item.mode}:${item.query}`,
              type: 'button',
              className: 'dfs-chip',
              title: item.query,
              onClick: () => runHistory(item),
            }, item.query))) : null,
          h('div', { className: 'dfs-status' }, status),
          h('div', { className: 'dfs-results', ref: listRef },
            matches === null && query.trim() === ''
              ? modeHistory.length === 0
                ? null
                : h('div', { className: 'dfs-history' },
                  h('div', { className: 'dfs-history-head' },
                    h('span', null, t('history')),
                    h('button', {
                      type: 'button',
                      className: 'dfs-clear',
                      onClick: () => {
                        // Clear only this mode's history; the other mode keeps its own.
                        const kept = history.filter((item) => item.mode !== mode)
                        saveHistory(root, kept)
                        setHistory(kept)
                      },
                    }, t('clear'))),
                  modeHistory.map((item) => h('button', {
                      key: `${item.mode}:${item.query}:${item.at}`,
                      type: 'button',
                      className: 'dfs-history-row',
                      title: item.query,
                      onClick: () => runHistory(item),
                    },
                      h('span', {
                        className: `dfs-history-mode ${item.mode === 'content' ? 'dfs-history-mode-content' : 'dfs-history-mode-name'}`,
                      }, item.mode === 'content' ? t('contentMode') : t('nameMode')),
                      h('span', { className: 'dfs-history-query' }, item.query))))
              : null,
            mode === 'content' && groups.length > 0
              ? groups.map((group) => h('div', { key: group.path, className: 'dfs-group' },
                h('div', { className: 'dfs-file', title: group.path },
                  h('span', { className: 'dfs-file-path' },
                    h(Highlighted, { text: group.rel, query, regexMode, caseSensitive })),
                  h('button', {
                    type: 'button',
                    className: 'dfs-ref',
                    title: t('reference'),
                    onMouseDown: (event) => event.stopPropagation(),
                    onClick: (event) => {
                      event.stopPropagation()
                      const result = referenceIntoChat(ctx, sessionId ?? resolveSessionId(ctx, root), root, group.path)
                      if (result.ok) setOpen(false)
                      else setError(result.reason)
                    },
                  }, '@')),
                group.matches.map((m) => {
                  rowIdx += 1
                  const idx = rowIdx
                  return h('div', {
                    key: `${group.path}:${m.line}`,
                    className: rowClass(idx),
                    'data-idx': idx,
                    onMouseDown: () => setSelected(idx),
                    onClick: () => openMatch(rows[idx]),
                  },
                    h('span', { className: 'dfs-lineno' }, String(m.line)),
                    h('span', { className: 'dfs-text', title: m.text },
                      h(Highlighted, { text: m.text, query, regexMode, caseSensitive })))
                })))
              : mode === 'name' && matches
                ? matches.map((m, idx) => h('div', {
                  key: m.path,
                  className: `dfs-row dfs-name-row${idx === selected ? ' dfs-row-on' : ''}`,
                  'data-idx': idx,
                  onMouseDown: () => setSelected(idx),
                  onClick: () => openMatch(rows[idx]),
                },
                  h('span', { className: 'dfs-name', title: m.path },
                    h(Highlighted, { text: rows[idx].base, query, regexMode, caseSensitive })),
                  h('span', { className: 'dfs-dir', title: m.path }, dirOf(m.path)),
                  rows[idx].ext ? h('span', { className: 'dfs-ext' }, rows[idx].ext) : null,
                  h('button', {
                    type: 'button',
                    className: 'dfs-ref',
                    title: t('reference'),
                    onMouseDown: (event) => event.stopPropagation(),
                    onClick: (event) => {
                      event.stopPropagation()
                      const result = referenceIntoChat(ctx, sessionId ?? resolveSessionId(ctx, root), root, m.path)
                      if (result.ok) setOpen(false)
                      else setError(result.reason)
                    },
                  }, '@')))
                : null),
          h('div', { className: 'dfs-foot' },
            h('span', { className: 'dfs-hint' }, t('hint')),
            root ? h('span', { className: 'dfs-root', title: root }, `${t('scope')}: ${root}`) : null,
            sidebarMissing ? h('span', { className: 'dfs-warn' }, t('noSidebar')) : null),
          ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'].map((dir) => h('div', {
            key: dir,
            className: `dfs-handle dfs-handle-${dir}`,
            onMouseDown: (event) => beginResize(event, dir),
          })),
        ),
      )
    }

    function dirOf(path) {
      if (typeof path !== 'string') return ''
      const normalized = path.replace(/\\/g, '/')
      const cut = normalized.lastIndexOf('/')
      return cut <= 0 ? '' : normalized.slice(0, cut)
    }
    void dirOf

    function Overlay({ ctx }) {
      return h(Palette, { ctx })
    }

    function SettingsPage({ ctx }) {
      const t = useMemo(() => {
        const bound = ctx?.locale?.bind?.(NS)
        const fallback = pickDict()
        return bound ? (key) => bound(key) ?? fallback[key] ?? key : (key) => fallback[key] ?? key
      }, [ctx])
      const [settings, setSettings] = useState(currentSettings)
      const [recording, setRecording] = useState(null)

      useEffect(() => subscribeSettings(setSettings), [])

      const apply = (patch) => {
        setSettings(updateSettings(patch))
      }

      useEffect(() => {
        if (recording === null) return undefined
        const onKey = (event) => {
          event.preventDefault()
          event.stopImmediatePropagation()
          if (event.key === 'Escape') {
            setRecording(null)
            return
          }
          if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') return
          const combo = comboOf(event)
          if (combo === '' || combo.split('+').length < 2) return
          apply(recording === 'name' ? { nameKey: combo } : { contentKey: combo })
          setRecording(null)
        }
        window.addEventListener('keydown', onKey, true)
        return () => window.removeEventListener('keydown', onKey, true)
      }, [recording])

      const row = (label, value, key, cleared) => h('div', { className: 'dfs-set-row' },
        h('span', { className: 'dfs-set-label' }, label),
        h('div', { className: 'dfs-set-control' },
          h('button', {
            type: 'button',
            className: `dfs-record-btn${recording === key ? ' dfs-recording' : ''}`,
            onClick: () => setRecording(recording === key ? null : key),
          }, recording === key ? t('settingsRecording') : (formatCombo(value) || t('settingsNotSet'))),
          cleared ? h('button', {
            type: 'button',
            className: 'dfs-set-clear',
            onClick: () => apply(cleared),
          }, t('settingsReset')) : null))

      return h('div', { className: 'dfs-settings' },
        h('div', { className: 'dfs-set-group-title' }, t('settingsGroupKeys')),
        row(t('settingsFileName'), settings.nameKey, 'name', { nameKey: '' }),
        row(t('settingsFileContent'), settings.contentKey, 'content', { contentKey: '' }),
        h('div', { className: 'dfs-set-row' },
          h('span', { className: 'dfs-set-label' }, t('settingsDoubleShift')),
          h('label', { className: 'dfs-switch' },
            h('input', {
              type: 'checkbox',
              checked: settings.doubleShift !== false,
              onChange: (e) => apply({ doubleShift: e.target.checked }),
            }),
            h('span', { className: 'dfs-switch-track' }, h('span', { className: 'dfs-switch-knob' })))),
        h('div', { className: 'dfs-set-group-title' }, t('settingsGroupScope')),
        h('div', { className: 'dfs-set-row' },
          h('span', { className: 'dfs-set-label' }, t('settingsHidden')),
          h('label', { className: 'dfs-switch' },
            h('input', {
              type: 'checkbox',
              checked: settings.includeHidden !== false,
              onChange: (e) => apply({ includeHidden: e.target.checked }),
            }),
            h('span', { className: 'dfs-switch-track' }, h('span', { className: 'dfs-switch-knob' })))),
        h('div', { className: 'dfs-set-row dfs-set-column' },
          h('span', { className: 'dfs-set-label' }, t('settingsExclude')),
          h('input', {
            className: 'dfs-set-input',
            type: 'text',
            value: settings.exclude,
            spellCheck: false,
            onChange: (e) => apply({ exclude: e.target.value }),
          })),
        h('div', { className: 'dfs-set-hint' }, t('settingsHint'),
          h('button', {
            type: 'button',
            className: 'dfs-set-reset',
            onClick: () => apply({ ...DEFAULT_SETTINGS }),
          }, t('settingsReset'))))
    }

    // ── stylesheet (injected once) ────────────────────────────────────────────
    if (typeof document !== 'undefined' && !document.getElementById('dsh-file-scout-style')) {
      const style = document.createElement('style')
      style.id = 'dsh-file-scout-style'
      style.textContent = [
        '.dfs-scrim{position:fixed;inset:0;z-index:9998;background:transparent}',
        '.dfs-overlay{position:fixed;z-index:9999;display:flex;flex-direction:column;border-radius:12px;overflow:hidden;font-size:14px;box-shadow:0 18px 60px rgba(0,0,0,.32);border:1px solid var(--dsw-alias-border,#d9d9e0);background:var(--dsw-alias-bg-layer-1,#ffffff);color:var(--dsw-alias-text-primary,#1f2329);min-width:460px;min-height:300px}',
        'body[data-ds-dark-theme] .dfs-overlay{border-color:var(--dsw-alias-border,#33333d);background:var(--dsw-alias-bg-layer-1,#17171c);color:var(--dsw-alias-text-primary,#e6e6ea)}',
        '.dfs-head{display:flex;align-items:center;justify-content:space-between;padding:10px 14px 4px;flex:none;cursor:move;user-select:none}',
        '.dfs-title{display:flex;align-items:center;gap:6px;font-weight:600;opacity:.85;font-size:14px}',
        '.dfs-modes{display:inline-flex;padding:2px;gap:2px;border-radius:8px;background:var(--dsw-alias-bg-layer-2,#ececf1);border:1px solid var(--dsw-alias-border,#e2e2e8)}',
        'body[data-ds-dark-theme] .dfs-modes{background:var(--dsw-alias-bg-layer-2,#22222b);border-color:#2c2c36}',
        '.dfs-mode{border:none;background:transparent;color:inherit;opacity:.65;padding:4px 16px;border-radius:6px;cursor:pointer;font-size:13.5px;font-family:inherit}',
        '.dfs-mode:hover{opacity:.9}',
        '.dfs-mode-on{opacity:1;font-weight:600;background:var(--dsw-alias-bg-layer-1,#ffffff);box-shadow:0 1px 3px rgba(0,0,0,.18)}',
        'body[data-ds-dark-theme] .dfs-mode-on{background:#3a3a46;box-shadow:0 1px 3px rgba(0,0,0,.5)}',
        '.dfs-close{flex:none;width:26px;height:26px;border:none;border-radius:6px;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:13px;line-height:26px;padding:0;font-family:inherit}',
        '.dfs-close:hover{opacity:1;background:var(--dsw-alias-bg-layer-2,#ececf1)}',
        'body[data-ds-dark-theme] .dfs-close:hover{background:var(--dsw-alias-bg-layer-2,#22222b)}',
        '.dfs-inputrow{display:flex;gap:6px;padding:8px 14px 0;flex:none}',
        '.dfs-input{flex:1;min-width:0;height:34px;border:1px solid var(--dsw-alias-border,#d9d9e0);border-radius:8px;background:var(--dsw-alias-bg-layer-2,#f5f5f8);color:inherit;padding:0 10px;font-size:14px;outline:none;font-family:inherit}',
        '.dfs-input:focus{border-color:var(--dsw-alias-focus,#4a5a80)}',
        'body[data-ds-dark-theme] .dfs-input{background:var(--dsw-alias-bg-layer-2,#0f0f14)}',
        '.dfs-toggle{width:34px;height:34px;flex:none;border:1px solid var(--dsw-alias-border,#d9d9e0);border-radius:8px;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:13px;font-family:inherit}',
        '.dfs-toggle:hover{opacity:.9;background:var(--dsw-alias-bg-layer-2,#ececf1)}',
        'body[data-ds-dark-theme] .dfs-toggle:hover{background:var(--dsw-alias-bg-layer-2,#22222b)}',
        '.dfs-toggle-on,.dfs-toggle-on:hover{opacity:1;background:var(--dsw-alias-focus,#4a7bd0);border-color:var(--dsw-alias-focus,#4a7bd0);color:#ffffff}',
        '.dfs-exclude{margin:6px 14px 0;height:28px;flex:none;border:1px dashed var(--dsw-alias-border,#d9d9e0);border-radius:6px;background:transparent;color:inherit;opacity:.85;padding:0 8px;font-size:13px;outline:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
        '.dfs-types{display:flex;gap:8px;align-items:center;padding:8px 14px 0;flex:none}',
        '.dfs-types-label{flex:none;opacity:.6;font-size:12.5px;user-select:none}',
        '.dfs-combo{position:relative;display:flex;align-items:center;flex:1;min-width:0;max-width:340px}',
        '.dfs-type-input{flex:1;min-width:0;height:28px;border:1px solid var(--dsw-alias-border,#d9d9e0);border-right:none;border-radius:6px 0 0 6px;background:var(--dsw-alias-bg-layer-2,#f5f5f8);color:inherit;font-size:12.5px;padding:0 8px;outline:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
        'body[data-ds-dark-theme] .dfs-type-input{background:#191920;border-color:#33333d}',
        '.dfs-type-input:focus{border-color:var(--dsw-alias-focus,#4a7bd0)}',
        '.dfs-combo-caret{flex:none;width:26px;height:28px;border:1px solid var(--dsw-alias-border,#d9d9e0);border-radius:0 6px 6px 0;background:var(--dsw-alias-bg-layer-2,#f5f5f8);color:inherit;opacity:.7;cursor:pointer;font-size:11px;padding:0;font-family:inherit}',
        'body[data-ds-dark-theme] .dfs-combo-caret{background:#191920;border-color:#33333d}',
        '.dfs-combo-caret:hover{opacity:1}',
        '.dfs-type-menu{position:absolute;top:30px;left:0;right:0;max-height:260px;overflow-y:auto;z-index:5;border:1px solid var(--dsw-alias-border,#d9d9e0);border-radius:8px;background:var(--dsw-alias-bg-layer-1,#ffffff);box-shadow:0 10px 28px rgba(0,0,0,.22);padding:4px}',
        'body[data-ds-dark-theme] .dfs-type-menu{background:#1b1b22;border-color:#33333d}',
        '.dfs-type-item{display:block;width:100%;border:none;border-radius:5px;background:transparent;color:inherit;text-align:left;font-size:12.5px;padding:3px 8px;cursor:pointer;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
        '.dfs-type-item:hover{background:var(--dsw-alias-bg-layer-2,#ececf1)}',
        'body[data-ds-dark-theme] .dfs-type-item:hover{background:#2a2a35}',
        '.dfs-type-rescan{flex:none;border:none;border-radius:6px;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:13px;padding:2px 6px;font-family:inherit}',
        '.dfs-type-rescan:hover{opacity:1;background:var(--dsw-alias-bg-layer-2,#ececf1)}',
        '.dfs-suggest{display:flex;gap:6px;align-items:center;padding:6px 14px 0;flex:none;overflow:hidden}',
        '.dfs-suggest-label{flex:none;opacity:.45;font-size:12px}',
        '.dfs-chip{flex:none;max-width:240px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;border:1px solid var(--dsw-alias-border,#e2e2e8);background:transparent;color:inherit;opacity:.8;border-radius:999px;padding:2px 10px;font-size:12.5px;cursor:pointer;font-family:inherit}',
        '.dfs-chip:hover{opacity:1}',
        '.dfs-status{flex:none;padding:6px 14px;opacity:.55;font-size:12.5px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        '.dfs-results{flex:1;min-height:0;overflow-y:auto;overflow-x:hidden;padding:0 8px 8px}',
        '.dfs-empty{padding:18px 12px;opacity:.55;font-size:13.5px}',
        '.dfs-history-head{display:flex;justify-content:space-between;align-items:center;padding:6px 10px 2px;opacity:.55;font-size:12.5px}',
        '.dfs-clear{border:none;background:transparent;color:inherit;opacity:.8;cursor:pointer;font-size:12.5px;font-family:inherit}',
        '.dfs-history-row{display:flex;gap:12px;align-items:center;width:100%;padding:6px 10px;border:none;border-radius:6px;background:transparent;color:inherit;text-align:left;cursor:pointer;font-size:13.5px}',
        '.dfs-history-row:hover{background:var(--dsw-alias-bg-layer-2,#ececf1)}',
        'body[data-ds-dark-theme] .dfs-history-row:hover{background:var(--dsw-alias-bg-layer-2,#22222b)}',
        '.dfs-history-mode{flex:none;width:52px;text-align:center;font-size:11.5px;padding:2px 0;border-radius:5px}',
        '.dfs-history-mode-name{background:rgba(47,111,235,.14);color:#2f6feb}',
        '.dfs-history-mode-content{background:rgba(245,166,35,.18);color:#b3761a}',
        'body[data-ds-dark-theme] .dfs-history-mode-name{background:rgba(88,140,255,.20);color:#8fb2ff}',
        'body[data-ds-dark-theme] .dfs-history-mode-content{background:rgba(245,166,35,.16);color:#eec27a}',
        '.dfs-history-query{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}',
        '.dfs-group{margin-bottom:2px}',
        '.dfs-file{display:flex;align-items:center;gap:6px;padding:5px 8px;font-weight:600;font-size:13.5px;opacity:.85}',
        '.dfs-file-path{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;direction:rtl;text-align:left}',
        '.dfs-file:hover .dfs-file-path{direction:ltr;overflow-x:auto;text-overflow:clip}',
        '.dfs-row{display:flex;gap:8px;align-items:center;padding:3px 8px 3px 12px;border-radius:6px;cursor:pointer;min-width:0}',
        '.dfs-row:hover{background:var(--dsw-alias-bg-layer-2,#ececf1)}',
        'body[data-ds-dark-theme] .dfs-row:hover{background:var(--dsw-alias-bg-layer-2,#22222b)}',
        '.dfs-row-on,.dfs-row-on:hover{background:var(--dsw-alias-bg-active,#dbe4ff)}',
        'body[data-ds-dark-theme] .dfs-row-on,body[data-ds-dark-theme] .dfs-row-on:hover{background:var(--dsw-alias-bg-active,#2a3550)}',
        '.dfs-name{font-weight:600;flex:none;max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:inherit}',
        '.dfs-ext{flex:none;font-size:11px;font-weight:600;letter-spacing:.4px;padding:1px 7px;border-radius:4px;background:var(--dsw-alias-bg-layer-2,#ececf1);opacity:.75}',
        'body[data-ds-dark-theme] .dfs-ext{background:#26262e}',
        '.dfs-dir{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;opacity:.5;font-size:12px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;direction:rtl;text-align:left}',
        '.dfs-row:hover .dfs-dir{direction:ltr;overflow-x:auto;text-overflow:clip}',
        '.dfs-ref{flex:none;width:22px;height:20px;border:none;border-radius:5px;background:transparent;color:inherit;opacity:.30;cursor:pointer;font-size:13px;font-weight:600;font-family:inherit;padding:0;line-height:20px}',
        '.dfs-row:hover .dfs-ref,.dfs-file:hover .dfs-ref{opacity:.85}',
        '.dfs-ref:hover{opacity:1;background:var(--dsw-alias-bg-layer-2,#ececf1)}',
        'body[data-ds-dark-theme] .dfs-ref:hover{background:var(--dsw-alias-bg-layer-2,#22222b)}',
        '.dfs-lineno{flex:none;min-width:42px;text-align:right;opacity:.5;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12px;user-select:none}',
        '.dfs-text{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:12.5px}',
        '.dfs-row:hover .dfs-text{overflow-x:auto;text-overflow:clip}',
        '.dfs-hl{background:rgba(255,201,80,.30);border-radius:2px;padding:0 1px}',
        'body[data-ds-dark-theme] .dfs-hl{background:rgba(255,201,80,.25);color:#ffd479}',
        '.dfs-foot{display:flex;gap:14px;align-items:center;padding:6px 14px;flex:none;opacity:.55;font-size:12px;border-top:1px solid var(--dsw-alias-border,#e5e5ea)}',
        'body[data-ds-dark-theme] .dfs-foot{border-top-color:var(--dsw-alias-border,#26262e)}',
        '.dfs-hint{flex:none}',
        '.dfs-root{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;direction:rtl;text-align:left}',
        '.dfs-warn{color:#c2701e}',
        '.dfs-handle{position:absolute;z-index:3;background:transparent}',
        '.dfs-handle:hover{background:var(--dsw-alias-focus,#4a5a80);opacity:.30;border-radius:4px}',
        '.dfs-handle-n{top:0;left:10px;right:10px;height:4px;cursor:ns-resize}',
        '.dfs-handle-s{bottom:0;left:10px;right:10px;height:4px;cursor:ns-resize}',
        '.dfs-handle-e{right:0;top:10px;bottom:10px;width:4px;cursor:ew-resize}',
        '.dfs-handle-w{left:0;top:10px;bottom:10px;width:4px;cursor:ew-resize}',
        '.dfs-handle-ne{top:0;right:0;width:12px;height:12px;cursor:nesw-resize;border-top-right-radius:12px}',
        '.dfs-handle-nw{top:0;left:0;width:12px;height:12px;cursor:nwse-resize;border-top-left-radius:12px}',
        '.dfs-handle-se{bottom:0;right:0;width:12px;height:12px;cursor:nwse-resize;border-bottom-right-radius:12px}',
        '.dfs-handle-sw{bottom:0;left:0;width:12px;height:12px;cursor:nesw-resize;border-bottom-left-radius:12px}',
        '.dfs-settings{display:flex;flex-direction:column;gap:10px;font-size:14px;color:var(--dsw-alias-text-primary,#1f2329);padding:4px 2px}',
        'body[data-ds-dark-theme] .dfs-settings{color:var(--dsw-alias-text-primary,#e6e6ea)}',
        '.dfs-set-group-title{font-size:14.5px;font-weight:700;margin:6px 0 0;padding-bottom:4px;border-bottom:2px solid var(--dsw-alias-focus,#4a7bd0);display:inline-block;width:auto}',
        'body[data-ds-dark-theme] .dfs-set-group-title{border-bottom-color:#5b8dd9}',
        '.dfs-set-row{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:8px 2px;border-bottom:1px solid var(--dsw-alias-border,#ececf1)}',
        'body[data-ds-dark-theme] .dfs-set-row{border-bottom-color:#26262e}',
        '.dfs-set-column{flex-direction:column;align-items:stretch;justify-content:flex-start;gap:6px}',
        '.dfs-set-label{flex:none;opacity:.85}',
        '.dfs-set-control{display:flex;align-items:center;gap:8px;min-width:0}',
        '.dfs-record-btn{min-width:150px;height:30px;border:1px solid var(--dsw-alias-border,#d9d9e0);border-radius:7px;background:var(--dsw-alias-bg-layer-2,#f5f5f8);color:inherit;cursor:pointer;font-size:13px;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;padding:0 10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}',
        'body[data-ds-dark-theme] .dfs-record-btn{background:#191920;border-color:#33333d}',
        '.dfs-record-btn:hover{border-color:var(--dsw-alias-focus,#4a5a80)}',
        '.dfs-recording{border-color:#d08f0a;color:#b3761a;background:rgba(245,166,35,.12)}',
        '.dfs-set-clear,.dfs-set-reset{border:none;background:transparent;color:inherit;opacity:.55;cursor:pointer;font-size:12px;font-family:inherit;padding:2px 6px}',
        '.dfs-set-clear:hover,.dfs-set-reset:hover{opacity:.9}',
        '.dfs-set-input{height:30px;border:1px solid var(--dsw-alias-border,#d9d9e0);border-radius:7px;background:var(--dsw-alias-bg-layer-2,#f5f5f8);color:inherit;padding:0 10px;font-size:13px;outline:none;font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}',
        '.dfs-set-input:focus{border-color:var(--dsw-alias-focus,#4a5a80)}',
        'body[data-ds-dark-theme] .dfs-set-input{background:#191920;border-color:#33333d}',
        '.dfs-set-hint{display:flex;align-items:center;justify-content:space-between;gap:12px;font-size:12px;opacity:.55}',
        '.dfs-switch{position:relative;display:inline-flex;align-items:center;cursor:pointer}',
        '.dfs-switch input{position:absolute;opacity:0;width:0;height:0}',
        '.dfs-switch-track{width:38px;height:21px;border-radius:999px;background:var(--dsw-alias-border,#d0d0d8);position:relative;transition:background .15s}',
        '.dfs-switch-knob{position:absolute;top:2px;left:2px;width:17px;height:17px;border-radius:50%;background:#fff;transition:left .15s;box-shadow:0 1px 2px rgba(0,0,0,.3)}',
        '.dfs-switch input:checked + .dfs-switch-track{background:var(--dsw-alias-focus,#4a7bd0)}',
        '.dfs-switch input:checked + .dfs-switch-track .dfs-switch-knob{left:19px}',
      ].join('\n')
      document.head.appendChild(style)
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => {
          const disposers = []
          for (const [locale, dict] of Object.entries(DICTS)) {
            disposers.push(ctx.locale.register(NS, locale, dict))
          }
          // Recorded shortcuts from Settings → 搜索设置, plus the IDEA-style
          // Double Shift. Any other key between the two Shift presses resets
          // the double-Shift window; auto-repeat never counts.
          let lastShiftAt = 0
          const openWith = (mode, event) => {
            event.preventDefault()
            event.stopImmediatePropagation()
            requestOpen(mode)
          }
          const onKey = (event) => {
            if (event.repeat) {
              lastShiftAt = 0
              return
            }
            const settings = currentSettings()
            const combo = comboOf(event)
            if (settings.nameKey && combo === settings.nameKey) {
              openWith('name', event)
              return
            }
            if (settings.contentKey && combo === settings.contentKey) {
              openWith('content', event)
              return
            }
            if (event.key !== 'Shift' || event.ctrlKey || event.altKey || event.metaKey) {
              lastShiftAt = 0
              return
            }
            if (settings.doubleShift === false) {
              lastShiftAt = 0
              return
            }
            const now = Date.now()
            if (now - lastShiftAt <= 350) {
              lastShiftAt = 0
              openWith('name', event)
              return
            }
            lastShiftAt = now
          }
          window.addEventListener('keydown', onKey, true)
          disposers.push(() => window.removeEventListener('keydown', onKey, true))
          disposers.push(ctx.slots.inject('shell.overlay', () =>
            ctx.slots.register({ name: 'shell.overlay', id: 'file-scout', order: 10 }, () => h(Overlay, { ctx })),
          ))
          // The dedicated Settings → 搜索设置 page: recorded shortcuts, the
          // double-Shift switch, and the exclude list all live there.
          disposers.push(ctx.slots.inject('settings.section', () => ctx.slots.register({
            name: 'settings.section',
            id: 'file-scout-settings',
            order: 90,
            label: () => {
              try {
                return ctx.locale.bind(NS)('settingsTitle') ?? '搜索设置'
              } catch {
                return '搜索设置'
              }
            },
          }, () => h(SettingsPage, { ctx }))))
          return () => {
            for (const dispose of disposers) {
              try {
                dispose()
              } catch {
                // One failed dispose must not block the rest.
              }
            }
          }
        }, 'file-scout: overlay + settings + locale + keys')
      },
    }
  },
})
