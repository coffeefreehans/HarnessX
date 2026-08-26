/** Desktop workbench Host plugin: local file/terminal/git routes for the advanced shell.
 *
 * The workbench client panel needs host-side capabilities the sandboxed
 * renderer cannot reach: directory listings, a persistent shell session, and
 * git plumbing. Everything is served under one authorized `/api/desktop/
 * workbench` prefix, mirroring the desktop-prefs route pattern. No upstream
 * kernel service is touched.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { readdir, stat } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from './runtime.ts'

const WORKBENCH_ROUTE = '/api/desktop/workbench'
const MAX_JSON_BODY_BYTES = 256 * 1024
const MAX_PREVIEW_BYTES = 64 * 1024
const MAX_OUTPUT_CHUNK_BYTES = 256 * 1024
const MAX_TERMINAL_SESSIONS = 8
const GIT_TIMEOUT_MS = 10_000
const GIT_NETWORK_TIMEOUT_MS = 120_000

/** One directory entry rendered by the project explorer. */
export interface WorkbenchEntry {
  name: string
  kind: 'directory' | 'file'
  size?: number | undefined
  mtimeMs?: number | undefined
}

/** Metadata describing the host so renderer defaults match the platform. */
export interface WorkbenchMeta {
  platform: NodeJS.Platform
  home: string
  sep: string
}

/** Parsed `git status --porcelain=v1 -b` output. */
export interface GitStatus {
  branch?: string | undefined
  ahead?: number | undefined
  behind?: number | undefined
  entries: GitStatusEntry[]
}

export interface GitStatusEntry {
  x: string
  y: string
  path: string
  origPath?: string | undefined
}

export interface GitLogEntry {
  abbrev: string
  subject: string
  author: string
  time: number
}

/** Aggregated numstat counters across staged and unstaged diffs. */
export interface GitDiffSummary {
  files: number
  additions: number
  deletions: number
}

/** Per-file line counters shown beside changed files in the explorer. */
export interface GitFileCount {
  additions: number
  deletions: number
}

/** Parsed `git branch --format` row. */
export interface GitBranchEntry {
  name: string
  current: boolean
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    request.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > MAX_JSON_BODY_BYTES) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    request.on('error', cause => reject(cause instanceof Error ? cause : new Error(String(cause))))
  })
}

/**
 * Validate an untrusted path into an absolute resolved filesystem path.
 * @param value - raw query or body value.
 * @returns the resolved absolute path.
 * @throws when the value is not an absolute path string.
 */
export function requireAbsolutePath(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0 || !isAbsolute(value) || value.includes('\0')) {
    throw new Error('an absolute path is required')
  }
  return resolve(value)
}

/**
 * List one directory with directories first and case-insensitive name order.
 * @param dir - absolute directory to read.
 * @returns renderable entries sorted for the explorer.
 */
export async function listDirectory(dir: string): Promise<WorkbenchEntry[]> {
  const names = await readdir(dir)
  const entries = await Promise.all(names.map(async (name): Promise<WorkbenchEntry> => {
    try {
      const info = await stat(join(dir, name))
      if (info.isDirectory()) return { name, kind: 'directory' }
      return { name, kind: 'file', size: info.size, mtimeMs: info.mtimeMs }
    } catch {
      // A racing deletion must not hide the remaining siblings.
      return { name, kind: 'file' }
    }
  }))
  return entries.sort((left, right) => {
    if (left.kind !== right.kind) return left.kind === 'directory' ? -1 : 1
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' })
  })
}

/**
 * Read a bounded text preview of one file.
 * @param file - absolute file path.
 * @returns text content plus whether reading stopped at the byte cap.
 */
export async function readPreview(file: string): Promise<{ text: string; truncated: boolean; binary: boolean }> {
  const info = await stat(file)
  if (!info.isFile()) throw new Error('not a regular file')
  if (info.size > MAX_OUTPUT_CHUNK_BYTES) throw new Error('file is too large to preview')
  const { open } = await import('node:fs/promises')
  const handle = await open(file, 'r')
  try {
    const length = Math.min(info.size, MAX_PREVIEW_BYTES)
    const buffer = Buffer.alloc(length)
    await handle.read(buffer, 0, length, 0)
    const binary = buffer.includes(0)
    return {
      text: binary ? '' : buffer.toString('utf8'),
      truncated: info.size > length,
      binary,
    }
  } finally {
    await handle.close()
  }
}

/**
 * Parse `git status --porcelain=v2 --branch` output without trusting column
 * widths, so paths containing spaces survive intact.
 * @param raw - full stdout of the status command.
 * @returns branch header values and per-file entries.
 */
export function parseGitStatus(raw: string): GitStatus {
  const result: GitStatus = { entries: [] }
  for (const line of raw.split('\n')) {
    const trimmed = line.replace(/\r$/, '')
    if (trimmed.startsWith('# branch.head ')) result.branch = trimmed.slice('# branch.head '.length)
    if (trimmed.startsWith('# branch.ab ')) {
      const match = /\+(\d+)\s+-(\d+)/.exec(trimmed.slice('# branch.ab '.length))
      if (match?.[1] !== undefined && match[2] !== undefined) {
        result.ahead = Number(match[1])
        result.behind = Number(match[2])
      }
    }
    if (trimmed.startsWith('1 ')) {
      // "1 XY sub mH mI mW hH hI <path>" — the path starts after eight spaces.
      const marker = nthSpaceIndex(trimmed, 8)
      if (marker >= 0) {
        const xy = trimmed.slice(2, 4)
        result.entries.push({ x: v2status(xy[0]), y: v2status(xy[1]), path: trimmed.slice(marker + 1) })
      }
      continue
    }
    if (trimmed.startsWith('2 ')) {
      // "2 XY sub mH mI mW hH hI Xscore <newPath>\t<origPath>"
      const separator = trimmed.indexOf('\t')
      if (separator >= 0) {
        const head = trimmed.slice(0, separator)
        // Nine leading fields precede the new path on rename rows.
        const marker = nthSpaceIndex(head, 9)
        if (marker >= 0) {
          const xy = head.slice(2, 4)
          const origPath = trimmed.slice(separator + 1)
          result.entries.push({
            x: v2status(xy[0]),
            y: v2status(xy[1]),
            path: head.slice(marker + 1),
            ...(origPath.length > 0 ? { origPath } : {}),
          })
        }
      }
      continue
    }
    if (trimmed.startsWith('? ') || trimmed.startsWith('! ')) {
      result.entries.push({ x: '?', y: '?', path: trimmed.slice(2) })
    }
  }
  return result
}

function v2status(value: string | undefined): string {
  return value === undefined || value === '.' || value === '' ? ' ' : value
}

function nthSpaceIndex(line: string, count: number): number {
  let index = -1
  for (let seen = 0; seen < count; seen += 1) {
    index = line.indexOf(' ', index + 1)
    if (index < 0) return -1
  }
  return index
}

/**
 * Parse `git branch --format` rows joined with unit separators.
 * @param raw - full stdout of the branch command.
 * @returns local branches with the checked-out marker.
 */
export function parseGitBranches(raw: string): GitBranchEntry[] {
  return raw.split('\n').map(line => line.replace(/\r$/, '')).filter(line => line.length > 0).map(line => {
    // `git branch --format` speaks ref-format, which has no %xNN escapes, so a
    // literal TAB (never part of a branch name) separates the fields.
    const [name = '', head = ''] = line.split('\t')
    return { name, current: head.trim() === '*' }
  }).filter(entry => entry.name.length > 0)
}

/**
 * Parse `git log` output joined by record/unit separators.
 * @param raw - full stdout of the log command.
 * @returns recent commit rows ready for rendering.
 */
export function parseGitLog(raw: string): GitLogEntry[] {
  return raw.split('\x1e').map(record => record.trimStart()).filter(record => record.length > 0).map(record => {
    const [abbrev = '', subject = '', author = '', time = ''] = record.split('\x1f')
    return { abbrev, subject, author, time: Number(time) || 0 }
  })
}

/**
 * Summarize numstat lines, treating binary "-" counts as zero.
 * @param raw - stdout of `git diff --numstat`.
 * @returns aggregated file/addition/deletion counters.
 */
export function summarizeNumstat(raw: string): GitDiffSummary {
  const summary: GitDiffSummary = { files: 0, additions: 0, deletions: 0 }
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    const [added = '-', deleted = '-'] = line.split('\t')
    summary.files += 1
    summary.additions += added === '-' ? 0 : Number(added) || 0
    summary.deletions += deleted === '-' ? 0 : Number(deleted) || 0
  }
  return summary
}

/**
 * Parse numstat lines into a per-file counter map. Rename paths printed as
 * `{old => new}` or `old => new` are keyed by their new side so they match
 * porcelain status paths.
 * @param raw - stdout of `git diff --numstat`.
 * @returns counters keyed by repository-relative path.
 */
export function parseNumstat(raw: string): Map<string, GitFileCount> {
  const counts = new Map<string, GitFileCount>()
  for (const line of raw.split('\n')) {
    if (line.trim().length === 0) continue
    const [added = '-', deleted = '-', ...rest] = line.split('\t')
    const path = numstatPathKey(rest.join('\t'))
    if (path.length === 0) continue
    counts.set(path, {
      additions: added === '-' ? 0 : Number(added) || 0,
      deletions: deleted === '-' ? 0 : Number(deleted) || 0,
    })
  }
  return counts
}

function numstatPathKey(raw: string): string {
  const trimmed = raw.trim()
  const arrow = trimmed.lastIndexOf('=>')
  if (arrow < 0) return trimmed
  const open = trimmed.lastIndexOf('{', arrow)
  if (open < 0) return trimmed.slice(arrow + 2).trim()
  const close = trimmed.indexOf('}', arrow)
  if (close < 0) return trimmed.slice(arrow + 2).trim()
  // "dir/{old => new}/rest" — splice the moved segment back into a plain path.
  return `${trimmed.slice(0, open)}${trimmed.slice(arrow + 2, close).trim()}${trimmed.slice(close + 1)}`.replace(/\/+/g, '/')
}

/**
 * Merge two numstat maps; entries present in both sum their counters.
 * @param primary - worktree-side counters.
 * @param secondary - index-side counters.
 * @returns one merged map safe for JSON responses.
 */
export function mergeNumstat(primary: Map<string, GitFileCount>, secondary: Map<string, GitFileCount>): Record<string, GitFileCount> {
  const merged: Record<string, GitFileCount> = {}
  for (const [path, count] of primary) {
    merged[path] = { ...count }
  }
  for (const [path, count] of secondary) {
    const existing = merged[path]
    merged[path] = existing === undefined
      ? { ...count }
      : { additions: existing.additions + count.additions, deletions: existing.deletions + count.deletions }
  }
  return merged
}

function runGit(cwd: string, args: readonly string[], timeoutMs = GIT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn('git', args, { cwd, windowsHide: true })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      rejectPromise(new Error('git command timed out'))
    }, timeoutMs)
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString('utf8') })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString('utf8') })
    child.on('error', cause => {
      clearTimeout(timer)
      rejectPromise(cause instanceof Error ? cause : new Error(String(cause)))
    })
    child.on('close', code => {
      clearTimeout(timer)
      if (code === 0) resolvePromise(stdout)
      else rejectPromise(new Error(stderr.trim().length > 0 ? stderr.trim() : `git exited with code ${String(code)}`))
    })
  })
}

/** Spawn function shape so tests can substitute a fake shell process. */
export type TerminalSpawner = (shell: string, args: readonly string[], cwd: string | undefined) => Pick<ChildProcess, 'stdin' | 'stdout'> & Partial<Pick<ChildProcess, 'pid'>> & {
  killed: boolean
  kill(): boolean
  exitCode: number | null
  on(event: 'error', listener: (cause: Error) => void): unknown
  on(event: 'close', listener: (code: number | null) => void): unknown
  on(event: string, listener: (...args: never[]) => void): unknown
}

interface OutputChunk {
  seq: number
  text: string
}

interface TerminalSession {
  id: string
  cwd: string
  chunks: OutputChunk[]
  nextSeq: number
  bytes: number
  exited: boolean
  process: ReturnType<TerminalSpawner>
}

function defaultShellCommand(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    const override = process.env.HARNESSX_WORKBENCH_SHELL
    if (override !== undefined && override.length > 0) return { shell: override, args: [] }
    return { shell: process.env.ComSpec ?? 'cmd.exe', args: [] }
  }
  const override = process.env.HARNESSX_WORKBENCH_SHELL
  if (override !== undefined && override.length > 0) return { shell: override, args: [] }
  return { shell: process.env.SHELL ?? '/bin/bash', args: [] }
}

/** Owns live terminal sessions with bounded ring-buffered output. */
export class TerminalRegistry {
  private readonly sessions = new Map<string, TerminalSession>()
  private nextId = 1

  constructor(private readonly spawner: TerminalSpawner = defaultTerminalSpawner) {}

  /** @returns currently live session descriptors. */
  list(): Array<{ id: string; cwd: string; exited: boolean }> {
    return [...this.sessions.values()].map(session => ({ id: session.id, cwd: session.cwd, exited: session.exited }))
  }

  /**
   * Spawn one persistent shell rooted at a directory.
   * @param cwd - working directory the shell starts in.
   * @returns the new session descriptor.
   */
  start(cwd: string): { id: string; cwd: string; exited: boolean } {
    if (this.sessions.size >= MAX_TERMINAL_SESSIONS) {
      throw new Error(`at most ${String(MAX_TERMINAL_SESSIONS)} terminal sessions can run at once`)
    }
    const { shell, args } = defaultShellCommand()
    const id = `term-${String(this.nextId)}`
    this.nextId += 1
    const process = this.spawner(shell, args, cwd)
    const session: TerminalSession = { id, cwd, chunks: [], nextSeq: 1, bytes: 0, exited: false, process }
    this.sessions.set(id, session)
    const push = (text: string): void => this.append(session, text)
    const stdout = process.stdout
    if (stdout !== null && stdout !== undefined) {
      stdout.on('data', (chunk: Buffer | string) => {
        push(typeof chunk === 'string' ? chunk : chunk.toString('utf8'))
      })
    }
    process.on('error', cause => {
      push(`\r\n[harnessx] failed to start shell: ${cause instanceof Error ? cause.message : String(cause)}\r\n`)
      session.exited = true
    })
    process.on('close', code => {
      push(`\r\n[harnessx] shell exited with code ${String(code)}\r\n`)
      session.exited = true
    })
    return { id, cwd, exited: false }
  }

  /**
   * Write one input line into a live session.
   * @param id - session id from start().
   * @param data - raw text; a newline is appended when missing.
   */
  write(id: string, data: string): void {
    const session = this.require(id)
    if (session.exited) throw new Error('session has exited')
    const stdin = session.process.stdin
    stdin?.write(data.endsWith('\n') ? data : `${data}\n`)
  }

  /**
   * Drain output appended after a sequence number.
   * @param id - session id from start().
   * @param after - last sequence already seen by the renderer.
   * @returns fresh chunks, the newest sequence, and liveness.
   */
  output(id: string, after: number): { chunks: OutputChunk[]; latest: number; exited: boolean } {
    const session = this.require(id)
    return {
      chunks: session.chunks.filter(chunk => chunk.seq > after),
      latest: session.nextSeq - 1,
      exited: session.exited,
    }
  }

  /**
   * Terminate one session and drop its buffer.
   * @param id - session id from start().
   */
  kill(id: string): void {
    const session = this.sessions.get(id)
    if (session === undefined) return
    this.sessions.delete(id)
    if (!session.process.killed) session.process.kill()
  }

  /** Kill every live session; used on plugin disposal. */
  disposeAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  private require(id: string): TerminalSession {
    const session = this.sessions.get(id)
    if (session === undefined) throw new Error('unknown terminal session')
    return session
  }

  private append(session: TerminalSession, text: string): void {
    let pending = text
    while (pending.length > 0) {
      const room = MAX_OUTPUT_CHUNK_BYTES - session.bytes
      if (room <= 0) {
        const dropped = session.chunks.shift()
        if (dropped !== undefined) session.bytes -= Buffer.byteLength(dropped.text)
        continue
      }
      const slice = pending.slice(0, Math.min(room, pending.length))
      session.chunks.push({ seq: session.nextSeq, text: slice })
      session.nextSeq += 1
      session.bytes += Buffer.byteLength(slice)
      pending = pending.slice(slice.length)
    }
  }
}

function defaultTerminalSpawner(shell: string, args: readonly string[], cwd: string | undefined) {
  return spawn(shell, [...args], { cwd, windowsHide: true }) as unknown as ReturnType<TerminalSpawner>
}

/** Validate a query path into an existing absolute directory. */
async function requireDirectory(value: unknown): Promise<string> {
  const dir = requireAbsolutePath(value)
  const info = await stat(dir)
  if (!info.isDirectory()) throw new Error('not a directory')
  return dir
}

function requireCwd(value: unknown): string {
  return requireAbsolutePath(value)
}

function requireStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`)
  return value.map(item => {
    if (typeof item !== 'string' || item.length === 0) throw new Error(`${field} entries must be non-empty strings`)
    return item
  })
}

/** Stable Cordis plugin name. */
export const name = 'desktop-workbench'

/** Host services required by the workbench routes. */
export const inject = ['webServer', 'desktopRuntime']

/**
 * Register the desktop workbench HTTP routes.
 * @param ctx - Host context carrying the Web carrier and desktop services.
 */
export function apply(ctx: Context): void {
  const terminals = new TerminalRegistry()
  // Read lazily at request time so headless boots without the workspace
  // service still mount the plugin; the explorer falls back to the DSH home.
  const resolveWorkspace = (): string | undefined => {
    const registry = (ctx as unknown as { get(name: string): unknown }).get('workspaceRegistry') as
      | { list(): Array<{ path: string }> }
      | undefined
    return registry?.list()[0]?.path
  }
  ctx.effect(() => {
    const disposeRoute = ctx.webServer.register({
      kind: 'prefix',
      path: WORKBENCH_ROUTE,
      handler: async (request: IncomingMessage, response: ServerResponse) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
          sendJson(response, 401, { error: 'unauthorized' })
          return
        }
        const url = new URL(request.url ?? '/', 'http://127.0.0.1')
        try {
          await routeWorkbench({
            method: request.method ?? 'GET',
            pathname: url.pathname,
            query: url.searchParams,
            body: ['POST'].includes(request.method ?? '') ? await readJsonBody(request) : undefined,
            response,
            terminals,
            workspace: resolveWorkspace,
            openAssistant: () => ctx.desktopRuntime.openAssistantWindow(),
          })
        } catch (cause) {
          sendJson(response, 500, { error: cause instanceof Error ? cause.message : String(cause) })
        }
      },
    })
    return () => {
      disposeRoute()
      terminals.disposeAll()
    }
  }, 'harnessx-desktop: workbench routes')
}

/** Request shape handed to the pure router so tests can drive it directly. */
export interface WorkbenchRequest {
  method: string
  pathname: string
  query: URLSearchParams
  body?: unknown
  response: ServerResponse
  terminals: TerminalRegistry
  /** Resolve the fixed workspace root shown by the explorer. */
  workspace?: () => string | undefined
  /** Open one auxiliary chat window mirroring the main shell. */
  openAssistant?: () => Promise<void>
}

/**
 * Dispatch one authorized workbench request.
 * @param request - parsed method/path/query/body plus the response sink.
 */
export async function routeWorkbench(request: WorkbenchRequest): Promise<void> {
  const { method, pathname, response } = request
  const subroute = pathname.slice(WORKBENCH_ROUTE.length)
  const notFound = (): void => { sendJson(response, 404, { error: 'not found' }) }
  if (method === 'GET' && subroute === '/meta') {
    sendJson(response, 200, { platform: process.platform, home: homedir(), sep: process.platform === 'win32' ? '\\' : '/' } satisfies WorkbenchMeta)
    return
  }
  if (method === 'GET' && subroute === '/workspace') {
    sendJson(response, 200, { path: request.workspace?.() })
    return
  }
  if (method === 'POST' && subroute === '/aux') {
    if (request.openAssistant === undefined) throw new Error('assistant windows are unavailable in this shell')
    await request.openAssistant()
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'GET' && subroute === '/fs') {
    const dir = await requireDirectory(request.query.get('path'))
    sendJson(response, 200, { path: dir, entries: await listDirectory(dir) })
    return
  }
  if (method === 'GET' && subroute === '/file') {
    const file = await requireAbsolutePath(request.query.get('path'))
    sendJson(response, 200, { path: file, preview: await readPreview(file) })
    return
  }
  if (method === 'POST' && subroute === '/term/start') {
    const body = (request.body ?? {}) as { cwd?: unknown }
    const cwd = body.cwd === undefined ? homedir() : requireCwd(body.cwd)
    sendJson(response, 200, request.terminals.start(cwd))
    return
  }
  if (method === 'POST' && subroute === '/term/write') {
    const body = (request.body ?? {}) as { id?: unknown; data?: unknown }
    if (typeof body.id !== 'string' || typeof body.data !== 'string') throw new Error('id and data are required')
    request.terminals.write(body.id, body.data)
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'GET' && subroute === '/term/output') {
    const id = request.query.get('id')
    const after = Number(request.query.get('after') ?? '0')
    if (id === null || !Number.isFinite(after)) throw new Error('id and after are required')
    sendJson(response, 200, request.terminals.output(id, after))
    return
  }
  if (method === 'POST' && subroute === '/term/kill') {
    const body = (request.body ?? {}) as { id?: unknown }
    if (typeof body.id !== 'string') throw new Error('id is required')
    request.terminals.kill(body.id)
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'GET' && subroute === '/git/status') {
    const cwd = await requireDirectory(request.query.get('path'))
    const raw = await runGit(cwd, ['status', '--porcelain=v2', '--branch'])
    const [worktree, index] = await Promise.all([
      runGit(cwd, ['diff', '--numstat']).catch(() => ''),
      runGit(cwd, ['diff', '--cached', '--numstat']).catch(() => ''),
    ])
    sendJson(response, 200, {
      ...parseGitStatus(raw),
      counts: mergeNumstat(parseNumstat(worktree), parseNumstat(index)),
    })
    return
  }
  if (method === 'GET' && subroute === '/git/branches') {
    const cwd = await requireDirectory(request.query.get('path'))
    const raw = await runGit(cwd, ['branch', '--format=%(refname:short)\t%(HEAD)'])
    sendJson(response, 200, { branches: parseGitBranches(raw) })
    return
  }
  if (method === 'POST' && subroute === '/git/checkout') {
    const body = (request.body ?? {}) as { cwd?: unknown; branch?: unknown; create?: unknown }
    const cwd = requireCwd(body.cwd)
    const branch = requireBranchName(body.branch)
    await runGit(cwd, body.create === true ? ['checkout', '-b', branch] : ['checkout', branch])
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'POST' && subroute === '/git/push') {
    const cwd = requireCwd((request.body ?? {}) as unknown)
    try {
      await runGit(cwd, ['push'], GIT_NETWORK_TIMEOUT_MS)
    } catch (cause) {
      const text = cause instanceof Error ? cause.message : String(cause)
      // A branch with no upstream is auto-published to the same-name remote
      // branch instead of surfacing git's setup instructions.
      if (/no upstream|set-upstream|push\.current/i.test(text)) {
        await runGit(cwd, ['push', '--set-upstream', 'origin', 'HEAD'], GIT_NETWORK_TIMEOUT_MS)
      } else {
        throw cause
      }
    }
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'POST' && subroute === '/git/pull') {
    const cwd = requireCwd((request.body ?? {}) as unknown)
    await runGit(cwd, ['pull', '--no-edit'], GIT_NETWORK_TIMEOUT_MS)
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'POST' && subroute === '/git/fetch') {
    const cwd = requireCwd((request.body ?? {}) as unknown)
    await runGit(cwd, ['fetch', '--prune'], GIT_NETWORK_TIMEOUT_MS)
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'POST' && subroute === '/git/discard') {
    const { cwd, paths } = await requireGitMutation(request.body)
    // checkout -- resets tracked worktree edits; untracked files stay untouched.
    await runGit(cwd, ['checkout', '--', ...paths])
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'POST' && subroute === '/git/stash') {
    const body = (request.body ?? {}) as { cwd?: unknown }
    const cwd = requireCwd(body.cwd)
    await runGit(cwd, ['stash', 'push', '--include-untracked', '-m', 'harnessx-desktop'])
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'GET' && subroute === '/git/stash/list') {
    const cwd = await requireDirectory(request.query.get('path'))
    // `stash list` speaks pretty-format, which does support %xNN escapes.
    const raw = await runGit(cwd, ['stash', 'list', '--format=%gd%x09%gs'])
    const entries = raw.split('\n').map(line => line.replace(/\r$/, '')).filter(line => line.length > 0).map(line => {
      const [name = '', subject = ''] = line.split('\t')
      return { name, subject }
    })
    sendJson(response, 200, { entries })
    return
  }
  if (method === 'POST' && subroute === '/git/stash/pop') {
    const body = (request.body ?? {}) as { cwd?: unknown }
    const cwd = requireCwd(body.cwd)
    await runGit(cwd, ['stash', 'pop'])
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'POST' && subroute === '/git/branch/delete') {
    const body = (request.body ?? {}) as { cwd?: unknown; branch?: unknown }
    const cwd = requireCwd(body.cwd)
    const branch = requireBranchName(body.branch)
    await runGit(cwd, ['branch', '-D', branch])
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'POST' && subroute === '/git/stage') {
    const { cwd, paths } = await requireGitMutation(request.body)
    await runGit(cwd, ['add', '--', ...paths])
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'POST' && subroute === '/git/unstage') {
    const { cwd, paths } = await requireGitMutation(request.body)
    await runGit(cwd, ['reset', '-q', 'HEAD', '--', ...paths])
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'POST' && subroute === '/git/commit') {
    const body = (request.body ?? {}) as { cwd?: unknown; message?: unknown }
    if (typeof body.message !== 'string' || body.message.trim().length === 0) throw new Error('a commit message is required')
    const cwd = requireCwd(body.cwd)
    await runGit(cwd, ['commit', '-m', body.message])
    sendJson(response, 200, { ok: true })
    return
  }
  if (method === 'GET' && subroute === '/git/log') {
    const cwd = await requireDirectory(request.query.get('path'))
    const raw = await runGit(cwd, ['log', '-n', '20', '--pretty=format:%h%x1f%s%x1f%an%x1f%at%x1e'])
    sendJson(response, 200, { entries: parseGitLog(raw) })
    return
  }
  if (method === 'GET' && subroute === '/git/diff') {
    const cwd = await requireDirectory(request.query.get('path'))
    const unstaged = summarizeNumstat(await runGit(cwd, ['diff', '--numstat']))
    const staged = summarizeNumstat(await runGit(cwd, ['diff', '--cached', '--numstat']))
    sendJson(response, 200, {
      unstaged,
      staged,
      total: {
        files: unstaged.files + staged.files,
        additions: unstaged.additions + staged.additions,
        deletions: unstaged.deletions + staged.deletions,
      },
    })
    return
  }
  notFound()
}

async function requireGitMutation(body: unknown): Promise<{ cwd: string; paths: string[] }> {
  const source = (body ?? {}) as { cwd?: unknown; paths?: unknown }
  return { cwd: requireCwd(source.cwd), paths: requireStringArray(source.paths, 'paths') }
}

function requireBranchName(value: unknown): string {
  if (typeof value !== 'string') throw new Error('a branch name is required')
  const branch = value.trim()
  if (branch.length === 0 || branch.startsWith('-') || /[\s\0]/.test(branch)) {
    throw new Error('a valid branch name is required')
  }
  return branch
}
