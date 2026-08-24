/** Vision fallback send interception: desktop-owned, zero kernel edits.
 *
 * The kernel rejects any image send for a model declared without image input
 * before the image ever reaches storage, so the bubble could never show it.
 * This module therefore keeps every custom-route declaration forced to
 * `input: ['text', 'image']` (see `ensureCustomImageDeclarations`): images are
 * always admitted, always stored, and always rendered natively in the chat.
 * A model that truly has vision then answers from the image itself. A model
 * marked 无多模态 in the desktop store gets its image described by the
 * universal caption bridge in parallel (locally downscaled first so relay
 * gateways don't reject large screenshots); the description is delivered
 * mid-turn as a steering message (`mode: 'steer'`) while the model's own turn
 * runs — the composer never blocks and the session model never changes.
 * Official-route (llm-deepseek) text-only entries keep the older behavior:
 * their admission cannot be overridden, so their sends strip the image and
 * rely on the steered caption alone.
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import {
  buildForceImageInputOps,
  capabilityKey,
  captionSteerContent,
  extractVisionGroups,
  failureSteerContent,
  getVisionFallbackStore,
  hasImagePart,
  walkPath,
  type PromptContentPart,
  type VisionFallbackSettings,
} from './vision-models-state.ts'
import { schedulePersistDesktopPrefs } from './desktop-prefs.ts'

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
  settings: {
    describe: (request: unknown) => Promise<{ result: { ok: true; value: { writable?: boolean; namespaces: { ns: string; value: unknown; revision: number }[] } } | { ok: false; error: { message: string } } }>
    mutate: (request: unknown) => Promise<{ result: { ok: true } | { ok: false; error: { message: string } } }>
  }
}

/**
 * Force every custom-route model declaration to admit images, once per page.
 * The kernel's admission gate rejects image sends for entries whose `input`
 * lacks `image` BEFORE they reach storage — with the gate closed, the chat
 * could never display the image. Declaring every custom-route entry capable
 * moves the "can this model really see" decision into desktop-owned
 * bookkeeping (`textOnly` in the vision store), where absent means
 * vision-capable and only marked models get caption help.
 *
 * Memoized; a failed attempt clears the memo so the next send retries.
 */
let declarationsPromise: Promise<void> | undefined
function ensureCustomImageDeclarations(api: WireApi): Promise<void> {
  declarationsPromise ??= (async (): Promise<void> => {
    const [providersResponse, describeResponse] = await Promise.all([
      api.llm.providers({}),
      api.settings.describe({}),
    ])
    if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
    if (!describeResponse.result.ok) throw new Error(describeResponse.result.error.message)
    const namespaces = new Map(describeResponse.result.value.namespaces.map(view => [view.ns, view.value]))
    const rows = providersResponse.result.value.providers
    const groups = extractVisionGroups(namespaces.get('llm-pi-ai'), rows)
    if (groups.length === 0) return
    const rawByProvider = new Map<string, unknown[]>()
    for (const group of groups) {
      const raw = walkPath(namespaces.get('llm-pi-ai'), group.modelsPath)
      if (Array.isArray(raw)) rawByProvider.set(group.provider, raw)
    }
    const ops = buildForceImageInputOps(groups, rawByProvider)
    if (ops.length === 0) return
    const view = describeResponse.result.value.namespaces.find(entry => entry.ns === 'llm-pi-ai')
    const response = await api.settings.mutate({
      ns: 'llm-pi-ai',
      ops,
      ...(view === undefined ? {} : { expectedRevision: view.revision }),
    })
    if (!response.result.ok) throw new Error(response.result.error.message)
    debug(`forced image-input declarations on ${String(ops.length)} provider(s); bubbles can store and show images`)
  })()
  return declarationsPromise
}

/**
 * Read which OFFICIAL-route (llm-deepseek) models admit images from their
 * declared catalog modalities. Their admission gate cannot be overridden by
 * desktop settings, so these declarations remain authoritative.
 */
async function loadOfficialSupportMap(api: WireApi): Promise<Map<string, boolean>> {
  const map = new Map<string, boolean>()
  const describeResponse = await api.settings.describe({})
  if (!describeResponse.result.ok) throw new Error(describeResponse.result.error.message)
  const namespaces = new Map(describeResponse.result.value.namespaces.map(view => [view.ns, view.value]))
  const deepSeek = namespaces.get('llm-deepseek')
  const deepSeekModels = walkPath(deepSeek, ['models'])
  const official = (await api.llm.providers({})).result
  const row = official.ok ? official.value.providers.find(entry => entry.settingsNs === 'llm-deepseek') : undefined
  if (row !== undefined && Array.isArray(deepSeekModels)) {
    for (const entry of deepSeekModels) {
      if (typeof entry !== 'object' || entry === null) continue
      const id = (entry as { id?: unknown }).id
      const modalities = (entry as { inputModalities?: unknown }).inputModalities
      if (typeof id === 'string' && Array.isArray(modalities) && modalities.includes('image')) {
        map.set(capabilityKey(row.provider, id), true)
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
    // Kick the declaration sweep eagerly so the admission gate is already open
    // before the user's first image send of this session.
    void ensureCustomImageDeclarations(api).catch((cause: unknown) => {
      declarationsPromise = undefined
      debug('declaration sweep failed; retrying on next send:', cause instanceof Error ? cause.message : String(cause))
    })
    sessions.prompt = async (...args: unknown[]): Promise<unknown> => {
      let engaged: {
        strip: boolean
        images: ImagePart[]
        provider: string
        model: string
        sessionId: string
      } | undefined
      const request = args[0] as { sessionId?: unknown; mode?: unknown; content?: unknown } | undefined
      const content = request?.content
      try {
        if (
          typeof request?.sessionId === 'string'
          && Array.isArray(content)
          && hasImagePart(content as PromptContentPart[])
        ) {
          // Open the admission gate first: without the forced declarations the
          // kernel rejects the whole send and no bubble could ever show it.
          await ensureCustomImageDeclarations(api)
          // The in-memory store is the source of truth, NOT localStorage: the
          // kernel web server port changes every launch, so this origin's
          // localStorage is wiped on restart while the host-side prefs file
          // hydrates the store at boot. Reading storage directly would
          // silently see "disabled" forever.
          const config = getVisionFallbackStore().getSnapshot()
          debug(`fallback config: enabled=${String(config.enabled)} provider=${config.provider ?? '(none)'} model=${config.model ?? '(none)'}`)
          if (!config.enabled || config.provider === undefined || config.model === undefined) {
            debug('universal vision not configured or disabled; model answers from the image directly')
          } else {
            const modelsResponse = await api.sessions.models({ sessionId: request.sessionId })
            if (!modelsResponse.result.ok) {
              debug('sessions.models failed; send untouched:', modelsResponse.result.error.message)
            } else {
              const current = modelsResponse.result.value.current
              if (current.provider === config.provider && current.model === config.model) {
                debug('current model IS the universal vision model; answering from the image directly')
              } else if (await officialRouteProvider(api, current.provider)) {
                // Official-route capability declarations are server-owned truth;
                // desktop settings cannot override their admission gate.
                const capable = (await loadOfficialSupportMap(api)).get(capabilityKey(current.provider, current.model)) === true
                if (capable) {
                  debug(`official-route model ${current.provider}/${current.model} admits images natively`)
                } else {
                  debug(`official-route model ${current.provider}/${current.model} cannot admit images; asking ${config.provider}/${config.model} to describe`)
                  engaged = engage(config, request.sessionId, content as PromptContentPart[], true)
                }
              } else {
                const key = capabilityKey(current.provider, current.model)
                if (config.textOnly[key] === true) {
                  debug(`model ${current.provider}/${current.model} is marked 无多模态; asking ${config.provider}/${config.model} to describe while it answers`)
                  engaged = engage(config, request.sessionId, content as PromptContentPart[], false)
                } else if (config.probeResults[key] === false) {
                  debug(`probe found no vision in ${current.provider}/${current.model}; asking ${config.provider}/${config.model} to describe while it answers`)
                  engaged = engage(config, request.sessionId, content as PromptContentPart[], false)
                } else {
                  if (config.probeResults[key] === undefined) void probeVision(key, current.provider, current.model)
                  debug(`model ${current.provider}/${current.model} uses its own vision; no caption needed`)
                }
              }
            }
          }
        }
      } catch (cause) {
        // Fall through: the send proceeds exactly as the kernel issued it,
        // but never silently — the cause names itself in the console.
        debug('decision error; send untouched:', cause instanceof Error ? cause.message : String(cause))
      }
      // Custom-route sends always carry their images verbatim: they are stored,
      // rendered in the bubble, and (when marked 无多模态) described in parallel.
      // Only the official-route legacy path strips before sending.
      const sendArgs = engaged?.strip === true
        ? [{ ...(request as object), content: stripForStorage(content as PromptContentPart[]) }, args[1]]
        : [args[0], args[1]]
      const sendPromise = original(sendArgs[0], sendArgs[1])
      if (engaged !== undefined) {
        // Recognition must not block the composer: dispatch it once the host
        // accepted the send, then steer the result mid-turn.
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
      }
      return sendPromise
    }
  } catch {
    // Feature stays off; the kernel path behaves exactly as before.
  }
}

function engage(
  config: VisionFallbackSettings,
  sessionId: string,
  content: PromptContentPart[],
  strip: boolean,
): { strip: boolean; images: ImagePart[]; provider: string; model: string; sessionId: string } {
  return {
    strip,
    images: content.filter((part): part is ImagePart => part.type === 'image'),
    provider: config.provider!,
    model: config.model!,
    sessionId,
  }
}

const VISION_PROBE_URL = '/api/desktop/vision/probe'

/** Reset module-level memoization between tests (declaration sweep, probes). */
export function __resetVisionFallbackForTests(): void {
  declarationsPromise = undefined
  probesInFlight.clear()
}

/** Probe calls already in flight, so concurrent sends fire one request per
 *  model instead of one per message. */
const probesInFlight = new Set<string>()

/**
 * Ask the host bridge whether a custom-route endpoint's model can really see
 * images (a tiny test image goes out; only an affirmative reply counts). The
 * verdict lands in the vision store and persists with the desktop prefs;
 * manual 无多模态 marks keep priority because the write is skipped once any
 * result exists. Fire-and-forget: probes never delay a send.
 */
async function probeVision(key: string, provider: string, model: string): Promise<void> {
  if (probesInFlight.has(key)) return
  probesInFlight.add(key)
  try {
    const response = await fetch(VISION_PROBE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ provider, model }),
    })
    if (!response.ok) throw new Error(`probe HTTP ${String(response.status)}`)
    const value = await response.json() as { capable?: unknown }
    const capable = value.capable === true
    const store = getVisionFallbackStore()
    const snapshot = store.getSnapshot()
    if (snapshot.probeResults[key] === undefined) {
      store.set({ ...snapshot, probeResults: { ...snapshot.probeResults, [key]: capable } })
      schedulePersistDesktopPrefs()
    }
    debug(`vision probe for ${provider}/${model}: ${capable ? 'has vision' : 'no vision'}`)
  } catch (cause) {
    debug('vision probe failed:', cause instanceof Error ? cause.message : String(cause))
  } finally {
    probesInFlight.delete(key)
  }
}

/**
 * Whether this provider is served by the official llm-deepseek route, whose
 * capability declarations are server-owned truth desktop settings cannot
 * override. Any lookup failure answers false (custom-route treatment).
 */
async function officialRouteProvider(api: WireApi, provider: string): Promise<boolean> {
  try {
    const response = await api.llm.providers({})
    if (!response.result.ok) return false
    return response.result.value.providers.some(row => row.provider === provider && row.settingsNs === 'llm-deepseek')
  } catch {
    return false
  }
}

/**
 * Remove every image part from content bound for storage. Only used for the
 * official-route legacy path, whose admission gate rejects images outright;
 * custom-route sends keep their images so the bubble can render them.
 */
function stripForStorage(content: PromptContentPart[]): PromptContentPart[] {
  const kept = content.filter(part => part.type !== 'image')
  return kept.length === 0 ? [{ type: 'text', text: ' ' }] : kept
}
