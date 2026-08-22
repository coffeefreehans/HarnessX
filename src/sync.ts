/** Cordis Host plugin for Google Drive sync REST API and background scheduler. */

import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from '@deepseek-ai/dsh-host-webserver'
import z from '@deepseek-ai/schemastery'
import { shell } from 'electron'
import {
  DEFAULT_GOOGLE_CLIENT_ID,
  DEFAULT_GOOGLE_CLIENT_SECRET,
  GoogleAuthFlow,
  GoogleDriveClient,
  generatePkcePair,
  type GoogleAuthTokens,
  type GoogleOAuthConfig,
} from './google-drive.ts'
import type {} from './profile-service.ts'
import type {} from './runtime.ts'
import { SyncEngine, type SyncCategory, type SyncConflict as SyncConflictPayload, type SyncResult } from './sync-engine.ts'

export const name = 'desktop-sync'
export const inject = ['webServer', 'desktopProfiles', 'desktopRuntime']

const SYNC_ROUTE_PREFIX = '/api/desktop/sync'
const MAX_BODY_BYTES = 128 * 1024

export interface Config {
  autoSync: boolean
  intervalMinutes: number
  customClientId?: string
  customClientSecret?: string
  categories: SyncCategory[]
}

export interface SyncStatusSnapshot {
  configured: boolean
  authenticated: boolean
  accountEmail?: string
  lastSyncTime?: number
  lastSyncResult?: SyncResult
  syncing: boolean
  config: Config
  error?: string
}

export const Config: z<Config> = z.object({
  autoSync: z.boolean().default(false),
  intervalMinutes: z.number().default(30),
  customClientId: z.string().default(''),
  customClientSecret: z.string().default(''),
  categories: z.array(z.string() as unknown as z<SyncCategory>).default(['sessions', 'plugins', 'settings']),
})

export function apply(ctx: Context, config: Config): void {
  const dshHome = resolveDshHome()
  const profileDir = ctx.desktopProfiles.current.dir
  const syncStateDir = join(dshHome, '.sync')
  const tokenFile = join(syncStateDir, 'google-tokens.json')
  const configFile = join(syncStateDir, 'config.json')

  let currentConfig: Config = {
    autoSync: config.autoSync ?? false,
    intervalMinutes: config.intervalMinutes ?? 30,
    customClientId: config.customClientId ?? '',
    customClientSecret: config.customClientSecret ?? '',
    categories: config.categories?.length ? config.categories : ['sessions', 'plugins', 'settings'],
  }

  let tokens: GoogleAuthTokens | undefined
  let accountEmail: string | undefined
  let syncing = false
  let lastSyncTime: number | undefined
  let lastSyncResult: SyncResult | undefined
  let lastError: string | undefined
  let activeAuthFlow: { close: () => void } | undefined
  let autoSyncTimer: ReturnType<typeof setInterval> | undefined

  const loadPersisted = async () => {
    try {
      if (existsSync(tokenFile)) {
        const raw = await readFile(tokenFile, 'utf8')
        tokens = JSON.parse(raw) as GoogleAuthTokens
      }
    } catch {}

    try {
      if (existsSync(configFile)) {
        const raw = await readFile(configFile, 'utf8')
        currentConfig = { ...currentConfig, ...(JSON.parse(raw) as Partial<Config>) }
      }
    } catch {}
  }

  void loadPersisted().then(async () => {
    if (tokens) {
      const client = getDriveClient()
      if (client) {
        try {
          const user = await client.getUserInfo()
          accountEmail = user.email
        } catch {
          // Ignore userInfo failure on startup
        }
      }
    }
    setupAutoSync()
  })

  function getOAuthConfig(): GoogleOAuthConfig {
    const cid = currentConfig.customClientId?.trim() || DEFAULT_GOOGLE_CLIENT_ID
    const secret = currentConfig.customClientSecret?.trim() || DEFAULT_GOOGLE_CLIENT_SECRET
    return { clientId: cid, clientSecret: secret }
  }

  function getDriveClient(): GoogleDriveClient | undefined {
    if (!tokens) return undefined
    return new GoogleDriveClient(getOAuthConfig(), tokens, async (refreshed) => {
      tokens = refreshed
      await mkdir(syncStateDir, { recursive: true })
      await writeFileAtomic(tokenFile, JSON.stringify(tokens, null, 2), { mode: 0o600, dirMode: 0o700 })
    })
  }

  function setupAutoSync() {
    if (autoSyncTimer) {
      clearInterval(autoSyncTimer)
      autoSyncTimer = undefined
    }
    if (currentConfig.autoSync && tokens) {
      const ms = Math.max(5, currentConfig.intervalMinutes) * 60 * 1000
      autoSyncTimer = setInterval(() => {
        void triggerSync()
      }, ms)
    }
  }

  async function triggerSync(): Promise<SyncResult> {
    if (syncing) {
      throw new Error('Synchronization is already in progress.')
    }
    const client = getDriveClient()
    if (!client) {
      throw new Error('Google Drive is not authenticated.')
    }

    syncing = true
    lastError = undefined
    try {
      const engine = new SyncEngine(dshHome, profileDir, client)
      const res = await engine.sync({ categories: currentConfig.categories })
      lastSyncResult = res
      // Show the Drive-server time of the newest cloud write so every machine
      // displays the same moment (e.g. the other computer's upload time).
      lastSyncTime = res.lastRemoteChangeMs > 0 ? res.lastRemoteChangeMs : res.timestamp
      return res
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      syncing = false
    }
  }

  function getEngine(): SyncEngine {
    const client = getDriveClient()
    if (!client) throw new Error('Google Drive is not authenticated.')
    return new SyncEngine(dshHome, profileDir, client)
  }

  /** Keep the persisted last-sync result free of already-resolved conflicts. */
  function dropResolvedConflict(key: string): void {
    if (!lastSyncResult) return
    if (!lastSyncResult.conflicts.some(conflict => conflict.key === key)) return
    lastSyncResult = {
      ...lastSyncResult,
      conflicts: lastSyncResult.conflicts.filter(conflict => conflict.key !== key),
    }
  }

  async function resetCloudAndSync(): Promise<SyncResult> {
    if (syncing) {
      throw new Error('Synchronization is already in progress.')
    }
    const client = getDriveClient()
    if (!client) {
      throw new Error('Google Drive is not authenticated.')
    }
    syncing = true
    lastError = undefined
    try {
      const engine = new SyncEngine(dshHome, profileDir, client)
      await engine.resetCloud()
      const res = await engine.sync({ categories: currentConfig.categories })
      lastSyncResult = res
      lastSyncTime = res.lastRemoteChangeMs > 0 ? res.lastRemoteChangeMs : res.timestamp
      return res
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err)
      throw err
    } finally {
      syncing = false
    }
  }

  // Register Web API Routes
  ctx.effect(() => {
    const disposeStatus = ctx.webServer.register({
      kind: 'exact',
      path: `${SYNC_ROUTE_PREFIX}/status`,
      handler: async (req, res) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        const snapshot: SyncStatusSnapshot = {
          configured: true,
          authenticated: Boolean(tokens?.accessToken),
          ...accountEmail !== undefined ? { accountEmail } : {},
          ...lastSyncTime !== undefined ? { lastSyncTime } : {},
          ...lastSyncResult !== undefined ? { lastSyncResult } : {},
          syncing,
          config: currentConfig,
          ...lastError !== undefined ? { error: lastError } : {},
        }
        sendJson(res, 200, snapshot)
      },
    })

    const disposeAuthStart = ctx.webServer.register({
      kind: 'exact',
      path: `${SYNC_ROUTE_PREFIX}/auth/start`,
      handler: async (req, res) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' })
          return
        }
        try {
          if (activeAuthFlow) {
            activeAuthFlow.close()
            activeAuthFlow = undefined
          }

          const flow = new GoogleAuthFlow()
          const { port, waitForCode, close } = await flow.startLoopbackListener()
          activeAuthFlow = { close }

          const pkce = generatePkcePair()
          const state = `st_${Date.now()}`
          const redirectUri = `http://127.0.0.1:${port}/oauth2callback`
          const authUrl = flow.buildAuthUrl(getOAuthConfig(), redirectUri, pkce.challenge, state)

          // Open user's default browser
          void shell.openExternal(authUrl)

          // Background wait for callback
          void waitForCode.then(async ({ code }) => {
            activeAuthFlow = undefined
            const exchanged = await GoogleDriveClient.exchangeCode(getOAuthConfig(), code, redirectUri, pkce.verifier)
            tokens = exchanged
            await mkdir(syncStateDir, { recursive: true })
            await writeFileAtomic(tokenFile, JSON.stringify(tokens, null, 2), { mode: 0o600, dirMode: 0o700 })

            const client = getDriveClient()
            if (client) {
              const user = await client.getUserInfo()
              accountEmail = user.email
            }
            setupAutoSync()
          }).catch((err: unknown) => {
            lastError = err instanceof Error ? err.message : String(err)
          })

          sendJson(res, 200, { ok: true, message: 'OAuth authorization opened in browser.' })
        } catch (err: unknown) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      },
    })

    const disposeAuthLogout = ctx.webServer.register({
      kind: 'exact',
      path: `${SYNC_ROUTE_PREFIX}/auth/logout`,
      handler: async (req, res) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' })
          return
        }
        tokens = undefined
        accountEmail = undefined
        try {
          await rm(tokenFile, { force: true })
        } catch {}
        setupAutoSync()
        sendJson(res, 200, { ok: true })
      },
    })

    const disposeConfig = ctx.webServer.register({
      kind: 'exact',
      path: `${SYNC_ROUTE_PREFIX}/config`,
      handler: async (req, res) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        if (req.method === 'POST') {
          try {
            const body = (await readJsonBody(req)) as Partial<Config>
            currentConfig = { ...currentConfig, ...body }
            await mkdir(syncStateDir, { recursive: true })
            await writeFileAtomic(configFile, JSON.stringify(currentConfig, null, 2), { mode: 0o600, dirMode: 0o700 })
            setupAutoSync()
            sendJson(res, 200, { ok: true, config: currentConfig })
          } catch (err: unknown) {
            sendJson(res, 400, { error: err instanceof Error ? err.message : String(err) })
          }
        } else {
          sendJson(res, 200, currentConfig)
        }
      },
    })

    const disposeTrigger = ctx.webServer.register({
      kind: 'exact',
      path: `${SYNC_ROUTE_PREFIX}/trigger`,
      handler: async (req, res) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' })
          return
        }
        try {
          const result = await triggerSync()
          sendJson(res, 200, { ok: true, result })
        } catch (err: unknown) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      },
    })

    const disposeResolveConflict = ctx.webServer.register({
      kind: 'exact',
      path: `${SYNC_ROUTE_PREFIX}/conflict/resolve`,
      handler: async (req, res) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' })
          return
        }
        try {
          const body = await readJsonBody(req) as { direction?: string; conflict?: SyncConflictPayload }
          const conflict = body.conflict
          if (!conflict || typeof conflict.key !== 'string' || typeof conflict.driveFileId !== 'string') {
            sendJson(res, 400, { error: 'Missing conflict payload.' })
            return
          }
          if (body.direction === 'upload') {
            await getEngine().uploadOverwrite(conflict)
            dropResolvedConflict(conflict.key)
            sendJson(res, 200, { ok: true, resolved: conflict.key, direction: 'upload' })
          } else if (body.direction === 'download') {
            await getEngine().downloadOverwrite(conflict)
            dropResolvedConflict(conflict.key)
            sendJson(res, 200, { ok: true, resolved: conflict.key, direction: 'download' })
          } else {
            sendJson(res, 400, { error: 'direction must be "upload" or "download".' })
          }
        } catch (err: unknown) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      },
    })

    const disposeReset = ctx.webServer.register({
      kind: 'exact',
      path: `${SYNC_ROUTE_PREFIX}/reset`,
      handler: async (req, res) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(req)) {
          sendJson(res, 401, { error: 'unauthorized' })
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { error: 'Method Not Allowed' })
          return
        }
        try {
          const result = await resetCloudAndSync()
          sendJson(res, 200, { ok: true, result })
        } catch (err: unknown) {
          sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) })
        }
      },
    })

    return () => {
      disposeStatus()
      disposeAuthStart()
      disposeAuthLogout()
      disposeConfig()
      disposeTrigger()
      disposeResolveConflict()
      disposeReset()
      if (activeAuthFlow) {
        activeAuthFlow.close()
        activeAuthFlow = undefined
      }
      if (autoSyncTimer) {
        clearInterval(autoSyncTimer)
        autoSyncTimer = undefined
      }
    }
  })
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' })
  res.end(JSON.stringify(body))
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      raw += chunk
      if (raw.length > MAX_BODY_BYTES) {
        reject(new Error('Body exceeded payload limit.'))
      }
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch (e) {
        reject(e)
      }
    })
    req.on('error', reject)
  })
}
