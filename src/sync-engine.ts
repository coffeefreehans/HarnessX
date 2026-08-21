/** Core synchronization engine for Google Drive sync. */

import { createHash, randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, relative } from 'node:path'
import type { GoogleDriveClient, GoogleDriveFile } from './google-drive.ts'

export type SyncCategory = 'sessions' | 'plugins' | 'settings'

export interface SyncOptions {
  categories: SyncCategory[]
  conflictStrategy?: 'latest' | 'remote-first' | 'local-first' | undefined
}

export interface SyncManifestItem {
  path: string
  category: SyncCategory
  sha256: string
  mtimeMs: number
  size: number
  driveFileId?: string | undefined
}

export interface SyncManifest {
  version: 1
  lastSyncTime: number
  items: Record<string, SyncManifestItem>
}

export interface SyncResult {
  uploaded: string[]
  downloaded: string[]
  deleted: string[]
  conflicts: string[]
  errors: Array<{ path: string; error: string }>
  timestamp: number
}

const MANIFEST_FILE_NAME = 'manifest.json'

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

export class SyncEngine {
  constructor(
    private readonly dshHome: string,
    private readonly profileDir: string,
    private readonly driveClient: GoogleDriveClient,
  ) {}

  /** Scan local files relevant to sync. */
  async scanLocalFiles(categories: SyncCategory[]): Promise<Map<string, { fullPath: string; category: SyncCategory; mtimeMs: number; size: number }>> {
    const fileMap = new Map<string, { fullPath: string; category: SyncCategory; mtimeMs: number; size: number }>()

    if (categories.includes('settings')) {
      const settingsPath = join(this.dshHome, 'settings.yaml')
      if (existsSync(settingsPath)) {
        try {
          const st = await stat(settingsPath)
          if (st.isFile()) {
            fileMap.set('settings/settings.yaml', {
              fullPath: settingsPath,
              category: 'settings',
              mtimeMs: st.mtimeMs,
              size: st.size,
            })
          }
        } catch {}
      }
    }

    if (categories.includes('plugins')) {
      // ponytail: covers .dsh-plugin-desktop, .harnessx-desktop, .hernessx-desktop; upgrade to explicit allowlist when plugin dir naming stabilizes
      const pluginDirs = ['.dsh-plugin-desktop', '.harnessx-desktop', '.hernessx-desktop']
      for (const dirName of pluginDirs) {
        const pluginRoot = join(this.profileDir, dirName)
        if (existsSync(pluginRoot)) {
          await this.scanPluginDirectoryRecursively(pluginRoot, pluginRoot, fileMap)
        }
      }

      const profileConfigs = ['package.json', 'cordis.patch.yml', 'cordis.yml']
      for (const fileName of profileConfigs) {
        const filePath = join(this.profileDir, fileName)
        if (existsSync(filePath)) {
          try {
            const st = await stat(filePath)
            if (st.isFile()) {
              fileMap.set(`plugins/${fileName}`, {
                fullPath: filePath,
                category: 'plugins',
                mtimeMs: st.mtimeMs,
                size: st.size,
              })
            }
          } catch {}
        }
      }
    }

    if (categories.includes('sessions')) {
      const sessionsRoot = join(this.dshHome, 'sessions')
      if (existsSync(sessionsRoot)) {
        await this.scanDirectoryRecursively(sessionsRoot, sessionsRoot, 'sessions', fileMap)
      }
    }

    return fileMap
  }

  private async scanDirectoryRecursively(
    rootDir: string,
    currentDir: string,
    category: SyncCategory,
    outMap: Map<string, { fullPath: string; category: SyncCategory; mtimeMs: number; size: number }>,
  ): Promise<void> {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === '.git') continue
        const full = join(currentDir, entry.name)
        if (entry.isDirectory()) {
          await this.scanDirectoryRecursively(rootDir, full, category, outMap)
        } else if (entry.isFile()) {
          const rel = relative(rootDir, full).replace(/\\/g, '/')
          const key = `sessions/${rel}`
          const st = await stat(full)
          outMap.set(key, {
            fullPath: full,
            category,
            mtimeMs: st.mtimeMs,
            size: st.size,
          })
        }
      }
    } catch {}
  }

  private async scanPluginDirectoryRecursively(
    rootDir: string,
    currentDir: string,
    outMap: Map<string, { fullPath: string; category: SyncCategory; mtimeMs: number; size: number }>,
  ): Promise<void> {
    try {
      const entries = await readdir(currentDir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue
        const full = join(currentDir, entry.name)
        if (entry.isDirectory()) {
          await this.scanPluginDirectoryRecursively(rootDir, full, outMap)
        } else if (entry.isFile()) {
          const rel = relative(this.profileDir, full).replace(/\\/g, '/')
          const key = `plugins/${rel}`
          const st = await stat(full)
          outMap.set(key, {
            fullPath: full,
            category: 'plugins',
            mtimeMs: st.mtimeMs,
            size: st.size,
          })
        }
      }
    } catch {}
  }

  resolveLocalFullPath(relKey: string): string {
    if (relKey === 'settings/settings.yaml') {
      return join(this.dshHome, 'settings.yaml')
    }
    if (relKey.startsWith('plugins/')) {
      const pluginSub = relKey.slice('plugins/'.length)
      return join(this.profileDir, pluginSub)
    }
    if (relKey.startsWith('sessions/')) {
      const sessionSub = relKey.slice('sessions/'.length)
      return join(this.dshHome, 'sessions', sessionSub)
    }
    throw new Error(`Unknown sync file key: ${relKey}`)
  }

  /** Run sync operation against Google Drive appDataFolder. */
  async sync(options: SyncOptions): Promise<SyncResult> {
    const result: SyncResult = {
      uploaded: [],
      downloaded: [],
      deleted: [],
      conflicts: [],
      errors: [],
      timestamp: Date.now(),
    }

    try {
      // 1. List remote files in appDataFolder
      const remoteFiles = await this.driveClient.listAppDataFiles()
      const remoteByName = new Map<string, GoogleDriveFile>()
      for (const f of remoteFiles) {
        remoteByName.set(f.name, f)
      }

      // 2. Fetch or initialize remote manifest
      let remoteManifest: SyncManifest = { version: 1, lastSyncTime: 0, items: {} }
      const remoteManifestFile = remoteByName.get(MANIFEST_FILE_NAME)
      if (remoteManifestFile) {
        try {
          const manifestBuf = await this.driveClient.downloadFile(remoteManifestFile.id)
          remoteManifest = JSON.parse(manifestBuf.toString('utf8')) as SyncManifest
        } catch {
          // ignore parsing error, start fresh
        }
      }

      // 3. Scan local files
      const localFiles = await this.scanLocalFiles(options.categories)

      // 4. Determine uploads and downloads
      for (const [key, local] of localFiles.entries()) {
        try {
          const localContent = await readFile(local.fullPath)
          const localHash = sha256Buffer(localContent)
          const remoteMeta = remoteManifest.items[key]
          const encodedKey = encodeURIComponent(key)
          const remoteDriveFile = remoteByName.get(encodedKey)

          if (!remoteDriveFile) {
            // Remote does not exist -> upload
            const uploaded = await this.driveClient.uploadAppDataFile(
              encodedKey,
              localContent,
              'application/octet-stream',
            )
            remoteManifest.items[key] = {
              path: key,
              category: local.category,
              sha256: localHash,
              mtimeMs: local.mtimeMs,
              size: local.size,
              driveFileId: uploaded.id,
            }
            result.uploaded.push(key)
          } else if (remoteMeta && remoteMeta.sha256 !== localHash) {
            // File changed - compare mtime
            if (local.mtimeMs > remoteMeta.mtimeMs) {
              // Local is newer -> upload
              await this.driveClient.uploadAppDataFile(
                encodedKey,
                localContent,
                'application/octet-stream',
                remoteDriveFile.id,
              )
              remoteManifest.items[key] = {
                path: key,
                category: local.category,
                sha256: localHash,
                mtimeMs: local.mtimeMs,
                size: local.size,
                driveFileId: remoteDriveFile.id,
              }
              result.uploaded.push(key)
            } else {
              // Remote is newer -> download
              const content = await this.driveClient.downloadFile(remoteDriveFile.id)
              const dest = this.resolveLocalFullPath(key)
              await writeFileAtomicSafe(dest, content)
              remoteManifest.items[key] = {
                path: key,
                category: local.category,
                sha256: sha256Buffer(content),
                mtimeMs: Date.now(),
                size: content.length,
                driveFileId: remoteDriveFile.id,
              }
              result.downloaded.push(key)
            }
          }
        } catch (err: unknown) {
          result.errors.push({ path: key, error: err instanceof Error ? err.message : String(err) })
        }
      }

      // Download remote-only files (exist in manifest but not locally)
      for (const [key, item] of Object.entries(remoteManifest.items)) {
        if (!options.categories.includes(item.category)) continue
        if (localFiles.has(key)) continue
        const encodedKey = encodeURIComponent(key)
        const remoteDriveFile = item.driveFileId
          ? { id: item.driveFileId }
          : remoteByName.get(encodedKey)
        if (!remoteDriveFile) continue
        try {
          const content = await this.driveClient.downloadFile(remoteDriveFile.id)
          const dest = this.resolveLocalFullPath(key)
          await writeFileAtomicSafe(dest, content)
          remoteManifest.items[key] = {
            path: key,
            category: item.category,
            sha256: sha256Buffer(content),
            mtimeMs: Date.now(),
            size: content.length,
            driveFileId: remoteDriveFile.id,
          }
          result.downloaded.push(key)
        } catch (err: unknown) {
          result.errors.push({ path: key, error: err instanceof Error ? err.message : String(err) })
        }
      }

      // 5. Update remote manifest.json
      remoteManifest.lastSyncTime = Date.now()
      const manifestJson = JSON.stringify(remoteManifest, null, 2)
      await this.driveClient.uploadAppDataFile(
        MANIFEST_FILE_NAME,
        manifestJson,
        'application/json',
        remoteManifestFile?.id,
      )
    } catch (err: unknown) {
      result.errors.push({ path: 'global', error: err instanceof Error ? err.message : String(err) })
    }

    return result
  }
}
