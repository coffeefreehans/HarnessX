import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  buildForceImageInputOps,
  capabilityKey,
  extractVisionGroups,
  getVisionFallbackStore,
  hasImagePart,
  isCaptionCompatible,
  sanitizeTextOnlyMap,
  walkPath,
  DEFAULT_VISION_FALLBACK_SETTINGS,
  type PromptContentPart,
  type ProviderRouteRow,
} from '../src/client/vision-models-state.ts'
import { __resetVisionFallbackForTests, installVisionFallback } from '../src/client/vision-fallback.ts'

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

  it('builds ops that force image input on every not-yet-capable entry', () => {
    const groups = extractVisionGroups(namespaceValue, rows)
    const raw = namespaceValue.providers.router.models as unknown[]
    const ops = buildForceImageInputOps(groups, new Map([['router', raw]]))
    expect(ops).toHaveLength(1)
    expect(ops[0]!.op).toBe('set')
    expect(ops[0]!.path).toEqual(['providers', 'router', 'models'])
    const value = ops[0]!.value as { id: string; input?: string[] }[]
    expect(value[0]).toEqual({ id: 'plain-text', contextWindow: 200000, input: ['text', 'image'] })
    expect(value[1]).toBe(raw[1])
    expect(value[2]).toEqual({ id: 'bzl/gpt-5.5', contextWindow: 400000, input: ['text', 'image'] })

    // A provider whose entries all declare images already produces no ops.
    const capableRaw = [{ id: 'only', contextWindow: 1, input: ['text', 'image'] }]
    const capableGroups = extractVisionGroups(
      { providers: { router: { models: capableRaw } } },
      [rows[0]!],
    )
    expect(buildForceImageInputOps(capableGroups, new Map([['router', capableRaw]]))).toHaveLength(0)

    // Providers without raw arrays are skipped.
    expect(buildForceImageInputOps(groups, new Map())).toHaveLength(0)
  })

  it('keys capability records safely for model ids containing slashes', () => {
    expect(capabilityKey('router', 'cbcn/glm-5v-turbo')).toBe('router\u0000cbcn/glm-5v-turbo')
  })

  it('sanitizes text-only and probe maps to boolean entries', () => {
    expect(sanitizeTextOnlyMap({ a: true, b: 'x', c: false, '': true })).toEqual({ a: true, c: false })
    expect(sanitizeTextOnlyMap(null)).toEqual({})
    expect(sanitizeTextOnlyMap(7)).toEqual({})
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
    store.set({
      enabled: true,
      provider: 'router',
      model: 'cbcn/glm-5v-turbo',
      textOnly: { [capabilityKey('router', 'plain-text')]: true },
      probeResults: { [capabilityKey('router', 'bzl/gpt-5.5')]: false },
    })
    expect(listener).toHaveBeenCalled()
    expect(store.getSnapshot()).toEqual({
      enabled: true,
      provider: 'router',
      model: 'cbcn/glm-5v-turbo',
      textOnly: { 'router\u0000plain-text': true },
      probeResults: { 'router\u0000bzl/gpt-5.5': false },
    })
    expect(getVisionFallbackStore().getSnapshot().provider).toBe('router')
    unsubscribe()
    store.set({ ...DEFAULT_VISION_FALLBACK_SETTINGS })
  })
})

describe('vision fallback send wrap', () => {
  const promptArgs: unknown[][] = []
  const sessionsModels = vi.fn()
  const settingsMutate = vi.fn()
  const providersImpl = async () => ({
    result: {
      ok: true as const,
      value: {
        providers: [
          { provider: 'nexscp', displayName: 'nexscp', settingsNs: 'llm-pi-ai', settingsPath: ['providers', 'nexscp'] },
          { provider: 'deepseek-official', displayName: 'DeepSeek', settingsNs: 'llm-deepseek', settingsPath: [] },
        ],
      },
    },
  })
  const describeImpl = async () => ({
    result: {
      ok: true as const,
      value: {
        writable: true,
        namespaces: [{
          ns: 'llm-pi-ai',
          revision: 7,
          value: {
            providers: {
              nexscp: { models: [{ id: 'stealth/ox-alpha' }, { id: 'gpt-vision', input: ['text', 'image'] }] },
            },
          },
        }],
      },
    },
  })
  let fetchMock: ReturnType<typeof vi.fn>
  const api = {
    sessions: {
      prompt: vi.fn(async (...args: unknown[]) => {
        promptArgs.push(args)
        return { result: { ok: true as const, value: { accepted: true as const } } }
      }),
      models: sessionsModels,
    },
    llm: { providers: vi.fn(providersImpl) },
    settings: { describe: vi.fn(describeImpl), mutate: settingsMutate },
  }

  beforeEach(() => {
    promptArgs.length = 0
    sessionsModels.mockReset()
    sessionsModels.mockResolvedValue({
      result: { ok: true as const, value: { current: { provider: 'nexscp', model: 'stealth/ox-alpha' } } },
    })
    // Restore the shared fixtures wholesale: individual tests may permanently
    // override them, and the module under test memoizes across tests.
    ;(api.llm.providers as ReturnType<typeof vi.fn>).mockImplementation(providersImpl)
    ;(api.settings.describe as ReturnType<typeof vi.fn>).mockImplementation(describeImpl)
    settingsMutate.mockReset()
    settingsMutate.mockResolvedValue({ result: { ok: true as const } })
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    getVisionFallbackStore().set({ ...DEFAULT_VISION_FALLBACK_SETTINGS })
    __resetVisionFallbackForTests()
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

  it('forces image-input declarations so the kernel admits and stores images', async () => {
    // Universal vision off entirely: the send still must go out verbatim, but
    // the declaration sweep runs first so admission cannot reject the image.
    await api.sessions.prompt(imageSend)
    expect(settingsMutate).toHaveBeenCalledTimes(1)
    const mutation = settingsMutate.mock.calls[0]![0] as { ns: string; ops: { op: string; path: string[]; value: { id: string; input?: string[] }[] }[] }
    expect(mutation.ns).toBe('llm-pi-ai')
    expect(mutation.ops[0]!.path).toEqual(['providers', 'nexscp', 'models'])
    expect(mutation.ops[0]!.value[0]).toEqual({ id: 'stealth/ox-alpha', input: ['text', 'image'] })
    expect(mutation.ops[0]!.value[1]).toEqual({ id: 'gpt-vision', input: ['text', 'image'] })
    // Verbatim: the bubble renders the stored image.
    const args = promptArgs[0] as unknown[]
    expect(args[0]).toBe(imageSend)
  })

  it('sends images verbatim and steers recognition for a blind model', async () => {
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: {},
      probeResults: { [capabilityKey('nexscp', 'stealth/ox-alpha')]: false },
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['一个报错弹窗的截图'] }) })
    await api.sessions.prompt(imageSend)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    // First original call carries BOTH parts — the image reaches storage so
    // the bubble shows it natively.
    const send = promptArgs[0] as unknown[]
    const sent = send[0] as { sessionId: string; mode: string; content: PromptContentPart[] }
    expect(sent.sessionId).toBe('s1')
    expect(sent.content).toEqual([
      { type: 'text', text: '这截图什么问题' },
      { type: 'image', mediaType: 'image/png', data: 'QUJD' },
    ])
    // Exactly one bridge call: recognition for the one image.
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/desktop/vision/describe')
    expect(JSON.parse(String(init.body))).toMatchObject({ provider: 'nexscp', model: 'gpt-vision' })
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

  it('lets a manual 无多模态 mark override even a positive probe', async () => {
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: { [capabilityKey('nexscp', 'stealth/ox-alpha')]: true },
      probeResults: { [capabilityKey('nexscp', 'stealth/ox-alpha')]: true },
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['识别内容'] }) })
    await api.sessions.prompt(imageSend)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(promptArgs.length).toBe(2)
  })

  it('stays native and probes in the background for an unproven model', async () => {
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: {},
      probeResults: {},
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ capable: false }) })
    await api.sessions.prompt(imageSend)
    // This send stays verbatim with NO steering; only the probe goes out.
    const args = promptArgs[0] as unknown[]
    expect(args[0]).toBe(imageSend)
    expect(promptArgs.length).toBe(1)
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/desktop/vision/probe')
    expect(JSON.parse(String(init.body))).toMatchObject({ provider: 'nexscp', model: 'stealth/ox-alpha' })
    // The verdict lands in the store for every later send.
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(getVisionFallbackStore().getSnapshot().probeResults[capabilityKey('nexscp', 'stealth/ox-alpha')]).toBe(false)
    // And the next send is captioned automatically.
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['识别内容'] }) })
    await api.sessions.prompt(imageSend)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(promptArgs.length).toBe(3)
    const steer = promptArgs[2] as unknown[]
    expect((steer[1] === undefined ? steer : steer)[0] as unknown).toBeDefined()
    expect((promptArgs[2] as unknown[])[0]).toMatchObject({ mode: 'steer' })
  })

  it('skips the bridge when the probe proved the model has vision', async () => {
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: {},
      probeResults: { [capabilityKey('nexscp', 'stealth/ox-alpha')]: true },
    })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(promptArgs.length).toBe(1)
    const args = promptArgs[0] as unknown[]
    expect(args[0]).toBe(imageSend)
  })

  it('re-reads capability on every send and never captions a freshly proven model', async () => {
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: { [capabilityKey('nexscp', 'stealth/ox-alpha')]: true },
      probeResults: {},
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['一个报错弹窗'] }) })
    // First send: marked blind → captioned.
    await api.sessions.prompt(imageSend)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    // The user clears the mark (the model truly sees): next send is native.
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: {},
      probeResults: {},
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ capable: false }) })
    await api.sessions.prompt(imageSend)
    expect(promptArgs.length).toBe(3)
    expect(promptArgs[2]!.length).toBeGreaterThan(0)
    expect((promptArgs[2] as unknown[])[0]).toMatchObject({ sessionId: 's1', mode: 'queue' })
  })

  it('strips and steers for an official-route text-only entry whose gate desktop settings cannot open', async () => {
    ;(api.settings.describe as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      result: {
        ok: true as const,
        value: {
          writable: true,
          namespaces: [
            {
              ns: 'llm-pi-ai',
              revision: 7,
              value: { providers: { nexscp: { models: [{ id: 'stealth/ox-alpha' }, { id: 'gpt-vision', input: ['text', 'image'] }] } } },
            },
            {
              ns: 'llm-deepseek',
              revision: 3,
              value: { models: [{ id: 'deepseek-chat', inputModalities: ['text'] }] },
            },
          ],
        },
      },
    })
    sessionsModels.mockResolvedValue({
      result: { ok: true as const, value: { current: { provider: 'deepseek-official', model: 'deepseek-chat' } } },
    })
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: {},
      probeResults: {},
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['官方模型看不到图'] }) })
    await api.sessions.prompt(imageSend)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    // The official admission gate rejects images outright, so this legacy path
    // strips before sending; only the steered caption tells the model.
    const sent = (promptArgs[0] as unknown[])[0] as { content: PromptContentPart[] }
    expect(sent.content).toEqual([{ type: 'text', text: '这截图什么问题' }])
    const steer = promptArgs[1] as unknown[] | undefined
    expect(steer).toBeDefined()
    expect(String(((steer![0] as { content: PromptContentPart[] }).content[0] as { text: string }).text))
      .toContain('由识图模型 nexscp/gpt-vision 自动生成')
  })

  it('sends the originals untouched when the provider directory fails', async () => {
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: {},
      probeResults: {},
    })
    ;(api.llm.providers as ReturnType<typeof vi.fn>).mockResolvedValue({
      result: { ok: false as const, error: { message: 'directory unavailable' } },
    })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).not.toHaveBeenCalled()
    const args = promptArgs.at(-1) as unknown[]
    expect(args[0]).toBe(imageSend)
  })

  it('steers an honest failure note when the bridge fails', async () => {
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: {},
      probeResults: { [capabilityKey('nexscp', 'stealth/ox-alpha')]: false },
    })
    fetchMock.mockResolvedValue({ ok: false, json: async () => ({ error: 'Invalid token' }) })
    await api.sessions.prompt(imageSend)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const sent = (promptArgs[0] as unknown[])[0] as { content: PromptContentPart[] }
    expect(sent.content).toEqual([
      { type: 'text', text: '这截图什么问题' },
      { type: 'image', mediaType: 'image/png', data: 'QUJD' },
    ])
    const steer = promptArgs[1] as unknown[] | undefined
    expect(steer).toBeDefined()
    const steerRequest = steer![0] as { mode: string; content: PromptContentPart[] }
    expect(steerRequest.mode).toBe('steer')
    expect(String((steerRequest.content[0] as { text: string }).text)).toContain('识图服务调用失败')
  })

  it('passes through when no universal model is configured', async () => {
    getVisionFallbackStore().set({
      enabled: false,
      provider: undefined,
      model: undefined,
      textOnly: {},
      probeResults: {},
    })
    await api.sessions.prompt(imageSend)
    expect(fetchMock).not.toHaveBeenCalled()
    expect(sessionsModels).not.toHaveBeenCalled()
    const args = promptArgs.at(-1) as unknown[]
    expect(args[0]).toBe(imageSend)
  })

  it('forwards the abort signal with the verbatim send', async () => {
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: {},
      probeResults: { [capabilityKey('nexscp', 'stealth/ox-alpha')]: false },
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['一个报错弹窗的截图'] }) })
    const signal = new AbortController().signal
    await api.sessions.prompt(imageSend, signal)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    const args = promptArgs[0] as unknown[]
    expect(args[0]).toBe(imageSend)
    expect(args[1]).toBe(signal)
  })

  it('re-reads the store on every send, so hydrated settings apply at once', async () => {
    // Boot order in the real app: the wrapper installs first, then
    // hydrateDesktopPrefs() fills the store from the host prefs file. A send
    // before hydration must stay untouched (native vision); the next send
    // must see the hydrated config.
    await api.sessions.prompt(imageSend)
    expect(fetchMock).not.toHaveBeenCalled()
    getVisionFallbackStore().set({
      enabled: true,
      provider: 'nexscp',
      model: 'gpt-vision',
      textOnly: {},
      probeResults: { [capabilityKey('nexscp', 'stealth/ox-alpha')]: false },
    })
    fetchMock.mockResolvedValue({ ok: true, json: async () => ({ captions: ['识别内容'] }) })
    await api.sessions.prompt(imageSend)
    await new Promise(resolve => { setTimeout(resolve, 0) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
