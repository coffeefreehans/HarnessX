import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => 'kwallet',
    encryptString: (value: string) => Buffer.from(value).map(byte => byte ^ 0xaa),
    decryptString: (value: Buffer) => Buffer.from(value).map(byte => byte ^ 0xaa).toString(),
  },
}))

import { DesktopCredentialProvider, parseEncryptedCredentialsDocument } from '../src/credentials.ts'

describe('encrypted desktop credentials document', () => {
  it('accepts only the versioned ciphertext envelope', () => {
    expect(parseEncryptedCredentialsDocument(JSON.stringify({
      version: 1,
      ciphertext: Buffer.from('ciphertext').toString('base64'),
    }))).toEqual({
      version: 1,
      ciphertext: Buffer.from('ciphertext').toString('base64'),
    })
  })

  it.each([
    '{}',
    '{"version":2,"ciphertext":"YQ=="}',
    '{"version":1,"ciphertext":""}',
    '{"version":1,"ciphertext":"not base64"}',
    '{"version":1,"ciphertext":"YQ==","plaintext":"secret"}',
  ])('rejects malformed or plaintext-bearing envelopes', (document) => {
    expect(() => parseEncryptedCredentialsDocument(document)).toThrow('invalid encrypted credentials document')
  })
})

describe('desktop credential provider', () => {
  it('persists credentials without plaintext and resolves them per operation', async () => {
    const home = await mkdtemp(join(tmpdir(), 'harnessx-credentials-'))
    try {
      const provider = new DesktopCredentialProvider(new Context(), { dshHome: home })
      const ref = credentialRef('HARNESSX_TEST_API_KEY')
      await provider.set(ref, 'secret-value')

      const stored = await readFile(join(home, '.credentials.encrypted.json'), 'utf8')
      expect(stored).not.toContain('secret-value')
      expect(await provider.resolve(ref)).toEqual({ value: 'secret-value', source: 'os-encrypted' })
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })

  it('migrates and removes the legacy plaintext credentials document', async () => {
    const home = await mkdtemp(join(tmpdir(), 'harnessx-credentials-migration-'))
    try {
      const legacyPath = join(home, '.credentials.yaml')
      await writeFile(legacyPath, 'HARNESSX_MIGRATED_KEY: legacy-secret\n', 'utf8')
      const provider = new DesktopCredentialProvider(new Context(), { dshHome: home })

      expect(await provider.resolve(credentialRef('HARNESSX_MIGRATED_KEY')))
        .toEqual({ value: 'legacy-secret', source: 'os-encrypted' })
      await expect(readFile(legacyPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
      expect(await readFile(join(home, '.credentials.encrypted.json'), 'utf8'))
        .not.toContain('legacy-secret')
    } finally {
      await rm(home, { recursive: true, force: true })
    }
  })
})
