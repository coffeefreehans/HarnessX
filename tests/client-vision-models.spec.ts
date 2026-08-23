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

  it('replaces the image with its caption for a text-only model', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['一个报错弹窗的截图'] }) })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/desktop/vision/describe')
    expect(JSON.parse(String(init.body))).toMatchObject({ provider: 'nexscp', model: 'gpt-vision' })
    const sent = (promptArgs.at(-1) as unknown[])[0] as { content: PromptContentPart[] }
    // The user's text part keeps its identity; the image part is gone,
    // replaced in position by the labelled caption — no image marker for
    // the model to chase.
    expect(sent.content).toHaveLength(2)
    expect(sent.content[0]).toBe(imageSend.content[0])
    expect(sent.content[1]).toEqual({
      type: 'text',
      text: '\n\n[图片 1 识别结果 · 识图模型自动生成,当前模型无法读取原图,请直接依据以下内容回答,不要尝试读取图片文件]\n一个报错弹窗的截图',
    })
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

  it('falls back to the original send when the bridge fails', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'boom' }) })
    await api.sessions.prompt(imageSend)
    const args = promptArgs.at(-1) as unknown[]
    expect(args[0]).toBe(imageSend)
    expect((args[0] as { content: PromptContentPart[] }).content).toHaveLength(2)
  })

  it('passes through when no universal model is configured', async () => {
    getVisionFallbackStore().set({ enabled: false, provider: undefined, model: undefined })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionsModels).not.toHaveBeenCalled()
    const args = promptArgs.at(-1) as unknown[]
    expect(args[0]).toBe(imageSend)
  })

  it('forwards the abort signal with the patched request', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['一个报错弹窗的截图'] }) })
    const signal = new AbortController().signal
    await api.sessions.prompt(imageSend, signal)
    const args = promptArgs.at(-1) as unknown[]
    expect(args[1]).toBe(signal)
    const sent = args[0] as { sessionId: string; mode: string; content: PromptContentPart[] }
    expect(sent.sessionId).toBe('s1')
    expect(sent.mode).toBe('queue')
    expect(sent.content).toHaveLength(2)
    expect(sent.content[1]!.type).toBe('text')
  })
})
