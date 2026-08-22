/** OS-encrypted credential provider for HarnessX desktop profiles. */

import { mkdir, readFile, unlink } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { CredentialProvider, parseCredentialKey, type CredentialInfo, type CredentialKey, type CredentialRecord, type CredentialRecordEntry, type CredentialRecordInfo, type CredentialRef, type ResolvedCredential } from '@deepseek-ai/dsh-credentials'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'
import { safeStorage } from 'electron'
import { parse as parseYaml } from 'yaml'

const BIN_NAME = 'harnessx-desktop'
const ENCRYPTED_CREDENTIALS_FILENAME = '.credentials.encrypted.json'
const LEGACY_CREDENTIALS_FILENAME = '.credentials.yaml'
const CREDENTIAL_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/u

/** Credential-provider path configuration. */
export interface Config {
  /** Harness home containing the encrypted credentials store. */
  dshHome?: string
  /** Explicit encrypted store path overriding the Harness home default. */
  path?: string
}

/** Validated credential-provider configuration. */
export const Config: z<Config> = z.object({
  dshHome: z.string().default(''),
  path: z.string().default(''),
}).default({ dshHome: '', path: '' })

/** Versioned envelope stored on disk without plaintext credential values.
 * The envelope stays at version 1 forever; the decrypted plaintext carries its
 * own layout version (2 = reference map plus record map, unversioned =
 * legacy reference-only flat mapping). */
export interface EncryptedCredentialsDocument {
  /** Encrypted document schema version. */
  readonly version: 1
  /** Base64-encoded ciphertext produced by Electron safeStorage. */
  readonly ciphertext: string
}

/** Parse and validate one encrypted credential envelope. */
export function parseEncryptedCredentialsDocument(text: string): EncryptedCredentialsDocument {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)
    || value.version !== 1
    || typeof value.ciphertext !== 'string'
    || value.ciphertext.length === 0
    || !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/u.test(value.ciphertext)
    || Object.keys(value).some(key => key !== 'version' && key !== 'ciphertext')) {
    throw new Error('invalid encrypted credentials document')
  }
  return { version: 1, ciphertext: value.ciphertext }
}

/** Desktop credential provider backed by DPAPI, Keychain, or a secure Linux secret store. */
export class DesktopCredentialProvider extends CredentialProvider {
  static Config = Config

  private readonly filename: string
  private readonly legacyFilename: string
  private readonly environment: ReturnType<typeof launchEnvironmentOf>
  private readonly ready: Promise<void>
  private values = new Map<string, string>()
  private records = new Map<string, CredentialRecord>()
  private operations: Promise<unknown> = Promise.resolve()

  constructor(ctx: Context, config: Config = {}) {
    super(ctx)
    const configuredHome = config.dshHome?.trim() || undefined
    const configuredPath = config.path?.trim() || undefined
    const home = resolveDshHome(configuredHome)
    this.filename = resolve(configuredPath ?? join(home, ENCRYPTED_CREDENTIALS_FILENAME))
    this.legacyFilename = join(home, LEGACY_CREDENTIALS_FILENAME)
    this.environment = launchEnvironmentOf(ctx)
    this.ready = this.loadOrMigrate()
  }

  /** Resolve a credential for one operation without caching it in a consumer. */
  async resolve(ref: CredentialRef): Promise<ResolvedCredential | undefined> {
    await this.ready
    const inherited = this.environment.getFrom(ref, ['process'])
    if (inherited?.value) return { value: inherited.value, source: 'env' }
    const stored = this.values.get(ref)
    if (stored !== undefined) return { value: stored, source: 'os-encrypted' }
    const fallback = this.environment.getFrom(ref, ['project-env', 'user-env'])
    return fallback?.value ? { value: fallback.value, source: fallback.source } : undefined
  }

  /** Describe configuration state without exposing the credential value. */
  async describe(ref: CredentialRef): Promise<CredentialInfo> {
    const resolved = await this.resolve(ref)
    return {
      configured: resolved !== undefined,
      ...(resolved === undefined ? {} : { source: resolved.source }),
      writable: !this.environment.getFrom(ref, ['process'])?.value,
    }
  }

  /** Store a non-empty credential through the operating-system encryption service. */
  async set(ref: CredentialRef, value: string): Promise<void> {
    if (value.length === 0) throw new Error(`${BIN_NAME}: credential value must not be empty`)
    await this.enqueue(async () => {
      this.assertWritable(ref)
      const next = new Map(this.values)
      next.set(ref, value)
      await this.persist(next, this.records)
      this.values = next
      this.notifyUpdated(ref)
    })
  }

  /** Remove one stored credential without changing environment-backed values. */
  async unset(ref: CredentialRef): Promise<void> {
    await this.enqueue(async () => {
      this.assertWritable(ref)
      if (!this.values.has(ref)) return
      const next = new Map(this.values)
      next.delete(ref)
      await this.persist(next, this.records)
      this.values = next
      this.notifyUpdated(ref)
    })
  }

  /** Read one stored plugin-owned record. */
  async readRecord(key: CredentialKey): Promise<CredentialRecord | undefined> {
    await this.ready
    return this.records.get(key)
  }

  /** Describe one record for configuration surfaces without exposing its value. */
  async describeRecord(key: CredentialKey): Promise<CredentialRecordInfo> {
    await this.ready
    const record = this.records.get(key)
    return {
      configured: record !== undefined,
      ...(record === undefined ? {} : { kind: record.kind }),
      writable: true,
    }
  }

  /** Enumerate every stored record's address and tag. */
  async listRecords(): Promise<readonly CredentialRecordEntry[]> {
    await this.ready
    return [...this.records.entries()]
      .map(([key, record]) => ({ key: parseCredentialKey(key), kind: record.kind }))
      .sort((left, right) => left.key.localeCompare(right.key))
  }

  /** Serialized read-modify-write over one record — the only record write path. */
  async modifyRecord(
    key: CredentialKey,
    mutate: (current: CredentialRecord | undefined) => Promise<CredentialRecord | undefined>,
  ): Promise<CredentialRecord | undefined> {
    return this.enqueue(async () => {
      const current = this.records.get(key)
      const next = await mutate(current)
      if (next === undefined) return this.records.get(key)
      const records = new Map(this.records)
      records.set(key, next)
      await this.persist(this.values, records)
      this.records = records
      this.notifyRecordUpdated(key)
      return next
    })
  }

  /** Remove one record; removing an absent record is a no-op. */
  async deleteRecord(key: CredentialKey): Promise<void> {
    await this.enqueue(async () => {
      if (!this.records.has(key)) return
      const records = new Map(this.records)
      records.delete(key)
      await this.persist(this.values, records)
      this.records = records
      this.notifyRecordUpdated(key)
    })
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const run = async (): Promise<T> => {
      await this.ready
      return await operation()
    }
    const next = this.operations.then(run, run)
    this.operations = next.catch(() => {})
    return next
  }

  private assertWritable(ref: CredentialRef): void {
    if (this.environment.getFrom(ref, ['process'])?.value) {
      throw new Error(`${BIN_NAME}: inherited environment credential ${ref} is read-only`)
    }
  }

  private async loadOrMigrate(): Promise<void> {
    assertSecureStorageAvailable()
    try {
      const document = parseEncryptedCredentialsDocument(await readFile(this.filename, 'utf8'))
      const store = decryptStore(document)
      this.values = store.credentials
      this.records = store.records
      await this.finishInterruptedMigration()
      return
    } catch (cause) {
      if (!isEnoent(cause)) throw cause
    }

    let legacyText: string
    try {
      legacyText = await readFile(this.legacyFilename, 'utf8')
    } catch (cause) {
      if (isEnoent(cause)) return
      throw cause
    }
    const migrated = parseLegacyCredentials(legacyText)
    await this.persist(migrated, new Map())
    await unlink(this.legacyFilename)
    this.values = migrated
  }

  private async finishInterruptedMigration(): Promise<void> {
    let legacyText: string
    try {
      legacyText = await readFile(this.legacyFilename, 'utf8')
    } catch (cause) {
      if (isEnoent(cause)) return
      throw cause
    }
    const legacy = parseLegacyCredentials(legacyText)
    if (!equalCredentials(this.values, legacy)) {
      throw new Error(`${BIN_NAME}: encrypted and legacy credential stores disagree; refusing automatic deletion`)
    }
    await unlink(this.legacyFilename)
  }

  private async persist(values: ReadonlyMap<string, string>, records: ReadonlyMap<string, CredentialRecord>): Promise<void> {
    const plaintext = JSON.stringify({
      version: 2,
      credentials: sortedEntries(values),
      records: sortedEntries(records),
    })
    const document: EncryptedCredentialsDocument = {
      version: 1,
      ciphertext: safeStorage.encryptString(plaintext).toString('base64'),
    }
    await mkdir(dirname(this.filename), { recursive: true, mode: 0o700 })
    await writeFileAtomic(this.filename, `${JSON.stringify(document, null, 2)}\n`, {
      mode: 0o600,
      dirMode: 0o700,
    })
  }
}

function assertSecureStorageAvailable(): void {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error(`${BIN_NAME}: operating-system credential encryption is unavailable`)
  }
  if (process.platform === 'linux'
    && safeStorage.getSelectedStorageBackend() === 'basic_text') {
    throw new Error(`${BIN_NAME}: refusing the unencrypted Linux credential backend`)
  }
}

function decryptStore(document: EncryptedCredentialsDocument): { credentials: Map<string, string>; records: Map<string, CredentialRecord> } {
  const plaintext = safeStorage.decryptString(Buffer.from(document.ciphertext, 'base64'))
  return parseDecryptedStore(JSON.parse(plaintext))
}

/** Interpret the decrypted plaintext: version 2 carries both key spaces, the
 * unversioned legacy layout is a flat reference-to-value mapping. */
function parseDecryptedStore(value: unknown): { credentials: Map<string, string>; records: Map<string, CredentialRecord> } {
  if (!isRecord(value)) throw new Error('credential store must be a mapping')
  if (value.version === 2) {
    return {
      credentials: parseCredentialRecord(value.credentials),
      records: parseCredentialRecords(value.records),
    }
  }
  if (value.version === undefined) {
    return { credentials: parseCredentialRecord(value), records: new Map() }
  }
  throw new Error(`unsupported credential store version: ${String(value.version)}`)
}

function parseCredentialRecords(value: unknown): Map<string, CredentialRecord> {
  if (value === undefined) return new Map()
  if (!isRecord(value)) throw new Error('credential records must be a mapping')
  const result = new Map<string, CredentialRecord>()
  for (const [key, record] of Object.entries(value)) {
    parseCredentialKey(key)
    if (!isCredentialRecord(record)) {
      throw new Error(`invalid credential record: ${key}`)
    }
    result.set(key, record)
  }
  return result
}

function isCredentialRecord(value: unknown): value is CredentialRecord {
  if (!isRecord(value)) return false
  if (value.kind === 'api-key') {
    if (value.key !== undefined && (typeof value.key !== 'string' || value.key.length === 0)) return false
    if (value.env === undefined) return true
    if (!isRecord(value.env)) return false
    return Object.entries(value.env).every(([name, envValue]) => CREDENTIAL_PATTERN.test(name) && typeof envValue === 'string')
  }
  if (value.kind === 'grant') return 'payload' in value
  return false
}

function sortedEntries<T>(values: ReadonlyMap<string, T>): Record<string, T> {
  return Object.fromEntries([...values].sort(([left], [right]) => left.localeCompare(right)))
}

function parseLegacyCredentials(text: string): Map<string, string> {
  if (text.trim().length === 0) return new Map()
  return parseCredentialRecord(parseYaml(text))
}

function equalCredentials(left: ReadonlyMap<string, string>, right: ReadonlyMap<string, string>): boolean {
  if (left.size !== right.size) return false
  for (const [key, value] of left) {
    if (right.get(key) !== value) return false
  }
  return true
}

function parseCredentialRecord(value: unknown): Map<string, string> {
  if (!isRecord(value)) throw new Error('credentials must be a mapping')
  const result = new Map<string, string>()
  for (const [key, credential] of Object.entries(value)) {
    if (!CREDENTIAL_PATTERN.test(key) || typeof credential !== 'string' || credential.length === 0) {
      throw new Error(`invalid credential entry: ${key}`)
    }
    result.set(key, credential)
  }
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEnoent(cause: unknown): boolean {
  return (cause as NodeJS.ErrnoException).code === 'ENOENT'
}

export default DesktopCredentialProvider
