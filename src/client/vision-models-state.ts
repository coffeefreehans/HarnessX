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
 * Whole-array `set` op flipping one entry's image declaration, the same
 * granularity the kernel Models editor writes. Enabling copies the entry and
 * sets `input: ['text', 'image']`; disabling drops the key so resolution falls
 * back to the route default (text). Unknown index returns undefined.
 */
export function buildToggleOp(
  group: VisionProviderGroup,
  index: number,
  enable: boolean,
  rawModels: readonly unknown[],
): SettingsPathOp | undefined {
  if (index < 0 || index >= group.models.length || index >= rawModels.length) return undefined
  const next = rawModels.map((entry, at) => {
    if (at !== index || typeof entry !== 'object' || entry === null) return entry
    const clone: Record<string, unknown> = { ...(entry as Record<string, unknown>) }
    if (enable) clone.input = ['text', 'image']
    else delete clone.input
    return clone
  })
  return { op: 'set', path: [...group.modelsPath], value: next }
}

/**
 * Whole-array `set` op setting every entry's image declaration at once. Used
 * by the per-provider enable/disable-all buttons; a no-change entry keeps its
 * object identity so the settings diff stays small.
 */
export function buildBulkOps(
  group: VisionProviderGroup,
  rawModels: readonly unknown[],
  enable: boolean,
): SettingsPathOp[] {
  const next = rawModels.map((entry, at) => {
    const row = group.models[at]
    if (row === undefined || typeof entry !== 'object' || entry === null) return entry
    if (row.imageEnabled === enable) return entry
    const clone: Record<string, unknown> = { ...(entry as Record<string, unknown>) }
    if (enable) clone.input = ['text', 'image']
    else delete clone.input
    return clone
  })
  return [{ op: 'set', path: [...group.modelsPath], value: next }]
}

/** Whether a prompt carries at least one image part. */
export function hasImagePart(content: readonly PromptContentPart[]): boolean {
  return content.some(part => part.type === 'image')
}

/**
 * Replace each image part with its caption as a labelled text part, in
 * position. Keeping the image part would make the kernel present the model
 * an `Image sha256:` marker plus a read-image tool, and text-only models
 * then chase the file instead of using the caption. With the image replaced
 * by its recognition, the model can only answer from the caption — which is
 * exactly the vision model's report to it. The producing vision model's name
 * travels inside the label so every historic send stays attributable.
 */
export function replaceImagesWithCaptions(
  content: readonly PromptContentPart[],
  captions: readonly string[],
  visionModel: string,
): PromptContentPart[] {
  let imageIndex = 0
  return content.map((part): PromptContentPart => {
    if (part.type !== 'image') return part
    const ordinal = imageIndex + 1
    const caption = captions[imageIndex]?.trim()
    imageIndex += 1
    return {
      type: 'text',
      text: `\n\n[图片 ${String(ordinal)} 识别结果 · 由识图模型 ${visionModel} 自动生成,当前模型无法读取原图,请直接依据以下内容回答,不要尝试读取图片文件]\n${caption !== undefined && caption.length > 0 ? caption : '(图片识别未返回内容)'}`,
    }
  })
}

/**
 * Replace each image part with a failure note, for sends where the caption
 * bridge was engaged but the recognition call failed. Sending the raw image
 * instead would only give a text-only model the kernel's `Image sha256:`
 * marker plus a read-image tool it cannot use — models then chase the hash
 * and answer nonsense. The note lets the model state honestly that the
 * image could not be recognized.
 */
export function replaceImagesWithFailureNotes(content: readonly PromptContentPart[]): PromptContentPart[] {
  let imageIndex = 0
  return content.map((part): PromptContentPart => {
    if (part.type !== 'image') return part
    const ordinal = imageIndex + 1
    imageIndex += 1
    return {
      type: 'text',
      text: `\n\n[图片 ${String(ordinal)} · 识图服务调用失败,当前模型无法读取原图。请直接告知用户这张图片暂时无法识别,不要尝试读取图片文件、调用读图工具或输出文件哈希]`,
    }
  })
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
}

export const VISION_FALLBACK_STORAGE_KEY = 'harnessx.desktop.vision'

export const DEFAULT_VISION_FALLBACK_SETTINGS: VisionFallbackSettings = {
  enabled: false,
  provider: undefined,
  model: undefined,
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
  if (typeof localStorage === 'undefined') return DEFAULT_VISION_FALLBACK_SETTINGS
  try {
    const raw = localStorage.getItem(VISION_FALLBACK_STORAGE_KEY)
    if (raw === null) return DEFAULT_VISION_FALLBACK_SETTINGS
    const value = JSON.parse(raw) as Partial<VisionFallbackSettings>
    return {
      enabled: value.enabled === true,
      provider: typeof value.provider === 'string' && value.provider.length > 0 ? value.provider : undefined,
      model: typeof value.model === 'string' && value.model.length > 0 ? value.model : undefined,
    }
  } catch {
    return DEFAULT_VISION_FALLBACK_SETTINGS
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
