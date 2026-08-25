/** Standalone "Multimodal Models" settings section, desktop-owned.
 *
 * Two surfaces in one page, both surviving kernel updates untouched:
 * the per-model 图片输入 declarations (written to the kernel's `llm-pi-ai`
 * settings namespace through the same wire ops the Models page uses) and the
 * universal caption model the desktop send-fallback consults (stored in
 * desktop-owned localStorage).
 */

import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import {
  capabilityKey,
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
  | 'noMatch'
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
  nav: '视觉模型',
  title: '视觉模型',
  desc: '图片始终显示在对话框里并随消息发送。发图时自动检测当前模型是否真能看图:能则用其自身视觉作答;不能则自动由下方通用识图模型识别,识别结果交给该模型作答,会话模型始终不变。勾选「强制」可跳过检测,始终走通用识图。',
  universal: '通用识图模型',
  universalDesc: '被标记为「强制」的模型收到图片时,由这个模型识别图片内容并把结果告诉当前模型',
  universalPlaceholder: '选择识图模型',
  searchPlaceholder: '搜索模型…',
  noMatch: '没有匹配的模型',
  loading: '加载中…',
  loadFailed: '读取模型配置失败',
  retry: '重试',
  empty: '没有自定义模型接口,请先在「模型」设置中添加。',
  enableAll: '全部强制',
  disableAll: '取消强制',
  imageInput: '强制',
  notWritable: '设置为只读,无法修改',
  saveFailed: '保存失败',
  modelsSuffix: '个模型',
  universalOnlyOpenai: '通用识图模型仅支持 openai-completions 协议的自定义接口',
}

const en: Record<VisionModelsKey, string> = {
  nav: 'Vision Models',
  title: 'Vision Models',
  desc: 'Images always show in the conversation and travel with the message. On each image send the model is checked automatically: models that truly see images answer from them, while blind models get their images described by the universal vision model below. Tick "Force" to skip detection and always caption.',
  universal: 'Universal Vision Model',
  universalDesc: 'Describes images for models marked "Force" and tells the current model what they contain',
  universalPlaceholder: 'Choose a caption model',
  searchPlaceholder: 'Search models…',
  noMatch: 'No matching models',
  loading: 'Loading…',
  loadFailed: 'Failed to load model settings',
  retry: 'Retry',
  empty: 'No custom model endpoints. Add one in the Models settings first.',
  enableAll: 'Force all',
  disableAll: 'Unforce all',
  imageInput: 'Force',
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
.dshVisionPicker { position: relative; display: flex; flex: 1 1 auto; min-width: 170px; max-width: 220px; }
.dshVisionPickerButton { display: flex; align-items: center; justify-content: space-between; gap: 6px; width: 100%; padding: 4px 8px; font-size: 12px; font-family: inherit; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.03)); color: var(--dsw-alias-label-primary); cursor: pointer; text-align: left; }
.dshVisionPickerButton:disabled { opacity: 0.5; cursor: not-allowed; }
.dshVisionPickerValue { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshVisionPickerChevron { flex: none; font-size: 10px; color: var(--dsw-alias-label-tertiary); transition: transform 0.15s ease; }
.dshVisionPickerChevronOpen { transform: rotate(180deg); }
.dshVisionPickerPanel { position: fixed; z-index: 1200; display: flex; flex-direction: column; gap: 6px; padding: 8px; border-radius: 8px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-layer-3, var(--dsw-alias-bg-module-platform, #fff)); box-shadow: 0 8px 24px rgba(0,0,0,0.16); }
.dshVisionPickerSearch { padding: 6px 8px; font-size: 12px; font-family: inherit; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); width: 100%; box-sizing: border-box; }
.dshVisionPickerList { max-height: 300px; overflow-y: auto; }
.dshVisionPickerOption { display: block; width: 100%; padding: 5px 8px; font-size: 12px; font-family: inherit; text-align: left; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dshVisionPickerOption:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshVisionPickerOptionSelected { color: var(--dsw-alias-accent, #2563eb); font-weight: 600; }
.dshVisionPickerEmpty { padding: 8px; font-size: 12px; color: var(--dsw-alias-label-tertiary); }
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
  groups: VisionProviderGroup[]
}

const EMPTY_STATE: VisionModelState = {
  status: 'loading', error: undefined, groups: [],
}

async function loadVisionState(api: VisionWireApi): Promise<VisionModelState> {
  const [providersResponse, describeResponse] = await Promise.all([
    api.llm.providers({}),
    api.settings.describe({}),
  ])
  if (!providersResponse.result.ok) throw new Error(providersResponse.result.error.message)
  if (!describeResponse.result.ok) throw new Error(describeResponse.result.error.message)
  const namespace = describeResponse.result.value.namespaces.find(entry => entry.ns === 'llm-pi-ai')
  if (namespace === undefined) throw new Error('llm-pi-ai settings namespace unavailable')
  return {
    status: 'ready',
    error: undefined,
    groups: extractVisionGroups(namespace.value, providersResponse.result.value.providers),
  }
}

interface PickerEntry {
  value: string
  label: string
}

/** Anchor geometry for the floating panel, captured when it opens. */
interface PickerRect {
  left: number
  top: number
  width: number
}

/** In-page replacement for the native `<select>` picker.
 *
 * The native control opens its option list as an OS popup window. That path
 * fails silently on some Windows setups — launches without foreground
 * activation rights (autostart, tray) and DPI-scaled displays close or
 * misplace the popup, which reads as "the dropdown cannot be clicked". This
 * renderer draws every option as ordinary in-page DOM through a portal, so
 * opening and picking are plain hit-tested clicks like any other button.
 */
function UniversalModelPicker(props: {
  groups: readonly VisionProviderGroup[]
  value: string
  disabled: boolean
  placeholder: string
  searchPlaceholder: string
  noMatch: string
  onChange: (value: string) => void
}): ReactNode {
  const { groups, value, disabled, placeholder, searchPlaceholder, noMatch, onChange } = props
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [rect, setRect] = useState<PickerRect | undefined>(undefined)
  const rootRef = useRef<HTMLDivElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)
  const searchRef = useRef<HTMLInputElement | null>(null)

  const entries = useMemo<PickerEntry[]>(() => groups.flatMap(group => group.models.map(model => ({
    value: `${group.provider}\u0000${model.id}`,
    label: `${group.displayName} · ${model.id}`,
  }))), [groups])
  const current = entries.find(entry => entry.value === value)

  const close = useCallback((): void => { setOpen(false) }, [])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target as Node | null
      if (target === null) return
      if ((rootRef.current?.contains(target) ?? false) || (panelRef.current?.contains(target) ?? false)) return
      setOpen(false)
    }
    // The panel anchors to captured viewport coordinates; scrolling under it
    // would leave it detached, so any scroll closes it instead.
    const onScroll = (): void => { setOpen(false) }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.stopPropagation()
      setOpen(false)
    }
    document.addEventListener('pointerdown', onPointerDown, true)
    document.addEventListener('scroll', onScroll, true)
    document.addEventListener('keydown', onKeyDown, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown, true)
      document.removeEventListener('scroll', onScroll, true)
      document.removeEventListener('keydown', onKeyDown, true)
    }
  }, [open])

  if (disabled) {
    return (
      <div className="dshVisionPicker">
        <button type="button" className="dshVisionPickerButton" aria-label={placeholder} disabled>
          <span className="dshVisionPickerValue">{current?.label ?? placeholder}</span>
          <span className="dshVisionPickerChevron" aria-hidden="true">▾</span>
        </button>
      </div>
    )
  }

  const filtered = query.trim() === ''
    ? entries
    : entries.filter(entry => entry.label.toLowerCase().includes(query.trim().toLowerCase()))

  const openPanel = (): void => {
    const box = rootRef.current?.getBoundingClientRect()
    if (box === undefined) return
    const width = Math.max(Math.round(box.width), 280)
    const left = Math.max(8, Math.round(box.right) - width)
    const top = Math.min(Math.round(box.bottom) + 4, Math.max(8, window.innerHeight - 340))
    setRect({ left, top, width })
    setQuery('')
    setOpen(true)
  }

  const pick = (next: string): void => {
    onChange(next)
    setOpen(false)
  }

  const moveFocus = (event: ReactKeyboardEvent): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    const panel = panelRef.current
    if (panel === null) return
    const options = Array.from(panel.querySelectorAll<HTMLButtonElement>('.dshVisionPickerOption'))
    if (options.length === 0) return
    event.preventDefault()
    const at = options.indexOf(document.activeElement as HTMLButtonElement)
    const nextAt = event.key === 'ArrowDown'
      ? Math.min(at + 1, options.length - 1)
      : Math.max(at - 1, 0)
    const next = options[nextAt]
    if (next !== undefined) next.focus()
  }

  return (
    <div className="dshVisionPicker" ref={rootRef}>
      <button
        type="button"
        className="dshVisionPickerButton"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => { open ? close() : openPanel() }}
      >
        <span className="dshVisionPickerValue">{current?.label ?? placeholder}</span>
        <span className={open ? 'dshVisionPickerChevron dshVisionPickerChevronOpen' : 'dshVisionPickerChevron'} aria-hidden="true">▾</span>
      </button>
      {createPortal(
        open && rect !== undefined ? (
          <div
            className="dshVisionPickerPanel"
            ref={panelRef}
            style={{ left: rect.left, top: rect.top, width: rect.width }}
            onKeyDown={moveFocus}
          >
            <input
              ref={searchRef}
              type="search"
              className="dshVisionPickerSearch"
              placeholder={searchPlaceholder}
              value={query}
              autoFocus
              onChange={e => { setQuery(e.target.value) }}
            />
            <div className="dshVisionPickerList">
              {filtered.length === 0
                ? <div className="dshVisionPickerEmpty">{noMatch}</div>
                : filtered.map(entry => (
                  <button
                    type="button"
                    key={entry.value}
                    className={entry.value === value
                      ? 'dshVisionPickerOption dshVisionPickerOptionSelected'
                      : 'dshVisionPickerOption'}
                    title={entry.label}
                    onClick={() => { pick(entry.value) }}
                  >
                    {entry.label}
                  </button>
                ))}
            </div>
          </div>
        ) : null,
        document.body,
      )}
    </div>
  )
}


export function VisionModelsSection(
  _props: PropsRuntime<'settings.section'> & PropsLocale<'settings.visionModels'> & { api: VisionWireApi },
): ReactNode {
  const { t, api } = _props
  const [state, setState] = useState<VisionModelState>(EMPTY_STATE)
  const [search, setSearch] = useState('')
  /** User-driven expansion per provider group; undefined keeps the smart
   *  default of expanding groups that contain 强制 marks. */
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({})
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

  /** Flip one model's manual 强制 mark in the desktop-owned store. */
  const setTextOnly = (provider: string, modelId: string, value: boolean): void => {
    const snapshot = fallbackStore.getSnapshot()
    fallbackStore.set({
      ...snapshot,
      textOnly: { ...snapshot.textOnly, [capabilityKey(provider, modelId)]: value },
    })
    schedulePersistDesktopPrefs()
  }

  /** Apply one manual mark to every model of a provider group at once. */
  const setGroupTextOnly = (group: VisionProviderGroup, value: boolean): void => {
    const snapshot = fallbackStore.getSnapshot()
    const textOnly = { ...snapshot.textOnly }
    for (const model of group.models) textOnly[capabilityKey(group.provider, model.id)] = value
    fallbackStore.set({ ...snapshot, textOnly })
    schedulePersistDesktopPrefs()
  }

  const universalValue = fallback.provider !== undefined && fallback.model !== undefined
    ? `${fallback.provider}\u0000${fallback.model}`
    : ''

  const onUniversalChange = (value: string): void => {
    if (value === '') {
      fallbackStore.set({ ...fallback, provider: undefined, model: undefined })
      schedulePersistDesktopPrefs()
      return
    }
    const [provider, model] = value.split('\u0000')
    fallbackStore.set({ ...fallback, provider, model })
    schedulePersistDesktopPrefs()
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
          <UniversalModelPicker
            groups={captionGroups}
            value={universalValue}
            disabled={state.groups.length > 0 && !hasCaptionEndpoint}
            placeholder={t('universalPlaceholder')}
            searchPlaceholder={t('searchPlaceholder')}
            noMatch={t('noMatch')}
            onChange={onUniversalChange}
          />
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
              const markedCount = group.models.filter(model =>
                fallback.textOnly[capabilityKey(group.provider, model.id)] === true).length
              return (
                <details
                  key={group.provider}
                  className="dshVisionGroup"
                  open={expandedGroups[group.provider] ?? markedCount > 0}
                  onToggle={e => {
                    setExpandedGroups(prev => ({ ...prev, [group.provider]: (e.target as HTMLDetailsElement).open }))
                  }}
                >
                  <summary>
                    <span>{`${group.displayName} · ${String(group.models.length)} ${t('modelsSuffix')}`}</span>
                    <span className="dshVisionGroupSummaryRight">
                      <button
                        type="button"
                        className="dshVisionLinkButton"
                        onClick={e => { e.preventDefault(); setGroupTextOnly(group, true) }}
                      >
                        {t('enableAll')}
                      </button>
                      <button
                        type="button"
                        className="dshVisionLinkButton"
                        onClick={e => { e.preventDefault(); setGroupTextOnly(group, false) }}
                      >
                        {t('disableAll')}
                      </button>
                    </span>
                  </summary>
                  <div className="dshVisionModels">
                    {models.map(model => {
                      const key = capabilityKey(group.provider, model.id)
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
                            checked={fallback.textOnly[key] === true}
                            onChange={e => { setTextOnly(group.provider, model.id, e.target.checked) }}
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
