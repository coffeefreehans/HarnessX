import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  buildBulkOps,
  buildToggleOp,
  extractVisionGroups,
  getVisionFallbackStore,
  hasImagePart,
  isCaptionCompatible,
  walkPath,
  DEFAULT_VISION_FALLBACK_SETTINGS,
  type PromptContentPart,
  type ProviderRouteRow,
} from '../src/client/vision-models-state.ts'
import { installVisionFallback } from '../src/client/vision-fallback.ts'

const rows: ProviderRouteRow[] = [
  { provider: 'router', displayName: '9router', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'router'] },
  { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
]

const namespaceValue = {
  providers: {
    router: {
      displayName: '9router',
      apiKeyEnv: 'ROUTER_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://fw.nexscp.com/v1',
      models: [
        { id: 'plain-text', contextWindow: 200000 },
        { id: 'cbcn/glm-5v-turbo', contextWindow: 200000, input: ['text', 'image'] },
        { id: 'bzl/gpt-5.5', contextWindow: 400000, input: [] },
      ],
    },
  },
}

describe('vision model state', () => {
  it('walks settings paths through objects', () => {
    expect(walkPath(namespaceValue, ['providers', 'router', 'api'])).toBe('openai-completions')
    expect(walkPath(namespaceValue, ['providers', 'missing'])).toBeUndefined()
    expect(walkPath(undefined, ['providers'])).toBeUndefined()
  })

  it('extracts custom-route groups with declared image capability', () => {
    const groups = extractVisionGroups(namespaceValue, rows)
    expect(groups).toHaveLength(1)
    const group = groups[0]!
    expect(group.provider).toBe('router')
    expect(group.displayName).toBe('9router')
    expect(group.modelsPath).toEqual(['providers', 'router', 'models'])
    expect(group.api).toBe('openai-completions')
    expect(group.models.map(model => [model.id, model.imageEnabled])).toEqual([
      ['plain-text', false],
      ['cbcn/glm-5v-turbo', true],
      ['bzl/gpt-5.5', false],
    ])
  })

  it('carries each provider api and flags caption compatibility', () => {
    const mixed = {
      providers: {
        vision: { api: 'openai-completions', models: [{ id: 'v1' }] },
        other: { api: 'anthropic', models: [{ id: 'a1' }] },
        none: { models: [{ id: 'n1' }] },
      },
    }
    const mixedRows: ProviderRouteRow[] = [
      { provider: 'vision', displayName: 'Vision', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'vision'] },
      { provider: 'other', displayName: 'Other', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'other'] },
      { provider: 'none', displayName: 'None', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'none'] },
    ]
    const groups = extractVisionGroups(mixed, mixedRows)
    expect(groups.map(group => [group.provider, group.api])).toEqual([
      ['vision', 'openai-completions'],
      ['other', 'anthropic'],
      ['none', undefined],
    ])
    expect(groups.filter(isCaptionCompatible).map(group => group.provider)).toEqual(['vision'])
  })

  it('ignores providers without a settings path or model list', () => {
    expect(extractVisionGroups(namespaceValue, [rows[1]!])).toHaveLength(0)
    expect(extractVisionGroups({ providers: { router: { displayName: 'x' } } }, rows)).toHaveLength(0)
  })

  it('builds a whole-array toggle op that only touches the target entry', () => {
    const groups = extractVisionGroups(namespaceValue, rows)
    const group = groups[0]!
    const raw = namespaceValue.providers.router.models as unknown[]
    const enable = buildToggleOp(group, 0, true, raw)
    expect(enable).toBeDefined()
    expect(enable?.op).toBe('set')
    expect(enable?.path).toEqual(['providers', 'router', 'models'])
    const value = enable!.value as { id: string; input?: string[] }[]
    expect(value[0]).toEqual({ id: 'plain-text', contextWindow: 200000, input: ['text', 'image'] })
    expect(value[1]).toBe(raw[1])
    expect(value[2]).toEqual({ id: 'bzl/gpt-5.5', contextWindow: 400000, input: [] })

    const disable = buildToggleOp(group, 1, false, raw)
    const disabled = disable!.value as { id: string; input?: string[] }[]
    expect(disabled[1]).toEqual({ id: 'cbcn/glm-5v-turbo', contextWindow: 200000 })
    expect('input' in disabled[1]!).toBe(false)

    expect(buildToggleOp(group, 99, true, raw)).toBeUndefined()
  })

  it('builds bulk ops that clone only changed entries', () => {
    const groups = extractVisionGroups(namespaceValue, rows)
    const group = groups[0]!
    const raw = namespaceValue.providers.router.models as unknown[]
    const ops = buildBulkOps(group, raw, true)
    expect(ops).toHaveLength(1)
    const value = ops[0]!.value as { id: string; input?: string[] }[]
    expect(value[0]!.input).toEqual(['text', 'image'])
    expect(value[1]).toBe(raw[1])
    expect(value[2]!.input).toEqual(['text', 'image'])
  })

  it('detects image parts', () => {
    const content: PromptContentPart[] = [
      { type: 'text', text: '看下这两张图' },
      { type: 'image', mediaType: 'image/png', data: 'aaa' },
      { type: 'text', text: '重点是第二张' },
      { type: 'image', mediaType: 'image/png', data: 'bbb' },
    ]
    expect(hasImagePart(content)).toBe(true)
    expect(hasImagePart([content[0]!])).toBe(false)
  })
})

describe('vision fallback store', () => {
  beforeEach(() => {
    const backing = new Map<string, string>()
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        getItem: (key: string) => backing.get(key) ?? null,
        setItem: (key: string, value: string) => { backing.set(key, value) },
        removeItem: (key: string) => { backing.delete(key) },
      },
    })
  })

  it('persists the universal model choice and notifies subscribers', () => {
    const store = getVisionFallbackStore()
    store.set({ ...DEFAULT_VISION_FALLBACK_SETTINGS })
    const listener = vi.fn()
    const unsubscribe = store.subscribe(listener)
    store.set({ enabled: true, provider: 'router', model: 'cbcn/glm-5v-turbo' })
    expect(listener).toHaveBeenCalled()
    expect(store.getSnapshot()).toEqual({ enabled: true, provider: 'router', model: 'cbcn/glm-5v-turbo' })
    expect(getVisionFallbackStore().getSnapshot().provider).toBe('router')
    unsubscribe()
    store.set({ ...DEFAULT_VISION_FALLBACK_SETTINGS })
  })
})

describe('vision fallback send wrap', () => {
  const promptArgs: unknown[][] = []
  const sessionsModels = vi.fn()
  let fetchMock: ReturnType<typeof vi.fn>
  const api = {
    sessions: {
      prompt: vi.fn(async (...args: unknown[]) => {
        promptArgs.push(args)
        return { result: { ok: true as const, value: { accepted: true as const } } }
      }),
      models: sessionsModels,
    },
    llm: {
      providers: vi.fn(async () => ({
        result: {
          ok: true as const,
          value: {
            providers: [
              { provider: 'nexscp', displayName: 'nexscp', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'nexscp'] },
            ],
          },
        },
      })),
    },
    settings: {
      describe: vi.fn(async () => ({
        result: {
          ok: true as const,
          value: {
            writable: true,
            namespaces: [{
              ns: 'llm-pi-ai',
              revision: 7,
              value: { providers: { nexscp: { models: [{ id: 'gpt-vision', input: ['text', 'image'] }] } } },
            }],
          },
        },
      })),
    },
  }

  beforeEach(() => {
    promptArgs.length = 0
    sessionsModels.mockReset()
    sessionsModels.mockResolvedValue({
      result: { ok: true as const, value: { current: { provider: 'nexscp', model: 'stealth/ox-alpha' } } },
    })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    getVisionFallbackStore().set({ ...DEFAULT_VISION_FALLBACK_SETTINGS })
    installVisionFallback({ get: () => ({ api }) } as never)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  // The kernel's Session class issues a flat request (sessionId, mode,
  // content, clientTimeZone) with an optional AbortSignal second argument.
  const imageSend = {
    sessionId: 's1',
    mode: 'queue' as const,
    clientTimeZone: 'Asia/Shanghai',
    content: [
      { type: 'text', text: '这截图什么问题' },
      { type: 'image', mediaType: 'image/png', data: 'QUJD' },
    ],
  }

  it('passes text-only prompts through untouched', async () => {
    await api.sessions.prompt({ sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionsModels).not.toHaveBeenCalled()
  })

  it('strips images silently from the send and steers the recognition', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['一个报错弹窗的截图'] }) })
    await api.sessions.prompt(imageSend)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/desktop/vision/describe')
    expect(JSON.parse(String(init.body))).toMatchObject({ provider: 'nexscp', model: 'gpt-vision' })
    // The send carries NO image (both adapters hard-fail one for a text-only
    // model) and NO stand-in text — just the user's own words.
    const send = promptArgs[0] as unknown[]
    const sent = send[0] as { sessionId: string; mode: string; content: PromptContentPart[] }
    expect(sent.sessionId).toBe('s1')
    expect(sent.mode).toBe('queue')
    expect(sent.content).toEqual([{ type: 'text', text: '这截图什么问题' }])
    // Second original call: the recognition steered into the running turn.
    const steer = promptArgs[1] as unknown[] | undefined
    expect(steer).toBeDefined()
    const steerRequest = steer![0] as { sessionId: string; mode: string; content: PromptContentPart[] }
    expect(steerRequest.mode).toBe('steer')
    expect(steerRequest.sessionId).toBe('s1')
    expect(String((steerRequest.content[0] as { text: string }).text))
      .toContain('由识图模型 nexscp/gpt-vision 自动生成')
    expect(String((steerRequest.content[0] as { text: string }).text)).toContain('一个报错弹窗的截图')
  })

  it('skips the bridge for a declared image-capable model', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    sessionsModels.mockResolvedValue({
      result: { ok: true as const, value: { current: { provider: 'nexscp', model: 'gpt-vision' } } },
    })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).not.toHaveBeenCalled()
    const args = promptArgs.at(-1) as unknown[]
    expect(args[0]).toBe(imageSend)
  })

  it('re-reads capability on every send and never captions a freshly toggled model', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['一个报错弹窗'] }) })
    // First send: current model has no image declaration → captioned.
    await api.sessions.prompt(imageSend)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The user now toggles 图片输入 on for that model: the next send must
    // read the fresh declaration and leave the originals alone.
    ;(api.settings.describe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      result: {
        ok: true as const,
        value: {
          writable: true,
          namespaces: [{
            ns: 'llm-pi-ai',
            revision: 8,
            value: {
              providers: {
                nexscp: { models: [
                  { id: 'stealth/ox-alpha', input: ['text', 'image'] },
                  { id: 'gpt-vision', input: ['text', 'image'] },
                ] },
              },
            },
          }],
        },
      },
    })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const args = promptArgs.at(-1) as unknown[]
    expect(args[0]).toBe(imageSend)
  })

  it('sends the originals untouched when capability cannot be read', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    ;(api.llm.providers as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      result: { ok: false as const, error: { message: 'directory unavailable' } },
    })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).not.toHaveBeenCalled()
    const args = promptArgs.at(-1) as unknown[]
    expect(args[0]).toBe(imageSend)
  })

  it('steers an honest failure note when the bridge fails', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Invalid token' }) })
    await api.sessions.prompt(imageSend)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    // The send carries no image and no stand-in text; the failure note
    // arrives as a steering message so the model states the outage honestly
    // instead of chasing kernel sha256 markers through read_image.
    const sent = (promptArgs[0] as unknown[])[0] as { content: PromptContentPart[] }
    expect(sent.content).toEqual([{ type: 'text', text: '这截图什么问题' }])
    const steer = promptArgs[1] as unknown[] | undefined
    expect(steer).toBeDefined()
    const steerRequest = steer![0] as { mode: string; content: PromptContentPart[] }
    expect(steerRequest.mode).toBe('steer')
    expect(String((steerRequest.content[0] as { text: string }).text)).toContain('识图服务调用失败')
  })

  it('passes through when no universal model is configured', async () => {
    getVisionFallbackStore().set({ enabled: false, provider: undefined, model: undefined })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionsModels).not.toHaveBeenCalled()
    const args = promptArgs.at(-1) as unknown[]
    expect(args[0]).toBe(imageSend)
  })

  it('forwards the abort signal with the stripped send', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['一个报错弹窗的截图'] }) })
    const signal = new AbortController().signal
    await api.sessions.prompt(imageSend, signal)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const args = promptArgs[0] as unknown[]
    expect(args[1]).toBe(signal)
    const sent = args[0] as { content: PromptContentPart[] }
    expect(sent.content).toEqual([{ type: 'text', text: '这截图什么问题' }])
  })

  it('re-reads the store on every send, so hydrated settings apply at once', async () => {
    // Boot order in the real app: the wrapper installs first, then
    // hydrateDesktopPrefs() fills the store from the host prefs file. A send
    // before hydration must stay untouched; the next send must see it.
    await api.sessions.prompt(imageSend)
    expect(fetchMock).not.toHaveBeenCalled()
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['识别内容'] }) })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
