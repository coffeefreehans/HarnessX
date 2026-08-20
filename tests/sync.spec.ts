import { describe, expect, it, vi } from 'vitest'
import { generatePkcePair, GoogleAuthFlow } from '../src/google-drive.ts'
import { SyncEngine } from '../src/sync-engine.ts'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GoogleDriveClient } from '../src/google-drive.ts'

describe('Google Drive Sync & Auth', () => {
  it('generates valid PKCE pair', () => {
    const pkce = generatePkcePair()
    expect(pkce.verifier).toBeDefined()
    expect(pkce.challenge).toBeDefined()
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
    expect(parsed.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:8080/oauth2callback')
  })

  it('syncs local files to mock remote storage', async () => {
    const testDir = await mkdtemp(join(tmpdir(), 'sync-test-'))
    const dshHome = join(testDir, 'dsh')
    const profileDir = join(dshHome, 'profiles', 'desktop')
    await mkdir(join(dshHome, 'sessions', 'projectA'), { recursive: true })
    await mkdir(profileDir, { recursive: true })

    // Create local mock files
    await writeFile(join(dshHome, 'settings.yaml'), 'key: value\n', 'utf8')
    await writeFile(join(profileDir, 'package.json'), '{"name":"test"}\n', 'utf8')
    await writeFile(join(dshHome, 'sessions', 'projectA', 's1.jsonl'), 'line1\n', 'utf8')

    // Mock GoogleDriveClient
    const remoteFiles = new Map<string, { id: string; name: string; content: Buffer }>()
    let idCounter = 1

    const mockClient = {
      listAppDataFiles: vi.fn(async () => {
        return Array.from(remoteFiles.values()).map(f => ({
          id: f.id,
          name: f.name,
        }))
      }),
      downloadFile: vi.fn(async (fileId: string) => {
        for (const f of remoteFiles.values()) {
          if (f.id === fileId) return f.content
        }
        throw new Error('Not found')
      }),
      uploadAppDataFile: vi.fn(async (name: string, content: string | Buffer, _mimeType: string, existingFileId?: string) => {
        const buf = typeof content === 'string' ? Buffer.from(content, 'utf8') : content
        const id = existingFileId || `id_${idCounter++}`
        remoteFiles.set(name, { id, name, content: buf })
        return { id, name }
      }),
      deleteFile: vi.fn(async (fileId: string) => {
        for (const [k, f] of remoteFiles.entries()) {
          if (f.id === fileId) remoteFiles.delete(k)
        }
      }),
    } as unknown as GoogleDriveClient

    const engine = new SyncEngine(dshHome, profileDir, mockClient)

    // Initial sync
    const res1 = await engine.sync({ categories: ['settings', 'plugins', 'sessions'] })
    expect(res1.uploaded.length).toBe(3)
    expect(res1.downloaded.length).toBe(0)
    expect(res1.errors.length).toBe(0)

    // Verify remote files
    expect(remoteFiles.has(encodeURIComponent('settings/settings.yaml'))).toBe(true)
    expect(remoteFiles.has(encodeURIComponent('plugins/package.json'))).toBe(true)
    expect(remoteFiles.has(encodeURIComponent('sessions/projectA/s1.jsonl'))).toBe(true)
    expect(remoteFiles.has('manifest.json')).toBe(true)

    // Clean up test directory
    await rm(testDir, { recursive: true, force: true })
  })
})
