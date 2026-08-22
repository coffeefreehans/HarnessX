import { describe, expect, it, vi } from 'vitest'
import { generatePkcePair, GoogleAuthFlow } from '../src/google-drive.ts'
import { SyncEngine } from '../src/sync-engine.ts'
import { mkdtemp, mkdir, readFile, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import type { GoogleDriveClient, GoogleDriveFile } from '../src/google-drive.ts'

const NAME_PREFIX = 'harnessx-v3:'

interface MockRemoteFile {
  id: string
  name: string
  content: Buffer
  modifiedTime: string
  appProperties?: Record<string, string> | undefined
}

function createMockClient(remoteFiles: Map<string, MockRemoteFile>): GoogleDriveClient {
  let idCounter = 1
  return {
    listAppDataFiles: vi.fn(async () => Array.from(remoteFiles.values()).map(({ id, name, modifiedTime, appProperties }) => ({ id, name, modifiedTime, appProperties }))),
    downloadFile: vi.fn(async (fileId: string) => {
      for (const f of remoteFiles.values()) {
        if (f.id === fileId) return f.content
      }
      throw new Error('Not found')
    }),
    uploadAppDataFile: vi.fn(async (name: string, content: string | Buffer, _mimeType: string, existingFileId?: string, appProperties?: Record<string, string>) => {
      const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
      const id = existingFileId || `id_${idCounter++}`
      const now = new Date().toISOString()
      const existing = remoteFiles.get(id)
      remoteFiles.set(id, { id, name, content: buf, modifiedTime: now, appProperties: appProperties ?? existing?.appProperties })
      const file: GoogleDriveFile = { id, name, modifiedTime: now, ...(appProperties !== undefined ? { appProperties } : {}) }
      return file
    }),
    patchAppProperties: vi.fn(async (fileId: string, properties: Record<string, string>) => {
      const file = remoteFiles.get(fileId)
      if (!file) throw new Error('Not found')
      file.appProperties = { ...file.appProperties, ...properties }
    }),
    deleteFile: vi.fn(async (fileId: string) => {
      remoteFiles.delete(fileId)
    }),
  } as unknown as GoogleDriveClient
}

/** Binary stand-in for a multi-frame zstd session log. */
function fakeZstd(payload: string): Buffer {
  return Buffer.concat([Buffer.from([0x28, 0xb5, 0x2f, 0xfd]), Buffer.from(payload, 'utf8')])
}

function sha(payload: Buffer): string {
  return createHash('sha256').update(payload).digest('hex')
}

async function makeHome(): Promise<{ home: string; profileDir: string }> {
  const root = await mkdtemp(join(tmpdir(), 'sync-v3-'))
  const home = join(root, 'dsh')
  const profileDir = join(home, 'profiles', 'desktop')
  await mkdir(join(home, 'sessions'), { recursive: true })
  await mkdir(profileDir, { recursive: true })
  return { home, profileDir }
}

describe('Google Drive Sync & Auth', () => {
  it('generates valid PKCE pair', () => {
    const pkce = generatePkcePair()
    expect(pkce.verifier.length).toBeGreaterThan(30)
    expect(pkce.challenge.length).toBeGreaterThan(30)
  })

  it('builds auth URL with correct parameters', () => {
    const flow = new GoogleAuthFlow()
    const url = flow.buildAuthUrl(
      { clientId: 'test-client-id' },
      'http://127.0.0.1:8080/oauth2callback',
      'challenge123',
      'state123',
    )
    const parsed = new URL(url)
    expect(parsed.searchParams.get('client_id')).toBe('test-client-id')
    expect(parsed.searchParams.get('code_challenge')).toBe('challenge123')
  })

  it('uploads local sessions and settings under the v3 namespace with hash properties', async () => {
    const { home, profileDir } = await makeHome()
    const sessionPath = join(home, 'sessions', '--proj--', 'session-abc', 'session.jsonl.zstd')
    await mkdir(dirnameOf(sessionPath), { recursive: true })
    await writeFile(sessionPath, fakeZstd('log-a'))
    await writeFile(join(home, 'settings.yaml'), 'theme: dark\n')

    const remoteFiles = new Map<string, MockRemoteFile>()
    const client = createMockClient(remoteFiles)
    const result = await new SyncEngine(home, profileDir, client).sync({ categories: ['sessions', 'settings', 'plugins'] })

    expect(result.uploaded.sort()).toEqual(['sessions/--proj--/session-abc/session.jsonl.zstd', 'settings/settings.yaml'])
    expect(result.downloaded).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.sessionCounts).toEqual({ local: 1, remote: 1 })

    const names = new Set([...remoteFiles.values()].map(f => f.name))
    expect(names.has(`${NAME_PREFIX}${encodeURIComponent('sessions/--proj--/session-abc/session.jsonl.zstd')}`)).toBe(true)
    expect(names.has(`${NAME_PREFIX}${encodeURIComponent('settings/settings.yaml')}`)).toBe(true)
    for (const file of remoteFiles.values()) {
      if (file.name.includes('registry')) continue
      expect(file.appProperties?.sha256).toHaveLength(64)
      expect(file.appProperties?.mtimeMs).toBeDefined()
    }
    await rm(home, { recursive: true, force: true })
  })

  it('ignores legacy protocol names without the v3 prefix', async () => {
    const { home, profileDir } = await makeHome()
    const legacyName = encodeURIComponent('sessions/--proj--/session-abc/session.jsonl.zstd')
    const remoteFiles = new Map<string, MockRemoteFile>([
      ['legacy', { id: 'legacy', name: legacyName, content: fakeZstd('old-protocol'), modifiedTime: new Date().toISOString() }],
      ['legacy-manifest', { id: 'legacy-manifest', name: 'manifest.json', content: Buffer.from('{}'), modifiedTime: new Date().toISOString() }],
    ])
    const client = createMockClient(remoteFiles)
    const result = await new SyncEngine(home, profileDir, client).sync({ categories: ['sessions'] })

    // The legacy file is invisible to v3: nothing to download, no conflicts, no errors.
    expect(result.downloaded).toEqual([])
    expect(result.conflicts).toEqual([])
    expect(result.errors).toEqual([])
    expect(result.sessionCounts).toEqual({ local: 0, remote: 0 })
    await rm(home, { recursive: true, force: true })
  })

  it('downloads remote-newer sessions and uploads local-newer sessions as whole binary files', async () => {
    const { home, profileDir } = await makeHome()

    const localNewerPath = join(home, 'sessions', '--p1--', 'session-new', 'session.jsonl.zstd')
    const remoteNewerPath = join(home, 'sessions', '--p2--', 'session-old', 'session.jsonl.zstd')
    await mkdir(dirnameOf(localNewerPath), { recursive: true })
    await mkdir(dirnameOf(remoteNewerPath), { recursive: true })

    const localNewer = fakeZstd('continued-locally')
    const remoteNewerLocalCopy = fakeZstd('stale-copy')
    const remoteNewerContent = fakeZstd('continued-remotely')
    const now = Date.now()
    await writeFile(localNewerPath, localNewer)
    await writeFile(remoteNewerPath, remoteNewerLocalCopy)

    const remoteFiles = new Map<string, MockRemoteFile>([
      ['f-new', {
        id: 'f-new',
        name: `${NAME_PREFIX}${encodeURIComponent('sessions/--p1--/session-new/session.jsonl.zstd')}`,
        content: fakeZstd('old-remote'),
        modifiedTime: new Date(now - 60_000).toISOString(),
        appProperties: { sha256: sha(fakeZstd('old-remote')), mtimeMs: String(now - 60_000) },
      }],
      ['f-old', {
        id: 'f-old',
        name: `${NAME_PREFIX}${encodeURIComponent('sessions/--p2--/session-old/session.jsonl.zstd')}`,
        content: remoteNewerContent,
        modifiedTime: new Date(now + 60_000).toISOString(),
        appProperties: { sha256: sha(remoteNewerContent), mtimeMs: String(now + 60_000) },
      }],
    ])
    const client = createMockClient(remoteFiles)
    const engine = new SyncEngine(home, profileDir, client)
    const result = await engine.sync({ categories: ['sessions'] })

    expect(result.uploaded).toEqual(['sessions/--p1--/session-new/session.jsonl.zstd'])
    expect(result.downloaded).toEqual(['sessions/--p2--/session-old/session.jsonl.zstd'])
    // Whole binary transfer: local file now holds the remote bytes exactly.
    expect(await readFile(remoteNewerPath)).toEqual(remoteNewerContent)
    // And Drive holds the locally-continued bytes exactly.
    expect(remoteFiles.get('f-new')?.content).toEqual(localNewer)
    // The shared "last sync" time is the newest Drive write, not this machine's clock.
    expect(result.lastRemoteChangeMs).toBeGreaterThanOrEqual(now + 60_000)
    expect(result.errors).toEqual([])
    await rm(home, { recursive: true, force: true })
  })

  it('skips sessions whose stored hash already matches local content', async () => {
    const { home, profileDir } = await makeHome()
    const content = fakeZstd('stable-session')
    const sessionPath = join(home, 'sessions', '--p--', 'session-stable', 'session.jsonl.zstd')
    await mkdir(dirnameOf(sessionPath), { recursive: true })
    await writeFile(sessionPath, content)

    const remoteFiles = new Map<string, MockRemoteFile>([
      ['f', {
        id: 'f',
        name: `${NAME_PREFIX}${encodeURIComponent('sessions/--p--/session-stable/session.jsonl.zstd')}`,
        content,
        modifiedTime: new Date().toISOString(),
        appProperties: { sha256: sha(content), mtimeMs: String(Date.now()) },
      }],
    ])
    const client = createMockClient(remoteFiles)
    const result = await new SyncEngine(home, profileDir, client).sync({ categories: ['sessions'] })

    expect(result.uploaded).toEqual([])
    expect(result.downloaded).toEqual([])
    expect(client.downloadFile).not.toHaveBeenCalled()
    await rm(home, { recursive: true, force: true })
  })

  it('flags differing settings as conflicts and resolves them both directions', async () => {
    const { home, profileDir } = await makeHome()
    const localPath = join(home, 'settings.yaml')
    await writeFile(localPath, 'local: true\n')
    const remoteContent = Buffer.from('remote: true\n', 'utf8')
    const now = Date.now()

    const remoteFiles = new Map<string, MockRemoteFile>([
      ['s', {
        id: 's',
        name: `${NAME_PREFIX}${encodeURIComponent('settings/settings.yaml')}`,
        content: remoteContent,
        modifiedTime: new Date(now).toISOString(),
        appProperties: { sha256: sha(remoteContent), mtimeMs: String(now) },
      }],
    ])
    const client = createMockClient(remoteFiles)
    const engine = new SyncEngine(home, profileDir, client)
    const result = await engine.sync({ categories: ['settings'] })

    expect(result.conflicts).toHaveLength(1)
    const conflict = result.conflicts[0]!
    expect(conflict.key).toBe('settings/settings.yaml')
    expect(await readFile(localPath, 'utf8')).toBe('local: true\n')

    await engine.downloadOverwrite(conflict)
    expect(await readFile(localPath, 'utf8')).toBe('remote: true\n')

    await writeFile(localPath, 'local-wins: true\n')
    await engine.uploadOverwrite(conflict)
    expect(remoteFiles.get('s')?.content.toString('utf8')).toBe('local-wins: true\n')
    await rm(home, { recursive: true, force: true })
  })

  it('derives pending installs and merges the plugin registry from profile bundles', async () => {
    const { home, profileDir } = await makeHome()
    // Profile manifest: one local plugin installed (npm exact), dependency declaration portable.
    await writeFile(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-desktop',
      dependencies: { 'dsh-better-sidebar': '0.12.2' },
      dsh: { profile: { bundles: [
        '@deepseek-ai/dsh-web-app',
        'harnessx-desktop/market',
        'dsh-better-sidebar',
      ] } },
    }))
    await mkdir(join(profileDir, 'node_modules', 'dsh-better-sidebar'), { recursive: true })
    await writeFile(join(profileDir, 'node_modules', 'dsh-better-sidebar', 'package.json'), JSON.stringify({ name: 'dsh-better-sidebar', version: '0.12.2' }))

    const registry = [{ name: 'dsh-import-agents', installSpec: 'github:Chang-Tong/dsh-import-agents', version: '0.2.6', installedAt: 1 }]
    const registryName = `${NAME_PREFIX}${encodeURIComponent('plugins/registry.json')}`
    const remoteFiles = new Map<string, MockRemoteFile>([
      ['reg', { id: 'reg', name: registryName, content: Buffer.from(JSON.stringify(registry)), modifiedTime: new Date().toISOString() }],
    ])
    const client = createMockClient(remoteFiles)
    const result = await new SyncEngine(home, profileDir, client).sync({ categories: ['plugins'] })

    expect(result.pendingInstalls).toEqual([
      { name: 'dsh-import-agents', installSpec: 'github:Chang-Tong/dsh-import-agents', version: '0.2.6' },
    ])
    const merged = JSON.parse(remoteFiles.get('reg')!.content.toString('utf8')) as Array<{ name: string; installSpec: string }>
    const mergedNames = merged.map(record => record.name).sort()
    expect(mergedNames).toEqual(['dsh-better-sidebar', 'dsh-import-agents'])
    const sidebar = merged.find(record => record.name === 'dsh-better-sidebar')!
    expect(sidebar.installSpec).toBe('dsh-better-sidebar@0.12.2')
    expect(result.errors).toEqual([])
    await rm(home, { recursive: true, force: true })
  })

  it('resetCloud deletes every remote file so a following sync republishes from local', async () => {
    const { home, profileDir } = await makeHome()
    const sessionPath = join(home, 'sessions', '--p--', 'session-x', 'session.jsonl.zstd')
    await mkdir(dirnameOf(sessionPath), { recursive: true })
    await writeFile(sessionPath, fakeZstd('fresh'))

    const remoteFiles = new Map<string, MockRemoteFile>([
      ['legacy', { id: 'legacy', name: 'manifest.json', content: Buffer.from('{}'), modifiedTime: new Date().toISOString() }],
      ['legacy2', { id: 'legacy2', name: encodeURIComponent('settings/settings.yaml'), content: Buffer.from('old'), modifiedTime: new Date().toISOString() }],
    ])
    const client = createMockClient(remoteFiles)
    const engine = new SyncEngine(home, profileDir, client)

    const deleted = await engine.resetCloud()
    expect(deleted).toBe(2)
    expect(remoteFiles.size).toBe(0)

    const result = await engine.sync({ categories: ['sessions'] })
    expect(result.uploaded).toEqual(['sessions/--p--/session-x/session.jsonl.zstd'])
    expect([...remoteFiles.values()].every(f => f.name.startsWith(NAME_PREFIX))).toBe(true)
    await rm(home, { recursive: true, force: true })
  })
})

function dirnameOf(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index === -1 ? '.' : path.slice(0, index)
}
