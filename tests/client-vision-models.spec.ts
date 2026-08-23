import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  buildBulkOps,
  buildToggleOp,
  extractVisionGroups,
  getVisionFallbackStore,
  hasImagePart,
  transformContentHybrid,
  transformContentWithCaptions,
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
    expect(group.models.map(model => [model.id, model.imageEnabled])).toEqual([
      ['plain-text', false],
      ['cbcn/glm-5v-turbo', true],
      ['bzl/gpt-5.5', false],
    ])
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

  it('keeps images and appends their captions in hybrid mode', () => {
    const content: PromptContentPart[] = [
      { type: 'text', text: '看下这两张图' },
      { type: 'image', mediaType: 'image/png', data: 'aaa' },
      { type: 'image', mediaType: 'image/jpeg', data: 'bbb' },
    ]
    const hybrid = transformContentHybrid(content, ['第一张', ''])
    expect(hybrid).toHaveLength(5)
    expect(hybrid[0]).toEqual({ type: 'text', text: '看下这两张图' })
    expect(hybrid[1]).toEqual({ type: 'image', mediaType: 'image/png', data: 'aaa' })
    expect(hybrid[2]).toEqual({ type: 'text', text: '[图片 1 识别结果]\n第一张' })
    expect(hybrid[3]).toEqual({ type: 'image', mediaType: 'image/jpeg', data: 'bbb' })
    expect(hybrid[4]).toEqual({ type: 'text', text: '[图片 2 识别结果]\n(图片识别未返回内容)' })
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

  it('detects image parts and swaps them for ordered captions', () => {
    const content: PromptContentPart[] = [
      { type: 'text', text: '看下这两张图' },
      { type: 'image', mediaType: 'image/png', data: 'aaa' },
      { type: 'text', text: '重点是第二张' },
      { type: 'image', mediaType: 'image/png', data: 'bbb' },
    ]
    expect(hasImagePart(content)).toBe(true)
    expect(hasImagePart([content[0]!])).toBe(false)
    const transformed = transformContentWithCaptions(content, ['第一张的描述', ''])
    expect(transformed[0]).toEqual({ type: 'text', text: '看下这两张图' })
    expect(transformed[1]).toEqual({ type: 'text', text: '[图片 1 识别结果]\n第一张的描述' })
    expect(transformed[2]).toEqual({ type: 'text', text: '重点是第二张' })
    expect(transformed[3]).toEqual({ type: 'text', text: '[图片 2 识别结果]\n(图片识别未返回内容)' })
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
  const promptCalls: unknown[] = []
  let fetchMock: ReturnType<typeof vi.fn>
  const sessionsModels = vi.fn()
  const api = {
    sessions: {
      prompt: vi.fn(async (request: unknown) => {
        promptCalls.push(request)
        return { result: { ok: true, value: { accepted: true as const } } }
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
    promptCalls.length = 0
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

  const imageSend = {
    rpcId: 'r1',
    payload: {
      sessionId: 's1',
      mode: 'queue' as const,
      content: [
        { type: 'text', text: '这截图什么问题' },
        { type: 'image', mediaType: 'image/png', data: 'QUJD' },
      ],
    },
  }

  it('passes text-only prompts through untouched', async () => {
    await api.sessions.prompt({ payload: { sessionId: 's1', mode: 'queue', content: [{ type: 'text', text: 'hi' }] } })
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionsModels).not.toHaveBeenCalled()
  })

  it('captions images through the bridge when the model is not enabled', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['一个报错弹窗的截图'] }) })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/desktop/vision/describe')
    expect(JSON.parse(String(init.body)).model).toBe('gpt-vision')
    const sent = promptCalls.at(-1) as { payload: { content: PromptContentPart[] } }
    expect(sent.payload.content).toEqual([
      { type: 'text', text: '这截图什么问题' },
      { type: 'text', text: '[图片 1 识别结果]\n一个报错弹窗的截图' },
    ])
  })

  it('sends originals plus captions when a declared custom model is selected', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    sessionsModels.mockResolvedValue({
      result: { ok: true as const, value: { current: { provider: 'nexscp', model: 'gpt-vision' } } },
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['一个报错弹窗'] }) })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const sent = promptCalls.at(-1) as { payload: { content: PromptContentPart[] } }
    expect(sent.payload.content).toHaveLength(3)
    expect(sent.payload.content[1]).toEqual({ type: 'image', mediaType: 'image/png', data: 'QUJD' })
    expect(sent.payload.content[2]).toEqual({ type: 'text', text: '[图片 1 识别结果]\n一个报错弹窗' })
  })

  it('keeps plain originals when captioning fails for a declared custom model', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    sessionsModels.mockResolvedValue({
      result: { ok: true as const, value: { current: { provider: 'nexscp', model: 'gpt-vision' } } },
    })
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'boom' }) })
    await api.sessions.prompt(imageSend)
    const sent = promptCalls.at(-1) as { payload: { content: PromptContentPart[] } }
    expect(sent.payload.content).toHaveLength(2)
    expect(sent.payload.content[1]!.type).toBe('image')
  })

  it('falls back to the original send when the bridge fails', async () => {
    getVisionFallbackStore().set({ enabled: true, provider: 'nexscp', model: 'gpt-vision' })
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'boom' }) })
    await api.sessions.prompt(imageSend)
    const sent = promptCalls.at(-1) as { payload: { content: PromptContentPart[] } }
    expect(sent.payload.content[1]!.type).toBe('image')
  })

  it('passes through when no universal model is configured', async () => {
    getVisionFallbackStore().set({ enabled: false, provider: undefined, model: undefined })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).not.toHaveBeenCalled()
    const sent = promptCalls.at(-1) as { payload: { content: PromptContentPart[] } }
    expect(sent.payload.content[1]!.type).toBe('image')
  })
})
