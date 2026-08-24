/** Desktop vision-caption Host plugin: one bridge endpoint, no kernel edits.
 *
 * The desktop client intercepts sends whose images the session's model cannot
 * admit and asks this route to describe them with a user-chosen universal
 * vision model. Provider endpoints and credentials come from the kernel's own
 * `llm-pi-ai` settings namespace and credential service, so nothing here
 * parses kernel-owned files or duplicates secret storage.
 */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-settings'
import { settingsNamespace } from '@deepseek-ai/dsh-settings'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from './runtime.ts'

const VISION_ROUTE = '/api/desktop/vision/describe'
const PROBE_ROUTE = '/api/desktop/vision/probe'
const MAX_JSON_BODY_BYTES = 32 * 1024 * 1024
const CAPTION_TIMEOUT_MS = 60_000
const PROBE_TIMEOUT_MS = 30_000
const PI_AI_SETTINGS = settingsNamespace('llm-pi-ai')

/** One-pixel PNG: the smallest image that still exercises the provider's
 *  vision path end to end. */
const PROBE_IMAGE_DATA = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const PROBE_PROMPT = '这是一张测试图片。请只回答 yes 或 no:你能看到这张图片并分辨它的内容吗?'
const CAPTION_PROMPT = [
  '请详细描述这张图片的内容。',
  '如果图片包含文字,请完整转述文字内容;如果是界面截图,请列出界面元素和布局;',
  '如果包含图表或数据,请总结关键数值。',
  '直接输出描述正文,不要任何前缀、称呼或总结语。',
].join('')

/** One image the client asks the bridge to describe. */
export interface CaptionImageRequest {
  mediaType: string
  data: string
}

/** POST body of the describe route. */
export interface DescribeRequest {
  provider: string
  model: string
  images: CaptionImageRequest[]
}

/** The custom-route profile fields the bridge needs. */
export interface ProviderRouteProfile {
  baseURL: string | undefined
  apiKeyEnv: string | undefined
  api: string | undefined
}

/**
 * Read one custom provider's connection fields from the `llm-pi-ai` settings
 * value. Returns undefined for unknown providers; only openai-completions
 * routes are served (the only wire shape the bridge speaks).
 */
export function resolveProviderProfile(
  settingsValue: unknown,
  provider: string,
): ProviderRouteProfile | undefined {
  if (typeof settingsValue !== 'object' || settingsValue === null) return undefined
  const providers = (settingsValue as { providers?: unknown }).providers
  if (typeof providers !== 'object' || providers === null) return undefined
  const profile = (providers as Record<string, unknown>)[provider]
  if (typeof profile !== 'object' || profile === null) return undefined
  const fields = profile as { baseURL?: unknown; apiKeyEnv?: unknown; api?: unknown }
  return {
    baseURL: typeof fields.baseURL === 'string' && fields.baseURL.length > 0 ? fields.baseURL : undefined,
    apiKeyEnv: typeof fields.apiKeyEnv === 'string' && fields.apiKeyEnv.length > 0 ? fields.apiKeyEnv : undefined,
    api: typeof fields.api === 'string' && fields.api.length > 0 ? fields.api : undefined,
  }
}

/**
 * Build the OpenAI chat-completions request body for one caption call.
 * @param body - the validated describe request.
 * @param index - which image of the request this call describes.
 */
export function buildCaptionRequestBody(body: DescribeRequest, index: number): Record<string, unknown> {
  const image = body.images[index]
  if (image === undefined) throw new Error(`caption image ${String(index)} missing`)
  return {
    model: body.model,
    stream: false,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: CAPTION_PROMPT },
        { type: 'image_url', image_url: { url: `data:${image.mediaType};base64,${image.data}` } },
      ],
    }],
  }
}

/**
 * Extract the assistant text from a chat-completions response. String content
 * is the norm; array content (text parts) is accepted defensively.
 */
export function parseCaptionResponse(payload: unknown): string | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const choices = (payload as { choices?: unknown }).choices
  if (!Array.isArray(choices) || choices.length === 0) return undefined
  const message = (choices[0] as { message?: unknown }).message
  if (typeof message !== 'object' || message === null) return undefined
  const content = (message as { content?: unknown }).content
  if (typeof content === 'string') return content.length > 0 ? content : undefined
  if (Array.isArray(content)) {
    const joined = content
      .map(part => typeof part === 'object' && part !== null
        && (part as { type?: unknown }).type === 'text'
        ? String((part as { text?: unknown }).text ?? '')
        : '')
      .join('')
    return joined.length > 0 ? joined : undefined
  }
  return undefined
}

/**
 * Build the OpenAI chat-completions request body for one vision probe.
 * @param model - the model id to probe.
 */
export function buildProbeRequestBody(model: string): Record<string, unknown> {
  return {
    model,
    stream: false,
    messages: [{
      role: 'user',
      content: [
        { type: 'text', text: PROBE_PROMPT },
        { type: 'image_url', image_url: { url: `data:image/png;base64,${PROBE_IMAGE_DATA}` } },
      ],
    }],
  }
}

/** The probe verdict parsed from one chat-completions reply. */
export type ProbeVerdict = 'yes' | 'no' | 'unknown'

/**
 * Classify one probe reply. Affirmations across common phrasings count as
 * seeing; denials, refusals, and empty content do not.
 */
export function parseProbeVerdict(payload: unknown): ProbeVerdict {
  const caption = parseCaptionResponse(payload)
  if (caption === undefined) return 'unknown'
  return /yes|是|能|看到/u.test(caption.toLowerCase()) ? 'yes' : 'no'
}

/** POST body of the probe route. */
export interface ProbeRequest {
  provider: string
  model: string
}

function isProbeRequest(value: unknown): value is ProbeRequest {
  return typeof value === 'object' && value !== null
    && typeof (value as { provider?: unknown }).provider === 'string'
    && (value as { provider: string }).provider.length > 0
    && typeof (value as { model?: unknown }).model === 'string'
    && (value as { model: string }).model.length > 0
}

/**
 * Ask one custom-route model whether it can see a test image. Endpoints that
 * reject image input answer false; so do models that admit the request but
 * deny seeing anything — only an affirmative reply counts as vision.
 */
export async function probeModelVision(
  body: ProbeRequest,
  deps: CaptionDeps,
): Promise<boolean> {
  const profile = resolveProviderProfile(deps.readSettings(), body.provider)
  if (profile === undefined) throw new Error(`未找到自定义接口 "${body.provider}" 的配置`)
  if (profile.api !== undefined && profile.api !== 'openai-completions') {
    throw new Error('自动检测仅支持 openai-completions 协议的自定义接口')
  }
  if (profile.baseURL === undefined) throw new Error(`自定义接口 "${body.provider}" 未配置 baseURL`)
  const apiKey = profile.apiKeyEnv === undefined
    ? undefined
    : await deps.resolveCredential(profile.apiKeyEnv)
  const endpoint = `${profile.baseURL.replace(/\/+$/u, '')}/chat/completions`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`
  const controller = new AbortController()
  const timer = setTimeout(() => { controller.abort() }, PROBE_TIMEOUT_MS)
  try {
    const response = await deps.fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(buildProbeRequestBody(body.model)),
      signal: controller.signal,
    })
    const payload = await response.json()
    if (!response.ok) return false
    return parseProbeVerdict(payload) === 'yes'
  } finally {
    clearTimeout(timer)
  }
}

function isCaptionImage(value: unknown): value is CaptionImageRequest {
  if (typeof value !== 'object' || value === null) return false
  const mediaType = (value as { mediaType?: unknown }).mediaType
  const data = (value as { data?: unknown }).data
  return typeof mediaType === 'string' && /^image\/[a-z0-9.+-]+$/iu.test(mediaType)
    && typeof data === 'string' && data.length > 0
}

/**
 * Validate a describe request body. Returns the request or an error message.
 */
export function parseDescribeRequest(value: unknown): { request?: DescribeRequest; error?: string } {
  if (typeof value !== 'object' || value === null) return { error: 'body must be an object' }
  const provider = (value as { provider?: unknown }).provider
  const model = (value as { model?: unknown }).model
  const images = (value as { images?: unknown }).images
  if (typeof provider !== 'string' || provider.length === 0) return { error: 'provider is required' }
  if (typeof model !== 'string' || model.length === 0) return { error: 'model is required' }
  if (!Array.isArray(images) || images.length === 0) return { error: 'images must be a non-empty array' }
  if (images.length > 8) return { error: 'too many images' }
  for (const image of images) {
    if (!isCaptionImage(image)) return { error: 'each image needs mediaType and base64 data' }
  }
  return { request: { provider, model, images } }
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': Buffer.byteLength(payload),
    'cache-control': 'no-store',
  })
  response.end(payload)
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    request.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > MAX_JSON_BODY_BYTES) {
        reject(new Error('request body too large'))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch (cause) {
        reject(cause instanceof Error ? cause : new Error(String(cause)))
      }
    })
    request.on('error', cause => reject(cause instanceof Error ? cause : new Error(String(cause))))
  })
}

export interface CaptionDeps {
  fetch: (input: string, init: Record<string, unknown>) => Promise<{ ok: boolean; status: number; json: () => Promise<unknown> }>
  resolveCredential: (ref: string) => Promise<string | undefined>
  readSettings: () => unknown
}

/**
 * Describe every image of one request with the universal model. Pure
 * dependency-injected core so focused tests cover it without a server.
 * @returns captions in request order.
 * @throws Error with a user-presentable message on any failure.
 */
export async function describeImages(
  body: DescribeRequest,
  deps: CaptionDeps,
): Promise<string[]> {
  const profile = resolveProviderProfile(deps.readSettings(), body.provider)
  if (profile === undefined) throw new Error(`未找到自定义接口 "${body.provider}" 的配置`)
  if (profile.api !== undefined && profile.api !== 'openai-completions') {
    throw new Error('通用识图模型仅支持 openai-completions 协议的自定义接口')
  }
  if (profile.baseURL === undefined) throw new Error(`自定义接口 "${body.provider}" 未配置 baseURL`)
  const apiKey = profile.apiKeyEnv === undefined
    ? undefined
    : await deps.resolveCredential(profile.apiKeyEnv)
  const endpoint = `${profile.baseURL.replace(/\/+$/u, '')}/chat/completions`
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (apiKey !== undefined) headers.authorization = `Bearer ${apiKey}`
  return Promise.all(body.images.map(async (_image, index): Promise<string> => {
    const controller = new AbortController()
    const timer = setTimeout(() => { controller.abort() }, CAPTION_TIMEOUT_MS)
    try {
      const response = await deps.fetch(endpoint, {
        method: 'POST',
        headers,
        body: JSON.stringify(buildCaptionRequestBody(body, index)),
        signal: controller.signal,
      })
      const payload = await response.json()
      if (!response.ok) {
        const message = typeof payload === 'object' && payload !== null
          && typeof (payload as { error?: unknown }).error === 'object'
          && (payload as { error: { message?: unknown } }).error !== null
          && typeof (payload as { error: { message?: unknown } }).error.message === 'string'
          ? (payload as { error: { message: string } }).error.message
          : `识图模型返回 HTTP ${String(response.status)}`
        throw new Error(`识图模型调用失败:${message}`)
      }
      const caption = parseCaptionResponse(payload)
      if (caption === undefined) throw new Error('识图模型未返回有效内容')
      return caption
    } finally {
      clearTimeout(timer)
    }
  }))
}

/** Stable Cordis plugin name. */
export const name = 'desktop-vision'

/** Host services required by the vision caption route. */
export const inject = ['webServer', 'desktopRuntime', 'settings', 'credentials']

/**
 * Register the desktop vision caption HTTP routes.
 * @param ctx - Host context carrying the Web carrier and kernel services.
 */
export function apply(ctx: Context): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: VISION_ROUTE,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      let parsed: { request?: DescribeRequest; error?: string }
      try {
        parsed = parseDescribeRequest(await readJsonBody(request))
      } catch (cause) {
        sendJson(response, 400, { error: `invalid request body: ${cause instanceof Error ? cause.message : String(cause)}` })
        return
      }
      if (parsed.request === undefined) {
        sendJson(response, 400, { error: parsed.error ?? 'invalid request' })
        return
      }
      try {
        const captions = await describeImages(parsed.request, {
          fetch: (input, init) => fetch(input, init as RequestInit),
          resolveCredential: async ref => {
            const resolved = await ctx.credentials.resolve(credentialRef(ref))
            if (resolved === undefined) return undefined
            const value = (resolved as { value?: unknown }).value
            return typeof value === 'string' ? value : undefined
          },
          readSettings: () => ctx.settings.get(PI_AI_SETTINGS),
        })
        sendJson(response, 200, { captions })
      } catch (cause) {
        sendJson(response, 502, { error: cause instanceof Error ? cause.message : String(cause) })
      }
    },
  }), 'harnessx-desktop: vision caption API route')
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact',
    path: PROBE_ROUTE,
    handler: async (request: IncomingMessage, response: ServerResponse) => {
      if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
        sendJson(response, 401, { error: 'unauthorized' })
        return
      }
      if (request.method !== 'POST') {
        sendJson(response, 405, { error: 'method not allowed' })
        return
      }
      let body: unknown
      try {
        body = await readJsonBody(request)
      } catch (cause) {
        sendJson(response, 400, { error: `invalid request body: ${cause instanceof Error ? cause.message : String(cause)}` })
        return
      }
      if (!isProbeRequest(body)) {
        sendJson(response, 400, { error: 'provider and model are required' })
        return
      }
      try {
        const capable = await probeModelVision(body, {
          fetch: (input, init) => fetch(input, init as RequestInit),
          resolveCredential: async ref => {
            const resolved = await ctx.credentials.resolve(credentialRef(ref))
            if (resolved === undefined) return undefined
            const value = (resolved as { value?: unknown }).value
            return typeof value === 'string' ? value : undefined
          },
          readSettings: () => ctx.settings.get(PI_AI_SETTINGS),
        })
        sendJson(response, 200, { capable })
      } catch (cause) {
        sendJson(response, 502, { error: cause instanceof Error ? cause.message : String(cause) })
      }
    },
  }), 'harnessx-desktop: vision probe API route')
}
