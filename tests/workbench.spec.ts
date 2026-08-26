import { execSync } from 'node:child_process'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import {
  apply,
  buildUntrackedPatch,
  countTextLines,
  listDirectory,
  mergeNumstat,
  parseGitBranches,
  parseGitLog,
  parseGitStatus,
  parseNumstat,
  readPreview,
  requireAbsolutePath,
  requireRelPath,
  resolveSessionWorkspace,
  routeWorkbench,
  summarizeNumstat,
  TerminalRegistry,
  windowsCodePageDecoderLabel,
  type TerminalSpawner,
} from '../src/workbench.ts'

function jsonResponse(): { response: ServerResponse; result: () => { status: number; body: string } } {
  const capture = { status: 0, body: '' }
  const response = {
    writeHead: vi.fn((status: number) => { capture.status = status }),
    end: vi.fn((body?: string) => { capture.body = body ?? '' }),
  } as unknown as ServerResponse
  return { response, result: () => capture }
}

function getRequest(pathname: string): IncomingMessage {
  return { method: 'GET', url: `http://127.0.0.1${pathname}`, headers: {} } as unknown as IncomingMessage
}

const hasGit = (() => {
  try {
    execSync('git --version', { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
})()

async function makeWorkspace(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'workbench-'))
  await writeFile(join(dir, 'hello.txt'), 'hello workbench')
  await mkdir(join(dir, 'sub'), { recursive: true })
  return dir
}

describe('path and parsing helpers', () => {
  it('requireAbsolutePath accepts only absolute path strings', () => {
    expect(requireAbsolutePath(join('D:\\', 'x', 'y'))).toBe(resolve('D:\\', 'x', 'y'))
    expect(requireAbsolutePath('/tmp/x')).toBe(resolve('/tmp/x'))
    expect(() => requireAbsolutePath('relative/path')).toThrow('absolute path')
    expect(() => requireAbsolutePath('D:\\x\0y')).toThrow('absolute path')
    expect(() => requireAbsolutePath(42)).toThrow('absolute path')
  })

  it('listDirectory sorts directories before files', async () => {
    const dir = await makeWorkspace()
    const entries = await listDirectory(dir)
    expect(entries.map(entry => entry.name)).toEqual(['sub', 'hello.txt'])
    expect(entries[0]?.kind).toBe('directory')
    expect(entries[1]?.kind).toBe('file')
  })

  it('readPreview returns bounded text', async () => {
    const dir = await makeWorkspace()
    const preview = await readPreview(join(dir, 'hello.txt'))
    expect(preview.text).toBe('hello workbench')
    expect(preview.truncated).toBe(false)
    expect(preview.binary).toBe(false)

    await writeFile(join(dir, 'blob.bin'), Buffer.from([0x00, 0x01, 0x02]))
    const binary = await readPreview(join(dir, 'blob.bin'))
    expect(binary.binary).toBe(true)
    expect(binary.text).toBe('')
  })

  it('parseGitStatus reads the v2 branch header, renames, and untracked rows', () => {
    const status = parseGitStatus([
      '# branch.oid abc123',
      '# branch.head main',
      '# branch.ab +2 -1',
      '1 A. N... 000000 000000 1234567 0000000 1234567 src/a.ts',
      '2 R. N... 100644 100644 100644 oldsha newsha R100 space in name.ts\told name.ts',
      '? notes.md',
      '',
    ].join('\n'))

    expect(status.branch).toBe('main')
    expect(status.ahead).toBe(2)
    expect(status.behind).toBe(1)
    expect(status.entries).toEqual([
      { x: 'A', y: ' ', path: 'src/a.ts' },
      { x: 'R', y: ' ', path: 'space in name.ts', origPath: 'old name.ts' },
      { x: '?', y: '?', path: 'notes.md' },
    ])
  })

  it('parseGitLog splits unit/record separators into rows', () => {
    const log = parseGitLog(['h1\x1ffirst\x1fann\x1f1700000000\x1e', '', 'h2\x1fsecond\x1fbob\x1f1700000100\x1e', ''].join('\n'))
    expect(log).toEqual([
      { abbrev: 'h1', subject: 'first', author: 'ann', time: 1700000000 },
      { abbrev: 'h2', subject: 'second', author: 'bob', time: 1700000100 },
    ])
  })

  it('summarizeNumstat treats binary dashes as zero', () => {
    const summary = summarizeNumstat(['10\t2\ta.ts', '-\t-\tb.png', ''].join('\n'))
    expect(summary).toEqual({ files: 2, additions: 10, deletions: 2 })
  })

  it('parseNumstat keys renames by destination and keeps binary rows as zero', () => {
    const counts = parseNumstat([
      '10\t2\tsrc/a.ts',
      '-\t-\timg.png',
      '3\t1\told.ts => new.ts',
      '4\t0\tnested/{old => new}/deep.ts',
      '',
    ].join('\n'))
    expect(counts.get('src/a.ts')).toEqual({ additions: 10, deletions: 2 })
    expect(counts.get('img.png')).toEqual({ additions: 0, deletions: 0 })
    expect(counts.get('new.ts')).toEqual({ additions: 3, deletions: 1 })
    expect(counts.get('nested/new/deep.ts')).toEqual({ additions: 4, deletions: 0 })
  })

  it('mergeNumstat sums counters for files present on both sides', () => {
    const merged = mergeNumstat(
      new Map([['a.ts', { additions: 10, deletions: 2 }], ['b.ts', { additions: 1, deletions: 0 }]]),
      new Map([['a.ts', { additions: 5, deletions: 1 }]]),
    )
    expect(merged['a.ts']).toEqual({ additions: 15, deletions: 3 })
    expect(merged['b.ts']).toEqual({ additions: 1, deletions: 0 })
  })

  it('parseGitBranches marks the checked-out branch', () => {
    expect(parseGitBranches(['main\t*', 'feature/x\t ', ''].join('\n'))).toEqual([
      { name: 'main', current: true },
      { name: 'feature/x', current: false },
    ])
  })

  it('countTextLines counts rendered lines like numstat additions', () => {
    expect(countTextLines('')).toBe(0)
    expect(countTextLines('one')).toBe(1)
    expect(countTextLines('one\ntwo')).toBe(2)
    expect(countTextLines('one\ntwo\n')).toBe(2)
  })

  it('buildUntrackedPatch presents the whole file as additions', () => {
    const patch = buildUntrackedPatch('temp/new.ts', 'alpha\nbeta\n')
    expect(patch.split('\n')).toEqual([
      '--- /dev/null',
      '+++ b/temp/new.ts',
      '@@ -0,0 +1,2 @@',
      '+alpha',
      '+beta',
    ])
    expect(buildUntrackedPatch('empty.txt', '')).toBe('')
  })

  it('requireRelPath accepts only safe repository-relative paths', () => {
    expect(requireRelPath('src/client/workbench.tsx')).toBe('src/client/workbench.tsx')
    expect(requireRelPath('\\temp\\new.ts')).toBe('temp/new.ts')
    expect(requireRelPath('/leading/slash')).toBe('leading/slash')
    expect(() => requireRelPath('')).toThrow('repository-relative')
    expect(() => requireRelPath('../secrets')).toThrow('repository-relative')
    expect(() => requireRelPath('a/../../b')).toThrow('repository-relative')
    expect(() => requireRelPath('a//b')).toThrow('repository-relative')
    expect(() => requireRelPath(42)).toThrow('repository-relative')
  })
})

describe('TerminalRegistry with a fake spawner', () => {
  interface FakeProcess {
    stdinWrites: string[]
    emitData(chunk: string | Buffer): void
    emitClose(code: number | null): void
    emitError(cause: Error): void
    killed: boolean
  }

  /** Build a registry whose shells are controllable fakes. */
  function makeHarness(encoding?: string): { registry: TerminalRegistry; processes: FakeProcess[] } {
    const processes: FakeProcess[] = []
    const spawner = (_shell: string, _args: readonly string[], _cwd: string | undefined) => {
      const dataListeners: Array<(chunk: Buffer | string) => void> = []
      const closeListeners: Array<(code: number | null) => void> = []
      const errorListeners: Array<(cause: Error) => void> = []
      const writes: string[] = []
      let killed = false
      const process = {
        stdin: { write: (data: string): void => { writes.push(data) } },
        stdout: {
          on: (event: 'data', listener: (chunk: Buffer | string) => void): void => {
            if (event === 'data') dataListeners.push(listener)
          },
          emit: (chunk: string): void => { for (const listener of dataListeners) listener(chunk) },
        },
        get killed(): boolean { return killed },
        kill: (): boolean => {
          killed = true
          for (const listener of closeListeners) listener(null)
          return true
        },
        exitCode: null,
        on: (event: 'error' | 'close', listener: never): void => {
          if (event === 'error') errorListeners.push(listener as unknown as (cause: Error) => void)
          else closeListeners.push(listener as unknown as (code: number | null) => void)
        },
      }
      const fake = process as unknown as FakeProcess & typeof process
      fake.stdinWrites = writes
      fake.emitData = process.stdout.emit
      fake.emitClose = code => { for (const listener of closeListeners) listener(code) }
      fake.emitError = cause => { for (const listener of errorListeners) listener(cause) }
      processes.push(fake)
      return process as unknown as ReturnType<TerminalSpawner>
    }
    return {
      registry: encoding === undefined
        ? new TerminalRegistry(spawner as ConstructorParameters<typeof TerminalRegistry>[0])
        : new TerminalRegistry(spawner as ConstructorParameters<typeof TerminalRegistry>[0], encoding),
      processes,
    }
  }

  it('drains output chunks by sequence and reports exit', () => {
    const { registry, processes } = makeHarness()
    const session = registry.start('/tmp')
    expect(registry.list()).toEqual([{ id: session.id, cwd: '/tmp', exited: false }])
    expect(session.exited).toBe(false)

    // Writes gain a trailing newline.
    registry.write(session.id, 'echo hi')

    const shell = processes[0]
    expect(shell?.stdinWrites).toEqual(['echo hi\n'])

    shell?.emitData('hello ')
    shell?.emitData('world\n')
    const all = registry.output(session.id, 0)
    expect(all.chunks.map(chunk => chunk.text).join('')).toBe('hello world\n')
    expect(all.exited).toBe(false)

    // after=<latest> returns only fresher chunks.
    shell?.emitData('more\n')
    const fresh = registry.output(session.id, all.latest)
    expect(fresh.chunks.map(chunk => chunk.text).join('')).toBe('more\n')
    expect(fresh.latest).toBeGreaterThan(all.latest)

    shell?.emitClose(0)
    expect(registry.output(session.id, 0).exited).toBe(true)
    expect(() => registry.write(session.id, 'again')).toThrow('exited')
  })

  it('surfaces spawn failures as transcript text and an exited flag', () => {
    const { registry, processes } = makeHarness()
    const session = registry.start('/tmp')
    processes[0]?.emitError(new Error('no such shell'))
    const output = registry.output(session.id, 0)
    expect(output.exited).toBe(true)
    expect(output.chunks.map(chunk => chunk.text).join('')).toContain('no such shell')
  })

  it('decodes console-code-page bytes split across chunks (GBK)', () => {
    const { registry, processes } = makeHarness('gbk')
    const session = registry.start('/tmp')
    const shell = processes[0]
    // "你好" in GBK; the two characters arrive in separate read events.
    shell?.emitData(Buffer.from([0xc4, 0xe3]))
    shell?.emitData(Buffer.from([0xba, 0xc3]))
    const output = registry.output(session.id, 0)
    expect(output.chunks.map(chunk => chunk.text).join('')).toBe('你好')
  })

  it('maps console code pages to decoder labels', () => {
    expect(windowsCodePageDecoderLabel(65001)).toBe('utf-8')
    expect(windowsCodePageDecoderLabel(936)).toBe('gbk')
    expect(windowsCodePageDecoderLabel(950)).toBe('big5')
    expect(windowsCodePageDecoderLabel(932)).toBe('shift_jis')
    expect(windowsCodePageDecoderLabel(949)).toBe('euc-kr')
    expect(windowsCodePageDecoderLabel(866)).toBe('ibm866')
    expect(windowsCodePageDecoderLabel(1252)).toBe('windows-1252')
  })

  it('kills sessions individually and on disposeAll', () => {
    const { registry, processes } = makeHarness()
    const first = registry.start('/tmp')
    const second = registry.start('/tmp')
    expect(second.id).not.toBe(first.id)

    registry.kill(first.id)
    expect(processes[0]?.killed).toBe(true)
    expect(processes[1]?.killed).toBe(false)
    expect(() => registry.output(first.id, 0)).toThrow('unknown terminal session')

    registry.kill(first.id) // idempotent
    registry.disposeAll()
    expect(processes[1]?.killed).toBe(true)
    expect(registry.list()).toEqual([])
  })

  it('caps concurrent sessions', () => {
    const { registry } = makeHarness()
    for (let index = 0; index < 8; index += 1) registry.start('/tmp')
    expect(() => registry.start('/tmp')).toThrow('at most 8')
  })

  it('routes the terminal lifecycle over HTTP against the real shell', async () => {
    const real = new TerminalRegistry()
    const started = jsonResponse()
    await routeWorkbench({
      method: 'POST',
      pathname: '/api/desktop/workbench/term/start',
      query: new URLSearchParams(),
      body: {},
      response: started.response,
      terminals: real,
    })
    expect(started.result().status).toBe(200)
    const id = (JSON.parse(started.result().body) as { id: string }).id

    await routeWorkbench({
      method: 'POST',
      pathname: '/api/desktop/workbench/term/write',
      query: new URLSearchParams(),
      body: { id, data: 'exit\r\n' },
      response: jsonResponse().response,
      terminals: real,
    })

    // Wait briefly for the shell to exit so the poll observes liveness flips.
    await new Promise(resolve => setTimeout(resolve, 400))
    const polled = jsonResponse()
    await routeWorkbench({
      method: 'GET',
      pathname: '/api/desktop/workbench/term/output',
      query: new URLSearchParams({ id }),
      body: undefined,
      response: polled.response,
      terminals: real,
    })
    const payload = JSON.parse(polled.result().body) as { exited: boolean; latest: number }
    expect(payload.exited).toBe(true)
    expect(payload.latest).toBeGreaterThan(0)
    real.disposeAll()
  })
})

describe('routeWorkbench dispatch', () => {
  it('answers meta, fs listing, and 404 for unknown subroutes', async () => {
    const terminals = new TerminalRegistry()

    const meta = jsonResponse()
    await routeWorkbench({ method: 'GET', pathname: '/api/desktop/workbench/meta', query: new URLSearchParams(), body: undefined, response: meta.response, terminals })
    expect(meta.result().status).toBe(200)
    const metaBody = JSON.parse(meta.result().body) as { platform: string; home: string; sep: string }
    expect(metaBody.platform).toBe(process.platform)
    expect(metaBody.home.length).toBeGreaterThan(0)
    expect(['/','\\']).toContain(metaBody.sep)

    const dir = await makeWorkspace()
    const fs = jsonResponse()
    await routeWorkbench({
      method: 'GET',
      pathname: '/api/desktop/workbench/fs',
      query: new URLSearchParams({ path: dir }),
      body: undefined,
      response: fs.response,
      terminals,
    })
    expect(fs.result().status).toBe(200)
    const fsBody = JSON.parse(fs.result().body) as { entries: Array<{ name: string }> }
    expect(fsBody.entries.map(entry => entry.name)).toEqual(['sub', 'hello.txt'])

    const missing = jsonResponse()
    await routeWorkbench({
      method: 'GET',
      pathname: '/api/desktop/workbench/nothing',
      query: new URLSearchParams(),
      body: undefined,
      response: missing.response,
      terminals,
    })
    expect(missing.result().status).toBe(404)

    const badPath = jsonResponse()
    await expect(routeWorkbench({
      method: 'GET',
      pathname: '/api/desktop/workbench/fs',
      query: new URLSearchParams({ path: 'nope' }),
      body: undefined,
      response: badPath.response,
      terminals,
    })).rejects.toThrow('an absolute path is required')
    // The router stays pure: nothing was written for a rejected request.
    expect(badPath.result().status).toBe(0)
  })

  it('reports the host workspace and only opens aux windows when supported', async () => {
    const terminals = new TerminalRegistry()

    const present = jsonResponse()
    await routeWorkbench({
      method: 'GET',
      pathname: '/api/desktop/workbench/workspace',
      query: new URLSearchParams(),
      body: undefined,
      response: present.response,
      terminals,
      workspace: () => join('D:\\', 'code'),
    })
    expect(present.result().status).toBe(200)
    expect(JSON.parse(present.result().body)).toEqual({ path: resolve('D:\\', 'code') })

    // The active session id rides the query so the resolver can follow it.
    const followed = jsonResponse()
    const seenSessionIds: Array<string | undefined> = []
    await routeWorkbench({
      method: 'GET',
      pathname: '/api/desktop/workbench/workspace',
      query: new URLSearchParams({ sessionId: 'sess-b' }),
      body: undefined,
      response: followed.response,
      terminals,
      workspace: (sessionId) => {
        seenSessionIds.push(sessionId)
        return sessionId === 'sess-b' ? join('D:\\', 'other') : join('D:\\', 'code')
      },
    })
    expect(followed.result().status).toBe(200)
    expect(JSON.parse(followed.result().body)).toEqual({ path: resolve('D:\\', 'other') })
    expect(seenSessionIds).toEqual(['sess-b'])

    const absent = jsonResponse()
    await routeWorkbench({
      method: 'GET',
      pathname: '/api/desktop/workbench/workspace',
      query: new URLSearchParams(),
      body: undefined,
      response: absent.response,
      terminals,
      workspace: () => undefined,
    })
    expect(absent.result().status).toBe(200)
    expect(JSON.parse(absent.result().body)).toEqual({})

    const opened: string[] = []
    const aux = jsonResponse()
    await routeWorkbench({
      method: 'POST',
      pathname: '/api/desktop/workbench/aux',
      query: new URLSearchParams(),
      body: {},
      response: aux.response,
      terminals,
      openAssistant: async () => { opened.push('aux') },
    })
    expect(aux.result().status).toBe(200)
    expect(opened).toEqual(['aux'])

    const unsupported = jsonResponse()
    await expect(routeWorkbench({
      method: 'POST',
      pathname: '/api/desktop/workbench/aux',
      query: new URLSearchParams(),
      body: {},
      response: unsupported.response,
      terminals,
    })).rejects.toThrow('assistant windows are unavailable')
    expect(unsupported.result().status).toBe(0)
  })

  it('runs a full git cycle against a scratch repository', async () => {
    if (!hasGit) return
    const dir = await makeWorkspace()
    execSync('git init -q', { cwd: dir })
    execSync('git config user.email test@example.com', { cwd: dir })
    execSync('git config user.name test', { cwd: dir })
    execSync('git add -A', { cwd: dir })
    execSync('git commit -q -m init', { cwd: dir })
    await writeFile(join(dir, 'tracked.txt'), 'one\n')
    const terminals = new TerminalRegistry()
    const call = async (method: 'GET' | 'POST', subroute: string, body?: unknown, extraQuery?: Record<string, string>): Promise<{ status: number; json: () => any }> => {
      const captured = jsonResponse()
      await routeWorkbench({
        method,
        pathname: `/api/desktop/workbench/git/${subroute}`,
        query: method === 'GET' ? new URLSearchParams({ path: dir, ...extraQuery }) : new URLSearchParams(),
        ...(method === 'POST' ? { body } : { body: undefined }),
        response: captured.response,
        terminals,
      })
      const result = captured.result()
      return { status: result.status, json: () => JSON.parse(result.body) }
    }

    const staged = await call('POST', 'stage', { cwd: dir, paths: ['tracked.txt'] })
    expect(staged.status).toBe(200)

    const status = await call('GET', 'status')
    expect(status.status).toBe(200)
    const statusBody = status.json() as { entries: Array<{ x: string; path: string }> }
    expect(statusBody.entries[0]).toMatchObject({ x: 'A', path: 'tracked.txt' })

    const committed = await call('POST', 'commit', { cwd: dir, message: 'add tracked file' })
    expect(committed.status).toBe(200)

    const clean = await call('GET', 'status')
    const cleanBody = clean.json() as { entries: unknown[]; branch?: string }
    expect(cleanBody.entries).toEqual([])
    expect(typeof cleanBody.branch).toBe('string')

    const log = await call('GET', 'log')
    const logBody = log.json() as { entries: Array<{ subject: string }> }
    expect(logBody.entries.map(entry => entry.subject)).toContain('add tracked file')

    const diff = await call('GET', 'diff')
    const diffBody = diff.json() as { total: { files: number } }
    expect(diffBody.total.files).toBe(0)

    await writeFile(join(dir, 'tracked.txt'), 'one\ntwo\n')
    const unstaged = await call('GET', 'diff')
    const unstagedBody = unstaged.json() as { total: { files: number; additions: number } }
    expect(unstagedBody.total.files).toBe(1)
    expect(unstagedBody.total.additions).toBe(1)

    // Per-file +/- counters ride along with the status payload.
    const counted = await call('GET', 'status')
    const countedBody = counted.json() as { counts: Record<string, { additions: number; deletions: number }> }
    expect(countedBody.counts['tracked.txt']).toEqual({ additions: 1, deletions: 0 })

    // Untracked directories expand into their files (-uall), each carrying
    // synthesized "every line is an addition" counters.
    await mkdir(join(dir, 'temp', 'nested'), { recursive: true })
    await writeFile(join(dir, 'temp', 'nested', 'new.ts'), 'alpha\nbeta\n')
    const expanded = await call('GET', 'status')
    const expandedBody = expanded.json() as {
      entries: Array<{ x: string; path: string }>
      counts: Record<string, { additions: number; deletions: number }>
    }
    expect(expandedBody.entries.some(entry => entry.x === '?' && entry.path === 'temp/nested/new.ts')).toBe(true)
    expect(expandedBody.counts['temp/nested/new.ts']).toEqual({ additions: 2, deletions: 0 })

    // Per-file patches: modified file diffs against HEAD, untracked file is a
    // synthesized whole-file patch, untouched file comes back empty.
    const modifiedPatch = await call('GET', 'patch', undefined, { file: 'tracked.txt' })
    const modifiedBody = modifiedPatch.json() as { patch: string }
    expect(modifiedBody.patch).toContain('--- a/tracked.txt')
    expect(modifiedBody.patch).toContain('+two')
    const untrackedPatch = await call('GET', 'patch', undefined, { file: 'temp/nested/new.ts' })
    const untrackedBody = untrackedPatch.json() as { patch: string }
    expect(untrackedBody.patch).toContain('+++ b/temp/nested/new.ts')
    expect(untrackedBody.patch).toContain('+alpha')
    const cleanPatch = await call('GET', 'patch', undefined, { file: 'hello.txt' })
    expect((cleanPatch.json() as { patch: string }).patch).toBe('')
    await expect(call('GET', 'patch', undefined, { file: '../escape' })).rejects.toThrow()

    // Branch creation, listing, and switching through the dedicated routes.
    const initialBranch = typeof cleanBody.branch === 'string' ? cleanBody.branch : 'main'
    const created = await call('POST', 'checkout', { cwd: dir, branch: 'feature/x', create: true })
    expect(created.status).toBe(200)
    const branches = await call('GET', 'branches')
    const branchesBody = branches.json() as { branches: Array<{ name: string; current: boolean }> }
    expect(branchesBody.branches.find(branch => branch.name === 'feature/x')?.current).toBe(true)
    const back = await call('POST', 'checkout', { cwd: dir, branch: initialBranch })
    expect(back.status).toBe(200)
    await expect(call('POST', 'checkout', { cwd: dir, branch: '-oProxyCommand=evil' })).rejects.toThrow()

    // Discard resets tracked worktree edits back to the committed content
    // ('one\n'; the 'two' edit was never staged or committed).
    await writeFile(join(dir, 'tracked.txt'), 'destroyed\n')
    const discarded = await call('POST', 'discard', { cwd: dir, paths: ['tracked.txt'] })
    expect(discarded.status).toBe(200)
    // autocrlf may check the content back out with CRLF line endings.
    expect((await readFile(join(dir, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe('one\n')

    // Stash push clears the worktree; pop restores it.
    await writeFile(join(dir, 'tracked.txt'), 'stashed\n')
    const stashed = await call('POST', 'stash', { cwd: dir })
    expect(stashed.status).toBe(200)
    const stashList = await call('GET', 'stash/list')
    expect((stashList.json() as { entries: unknown[] }).entries).toHaveLength(1)
    expect(((await call('GET', 'status')).json() as { entries: unknown[] }).entries).toEqual([])
    const popped = await call('POST', 'stash/pop', { cwd: dir })
    expect(popped.status).toBe(200)
    expect((await readFile(join(dir, 'tracked.txt'), 'utf8')).replace(/\r\n/g, '\n')).toBe('stashed\n')
    await call('POST', 'discard', { cwd: dir, paths: ['tracked.txt'] })

    // Force-deleting a branch removes it from the listing.
    await call('POST', 'checkout', { cwd: dir, branch: 'doomed', create: true })
    await call('POST', 'checkout', { cwd: dir, branch: initialBranch })
    const deleted = await call('POST', 'branch/delete', { cwd: dir, branch: 'doomed' })
    expect(deleted.status).toBe(200)
    const afterDelete = await call('GET', 'branches')
    expect((afterDelete.json() as { branches: Array<{ name: string }> }).branches.map(b => b.name))
      .not.toContain('doomed')
  })

  it('keys status rows workspace-relative when the workspace is a repo subdirectory', async () => {
    if (!hasGit) return
    const dir = await makeWorkspace()
    execSync('git init -q', { cwd: dir })
    execSync('git config user.email test@example.com', { cwd: dir })
    execSync('git config user.name test', { cwd: dir })
    await mkdir(join(dir, 'pkg', 'inner'), { recursive: true })
    await writeFile(join(dir, 'pkg', 'inner', 'mod.txt'), 'base\n')
    execSync('git add -A', { cwd: dir })
    execSync('git commit -q -m init', { cwd: dir })
    await writeFile(join(dir, 'pkg', 'inner', 'mod.txt'), 'changed\n')
    await writeFile(join(dir, 'pkg', 'inner', 'fresh.txt'), 'one\n')
    const captured = jsonResponse()
    await routeWorkbench({
      method: 'GET',
      pathname: '/api/desktop/workbench/git/status',
      query: new URLSearchParams({ path: join(dir, 'pkg') }),
      body: undefined,
      response: captured.response,
      terminals: new TerminalRegistry(),
    })
    const body = JSON.parse(captured.result().body) as {
      entries: Array<{ path: string }>
      counts: Record<string, { additions: number; deletions: number }>
    }
    // Porcelain paths arrive repo-root-relative ('pkg/inner/...') and must be
    // reported relative to the queried workspace, with outside rows dropped.
    expect(body.entries.map(entry => entry.path).sort()).toEqual(['inner/fresh.txt', 'inner/mod.txt'])
    expect(body.counts['inner/mod.txt']).toEqual({ additions: 1, deletions: 1 })
    expect(body.counts['inner/fresh.txt']).toEqual({ additions: 1, deletions: 0 })
  })
})

describe('plugin registration', () => {
  it('registers one authorized prefix route and rejects unauthenticated calls', async () => {
    type Route = { kind: string; path: string; handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void }
    const registered: Route[] = []
    let disposeEffect = (): void => {}
    const ctx = {
      webServer: {
        register: vi.fn((route: Route) => {
          registered.push(route)
          return () => {}
        }),
      },
      desktopRuntime: {
        authorizeLocalApiRequest: vi.fn(() => false),
      },
      effect: vi.fn((factory: () => () => void) => {
        disposeEffect = factory()
        return disposeEffect
      }),
    } as unknown as Context

    apply(ctx)
    expect(vi.mocked(ctx.effect)).toHaveBeenCalledTimes(1)
    expect(registered).toHaveLength(1)
    expect(registered[0]).toMatchObject({ kind: 'prefix', path: '/api/desktop/workbench' })
    expect(typeof disposeEffect).toBe('function')

    // The handler must reject requests that fail local authorization.
    const captured = jsonResponse()
    await registered[0]?.handler(getRequest('/api/desktop/workbench/meta'), captured.response)
    expect(captured.result().status).toBe(401)
    expect(JSON.parse(captured.result().body)).toEqual({ error: 'unauthorized' })

    // Disposal must not throw even though no terminal ever started.
    expect(() => disposeEffect()).not.toThrow()
  })
})

describe('resolveSessionWorkspace', () => {
  const rows = [
    { path: 'C:\proj-a', sessionIds: ['s1', 's2'] },
    { path: 'C:\proj-b', sessionIds: ['s3'] },
    { path: 'C:\proj-c' },
  ]

  it('follows the workspace owning the active session', () => {
    expect(resolveSessionWorkspace(rows, 's3')).toBe('C:\proj-b')
    expect(resolveSessionWorkspace(rows, 's1')).toBe('C:\proj-a')
  })

  it('falls back to the first registry row when nothing owns the session', () => {
    expect(resolveSessionWorkspace(rows, 'unknown')).toBe('C:\proj-a')
    expect(resolveSessionWorkspace(rows)).toBe('C:\proj-a')
  })

  it('returns undefined for an empty registry', () => {
    expect(resolveSessionWorkspace([], 's1')).toBeUndefined()
    expect(resolveSessionWorkspace([])).toBeUndefined()
  })
})
