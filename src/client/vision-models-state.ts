/** Vision-model state: per-model image toggles and the universal vision model choice.
 *
 * Pure logic plus localStorage-backed desktop-owned configuration. The kernel
 * keeps provider model lists under the `llm-pi-ai` settings namespace; image
 * admission reads each entry's `input` array, and undeclared entries default
 * to text-only. This module reads/writes those declarations through the same
 * settings wire face the kernel Models page uses, so no kernel file changes.
 */

export type PromptContentPart =
  | { type: 'text'; text: string }
  | { type: 'image'; mediaType: string; data: string; name?: string }

/** One settings.mutate path op (the wire shape of SettingsPathOpView). */
export interface SettingsPathOp {
  op: 'set' | 'unset'
  path: string[]
  value?: unknown
}

/** Minimal provider-directory row the page and fallback consume. */
export interface ProviderRouteRow {
  provider: string
  displayName: string
  settingsNs: string
  settingsPath: string[]
}

/** One custom-route model with its declared image capability. */
export interface VisionModelRow {
  id: string
  name: string | undefined
  imageEnabled: boolean
}

/** One custom provider with its editable model declarations. */
export interface VisionProviderGroup {
  provider: string
  displayName: string
  modelsPath: string[]
  models: VisionModelRow[]
  /** Wire protocol the bridge can caption through; only `openai-completions`
   *  routes are served by the host caption endpoint. */
  api: string | undefined
}

/** Walk a JSON value by path segments (objects and array indices). */
export function walkPath(value: unknown, path: readonly string[]): unknown {
  let current = value
  for (const segment of path) {
    if (typeof current !== 'object' || current === null) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

function isImageEnabled(entry: unknown): boolean {
  if (typeof entry !== 'object' || entry === null) return false
  const input = (entry as { input?: unknown }).input
  return Array.isArray(input) && input.includes('image')
}

/**
 * Build the provider groups a vision surface renders, from the settings
 * namespace value plus the provider directory rows. Only custom `llm-pi-ai`
 * routes are editable here; entries are returned in declared order.
 */
export function extractVisionGroups(
  namespaceValue: unknown,
  rows: readonly ProviderRouteRow[],
): VisionProviderGroup[] {
  const groups: VisionProviderGroup[] = []
  for (const row of rows) {
    if (row.settingsNs !== 'llm-pi-ai' || row.settingsPath.length === 0) continue
    const profile = walkPath(namespaceValue, row.settingsPath)
    if (typeof profile !== 'object' || profile === null) continue
    const rawModels = (profile as { models?: unknown }).models
    if (!Array.isArray(rawModels)) continue
    const models: VisionModelRow[] = []
    for (const entry of rawModels) {
      if (typeof entry !== 'object' || entry === null) continue
      const id = (entry as { id?: unknown }).id
      if (typeof id !== 'string' || id.length === 0) continue
      const name = (entry as { name?: unknown }).name
      models.push({
        id,
        name: typeof name === 'string' && name.length > 0 ? name : undefined,
        imageEnabled: isImageEnabled(entry),
      })
    }
    const profileApi = (profile as { api?: unknown }).api
    groups.push({
      provider: row.provider,
      displayName: row.displayName,
      modelsPath: [...row.settingsPath, 'models'],
      models,
      api: typeof profileApi === 'string' && profileApi.length > 0 ? profileApi : undefined,
    })
  }
  return groups
}

/**
 * Build one whole-array `set` op per provider that forces EVERY entry's image
 * declaration on (`input: ['text', 'image']`). The kernel rejects image sends
 * for models declared without image input before they ever reach storage, so
 * bubbles could never show them. With every custom-route entry declared
 * capable, a model that truly has vision answers from the image itself, and a
 * model marked 无多模态 in the desktop store still gets its image stored and
 * displayed while the universal caption model describes it in parallel.
 * Entries already declaring images keep their object identity so unchanged
 * providers produce no ops at all. Providers without raw arrays are skipped.
 */
export function buildForceImageInputOps(
  groups: readonly VisionProviderGroup[],
  rawByProvider: ReadonlyMap<string, readonly unknown[]>,
): SettingsPathOp[] {
  const ops: SettingsPathOp[] = []
  for (const group of groups) {
    const raw = rawByProvider.get(group.provider)
    if (raw === undefined) continue
    let changed = false
    const next = raw.map((entry, at) => {
      const row = group.models[at]
      if (row === undefined || row.imageEnabled) return entry
      if (typeof entry !== 'object' || entry === null) return entry
      changed = true
      return { ...(entry as Record<string, unknown>), input: ['text', 'image'] }
    })
    if (changed) ops.push({ op: 'set', path: [...group.modelsPath], value: next })
  }
  return ops
}

/** Desktop-owned record key for one provider/model pair. Model ids may
 *  contain `/`, so the separator must be a character ids cannot carry. */
export function capabilityKey(provider: string, model: string): string {
  return `${provider}\u0000${model}`
}

/**
 * Whether a prompt carries at least one image part.
 */
export function hasImagePart(content: readonly PromptContentPart[]): boolean {
  return content.some(part => part.type === 'image')
}
export function captionSteerContent(
  captions: readonly string[],
  visionModel: string,
): PromptContentPart[] {
  return captions.map((caption, index): PromptContentPart => ({
    type: 'text',
    text: `\n\n[图片 ${String(index + 1)} 识别结果 · 由识图模型 ${visionModel} 自动生成,当前模型无法读取原图,请直接依据以下内容回答用户关于这张图片的问题,不要尝试读取图片文件]\n${caption.trim().length > 0 ? caption.trim() : '(图片识别未返回内容)'}`,
  }))
}

/**
 * Build the steering message for sends whose recognition failed. The note
 * lets the model state honestly that the image could not be recognized,
 * instead of chasing kernel sha256 markers through read_image.
 */
export function failureSteerContent(count: number): PromptContentPart[] {
  return Array.from({ length: Math.max(0, count) }, (_unused, index): PromptContentPart => ({
    type: 'text',
    text: `\n\n[图片 ${String(index + 1)} · 识图服务调用失败,当前模型无法读取原图。请直接告知用户这张图片暂时无法识别,不要尝试读取图片文件、调用读图工具或输出文件哈希]`,
  }))
}

/** Wire protocol the host caption bridge speaks. Only `openai-completions`
 *  custom endpoints can be used as the universal vision model. */
export const CAPTION_SUPPORTED_API = 'openai-completions'

/** Whether a provider group can serve the universal vision model. */
export function isCaptionCompatible(group: VisionProviderGroup): boolean {
  return group.api === CAPTION_SUPPORTED_API
}

export interface VisionFallbackSettings {
  /** Send images through the universal caption model when the current model cannot take them. */
  enabled: boolean
  /** Provider route of the universal caption model. */
  provider: string | undefined
  /** Model id of the universal caption model. */
  model: string | undefined
  /** Models marked 无多模态 by the user, keyed {@link capabilityKey}. A model
   *  absent here is treated as vision-capable unless a probe says otherwise;
   *  an explicit mark wins over any probe result. */
  textOnly: Record<string, boolean>
  /** Cached automatic vision-probe outcomes, keyed {@link capabilityKey}.
   *  true = the endpoint answered a tiny test image affirmatively; false =
   *  it rejected or denied seeing it. Absent = never probed. */
  probeResults: Record<string, boolean>
}

export const VISION_FALLBACK_STORAGE_KEY = 'harnessx.desktop.vision'

export const DEFAULT_VISION_FALLBACK_SETTINGS: VisionFallbackSettings = {
  enabled: false,
  provider: undefined,
  model: undefined,
  textOnly: {},
  probeResults: {},
}

/** Sanitize one candidate text-only map: plain objects with boolean values. */
export function sanitizeTextOnlyMap(value: unknown): Record<string, boolean> {
  if (typeof value !== 'object' || value === null) return {}
  const result: Record<string, boolean> = {}
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (key.length > 0 && typeof entry === 'boolean') result[key] = entry
  }
  return result
}

export interface VisionFallbackStore {
  getSnapshot(): VisionFallbackSettings
  subscribe(listener: () => void): () => void
  set(next: VisionFallbackSettings): void
}

let fallbackStore: VisionFallbackStore | undefined

/** Read the fallback settings straight from storage, bypassing any in-memory
 *  snapshot. The send interceptor calls this per prompt so a toggle flipped in
 *  another window (or another module instance) applies on the very next send. */
export function readPersistedFallback(): VisionFallbackSettings {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_VISION_FALLBACK_SETTINGS, textOnly: {}, probeResults: {} }
  try {
    const raw = localStorage.getItem(VISION_FALLBACK_STORAGE_KEY)
    if (raw === null) return { ...DEFAULT_VISION_FALLBACK_SETTINGS, textOnly: {} }
    const value = JSON.parse(raw) as Partial<VisionFallbackSettings>
    return {
      enabled: value.enabled === true,
      provider: typeof value.provider === 'string' && value.provider.length > 0 ? value.provider : undefined,
      model: typeof value.model === 'string' && value.model.length > 0 ? value.model : undefined,
      textOnly: sanitizeTextOnlyMap(value.textOnly),
      probeResults: sanitizeTextOnlyMap(value.probeResults),
    }
  } catch {
    return { ...DEFAULT_VISION_FALLBACK_SETTINGS, textOnly: {}, probeResults: {} }
  }
}

/** Desktop-owned persistent store for the universal caption model choice. */
export function getVisionFallbackStore(): VisionFallbackStore {
  if (fallbackStore === undefined) {
    let current = readPersistedFallback()
    const listeners = new Set<() => void>()
    fallbackStore = {
      getSnapshot: () => current,
      subscribe: (listener) => {
        listeners.add(listener)
        return () => { listeners.delete(listener) }
      },
      set: (next) => {
        current = Object.freeze({ ...next })
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(VISION_FALLBACK_STORAGE_KEY, JSON.stringify(current))
          } catch {
            // Storage unavailable; the in-memory value still serves this session.
          }
        }
        for (const listener of listeners) listener()
      },
    }
  }
  return fallbackStore
}
