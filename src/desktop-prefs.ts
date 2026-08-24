/** Desktop preferences Host plugin: one JSON file behind one local route.
 *
 * The renderer cannot keep preferences in localStorage: the kernel web server
 * port changes between launches and localStorage is origin-scoped, so every
 * restart wiped desktop-owned settings (vision fallback choice, notification
 * options). This route persists them in the DSH home, independent of ports.
 */

import { existsSync } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { dirname, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import type {} from './runtime.ts'

const PREFS_ROUTE = '/api/desktop/prefs'
const MAX_JSON_BODY_BYTES = 64 * 1024

/** The persisted desktop-owned preference shape (all sections optional). */
export interface DesktopPrefs {
  vision?: {
    enabled?: unknown
    provider?: unknown
    model?: unknown
    textOnly?: unknown
    probeResults?: unknown
  }
  notifications?: { sound?: unknown; systemNotification?: unknown; onlyWhenBlurred?: unknown }
}

/**
 * Keep only plain-object boolean entries; absent when nothing survives, so an
 * empty map never materializes in the file.
 */
function booleanMap(value: unknown): Record<string, boolean> | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const result: Record<string, boolean> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key.length > 0 && typeof entry === 'boolean') result[key] = entry
  }
  return Object.keys(result).length > 0 ? result : undefined
}

/**
 * Validate one preference section value as a plain string.
 * @returns the string, or undefined when absent or not a non-empty string.
 */
export function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

/**
 * Validate an untrusted prefs object into a normalized one. Unknown sections
 * and malformed fields are dropped, never rejected: a partially corrupted
 * file must not take the remaining preferences with it.
 */
export function normalizePrefs(value: unknown): DesktopPrefs {
  if (typeof value !== 'object' || value === null) return {}
  const source = value as Record<string, unknown>
  const result: DesktopPrefs = {}
  const vision = source.vision
  if (typeof vision === 'object' && vision !== null) {
    const v = vision as Record<string, unknown>
    result.vision = {
      ...(typeof v.enabled === 'boolean' ? { enabled: v.enabled } : {}),
      ...(optionalString(v.provider) !== undefined ? { provider: v.provider } : {}),
      ...(optionalString(v.model) !== undefined ? { model: v.model } : {}),
      ...booleanMap(v.textOnly) !== undefined ? { textOnly: booleanMap(v.textOnly) } : {},
      ...booleanMap(v.probeResults) !== undefined ? { probeResults: booleanMap(v.probeResults) } : {},
    }
  }
  const notifications = source.notifications
  if (typeof notifications === 'object' && notifications !== null) {
    const n = notifications as Record<string, unknown>
    result.notifications = {
      ...(typeof n.sound === 'boolean' ? { sound: n.sound } : {}),
      ...(typeof n.systemNotification === 'boolean' ? { systemNotification: n.systemNotification } : {}),
      ...(typeof n.onlyWhenBlurred === 'boolean' ? { onlyWhenBlurred: n.onlyWhenBlurred } : {}),
    }
  }
  return result
}

/** Deep-merge two normalized prefs (patch wins per present field). */
export function mergePrefs(base: DesktopPrefs, patch: DesktopPrefs): DesktopPrefs {
  return normalizePrefs({
    vision: { ...base.vision, ...patch.vision },
    notifications: { ...base.notifications, ...patch.notifications },
  })
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
  return new Promise((resolve, reject) => {
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
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    request.on('error', cause => reject(cause instanceof Error ? cause : new Error(String(cause))))
  })
}

/** Stable Cordis plugin name. */
export const name = 'desktop-prefs'

/** Host services required by the preferences route. */
export const inject = ['webServer', 'desktopRuntime']

/**
 * Register the desktop preferences HTTP route.
 * @param ctx - Host context carrying the Web carrier and desktop services.
 */
export function apply(ctx: Context): void {
  const prefsPath = join(resolveDshHome(), '.harnessx-desktop', 'prefs.json')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PREFS_ROUTE,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      if (request.method !== 'GET' && request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      try {
        if (request.method === 'GET') {
          let stored: DesktopPrefs = {}
          if (existsSync(prefsPath)) {
            stored = normalizePrefs(JSON.parse(await readFile(prefsPath, 'utf8')))
          }
          sendJson(response, 200, stored)
          return
        }
        const patch = normalizePrefs(await readJsonBody(request))
        let stored: DesktopPrefs = {}
        if (existsSync(prefsPath)) {
          stored = normalizePrefs(JSON.parse(await readFile(prefsPath, 'utf8')))
        }
        const merged = mergePrefs(stored, patch)
        await mkdir(dirname(prefsPath), { recursive: true, mode: 0o700 })
        await writeFileAtomic(prefsPath, `${JSON.stringify(merged, null, 2)}\n`, { mode: 0o600 })
        sendJson(response, 200, merged)
      } catch (cause) {
        sendJson(response, 500, { error: cause instanceof Error ? cause.message : String(cause) })
      }
    },
  }), 'harnessx-desktop: preferences route')
}
