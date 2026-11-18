/**
 * dsh-file-scout — Host half.
 *
 * Serves the palette's two searches over a plain webServer prefix route
 * (the dsh-workspace-search / dsh-better-sidebar pattern — NOT
 * connection.rpc.handle, whose owner rebinding breaks out-of-tree bundles):
 *
 *   POST /file-scout/roots    {} -> { ok, value: { roots: [{ path, title }] } }
 *   POST /file-scout/search   { root, mode: 'name'|'content', query,
 *                               caseSensitive?, regex?, exclude? }
 *
 * Name search runs the packaged ripgrep (`rg --files`) and filters names in
 * process; content search runs a full ripgrep line match with the query as a
 * literal or regex. Both walks honor the workspace's native .gitignore rules
 * and the caller's exclude globs, and both are bounded: entry/match caps stop
 * the process early and report truncation honestly.
 *
 * The ripgrep binary resolves from the Desktop installation's unpacked
 * node_modules (@vscode/ripgrep-*), with bare `rg` on PATH as a fallback, so
 * the plugin imports no host-only package: everything it needs at runtime is
 * `webServer` + `subprocess` services and the rg executable on disk.
 */
import { spawn } from 'node:child_process'
import { appendFileSync, existsSync, readdirSync, statSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'

export const inject = ['webServer']

/** Temporary diagnosis sink; remove once the search path is verified. */
const DEBUG_LOG = 'C:\\Users\\10641\\Documents\\deepseek-harness\\default-workspace\\file-scout-debug.log'

function debug(entry) {
  try {
    appendFileSync(DEBUG_LOG, `${new Date().toISOString()} ${JSON.stringify(entry)}\n`)
  } catch {
    // Diagnosis must never break the search.
  }
}

const ROUTE_PREFIX = '/file-scout'

/** Deployment budgets on one search. */
const LIMITS = {
  /** Cap on files listed from rg output in name mode. */
  maxEntries: 100_000,
  /** Cap on returned results (files in name mode, match lines in content mode). */
  maxResults: 400,
  /** Cap on matches per file in content mode (rg --max-count). */
  maxPerFile: 100,
  /** Cap on one reported match line's length. */
  maxLineLength: 300,
  /** Search deadline in milliseconds. */
  timeoutMs: 30_000,
  /** Process-termination grace in milliseconds. */
  graceMs: 1_000,
  /** Byte cap on retained stderr diagnostics. */
  stderrMaxBytes: 65_536,
}

/** VCS metadata never contributes files. */
const VCS_GLOBS = ['!.git', '!.hg', '!.svn', '!.bzr', '!.jj', '!.sl']

/** Loopback hostnames accepted by the request fence. */
const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '[::ffff:127.0.0.1]'])

function json(res, status, body) {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

function ok(value) {
  return { ok: true, value }
}

function fail(message) {
  return { ok: false, error: { message } }
}

/** Same loopback/origin trust fence as the built-in /api gateway. */
function fenced(req) {
  const hostHeader = req.headers?.host
  if (typeof hostHeader !== 'string' || hostHeader.length === 0) return false
  const hostname = hostHeader.toLowerCase().replace(/:\d+$/, '')
  const hostTrusted = LOOPBACK_HOSTNAMES.has(hostname)
  const originHeader = req.headers?.origin
  if (typeof originHeader === 'string' && originHeader.length > 0) {
    let originHost
    try {
      originHost = new URL(originHeader).hostname.toLowerCase()
    } catch {
      return false
    }
    return originHost === hostname
  }
  if (!hostTrusted) return false
  return req.headers?.['sec-fetch-site'] !== 'cross-site'
}

async function readJsonBody(req, limit = 1 << 20) {
  let size = 0
  const chunks = []
  for await (const chunk of req) {
    size += chunk.length
    if (size > limit) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const raw = Buffer.concat(chunks).toString('utf8')
  if (raw.length === 0) return {}
  return JSON.parse(raw)
}

/**
 * Resolve the packaged ripgrep executable. The Desktop app packs the binary
 * beside the ASAR, under the unpacked @vscode/ripgrep vendor package's bin
 * directory; an `rg` already on PATH is the last fallback.
 */
function resolveRipgrep() {
  const exe = process.platform === 'win32' ? 'rg.exe' : 'rg'
  const candidates = []
  const roots = []
  // Electron's canonical resources directory: <install>/resources.
  try {
    if (typeof process.resourcesPath === 'string' && process.resourcesPath !== '') {
      roots.push(join(process.resourcesPath, 'app.asar.unpacked'))
    }
  } catch {
    // Not Electron — fall through.
  }
  const installDir = process.env.DSH_INSTALL_DIR
  if (typeof installDir === 'string' && /app\.asar$/i.test(installDir)) {
    roots.push(installDir.replace(/app\.asar$/i, 'app.asar.unpacked'))
  }
  // The executable's own directory: <install>/DSH NEXT.exe beside resources.
  try {
    const execDir = dirname(process.execPath)
    if (execDir) roots.push(join(execDir, 'resources', 'app.asar.unpacked'))
  } catch {
    // No execPath — keep the remaining roots.
  }
  for (const unpacked of roots) {
    const vendorRoot = join(unpacked, 'node_modules', '@vscode')
    try {
      for (const entry of readdirSync(vendorRoot)) {
        if (!/^ripgrep-/.test(entry)) continue
        candidates.push(join(vendorRoot, entry, 'bin', exe))
      }
    } catch {
      // No unpacked vendor dir here — try the next root.
    }
  }
  for (const candidate of candidates) {
    try {
      if (existsSync(candidate)) return { path: candidate, roots, candidates }
    } catch {
      // Unreadable candidate — try the next one.
    }
  }
  // Bare name: the OS resolves it through PATH; usually absent, so the search
  // reports the ENOENT with the roots it tried.
  return { path: exe, roots, candidates }
}

function isDirectory(path) {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}

function collectRoots(ctx) {
  const items = []
  const seen = new Set()
  const add = (path, title) => {
    if (typeof path !== 'string' || !path || seen.has(path) || !isAbsolute(path)) return
    seen.add(path)
    items.push({ path, title: typeof title === 'string' && title ? title : path })
  }
  try {
    const registry = ctx.get('workspaceRegistry')
    if (registry && typeof registry.list === 'function') {
      for (const workspace of registry.list()) {
        const path = workspace?.path ?? workspace?.record?.path
        const title = typeof workspace?.title === 'string' ? workspace.title : workspace?.record?.title
        add(path, title)
      }
    }
  } catch {
    // A missing registry is not a roots failure.
  }
  try {
    const fallback = ctx.get('sandboxPolicy')?.workspaceRoot
    add(fallback, 'default')
  } catch {
    // Sandbox policy is optional context.
  }
  return items
}

/** Translate a comma-separated exclude list into rg `--glob=!…` arguments. */
function excludeArgs(exclude) {
  const args = []
  const patterns = String(exclude ?? '').split(',').map((p) => p.trim()).filter((p) => p.length > 0)
  for (const pattern of patterns) args.push('--glob', `!${pattern}`)
  return args
}

function escapeLiteral(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Start one packaged-ripgrep run. Plain `node:child_process` keeps the
 * plugin's own read-only subprocess fully under its control (the harness
 * `subprocess` seam is not needed for a bounded, killable search), and its
 * stderr/exit facts ride back to the palette as diagnostics.
 */
function runRg(argv, cwd, signal) {
  const child = spawn(argv[0], argv.slice(1), {
    cwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr.setEncoding('utf8')
  child.stderr.on('data', (chunk) => {
    if (stderr.length < LIMITS.stderrMaxBytes) stderr += chunk
  })
  const done = new Promise((resolve) => {
    child.on('error', (error) => resolve({ exitCode: null, signal: null, stderr, error: String(error?.message ?? error) }))
    child.on('close', (exitCode, codeSignal) => resolve({ exitCode, signal: codeSignal, stderr }))
  })
  if (signal !== undefined) {
    const kill = () => {
      try {
        child.kill('SIGTERM')
      } catch {
        // Already gone.
      }
    }
    if (signal.aborted) kill()
    else signal.addEventListener('abort', kill, { once: true })
  }
  return { child, done }
}

/**
 * Drain one ripgrep stdout pipe, handing every complete record to `onRecord`
 * until it returns false or the stream ends. The process is killed as soon
 * as the callback stops, so caps cut the walk instead of reading it through.
 */
async function drain(child, separator, onRecord, run) {
  let buffer = ''
  let stopped = false
  let raw = ''
  try {
    child.stdout.setEncoding('utf8')
    for await (const chunk of child.stdout) {
      raw += chunk
      if (raw.length > 2000) raw = raw.slice(-2000)
      buffer += chunk
      let at = buffer.indexOf(separator)
      while (at !== -1) {
        const record = buffer.slice(0, at)
        buffer = buffer.slice(at + separator.length)
        at = buffer.indexOf(separator)
        if (onRecord(record) === false) {
          stopped = true
          break
        }
      }
      if (stopped) break
    }
  } catch {
    // A killed process ends its pipe early; records already parsed stand.
  }
  if (stopped) {
    try {
      child.kill('SIGTERM')
    } catch {
      // Already gone.
    }
  }
  if (run !== undefined) run.rawTail = raw.slice(-300)
  return stopped
}

/**
 * Name mode: `rg --files` lists paths; the query filters names in process
 * (full relative path when the query contains `/`).
 */
async function searchNames(ctx, spec) {
  const argv = [
    '--files', '--sort', 'path', '--null', '--path-separator=/',
    ...spec.includeHidden ? ['--hidden'] : [],
    ...excludeArgs(spec.exclude),
    ...VCS_GLOBS.map((g) => `--glob=${g}`),
  ]
  const run = runRg([spec.rg, ...argv], spec.root, spec.signal)
  const matches = []
  const needle = spec.query.toLowerCase()
  const byPath = spec.query.includes('/')
  let listed = 0
  let truncated = false
  const stopped = await drain(run.child, '\0', (record) => {
    listed += 1
    if (listed > LIMITS.maxEntries) {
      truncated = true
      return false
    }
    const rel = record.replace(/\\/g, '/')
    const name = rel.slice(rel.lastIndexOf('/') + 1)
    const hay = (byPath ? rel : name).toLowerCase()
    if (hay.includes(needle)) matches.push({ path: `${spec.root.replace(/[\\/]+$/, '')}/${rel}`, name: rel })
    return true
  }, run)
  const outcome = await run.done
  debug({ mode: 'name', root: spec.root, query: spec.query, argv: spec.rg, exit: outcome.exitCode, signal: outcome.signal, error: outcome.error, stderr: outcome.stderr?.slice(0, 300), listed, matches: matches.length, raw: run.rawTail })
  matches.sort((a, b) => {
    const depth = a.name.split('/').length - b.name.split('/').length
    return depth || (a.name < b.name ? -1 : 1)
  })
  return {
    matches: matches.slice(0, LIMITS.maxResults),
    truncated: truncated || matches.length > LIMITS.maxResults,
    incomplete: stopped,
    listed,
    diagnostics: diagnosticsOf(outcome),
  }
}

/**
 * Content mode: one rg process over the workspace, query as literal or regex,
 * matches bounded by caps and cut early.
 */
async function searchContent(ctx, spec) {
  let pattern = spec.query
  if (spec.regex) {
    try {
      new RegExp(pattern) // eslint-disable-line no-new
    } catch {
      return { invalid: true }
    }
  } else {
    pattern = escapeLiteral(pattern)
  }
  const argv = [
    '--line-number', '--no-heading', '--null', '--path-separator=/',
    '--max-columns', String(LIMITS.maxLineLength), '--max-columns-preview',
    `--max-count=${LIMITS.maxPerFile}`,
    ...spec.includeHidden ? ['--hidden'] : [],
    ...spec.caseSensitive ? [] : ['--ignore-case'],
    ...excludeArgs(spec.exclude),
    ...VCS_GLOBS.map((g) => `--glob=${g}`),
    pattern,
  ]
  const run = runRg([spec.rg, ...argv], spec.root, spec.signal)
  const matches = []
  const files = new Set()
  const rootPrefix = spec.root.replace(/[\\/]+$/, '')
  let truncated = false
  let listed = 0
  const stopped = await drain(run.child, '\n', (record) => {
    listed += 1
    const nul = record.indexOf('\0')
    if (nul === -1) return true
    const rel = record.slice(0, nul).replace(/\\/g, '/')
    const rest = record.slice(nul + 1)
    const colon = rest.indexOf(':')
    const line = Number.parseInt(rest.slice(0, colon), 10)
    const text = rest.slice(colon + 1)
    if (!Number.isFinite(line) || line <= 0) return true
    files.add(rel)
    if (matches.length >= LIMITS.maxResults) {
      truncated = true
      return false
    }
    matches.push({
      path: `${rootPrefix}/${rel}`,
      rel,
      line,
      text: text.length > LIMITS.maxLineLength ? `${text.slice(0, LIMITS.maxLineLength)}…` : text,
    })
    return true
  }, run)
  const outcome = await run.done
  debug({ mode: 'content', root: spec.root, query: spec.query, exit: outcome.exitCode, signal: outcome.signal, error: outcome.error, stderr: outcome.stderr?.slice(0, 300), listed, matches: matches.length, raw: run.rawTail })
  return {
    matches,
    truncated: truncated || listed > LIMITS.maxEntries,
    incomplete: stopped,
    listed,
    files: files.size,
    diagnostics: diagnosticsOf(outcome),
  }
}

/** One short human-readable line about a finished rg run, empty when clean. */
function diagnosticsOf(outcome) {
  if (outcome === undefined) return ''
  const parts = []
  if (outcome.error) parts.push(outcome.error)
  if (outcome.exitCode !== null && outcome.exitCode !== 0 && outcome.exitCode !== 1) {
    parts.push(`rg exit ${outcome.exitCode}`)
  }
  if (outcome.stderr && outcome.stderr.trim() !== '') parts.push(outcome.stderr.trim())
  return parts.join(' · ').slice(0, 400)
}

export function apply(ctx) {
  const rg = resolveRipgrep()
  debug({
    event: 'resolve',
    execPath: process.execPath,
    resourcesPath: process.resourcesPath,
    installDir: process.env.DSH_INSTALL_DIR,
    roots: rg.roots,
    candidates: rg.candidates,
    picked: rg.path,
  })

  ctx.effect(() =>
    ctx.webServer.register({
      kind: 'prefix',
      path: ROUTE_PREFIX,
      handler: async (req, res) => {
        try {
          if (!fenced(req)) {
            json(res, 403, fail('forbidden'))
            return
          }
          if (req.method !== 'POST') {
            res.setHeader('allow', 'POST')
            json(res, 405, fail(`method not allowed; POST ${ROUTE_PREFIX}/{roots,search}`))
            return
          }
          const endpoint = req.url?.slice(ROUTE_PREFIX.length).replace(/^\/+|\/+$/g, '') ?? ''
          const body = await readJsonBody(req)

          if (endpoint === 'roots') {
            json(res, 200, ok({ roots: collectRoots(ctx) }))
            return
          }

          if (endpoint === 'search') {
            const query = String(body?.query ?? '').trim()
            const root = String(body?.root ?? '')
            if (query.length === 0) {
              json(res, 200, fail('query must not be blank'))
              return
            }
            if (!isAbsolute(root) || !isDirectory(root)) {
              json(res, 200, fail(`search root must be an existing absolute directory, got "${root}"`))
              return
            }
            const mode = body?.mode === 'content' ? 'content' : 'name'
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), LIMITS.timeoutMs)
            const started = Date.now()
            try {
              const spec = {
                rg: rg.path,
                root,
                query,
                mode,
                caseSensitive: body?.caseSensitive === true,
                regex: body?.regex === true,
                includeHidden: body?.includeHidden === true,
                exclude: typeof body?.exclude === 'string' ? body.exclude : 'node_modules',
                signal: controller.signal,
              }
              const result = mode === 'content' ? await searchContent(ctx, spec) : await searchNames(ctx, spec)
              if (result.invalid) {
                json(res, 200, fail('invalid regular expression'))
                return
              }
              json(res, 200, ok({
                root,
                mode,
                elapsedMs: Date.now() - started,
                matches: result.matches,
                files: result.files,
                listed: result.listed,
                truncated: result.truncated,
                incomplete: result.incomplete,
                diagnostics: result.diagnostics ?? '',
              }))
            } finally {
              clearTimeout(timer)
            }
            return
          }

          json(res, 404, fail(`unknown endpoint: ${endpoint}`))
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          json(res, error instanceof SyntaxError ? 400 : 500, fail(message))
        }
      },
    }),
    'file-scout: http route',
  )
}
