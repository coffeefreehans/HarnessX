/** Vision fallback send interception: desktop-owned, zero kernel edits.
 *
 * Wraps the shared client API's `sessions.prompt` method (the one call every
 * composer send lands on). When a prompt carries images and the session's
 * model does not admit them, the session is switched to the configured
 * universal vision model BEFORE the send — so that model reads the images
 * natively and answers directly. The outgoing request itself is never
 * modified: no caption text is injected into the user's message, and any
 * failure here leaves the send exactly as the kernel issued it.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  extractVisionGroups,
  getVisionFallbackStore,
  hasImagePart,
  walkPath,
  type PromptContentPart,
} from './vision-models-state.ts'

/** Minimal wire faces the interceptor needs (structural, fixture-compatible). */
interface WireSessions {
  prompt: (request: unknown, signal?: unknown) => Promise<unknown>
  models: (request: unknown) => Promise<{
    result: { ok: true; value: { current: { provider: string; model: string } } }
    | { ok: false; error: { message: string } }
  }>
  selectModel: (request: unknown) => Promise<{
    result: { ok: true; value: { selected: { provider: string; model: string } } }
    | { ok: false; error: { message: string } }
  }>
}

interface WireApi {
  sessions: WireSessions
  llm: { providers: (request: unknown) => Promise<{ result: { ok: true; value: { providers: { provider: string; displayName: string; settingsNs: string; settingsPath: string[] }[] } } | { ok: false; error: { message: string } } }> }
  settings: { describe: (request: unknown) => Promise<{ result: { ok: true; value: { namespaces: { ns: string; value: unknown }[] } } | { ok: false; error: { message: string } } }> }
}

const supportKey = (provider: string, model: string): string => `${provider}\u0000${model}`

let supportMap: Map<string, boolean> | undefined
let supportMapLoading: Promise<Map<string, boolean>> | undefined

async function loadSupportMap(api: WireApi): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>()
  const providersResponse = await api.llm.providers({})
  if (!providersResponse.result.ok) return map
  const describeResponse = await api.settings.describe({})
  if (!describeResponse.result.ok) return map
  const namespaces = new Map(describeResponse.result.value.namespaces.map(view => [view.ns, view.value]))
  const rows = providersResponse.result.value.providers
  // Custom routes: per-entry `input` declarations written by our settings page.
  for (const group of extractVisionGroups(namespaces.get('llm-pi-ai'), rows)) {
    for (const model of group.models) {
      if (model.imageEnabled) map.set(supportKey(group.provider, model.id), true)
    }
  }
  // The official route: declared `inputModalities` of its catalog entries.
  const deepSeek = namespaces.get('llm-deepseek')
  const deepSeekModels = walkPath(deepSeek, ['models'])
  const official = rows.find(row => row.settingsNs === 'llm-deepseek')
  if (official !== undefined && Array.isArray(deepSeekModels)) {
    for (const entry of deepSeekModels) {
      if (typeof entry !== 'object' || entry === null) continue
      const id = (entry as { id?: unknown }).id
      const modalities = (entry as { inputModalities?: unknown }).inputModalities
      if (typeof id === 'string' && Array.isArray(modalities) && modalities.includes('image')) {
        map.set(supportKey(official.provider, id), true)
      }
    }
  }
  return map
}

async function ensureSupportMap(api: WireApi): Promise<Map<string, boolean>> {
  if (supportMap !== undefined) return supportMap
  supportMapLoading ??= loadSupportMap(api).then(map => {
    supportMap = map
    supportMapLoading = undefined
    return map
  }, () => {
    supportMapLoading = undefined
    return new Map<string, boolean>()
  })
  return supportMapLoading
}

/**
 * Switch the session to the universal vision model when the current model
 * cannot take images. Any failure (not configured, directory unreadable,
 * selection rejected) returns quietly: the send then proceeds exactly as
 * the kernel issued it, on the unchanged current model.
 */
async function switchToVisionModelIfNeeded(api: WireApi, sessionId: string): Promise<void> {
  const config = getVisionFallbackStore().getSnapshot()
  if (!config.enabled || config.provider === undefined || config.model === undefined) return
  const modelsResponse = await api.sessions.models({ sessionId })
  if (!modelsResponse.result.ok) return
  const current = modelsResponse.result.value.current
  if (current.provider === config.provider && current.model === config.model) return
  const map = await ensureSupportMap(api)
  // Declared image-capable models (official catalog entries, or custom routes
  // whose toggle the user set) read the originals themselves; only text-only
  // selections are rerouted to the universal vision model.
  if (map.get(supportKey(current.provider, current.model)) === true) return
  await api.sessions.selectModel({
    sessionId,
    provider: config.provider,
    model: config.model,
  })
}

let installed = false

/**
 * Wrap `api.sessions.prompt` with the vision fallback once per page. The wrap
 * is additive: any error inside it calls the original untouched, and a frozen
 * or differently-shaped api face leaves the feature off entirely.
 * @param ctx - browser Cordis context carrying the connection service.
 */
export function installVisionFallback(ctx: ClientContext): void {
  if (installed) return
  try {
    const connection = ctx.get('connection') as { api: WireApi }
    const api = connection?.api
    const sessions = api?.sessions
    if (sessions === undefined || typeof sessions.prompt !== 'function') return
    const original = sessions.prompt.bind(sessions)
    installed = true
    sessions.prompt = async (...args: unknown[]): Promise<unknown> => {
      try {
        // The kernel's Session class sends a flat { sessionId, mode, content,
        // clientTimeZone } request with an optional AbortSignal second
        // argument. Only the session's model may change here; the request
        // itself always goes out byte-identical to what the kernel issued.
        const request = args[0] as { sessionId?: unknown; content?: unknown } | undefined
        const content = request?.content
        if (typeof request?.sessionId === 'string' && Array.isArray(content)) {
          if (hasImagePart(content as PromptContentPart[])) {
            await switchToVisionModelIfNeeded(api, request.sessionId)
          }
        }
      } catch {
        // Fall through: the send proceeds exactly as the kernel issued it.
      }
      return original(args[0], args[1])
    }
    const remote = (ctx as unknown as {
      remote?: { $on(event: string, listener: () => void): () => void }
    }).remote
    remote?.$on('settings/document-updated', () => {
      supportMap = undefined
    })
  } catch {
    // Feature stays off; the kernel path behaves exactly as before.
  }
}
