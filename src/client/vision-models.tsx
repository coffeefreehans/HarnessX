/** Standalone "Multimodal Models" settings section, desktop-owned.
 *
 * Two surfaces in one page, both surviving kernel updates untouched:
 * the per-model 图片输入 declarations (written to the kernel's `llm-pi-ai`
 * settings namespace through the same wire ops the Models page uses) and the
 * universal caption model the desktop send-fallback consults (stored in
 * desktop-owned localStorage).
 */

import { useCallback, useEffect, useState, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  buildBulkOps,
  buildToggleOp,
  extractVisionGroups,
  getVisionFallbackStore,
  isCaptionCompatible,
  type ProviderRouteRow,
  type VisionProviderGroup,
} from './vision-models-state.ts'
import { schedulePersistDesktopPrefs } from './desktop-prefs.ts'
import { DESKTOP_NAV_ICONS, registerDesktopSettingsNavSection } from './desktop-section.tsx'


declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.visionModels': VisionModelsKey
  }
}

export type VisionModelsKey =
  | 'nav'
  | 'title'
  | 'desc'
  | 'universal'
  | 'universalDesc'
  | 'universalPlaceholder'
  | 'searchPlaceholder'
  | 'loading'
  | 'loadFailed'
  | 'retry'
  | 'empty'
  | 'enableAll'
  | 'disableAll'
  | 'imageInput'
  | 'notWritable'
  | 'saveFailed'
  | 'modelsSuffix'
  | 'universalOnlyOpenai'

const zh: Record<VisionModelsKey, string> = {
  nav: '多模态模型',
  title: '多模态模型',
  desc: '为自定义接口的模型声明图片输入。当前模型不支持图片时,发送图片会自动把会话切换到下方通用识图模型,由它直接读图作答;消息原样发送,不会插入任何识图文字。',
  universal: '通用识图模型',
  universalDesc: '当前模型不支持图片时,发送图片自动切换到这个模型;之后可在会话中手动切回',
  universalPlaceholder: '选择识图模型',
  searchPlaceholder: '搜索模型…',
  loading: '加载中…',
  loadFailed: '读取模型配置失败',
  retry: '重试',
  empty: '没有自定义模型接口,请先在「模型」设置中添加。',
  enableAll: '全部开启',
  disableAll: '全部关闭',
  imageInput: '图片输入',
  notWritable: '设置为只读,无法修改',
  saveFailed: '保存失败',
  modelsSuffix: '个模型',
  universalOnlyOpenai: '通用识图模型仅支持 openai-completions 协议的自定义接口',
}

const en: Record<VisionModelsKey, string> = {
  nav: 'Multimodal Models',
  title: 'Multimodal Models',
  desc: 'Declare image input per custom-endpoint model. When the current model cannot take images, sending an image switches the session to the universal vision model below, which reads it directly; your message is sent verbatim with no caption text injected.',
  universal: 'Universal Vision Model',
  universalDesc: 'Sending an image with a text-only model switches to this one; switch back in the session anytime',
  universalPlaceholder: 'Choose a caption model',
  searchPlaceholder: 'Search models…',
  loading: 'Loading…',
  loadFailed: 'Failed to load model settings',
  retry: 'Retry',
  empty: 'No custom model endpoints. Add one in the Models settings first.',
  enableAll: 'Enable all',
  disableAll: 'Disable all',
  imageInput: 'Image input',
  notWritable: 'Settings are read-only',
  saveFailed: 'Save failed',
  modelsSuffix: 'models',
  universalOnlyOpenai: 'The universal vision model requires an openai-completions custom endpoint',
}

const NS = 'settings.visionModels'

const VISION_CSS = `
.dshVisionSection { display: flex; flex-direction: column; gap: 12px; padding: 4px 0 24px; max-width: 640px; }
.dshVisionHeader { display: flex; flex-direction: column; gap: 4px; }
.dshVisionTitle { font-size: 16px; font-weight: 600; line-height: 24px; color: var(--dsw-alias-label-primary); }
.dshVisionDesc { font-size: 12px; font-weight: 400; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshVisionCard { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 16px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.03)); }
.dshVisionCardLeft { display: flex; flex-direction: column; gap: 2px; }
.dshVisionCardLabel { font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); }
.dshVisionCardDesc { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dshVisionCardRight { display: flex; align-items: center; gap: 10px; }
.dshVisionSelect { padding: 4px 8px; font-size: 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform, transparent); color: var(--dsw-alias-label-primary); max-width: 220px; }
.dshVisionSearch { padding: 6px 10px; font-size: 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dshVisionSearch-color, var(--dsw-alias-label-primary)); width: 200px; }
.dshVisionGroup { border: 1px solid var(--dsw-alias-border-l2); border-radius: 8px; overflow: hidden; }
.dshVisionGroup > summary { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 10px 14px; cursor: pointer; background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.03)); font-size: 13px; font-weight: 500; color: var(--dsw-alias-label-primary); list-style: none; }
.dshVisionGroup > summary::-webkit-details-marker { display: none; }
.dshVisionGroupSummaryRight { display: flex; align-items: center; gap: 8px; font-size: 11px; font-weight: 400; color: var(--dsw-alias-label-tertiary); }
.dshVisionModels { display: flex; flex-direction: column; max-height: 380px; overflow-y: auto; }
.dshVisionModelRow { display: flex; align-items: center; justify-content: space-between; gap: 10px; padding: 8px 14px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05)); }
.dshVisionModelId { font-size: 12px; color: var(--dsw-alias-label-primary); word-break: break-all; }
.dshVisionModelMeta { font-size: 10px; color: var(--dsw-alias-label-tertiary); }
.dshVisionToggle { appearance: none; width: 36px; height: 20px; border-radius: 10px; background: var(--dsw-alias-border-l2, #ccc); position: relative; cursor: pointer; outline: none; transition: background 0.2s ease; margin: 0; flex: none; }
.dshVisionToggle:checked { background: var(--dsw-alias-accent, #2563eb); }
.dshVisionToggle::before { content: ""; position: absolute; width: 16px; height: 16px; border-radius: 50%; top: 2px; left: 2px; background: #fff; transition: transform 0.2s ease; box-shadow: 0 1px 2px rgba(0,0,0,0.2); }
.dshVisionToggle:checked::before { transform: translateX(16px); }
.dshVisionToggle:disabled { opacity: 0.5; cursor: not-allowed; }
.dshVisionLinkButton { padding: 2px 8px; font-size: 11px; border-radius: 6px; border: none; background: transparent; color: var(--dsw-alias-accent, #2563eb); cursor: pointer; font: inherit; font-size: 11px; }
.dshVisionLinkButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshVisionLinkButton:disabled { opacity: 0.5; cursor: not-allowed; }
.dshVisionNotice { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dshVisionError { font-size: 12px; color: var(--dsw-alias-accent-danger, #dc2626); display: flex; align-items: center; gap: 8px; }
`

let stylesInjected = false
function ensureVisionStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.dataset.plugin = 'harnessx-desktop'
  style.dataset.pluginCss = 'harnessx-desktop/vision-models'
  style.textContent = VISION_CSS
  document.head.appendChild(style)
  stylesInjected = true
}

/** Wire faces the page talks through (structural, fixture-compatible). */
export interface VisionWireApi {
  llm: { providers: (request: unknown) => Promise<{ result: { ok: true; value: { providers: ProviderRouteRow[] } } | { ok: false; error: { message: string } } }> }
  settings: {
    describe: (request: unknown) => Promise<{ result: { ok: true; value: { writable: boolean; namespaces: { ns: string; value: unknown; revision: number }[] } } | { ok: false; error: { message: string } } }>
    mutate: (request: unknown) => Promise<{ result: { ok: true } | { ok: false; error: { message: string } } }>
  }
}

interface VisionModelState {
  status: 'loading' | 'ready' | 'error'
  error: string | undefined
  writable: boolean
  groups: VisionProviderGroup[]
  rawModels: Map<string, unknown[]>
  revision: number | undefined
}

const EMPTY_STATE: VisionModelState = {
  status: 'loading', error: undefined, writable: true, groups: [], rawModels: new Map(), revision: undefined,
}

async function loadVisionState(api: VisionWireApi): Promise<VisionModelState> {
  const [providersResponse, describeResponse] = await Promise.all([
    api.llm.providers({}),
    api.settings.describe({}),
  ])
  if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
  if (!describeResponse.result.ok) throw new Error(describeResponse.result.error.message)
  const view = describeResponse.result.value
  const namespace = view.namespaces.find(entry => entry.ns === 'llm-pi-ai')
  if (namespace === undefined) throw new Error('llm-pi-ai settings namespace unavailable')
  const groups = extractVisionGroups(namespace.value, providersResponse.result.value.providers)
  const rawModels = new Map<string, unknown[]>()
  for (const group of groups) {
    let cursor: unknown = namespace.value
    let raw: unknown[] = []
    for (const segment of group.modelsPath) {
      cursor = typeof cursor === 'object' && cursor !== null
        ? (cursor as Record<string, unknown>)[segment]
        : undefined
    }
    if (Array.isArray(cursor)) raw = cursor
    rawModels.set(group.provider, raw)
  }
  return {
    status: 'ready',
    error: undefined,
    writable: view.writable,
    groups,
    rawModels,
    revision: namespace.revision,
  }
}

export function VisionModelsSection(
  _props: PropsRuntime<'settings.section'> & PropsLocale<'settings.visionModels'> & { api: VisionWireApi },
): ReactNode {
  const { t, api } = _props
  const [state, setState] = useState<VisionModelState>(EMPTY_STATE)
  const [search, setSearch] = useState('')
  const [busyProvider, setBusyProvider] = useState<string | undefined>(undefined)
  const [saveError, setSaveError] = useState<string | undefined>(undefined)
  const fallbackStore = getVisionFallbackStore()
  const [fallback, setFallback] = useState(fallbackStore.getSnapshot())

  useEffect(() => {
    ensureVisionStyles()
    return fallbackStore.subscribe(() => { setFallback(fallbackStore.getSnapshot()) })
  }, [fallbackStore])

  const reload = useCallback(() => {
    setState(current => ({ ...current, status: current.groups.length > 0 ? 'ready' : 'loading' }))
    loadVisionState(api).then(next => { setState(next) }, (cause: unknown) => {
      setState({
        ...EMPTY_STATE,
        status: 'error',
        error: cause instanceof Error ? cause.message : String(cause),
      })
    })
  }, [api])

  useEffect(() => { reload() }, [reload])

  const mutate = useCallback(async (provider: string, ops: { op: 'set' | 'unset'; path: string[]; value?: unknown }[]): Promise<void> => {
    if (state.writable !== true || busyProvider !== undefined) return
    setBusyProvider(provider)
    setSaveError(undefined)
    try {
      const response = await api.settings.mutate({
        ns: 'llm-pi-ai',
        ops,
        ...(state.revision === undefined ? {} : { expectedRevision: state.revision }),
      })
      if (!response.result.ok) {
        setSaveError(`${t('saveFailed')}:${response.result.error.message}`)
      }
    } catch (cause) {
      setSaveError(`${t('saveFailed')}:${cause instanceof Error ? cause.message : String(cause)}`)
    } finally {
      setBusyProvider(undefined)
      reload()
    }
  }, [api, busyProvider, reload, state.revision, state.writable, t])

  const toggle = (group: VisionProviderGroup, index: number, enable: boolean): void => {
    const raw = state.rawModels.get(group.provider) ?? []
    const op = buildToggleOp(group, index, enable, raw)
    if (op === undefined) return
    void mutate(group.provider, [op])
  }

  const bulk = (group: VisionProviderGroup, enable: boolean): void => {
    const raw = state.rawModels.get(group.provider) ?? []
    void mutate(group.provider, buildBulkOps(group, raw, enable))
  }

  const universalValue = fallback.provider !== undefined && fallback.model !== undefined
    ? `${fallback.provider}\u0000${fallback.model}`
    : ''

  const onUniversalChange = (value: string): void => {
    if (value === '') {
      fallbackStore.set({ ...fallback, provider: undefined, model: undefined })
      return
    }
    const [provider, model] = value.split('\u0000')
    fallbackStore.set({ ...fallback, provider, model })
  }

  // The caption bridge only speaks openai-completions, so the universal model
  // picker must list compatible endpoints only; otherwise a user could select
  // a model the host would reject and the send would silently lose the image.
  const captionGroups = state.groups.filter(isCaptionCompatible)
  const hasCaptionEndpoint = captionGroups.length > 0 || state.groups.length === 0

  if (state.status === 'loading') {
    return <div className="dshVisionSection"><div className="dshVisionNotice">{t('loading')}</div></div>
  }
  if (state.status === 'error') {
    return (
      <div className="dshVisionSection">
        <div className="dshVisionError">
          <span>{t('loadFailed')}{state.error === undefined ? '' : `:${state.error}`}</span>
          <button type="button" className="dshVisionLinkButton" onClick={() => { reload() }}>{t('retry')}</button>
        </div>
      </div>
    )
  }

  const query = search.trim().toLowerCase()
  return (
    <div className="dshVisionSection">
      <div className="dshVisionHeader">
        <div className="dshVisionTitle">{t('title')}</div>
        <div className="dshVisionDesc">{t('desc')}</div>
      </div>

      <div className="dshVisionCard">
        <div className="dshVisionCardLeft">
          <div className="dshVisionCardLabel">{t('universal')}</div>
          <div className="dshVisionCardDesc">{t('universalDesc')}</div>
        </div>
        <div className="dshVisionCardRight">
          <select
            className="dshVisionSelect"
            aria-label={t('universal')}
            value={universalValue}
            disabled={state.groups.length > 0 && !hasCaptionEndpoint}
            onChange={e => { onUniversalChange(e.target.value) }}
          >
            <option value="">{t('universalPlaceholder')}</option>
            {captionGroups.map(group => group.models.map(model => {
              const value = `${group.provider}\u0000${model.id}`
              return <option key={value} value={value}>{`${group.displayName} · ${model.id}`}</option>
            }))}
          </select>
          <input
            type="checkbox"
            className="dshVisionToggle"
            aria-label={t('universal')}
            checked={fallback.enabled && universalValue !== ''}
            disabled={universalValue === ''}
            onChange={e => {
              fallbackStore.set({ ...fallback, enabled: e.target.checked })
              schedulePersistDesktopPrefs()
            }}
          />
        </div>
      </div>

      {state.groups.length > 0 && !hasCaptionEndpoint
        ? <div className="dshVisionNotice">{t('universalOnlyOpenai')}</div>
        : null}

      {saveError === undefined ? null : <div className="dshVisionError">{saveError}</div>}
      {state.writable ? null : <div className="dshVisionNotice">{t('notWritable')}</div>}

      {state.groups.length === 0
        ? <div className="dshVisionNotice">{t('empty')}</div>
        : (
          <>
            <input
              type="search"
              className="dshVisionSearch"
              placeholder={t('searchPlaceholder')}
              aria-label={t('searchPlaceholder')}
              value={search}
              onChange={e => { setSearch(e.target.value) }}
            />
            {state.groups.map(group => {
              const models = query === ''
                ? group.models
                : group.models.filter(model =>
                  model.id.toLowerCase().includes(query)
                  || (model.name ?? '').toLowerCase().includes(query))
              if (models.length === 0) return null
              const enabledCount = group.models.filter(model => model.imageEnabled).length
              return (
                <details key={group.provider} className="dshVisionGroup" open={enabledCount > 0}>
                  <summary>
                    <span>{`${group.displayName} · ${String(group.models.length)} ${t('modelsSuffix')}`}</span>
                    <span className="dshVisionGroupSummaryRight">
                      <button
                        type="button"
                        className="dshVisionLinkButton"
                        disabled={!state.writable || busyProvider !== undefined}
                        onClick={e => { e.preventDefault(); bulk(group, true) }}
                      >
                        {t('enableAll')}
                      </button>
                      <button
                        type="button"
                        className="dshVisionLinkButton"
                        disabled={!state.writable || busyProvider !== undefined}
                        onClick={e => { e.preventDefault(); bulk(group, false) }}
                      >
                        {t('disableAll')}
                      </button>
                    </span>
                  </summary>
                  <div className="dshVisionModels">
                    {models.map(model => {
                      const index = group.models.indexOf(model)
                      return (
                        <div key={model.id} className="dshVisionModelRow">
                          <div className="dshVisionCardLeft">
                            <div className="dshVisionModelId">{model.id}</div>
                            {model.name === undefined || model.name === model.id
                              ? null
                              : <div className="dshVisionModelMeta">{model.name}</div>}
                          </div>
                          <input
                            type="checkbox"
                            className="dshVisionToggle"
                            aria-label={`${t('imageInput')} ${model.id}`}
                            checked={model.imageEnabled}
                            disabled={!state.writable || busyProvider !== undefined}
                            onChange={e => { toggle(group, index, e.target.checked) }}
                          />
                        </div>
                      )
                    })}
                  </div>
                </details>
              )
            })}
          </>
        )}
    </div>
  )
}

/** Master switch for the Multimodal Models settings surface. Every supporting
 *  piece (fallback send interception, host caption route, preference hydration)
 *  stays wired regardless, so this only gates the panel entry. */
const VISION_MODELS_UI_ENABLED = true

/** Register the desktop-owned Multimodal Models section in the settings panel. */
export function applyVisionModels(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'vision-models: dictionaries')
  if (!VISION_MODELS_UI_ENABLED) return
  const t = ctx.locale.bind(NS)
  registerDesktopSettingsNavSection(() => t('nav'), DESKTOP_NAV_ICONS.eye)
  const connection = ctx.get('connection') as { api: VisionWireApi }
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'vision-models',
    order: 85,
    label: () => t('nav'),
    locale: NS,
    inject: () => ({ api: connection.api }),
  }, VisionModelsSection))
}
