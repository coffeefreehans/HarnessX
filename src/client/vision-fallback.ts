/** Vision fallback send interception: desktop-owned, zero kernel edits.
 *
 * Wraps the shared client API's `sessions.prompt` method (the one call every
 * composer send lands on). When a prompt carries images, the session's model
 * does not admit them, and a universal caption model is configured, each
 * image is first described through the desktop caption bridge and the image
 * parts are swapped for their caption text — so the kernel sees a plain text
 * prompt and never has to reject it. Models whose image toggle is on pass
 * straight through and keep receiving originals. Any failure here falls back
 * to the untouched original call.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  extractVisionGroups,
  getVisionFallbackStore,
  hasImagePart,
  transformContentWithCaptions,
  walkPath,
  type PromptContentPart,
} from './vision-models-state.ts'

const VISION_DESCRIBE_URL = '/api/desktop/vision/describe'

/** Minimal wire faces the interceptor needs (structural, fixture-compatible). */
interface WireSessions {
  prompt: (request: unknown) => Promise<unknown>
  models: (request: unknown) => Promise<{
    result: { ok: true; value: { current: { provider: string; model: string } } }
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

interface ImagePart { type: 'image'; mediaType: string; data: string; name?: string }

/**
 * Caption the images of one prompt through the bridge, when configured and
 * needed. Returns the replacement content, or undefined to send unchanged.
 */
async function captionIfNeeded(
  api: WireApi,
  sessionId: string,
  content: readonly PromptContentPart[],
): Promise<PromptContentPart[] | undefined> {
  const config = getVisionFallbackStore().getSnapshot()
  if (!config.enabled || config.provider === undefined || config.model === undefined) return undefined
  const modelsResponse = await api.sessions.models({ sessionId })
  if (!modelsResponse.result.ok) return undefined
  const current = modelsResponse.result.value.current
  const map = await ensureSupportMap(api)
  if (map.get(supportKey(current.provider, current.model)) === true) return undefined
  const images = content.filter((part): part is ImagePart => part.type === 'image')
  const response = await fetch(VISION_DESCRIBE_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ provider: config.provider, model: config.model, images }),
  })
  if (!response.ok) return undefined
  const value = await response.json() as { captions?: unknown }
  if (!Array.isArray(value.captions) || value.captions.length !== images.length) return undefined
  for (const caption of value.captions) {
    if (typeof caption !== 'string') return undefined
  }
  return transformContentWithCaptions(content, value.captions)
}

let installed = false

/**
 * Wrap `api.sessions.prompt` with the vision fallback once per page. The wrap
 * is additive: any error inside it calls the original untouched, and a frozen
 * or differently-shaped api face leaves the feature off entirely.
 * @param ctx - browser Cordis context carrying the connection service.
 */
export function installVisionFallback(ctx: ClientContext): void {
  if (installed || typeof fetch !== 'function') return
  try {
    const connection = ctx.get('connection') as { api: WireApi }
    const api = connection?.api
    const sessions = api?.sessions
    if (sessions === undefined || typeof sessions.prompt !== 'function') return
    const original = sessions.prompt.bind(sessions)
    installed = true
    sessions.prompt = async (request: unknown): Promise<unknown> => {
      try {
        const payload = (request as { payload?: { sessionId?: string; content?: unknown } }).payload
        const content = payload?.content
        if (typeof payload?.sessionId === 'string' && Array.isArray(content)) {
          const typed = content as PromptContentPart[]
          if (hasImagePart(typed)) {
            const replacement = await captionIfNeeded(api, payload.sessionId, typed)
            if (replacement !== undefined) {
              return original({ ...(request as object), payload: { ...payload, content: replacement } })
            }
          }
        }
      } catch {
        // Fall through: the send proceeds exactly as the kernel issued it.
      }
      return original(request)
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
