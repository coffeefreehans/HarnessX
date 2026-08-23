import { describe, expect, it, vi } from 'vitest'
import {
  buildCaptionRequestBody,
  describeImages,
  parseCaptionResponse,
  parseDescribeRequest,
  resolveProviderProfile,
  type CaptionDeps,
} from '../src/vision-caption.ts'

const settingsValue = {
  providers: {
    router: {
      displayName: '9router',
      apiKeyEnv: 'ROUTER_API_KEY',
      api: 'openai-completions',
      baseURL: 'https://fw.nexscp.com/v1/',
      models: [],
    },
    bare: {
      api: 'openai-completions',
      baseURL: 'https://bare.example/v1',
    },
    anthropicRoute: {
      api: 'anthropic-messages',
      baseURL: 'https://a.example',
    },
  },
}

describe('resolveProviderProfile', () => {
  it('reads connection fields for a known provider', () => {
    expect(resolveProviderProfile(settingsValue, 'router')).toEqual({
      baseURL: 'https://fw.nexscp.com/v1/',
      apiKeyEnv: 'ROUTER_API_KEY',
      api: 'openai-completions',
    })
  })

  it('treats absent optional fields as undefined', () => {
    expect(resolveProviderProfile(settingsValue, 'bare')).toEqual({
      baseURL: 'https://bare.example/v1',
      apiKeyEnv: undefined,
      api: 'openai-completions',
    })
  })

  it('returns undefined for unknown providers and non-object settings', () => {
    expect(resolveProviderProfile(settingsValue, 'missing')).toBeUndefined()
    expect(resolveProviderProfile(undefined, 'router')).toBeUndefined()
    expect(resolveProviderProfile('nope', 'router')).toBeUndefined()
  })
})

describe('parseDescribeRequest', () => {
  const valid = {
    provider: 'router',
    model: 'cbcn/glm-5v-turbo',
    images: [{ mediaType: 'image/png', data: 'QUJD' }],
  }

  it('accepts a valid request', () => {
    expect(parseDescribeRequest(valid)).toEqual({ request: valid })
  })

  it('rejects missing or malformed fields', () => {
    expect(parseDescribeRequest(valid).request).toBeDefined()
    expect(parseDescribeRequest({ ...valid, provider: '' }).error).toBeDefined()
    expect(parseDescribeRequest({ ...valid, model: 7 }).error).toBeDefined()
    expect(parseDescribeRequest({ ...valid, images: [] }).error).toBeDefined()
    expect(parseDescribeRequest({ ...valid, images: [{ mediaType: 'text/html', data: 'x' }] }).error).toBeDefined()
    expect(parseDescribeRequest({ ...valid, images: [{ mediaType: 'image/png' }] }).error).toBeDefined()
    expect(parseDescribeRequest(
      { ...valid, images: Array.from({ length: 9 }, () => ({ mediaType: 'image/png', data: 'x' })) },
    ).error).toBeDefined()
    expect(parseDescribeRequest(null).error).toBeDefined()
  })
})

describe('buildCaptionRequestBody', () => {
  it('targets the requested model and image', () => {
    const body = buildCaptionRequestBody(
      { provider: 'router', model: 'glm-5v', images: [{ mediaType: 'image/png', data: 'QUJD' }, { mediaType: 'image/jpeg', data: 'REVG' }] },
      1,
    )
    expect(body.model).toBe('glm-5v')
    expect(body.stream).toBe(false)
    const message = (body.messages as { content: { type: string; image_url?: { url: string } }[] }[])[0]!
    expect(message.content[1]!.image_url?.url).toBe('data:image/jpeg;base64,REVG')
  })
})

describe('parseCaptionResponse', () => {
  it('reads string content', () => {
    expect(parseCaptionResponse({ choices: [{ message: { content: '一座桥' } }] })).toBe('一座桥')
  })

  it('joins array text parts', () => {
    expect(parseCaptionResponse({
      choices: [{ message: { content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] } }],
    })).toBe('ab')
  })

  it('returns undefined for unusable payloads', () => {
    expect(parseCaptionResponse({ choices: [] })).toBeUndefined()
    expect(parseCaptionResponse({ choices: [{ message: { content: '' } }] })).toBeUndefined()
    expect(parseCaptionResponse('nope')).toBeUndefined()
    expect(parseCaptionResponse({ choices: [{ message: { content: 42 } }] })).toBeUndefined()
  })
})

describe('describeImages', () => {
  const request = {
    provider: 'router',
    model: 'glm-5v',
    images: [{ mediaType: 'image/png', data: 'QUJD' }, { mediaType: 'image/png', data: 'REVG' }],
  }

  function deps(overrides: Partial<CaptionDeps> = {}): CaptionDeps {
    return {
      fetch: vi.fn(async () => ({
        ok: true,
        status: 200,
        json: async () => ({ choices: [{ message: { content: '描述' } }] }),
      })),
      resolveCredential: vi.fn(async () => 'sk-test'),
      readSettings: () => settingsValue,
      ...overrides,
    }
  }

  it('calls the provider chat-completions endpoint once per image with auth', async () => {
    const fetchMock = vi.fn(async (_input: string, init: Record<string, unknown>) => ({
      ok: true,
      status: 200,
      json: async () => ({
        choices: [{ message: { content: `cap-${String((init.body as string).length > 0 ? 'x' : 'y')}` } }],
      }),
    }))
    const captions = await describeImages(request, deps({ fetch: fetchMock as never }))
    expect(captions).toHaveLength(2)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect(url).toBe('https://fw.nexscp.com/v1/chat/completions')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    expect(JSON.parse(String(init.body)).model).toBe('glm-5v')
  })

  it('omits authorization when no credential resolves', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'c' } }] }) }))
    await describeImages({ ...request, provider: 'bare' }, deps({ fetch: fetchMock as never }))
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, Record<string, unknown>]
    expect((init.headers as Record<string, string>).authorization).toBeUndefined()
  })

  it('rejects unknown providers and non-openai routes', async () => {
    await expect(describeImages({ ...request, provider: 'missing' }, deps())).rejects.toThrow('未找到')
    await expect(describeImages({ ...request, provider: 'anthropicRoute' }, deps())).rejects.toThrow('openai-completions')
  })

  it('surfaces upstream failures with the provider message', async () => {
    const failing = vi.fn(async () => ({
      ok: false,
      status: 400,
      json: async () => ({ error: { message: 'invalid image' } }),
    }))
    await expect(describeImages(request, deps({ fetch: failing as never }))).rejects.toThrow('invalid image')
  })

  it('rejects when the model returns no usable content', async () => {
    const empty = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ choices: [] }) }))
    await expect(describeImages(request, deps({ fetch: empty as never }))).rejects.toThrow('未返回有效内容')
  })
})
