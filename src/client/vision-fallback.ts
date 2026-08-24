/** Vision fallback send interception: desktop-owned, zero kernel edits.
 *
 * Wraps the shared client API's `sessions.prompt` method (the one call every
 * composer send lands on). When a prompt carries images and the session's
 * model does not admit them, the images are first described by the configured
 * universal vision model through the desktop caption bridge, and each image
 * part is replaced by its labelled caption — the ORIGINAL model stays
 * selected and answers from the recognition it was handed. Keeping the image
 * part is deliberately avoided: the kernel would show the model an image
 * marker plus a read-image tool, and text-only models chase that file
 * instead of using the caption. Any failure here falls back to the untouched
 * original call.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  replaceImagesWithCaptions,
  replaceImagesWithFailureNotes,
  extractVisionGroups,
  readPersistedFallback,
  hasImagePart,
  walkPath,
  type PromptContentPart,
} from './vision-models-state.ts'

const VISION_DESCRIBE_URL = '/api/desktop/vision/describe'

/** Per-decision trace, always visible in devtools: console.debug lands in
 *  Chromium's Verbose level, which the console hides by default, so the
 *  branch that handled an image send must log at the default level. */
function debug(reason: string, detail?: string): void {
  console.log(`[harnessx-desktop] vision: ${reason}${detail === undefined ? '' : ` ${detail}`}`)
}

/** Minimal wire faces the interceptor needs (structural, fixture-compatible). */
interface WireSessions {
  prompt: (request: unknown, signal?: unknown) => Promise<unknown>
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

/**
 * Read which models currently admit images. Deliberately uncached: the user
 * may have toggled 图片输入 for a model moments ago, and a stale map would
 * caption (and replace) images a now-capable model could read natively.
 * @throws when the provider directory or settings cannot be read, so callers
 *  can treat "cannot tell" as "capable" and leave the send untouched.
 */
async function loadSupportMap(api: WireApi): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>()
  const providersResponse = await api.llm.providers({})
  if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
  const describeResponse = await api.settings.describe({})
  if (!describeResponse.result.ok) throw new Error(describeResponse.result.error.message)
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

interface ImagePart { type: 'image'; mediaType: string; data: string; name?: string }

/**
 * Describe the images of one prompt through the caption bridge, when the
 * current model cannot take them. The capability decision is re-read on
 * every send: an image-capable model always gets its originals, and only a
 * text-only model's images are replaced by the universal model's captions.
 * The session's model is never switched: the ORIGINAL model answers, using
 * the recognition the vision model produced.
 */
async function captionImagesIfNeeded(
  api: WireApi,
  sessionId: string,
  content: readonly PromptContentPart[],
): Promise<PromptContentPart[] | undefined> {
  // Live storage read, not the in-process snapshot: a toggle flipped in
  // another window (or before this page loaded) applies on the next send.
  const config = readPersistedFallback()
  debug(`fallback config: enabled=${String(config.enabled)} provider=${config.provider ?? '(none)'} model=${config.model ?? '(none)'}`)
  if (!config.enabled || config.provider === undefined || config.model === undefined) {
    debug('universal vision model not configured or disabled; image sent as-is')
    return undefined
  }
  const modelsResponse = await api.sessions.models({ sessionId })
  if (!modelsResponse.result.ok) {
    debug('sessions.models failed; image sent as-is:', modelsResponse.result.error.message)
    return undefined
  }
  const current = modelsResponse.result.value.current
  if (current.provider === config.provider && current.model === config.model) {
    debug('current model IS the universal vision model; image sent as-is')
    return undefined
  }
  let capable: boolean
  try {
    const map = await loadSupportMap(api)
    capable = map.get(supportKey(current.provider, current.model)) === true
  } catch (cause) {
    // Capability unreadable: respect the user's model choice and send the
    // originals untouched rather than captioning on a guess.
    debug('capability unreadable; image sent as-is:', cause instanceof Error ? cause.message : String(cause))
    return undefined
  }
  if (capable) {
    debug(`model ${current.provider}/${current.model} declared image-capable; originals sent`)
    return undefined
  }
  debug(`current model ${current.provider}/${current.model} cannot take images; asking ${config.provider}/${config.model} to describe`)
  const images = content.filter((part): part is ImagePart => part.type === 'image')
  try {
    const response = await fetch(VISION_DESCRIBE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider: config.provider, model: config.model, images }),
    })
    if (!response.ok) throw new Error(`caption bridge HTTP ${String(response.status)}`)
    const value = await response.json() as { captions?: unknown }
    if (!Array.isArray(value.captions) || value.captions.length !== images.length) {
      throw new Error('caption bridge returned a malformed payload')
    }
    for (const caption of value.captions) {
      if (typeof caption !== 'string') throw new Error('caption bridge returned a non-string caption')
    }
    return replaceImagesWithCaptions(content, value.captions, `${config.provider}/${config.model}`)
  } catch (cause) {
    // The caption bridge failed for a model that cannot read images. Sending
    // the raw image would only hand the model a sha256 marker it would chase
    // through read_image; replace with an honest failure note instead.
    debug('caption bridge failed:', cause instanceof Error ? cause.message : String(cause))
    return replaceImagesWithFailureNotes(content)
  }
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
    sessions.prompt = async (...args: unknown[]): Promise<unknown> => {
      try {
        // The kernel's Session class sends a flat { sessionId, mode, content,
        // clientTimeZone } request with an optional AbortSignal second
        // argument. Only content may gain appended caption parts; everything
        // else (and the signal) forwards exactly as the kernel issued it.
        const request = args[0] as { sessionId?: unknown; content?: unknown } | undefined
        const content = request?.content
        if (typeof request?.sessionId === 'string' && Array.isArray(content)) {
          if (hasImagePart(content as PromptContentPart[])) {
            const replacement = await captionImagesIfNeeded(api, request.sessionId, content as PromptContentPart[])
            if (replacement !== undefined) {
              return original({ ...(request as object), content: replacement }, args[1])
            }
          }
        }
      } catch (cause) {
        // Fall through: the send proceeds exactly as the kernel issued it,
        // but never silently — the cause names itself in the console.
        debug('decision error; image sent as-is:', cause instanceof Error ? cause.message : String(cause))
      }
      return original(args[0], args[1])
    }
  } catch {
    // Feature stays off; the kernel path behaves exactly as before.
  }
}
