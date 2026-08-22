/**
 * Cloud sync engine v3.
 *
 * Drive layout: every sync file in appDataFolder is named
 * `harnessx-v3:<encodeURIComponent(key)>` and carries `sha256` plus `mtimeMs`
 * appProperties, so no shared manifest can be lost or clobbered. Names without
 * the `harnessx-v3:` prefix belong to earlier protocols and are ignored.
 *
 * Sessions are multi-frame zstd logs (`sessions/<project>/<session-id>/session.jsonl.zstd`)
 * synced as opaque binaries: union across machines, newest mtime wins per file.
 * Settings conflicts are surfaced for the user to resolve explicitly.
 * Plugins sync only an install registry; installation goes through the market.
 */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import type { GoogleDriveClient, GoogleDriveFile } from './google-drive.ts'
import { desktopThirdPartyBundles } from './profile.ts'

export type SyncCategory = 'sessions' | 'plugins' | 'settings'

export interface SyncOptions {
  categories: SyncCategory[]
}

export interface SyncConflict {
  key: string
  category: SyncCategory
  localMtimeMs: number
  remoteMtimeMs: number
  driveFileId: string
}

export interface SyncPendingInstall {
  name: string
  installSpec: string
  version?: string
}

export interface SyncResult {
  uploaded: string[]
  downloaded: string[]
  conflicts: SyncConflict[]
  pendingInstalls: SyncPendingInstall[]
  errors: Array<{ path: string; error: string }>
  sessionCounts: { local: number; remote: number }
  timestamp: number
}

const NAME_PREFIX = 'harnessx-v3:'
const PROP_HASH = 'sha256'
const PROP_MTIME = 'mtimeMs'
const REGISTRY_KEY = 'plugins/registry.json'
const SESSION_SUFFIX = '.jsonl.zstd'
const SETTINGS_KEY = 'settings/settings.yaml'

function sha256Buffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}

async function writeFileAtomicSafe(filename: string, content: string | Buffer): Promise<void> {
  await mkdir(dirname(filename), { recursive: true, mode: 0o700 })
  const temp = `${filename}.${randomBytes(6).toString('hex')}.tmp`
  try {
    await writeFile(temp, content, { mode: 0o600, flag: 'wx' })
    await rename(temp, filename)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

function encodeRemoteName(key: string): string {
  return `${NAME_PREFIX}${encodeURIComponent(key)}`
}

/** Decode a Drive name into a sync key; returns undefined for foreign or legacy names. */
function decodeRemoteName(name: string): string | undefined {
  if (!name.startsWith(NAME_PREFIX)) return undefined
  try {
    const key = decodeURIComponent(name.slice(NAME_PREFIX.length))
    return isSyncKey(key) ? key : undefined
  } catch {
    return undefined
  }
}

function isSyncKey(key: string): key is string {
  const slash = key.indexOf('/')
  if (slash <= 0) return false
  const category = key.slice(0, slash)
  if (category !== 'sessions' && category !== 'settings') return false
  const suffix = key.slice(slash + 1)
  if (suffix.length === 0 || suffix.includes('\\') || suffix.startsWith('/')) return false
  const segments = suffix.split('/')
  return segments.every(segment => segment.length > 0 && segment !== '.' && segment !== '..')
}

function categoryOf(key: string): SyncCategory {
  return key.slice(0, key.indexOf('/')) as SyncCategory
}

function driveMtime(file: GoogleDriveFile): number {
  const parsed = file.modifiedTime ? new Date(file.modifiedTime).getTime() : 0
  return Number.isFinite(parsed) ? parsed : 0
}

function propHash(file: GoogleDriveFile): string | undefined {
  const value = file.appProperties?.[PROP_HASH]
  return typeof value === 'string' && value.length === 64 ? value : undefined
}

function propMtime(file: GoogleDriveFile): number {
  const raw = file.appProperties?.[PROP_MTIME]
  if (raw === undefined) return 0
  const parsed = Number(raw)
  return Number.isFinite(parsed) ? parsed : 0
}

function remoteTimeOf(file: GoogleDriveFile): number {
  return propMtime(file) || driveMtime(file)
}

export interface LocalSyncFile {
  fullPath: string
  mtimeMs: number
  size: number
}

export class SyncEngine {
  constructor(
    private readonly dshHome: string,
    private readonly profileDir: string,
    private readonly driveClient: GoogleDriveClient,
  ) {}

  resolveLocalFullPath(key: string): string {
    if (!isSyncKey(key)) throw new Error(`Invalid sync key: ${key}`)
    if (key === SETTINGS_KEY) return join(this.dshHome, 'settings.yaml')
    const root = resolve(this.dshHome, 'sessions')
    const destination = resolve(root, key.slice('sessions/'.length))
    if (destination !== root && !destination.startsWith(`${root}\\`) && !destination.startsWith(`${root}/`)) {
      throw new Error(`Sync path escapes sessions root: ${key}`)
    }
    return destination
  }

  async scanSessions(): Promise<Map<string, LocalSyncFile>> {
    const files = new Map<string, LocalSyncFile>()
    const sessionsRoot = join(this.dshHome, 'sessions')
    if (!existsSync(sessionsRoot)) return files
    await this.scanSessionDir(sessionsRoot, sessionsRoot, files)
    return files
  }

  private async scanSessionDir(rootDir: string, currentDir: string, out: Map<string, LocalSyncFile>): Promise<void> {
    let entries
    try {
      entries = await readdir(currentDir, { withFileTypes: true })
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry.name === '.git' || entry.name === 'node_modules') continue
      const full = join(currentDir, entry.name)
      if (entry.isDirectory()) {
        await this.scanSessionDir(rootDir, full, out)
      } else if (entry.isFile() && entry.name.endsWith(SESSION_SUFFIX) && !entry.name.includes('.bak')) {
        try {
          const st = await stat(full)
          const rel = relative(rootDir, full).replace(/\\/g, '/')
          out.set(`sessions/${rel}`, { fullPath: full, mtimeMs: st.mtimeMs, size: st.size })
        } catch {}
      }
    }
  }

  async scanSettings(): Promise<Map<string, LocalSyncFile>> {
    const files = new Map<string, LocalSyncFile>()
    const settingsPath = join(this.dshHome, 'settings.yaml')
    if (existsSync(settingsPath)) {
      try {
        const st = await stat(settingsPath)
        if (st.isFile()) files.set(SETTINGS_KEY, { fullPath: settingsPath, mtimeMs: st.mtimeMs, size: st.size })
      } catch {}
    }
    return files
  }

  async sync(options: SyncOptions): Promise<SyncResult> {
    const result: SyncResult = {
      uploaded: [],
      downloaded: [],
      conflicts: [],
      pendingInstalls: [],
      errors: [],
      sessionCounts: { local: 0, remote: 0 },
      timestamp: Date.now(),
    }

    let remoteFiles: GoogleDriveFile[]
    try {
      remoteFiles = await this.driveClient.listAppDataFiles()
    } catch (error) {
      result.errors.push({ path: 'global', error: error instanceof Error ? error.message : String(error) })
      return result
    }

    const remoteByKey = new Map<string, GoogleDriveFile>()
    for (const file of remoteFiles) {
      const key = decodeRemoteName(file.name)
      if (!key) continue
      const existing = remoteByKey.get(key)
      if (!existing || remoteTimeOf(file) >= remoteTimeOf(existing)) remoteByKey.set(key, file)
    }

    const localFiles = new Map<string, LocalSyncFile>()
    if (options.categories.includes('sessions')) {
      for (const [key, file] of await this.scanSessions()) localFiles.set(key, file)
    }
    if (options.categories.includes('settings')) {
      for (const [key, file] of await this.scanSettings()) localFiles.set(key, file)
    }
    result.sessionCounts.local = [...localFiles.keys()].filter(key => categoryOf(key) === 'sessions').length
    result.sessionCounts.remote = [...remoteByKey.keys()].filter(key => categoryOf(key) === 'sessions').length

    const keys = new Set<string>([...localFiles.keys(), ...remoteByKey.keys()])
    for (const key of keys) {
      const category = categoryOf(key)
      if (!options.categories.includes(category)) continue
      const local = localFiles.get(key)
      const remote = remoteByKey.get(key)
      try {
        if (local && remote) {
          const localContent = await readFile(local.fullPath)
          const localHash = sha256Buffer(localContent)
          const storedHash = propHash(remote)
          if (storedHash === localHash) continue
          let remoteHash = storedHash
          if (remoteHash === undefined) {
            const remoteContent = await this.driveClient.downloadFile(remote.id)
            remoteHash = sha256Buffer(remoteContent)
            if (remoteHash === localHash) {
              await this.stampProperties(remote.id, localHash, local.mtimeMs)
              continue
            }
          }
          if (category === 'sessions') {
            if (local.mtimeMs > remoteTimeOf(remote)) {
              await this.uploadLocal(key, localContent, local.mtimeMs, remote.id)
              result.uploaded.push(key)
            } else {
              await this.downloadRemote(key, remote.id, remoteTimeOf(remote))
              result.downloaded.push(key)
            }
          } else {
            result.conflicts.push({
              key,
              category,
              localMtimeMs: local.mtimeMs,
              remoteMtimeMs: remoteTimeOf(remote),
              driveFileId: remote.id,
            })
          }
        } else if (local) {
          const content = await readFile(local.fullPath)
          await this.uploadLocal(key, content, local.mtimeMs)
          result.uploaded.push(key)
        } else if (category === 'sessions') {
          await this.downloadRemote(key, remote!.id, remoteTimeOf(remote!))
          result.downloaded.push(key)
        } else {
          result.conflicts.push({
            key,
            category,
            localMtimeMs: 0,
            remoteMtimeMs: remoteTimeOf(remote!),
            driveFileId: remote!.id,
          })
        }
      } catch (error) {
        result.errors.push({ path: key, error: error instanceof Error ? error.message : String(error) })
      }
    }

    if (options.categories.includes('plugins')) {
      try {
        result.pendingInstalls = await this.syncPluginRegistry(remoteFiles)
      } catch (error) {
        result.errors.push({ path: REGISTRY_KEY, error: error instanceof Error ? error.message : String(error) })
      }
    }

    // Post-sync remote session view: whatever Drive held plus this run's uploads.
    const remoteSessionKeys = new Set(
      [...remoteByKey.keys()].filter(key => categoryOf(key) === 'sessions'),
    )
    for (const key of result.uploaded) {
      if (categoryOf(key) === 'sessions') remoteSessionKeys.add(key)
    }
    result.sessionCounts.remote = remoteSessionKeys.size

    return result
  }

  /** Resolve a settings conflict by pushing the local file over the Drive copy. */
  async uploadOverwrite(conflict: SyncConflict): Promise<string> {
    const localPath = this.resolveLocalFullPath(conflict.key)
    const content = await readFile(localPath)
    const st = await stat(localPath)
    await this.uploadLocal(conflict.key, content, st.mtimeMs, conflict.driveFileId)
    return conflict.key
  }

  /** Resolve a settings conflict by taking the Drive copy into the local tree. */
  async downloadOverwrite(conflict: SyncConflict): Promise<string> {
    await this.downloadRemote(conflict.key, conflict.driveFileId, conflict.remoteMtimeMs)
    return conflict.key
  }

  /** Delete every file in appDataFolder so a fresh sync republishes cleanly. */
  async resetCloud(): Promise<number> {
    const files = await this.driveClient.listAppDataFiles()
    let deleted = 0
    for (const file of files) {
      await this.driveClient.deleteFile(file.id)
      deleted += 1
    }
    return deleted
  }

  private async uploadLocal(key: string, content: Buffer, mtimeMs: number, existingFileId?: string): Promise<void> {
    await this.driveClient.uploadAppDataFile(
      encodeRemoteName(key),
      content,
      'application/octet-stream',
      existingFileId,
      {
        [PROP_HASH]: sha256Buffer(content),
        [PROP_MTIME]: String(Math.round(mtimeMs)),
      },
    )
  }

  private async downloadRemote(key: string, driveFileId: string, mtimeMs: number): Promise<void> {
    const content = await this.driveClient.downloadFile(driveFileId)
    const dest = this.resolveLocalFullPath(key)
    await writeFileAtomicSafe(dest, content)
    await utimes(dest, new Date(mtimeMs || Date.now()), new Date(mtimeMs || Date.now())).catch(() => {})
    await this.stampProperties(driveFileId, sha256Buffer(content), mtimeMs)
  }

  private async stampProperties(driveFileId: string, hash: string, mtimeMs: number): Promise<void> {
    await this.driveClient.patchAppProperties(driveFileId, {
      [PROP_HASH]: hash,
      [PROP_MTIME]: String(Math.round(mtimeMs)),
    })
  }

  /**
   * Merge the remote install registry with locally installed plugins.
   * Returns the remote-but-not-local records for the UI install list.
   */
  private async syncPluginRegistry(remoteFiles: GoogleDriveFile[]): Promise<SyncPendingInstall[]> {
    const registryFile = remoteFiles.find(file => file.name === encodeRemoteName(REGISTRY_KEY))
    let remoteRecords: PluginRegistryRecord[] = []
    if (registryFile) {
      try {
        const parsed: unknown = JSON.parse((await this.driveClient.downloadFile(registryFile.id)).toString('utf8'))
        if (Array.isArray(parsed)) {
          remoteRecords = parsed.filter(isRegistryRecord)
        }
      } catch {
        remoteRecords = []
      }
    }
    const installed = await this.listInstalledPlugins()
    const installedNames = new Set(installed.map(plugin => plugin.name))
    const pending: SyncPendingInstall[] = []
    for (const record of remoteRecords) {
      if (installedNames.has(record.name)) continue
      pending.push({ name: record.name, installSpec: record.installSpec, ...(record.version !== undefined ? { version: record.version } : {}) })
    }
    const union = new Map<string, PluginRegistryRecord>()
    for (const record of remoteRecords) {
      const existing = union.get(record.name)
      if (!existing || record.installedAt >= existing.installedAt) union.set(record.name, record)
    }
    for (const plugin of installed) {
      const existing = union.get(plugin.name)
      if (!existing || Date.now() >= existing.installedAt) {
        union.set(plugin.name, {
          name: plugin.name,
          installSpec: plugin.installSpec,
          ...(plugin.version !== undefined ? { version: plugin.version } : {}),
          installedAt: Date.now(),
        })
      }
    }
    await this.driveClient.uploadAppDataFile(
      encodeRemoteName(REGISTRY_KEY),
      JSON.stringify([...union.values()], null, 2),
      'application/json',
      registryFile?.id,
      { [PROP_HASH]: sha256Buffer(Buffer.from(JSON.stringify([...union.values()], null, 2), 'utf8')), [PROP_MTIME]: String(Date.now()) },
    )
    return pending
  }

  /** Read third-party plugins from the profile manifest, mirroring the market view. */
  async listInstalledPlugins(): Promise<Array<{ name: string; installSpec: string; version?: string }>> {
    const manifestPath = join(this.profileDir, 'package.json')
    let manifest: Record<string, unknown>
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as Record<string, unknown>
    } catch {
      return []
    }
    const dsh = typeof manifest.dsh === 'object' && manifest.dsh !== null ? manifest.dsh as Record<string, unknown> : {}
    const profile = typeof dsh.profile === 'object' && dsh.profile !== null ? dsh.profile as Record<string, unknown> : {}
    const bundles = Array.isArray(profile.bundles) ? profile.bundles.filter((b): b is string => typeof b === 'string') : []
    const dependencies = typeof manifest.dependencies === 'object' && manifest.dependencies !== null ? manifest.dependencies as Record<string, unknown> : {}
    const result: Array<{ name: string; installSpec: string; version?: string }> = []
    for (const name of desktopThirdPartyBundles(bundles)) {
      // First-party desktop bundles (host plugins mounted under the desktop package) are not user plugins.
      if (name === 'harnessx-desktop' || name.startsWith('harnessx-desktop/')) continue
      const requested = typeof dependencies[name] === 'string' ? dependencies[name] as string : undefined
      const version = await this.installedVersion(name)
      result.push({ name, installSpec: deriveInstallSpec(name, requested, version), ...(version !== undefined ? { version } : {}) })
    }
    return result
  }

  private async installedVersion(name: string): Promise<string | undefined> {
    try {
      const value: unknown = JSON.parse(await readFile(join(this.profileDir, 'node_modules', ...name.split('/'), 'package.json'), 'utf8'))
      if (value !== null && typeof value === 'object' && typeof (value as Record<string, unknown>).version === 'string') {
        return (value as Record<string, unknown>).version as string
      }
    } catch {}
    return undefined
  }
}

interface PluginRegistryRecord {
  name: string
  installSpec: string
  version?: string
  installedAt: number
}

function isRegistryRecord(value: unknown): value is PluginRegistryRecord {
  if (value === null || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return typeof record.name === 'string' && typeof record.installSpec === 'string' && Number.isFinite(record.installedAt)
}

/** Derive a portable install spec from the profile dependency declaration. */
function deriveInstallSpec(name: string, requested: string | undefined, version: string | undefined): string {
  if (requested === undefined) return version !== undefined ? `${name}@${version}` : name
  if (requested.startsWith('github:')) return requested
  if (/^[\^~]?\d/.test(requested)) return version !== undefined ? `${name}@${version}` : `${name}@${requested.replace(/^[\^~]/u, '')}`
  if (requested.startsWith('file:')) return version !== undefined ? `${name}@${version}` : name
  return requested
}
