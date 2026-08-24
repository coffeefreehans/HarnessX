/** Vision fallback send interception: desktop-owned, zero kernel edits.
 *
 * Wraps the shared client API's `sessions.prompt` method (the one call every
 * composer send lands on). When a prompt carries images and the session's
 * model does not admit them, the send leaves VERBATIM — the user's bubble
 * shows the real image and nothing about the send path changes. Recognition
 * runs in parallel through the desktop caption bridge (with local downscaling
 * so relay gateways don't reject large screenshots), and its result is
 * delivered mid-turn as a steering message (`mode: 'steer'`), so the
 * recognition happens inside the thinking phase instead of blocking the
 * send. The ORIGINAL model stays selected and answers from the recognition
 * it was handed; the session's model is never switched.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  captionSteerContent,
  extractVisionGroups,
  failureSteerContent,
  getVisionFallbackStore,
  hasImagePart,
  walkPath,
  type PromptContentPart,
} from './vision-models-state.ts'

const VISION_DESCRIBE_URL = '/api/desktop/vision/describe'
/** Long-edge cap for images sent to the caption bridge: relay gateways
 *  reject multi-megabyte data URLs with HTTP 413, so every image is locally
 *  downscaled and re-encoded before it leaves the app. */
const CAPTION_MAX_EDGE = 1400

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
 * Locally downscale and re-encode one image so the caption request fits
 * through relay gateways (multi-megabyte data URLs die with HTTP 413) and
 * uploads finish fast. Long edge is capped at CAPTION_MAX_EDGE and the result
 * re-encoded as JPEG; any canvas failure returns the original untouched.
 */
async function toCaptionImage(part: ImagePart): Promise<ImagePart> {
  try {
    const bytes = Uint8Array.from(atob(part.data), ch => ch.charCodeAt(0))
    const bitmap = await createImageBitmap(new Blob([bytes], { type: part.mediaType }))
    try {
      const scale = Math.min(1, CAPTION_MAX_EDGE / Math.max(bitmap.width, bitmap.height))
      const width = Math.max(1, Math.round(bitmap.width * scale))
      const height = Math.max(1, Math.round(bitmap.height * scale))
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d')
      if (ctx === null) throw new Error('canvas 2d context unavailable')
      ctx.drawImage(bitmap, 0, 0, width, height)
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
      const encoded = new Uint8Array(await blob.arrayBuffer())
      let binary = ''
      const chunk = 0x8000
      for (let at = 0; at < encoded.length; at += chunk) {
        binary += String.fromCharCode(...encoded.subarray(at, at + chunk))
      }
      return { type: 'image', mediaType: 'image/jpeg', data: btoa(binary), ...(part.name === undefined ? {} : { name: part.name }) }
    } finally {
      bitmap.close()
    }
  } catch (cause) {
    debug('local image compression failed; sending original:', cause instanceof Error ? cause.message : String(cause))
    return part
  }
}

/**
 * Run recognition for an already-dispatched send and deliver the outcome as a
 * steering message into the thinking turn. Fire-and-forget: the send itself
 * has already left, so no latency here reaches the composer.
 */
async function steerRecognition(
  original: WireSessions['prompt'],
  sessionId: string,
  images: readonly ImagePart[],
  provider: string,
  model: string,
  signal: unknown,
): Promise<void> {
  let captions: string[] | undefined
  try {
    const compressed = await Promise.all(images.map(toCaptionImage))
    const response = await fetch(VISION_DESCRIBE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ images: compressed, provider, model }),
      ...(signal instanceof AbortSignal ? { signal } : {}),
    })
    if (!response.ok) throw new Error(`caption bridge HTTP ${String(response.status)}`)
    const value = await response.json() as { captions?: unknown }
    if (!Array.isArray(value.captions) || value.captions.length !== images.length) {
      throw new Error('caption bridge returned a malformed payload')
    }
    for (const caption of value.captions) {
      if (typeof caption !== 'string') throw new Error('caption bridge returned a non-string caption')
    }
    captions = value.captions
  } catch (cause) {
    debug('caption bridge failed:', cause instanceof Error ? cause.message : String(cause))
  }
  try {
    const content = captions !== undefined
      ? captionSteerContent(captions, `${provider}/${model}`)
      : failureSteerContent(images.length)
    debug(captions !== undefined
      ? 'recognition done; steering it into the running turn'
      : 'steering the failure note into the running turn')
    await original({ sessionId, mode: 'steer', content })
  } catch (cause) {
    debug('steering failed:', cause instanceof Error ? cause.message : String(cause))
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
      let engaged: {
        images: ImagePart[]
        provider: string
        model: string
        sessionId: string
      } | undefined
      try {
        // The kernel's Session class sends a flat { sessionId, mode, content,
        // clientTimeZone } request with an optional AbortSignal second
        // argument. The send itself always forwards verbatim; only a parallel
        // recognition (steered in later) is added for text-only models.
        const request = args[0] as { sessionId?: unknown; mode?: unknown; content?: unknown } | undefined
        const content = request?.content
        if (
          typeof request?.sessionId === 'string'
          && Array.isArray(content)
          && hasImagePart(content as PromptContentPart[])
        ) {
          // The in-memory store is the source of truth, NOT localStorage: the
          // kernel web server port changes every launch, so this origin's
          // localStorage is wiped on restart while the host-side prefs file
          // hydrates the store at boot. Reading storage directly would
          // silently see "disabled" forever.
          const config = getVisionFallbackStore().getSnapshot()
          debug(`fallback config: enabled=${String(config.enabled)} provider=${config.provider ?? '(none)'} model=${config.model ?? '(none)'}`)
          if (!config.enabled || config.provider === undefined || config.model === undefined) {
            debug('universal vision model not configured or disabled; image sent as-is')
          } else {
            const modelsResponse = await api.sessions.models({ sessionId: request.sessionId })
            if (!modelsResponse.result.ok) {
              debug('sessions.models failed; image sent as-is:', modelsResponse.result.error.message)
            } else {
              const current = modelsResponse.result.value.current
              if (current.provider === config.provider && current.model === config.model) {
                debug('current model IS the universal vision model; image sent as-is')
              } else {
                let capable: boolean
                try {
                  const map = await loadSupportMap(api)
                  capable = map.get(supportKey(current.provider, current.model)) === true
                } catch (cause) {
                  // Capability unreadable: respect the user's model choice and
                  // send the originals untouched rather than captioning on a guess.
                  debug('capability unreadable; image sent as-is:', cause instanceof Error ? cause.message : String(cause))
                  capable = true
                }
                if (capable) {
                  debug(`model ${current.provider}/${current.model} declared image-capable; originals sent`)
                } else {
                  debug(`current model ${current.provider}/${current.model} cannot take images; asking ${config.provider}/${config.model} to describe while the turn runs`)
                  engaged = {
                    images: (content as PromptContentPart[])
                      .filter((part): part is ImagePart => part.type === 'image'),
                    provider: config.provider,
                    model: config.model,
                    sessionId: request.sessionId,
                  }
                }
              }
            }
          }
        }
      } catch (cause) {
        // Fall through: the send proceeds exactly as the kernel issued it,
        // but never silently — the cause names itself in the console.
        debug('decision error; image sent as-is:', cause instanceof Error ? cause.message : String(cause))
      }
      if (engaged === undefined) return original(args[0], args[1])
      // The send leaves VERBATIM — the user's bubble shows the real image and
      // the kernel behaves exactly as in a vanilla chat. Only the parallel
      // recognition differs.
      const sendPromise = original(args[0], args[1])
      // Recognition must not block the composer: dispatch it once the host
      // accepted the pending-note send, then steer the result mid-turn.
      void (async (): Promise<void> => {
        try {
          const accepted = await sendPromise
          const ok = (accepted as { result?: { ok?: boolean } })?.result?.ok === true
          if (!ok) {
            debug('send was not accepted; skipping recognition steering')
            return
          }
        } catch {
          // A rejected send promise still resolves through promptError paths;
          // attempt steering anyway — the host drops it if the session is gone.
        }
        if (args[1] instanceof AbortSignal && args[1].aborted) {
          debug('send aborted before recognition finished; skipping steering')
          return
        }
        await steerRecognition(
          original,
          engaged.sessionId,
          engaged.images,
          engaged.provider,
          engaged.model,
          args[1],
        )
      })()
      return sendPromise
    }
  } catch {
    // Feature stays off; the kernel path behaves exactly as before.
  }
}
