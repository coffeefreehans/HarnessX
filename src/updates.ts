/** Cordis Host plugin for scheduled, tray, and settings-page HarnessX updates. */

import { open } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import z from '@deepseek-ai/schemastery'
import type {} from './runtime.ts'
import {
  checkForStableUpdate,
  parseSemVer,
  type UpdateCheckResult,
} from './update-checker.ts'

/** Stable Cordis plugin name. */
export const name = 'desktop-updates'

/** Host services required for native operations and settings-page APIs. */
export const inject = ['desktopRuntime', 'webServer']

const MAX_TIMER_DELAY_MS = 2_147_483_647
const MAX_STATE_BYTES = 4 * 1024
const MAX_FEEDBACK_BODY_BYTES = 64 * 1024
const UPDATE_ROUTE = '/api/desktop/updates'

/**
 * Relay that forwards user feedback to the maintainer mailbox. The address
 * lives here on the Host side only and is never sent to the renderer.
 */
const FEEDBACK_ENDPOINT = 'https://formsubmit.co/ajax/coffeefreehans@gmail.com'
const FEEDBACK_INVALID = '请填写有效的邮箱、标题和内容。'
const FEEDBACK_FAILED = '反馈发送失败，请稍后重试。'

/** Scheduled update policy. */
export interface Config {
  /** Enable background checks in packaged applications. */
  enabled: boolean
  /** Delay before the first background check after plugin activation. */
  initialDelayMs: number
  /** Delay between completion of one background check and the next attempt. */
  intervalMs: number
  /** Maximum duration of one version request before caller-owned cancellation. */
  requestTimeoutMs: number
}

/** Validated scheduled update policy. */
export const Config: z<Config> = z.object({
  enabled: z.boolean().default(true),
  initialDelayMs: z.number().step(1).min(0).max(MAX_TIMER_DELAY_MS).default(60_000),
  intervalMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(6 * 60 * 60 * 1000),
  requestTimeoutMs: z.number().step(1).min(1).max(MAX_TIMER_DELAY_MS).default(15_000),
})

interface UpdateStateV2 {
  /** Persistent state schema version. */
  readonly version: 2
  /** Latest version for which an automatic prompt was shown. */
  readonly lastPromptedVersion?: string
}

/** Settings-page update state returned by the Host API. */
export interface UpdateApiSnapshot {
  /** Installed application version. */
  readonly currentVersion: string
  /** Current CPU architecture. */
  readonly arch: string
  /** Whether this package can download an installer. */
  readonly canDownload: boolean
  /** Whether a version request is running. */
  readonly checking: boolean
  /** Version currently being downloaded. */
  readonly downloadingVersion?: string
  /** Latest version returned by GitHub. */
  readonly latestVersion?: string
  /** Update comparison result. */
  readonly status: 'idle' | 'error' | 'up-to-date' | 'update-available'
  /** GitHub release title. */
  readonly releaseName?: string
  /** Plain-text GitHub release notes. */
  readonly releaseNotes?: string
  /** GitHub release publication timestamp. */
  readonly publishedAt?: string
  /** Public GitHub release URL. */
  readonly releaseUrl?: string
  /** Timestamp of the latest completed check. */
  readonly lastCheckedAt?: string
  /** Latest safe user-facing failure message. */
  readonly error?: string
}

const EMPTY_STATE: UpdateStateV2 = { version: 2 }

/**
 * Register effect-scoped update polling, settings APIs, and a dynamic tray command.
 * @param ctx - Host context carrying native and web-server adapters.
 * @param config - Validated polling and timeout values.
 */
export function apply(ctx: Context, config: Config): void {
  const adapter = ctx.desktopRuntime.updates
  ctx.effect(() => {
    let disposed = false
    let checking = false
    let downloadingVersion: string | undefined
    let latestResult: UpdateCheckResult | null | undefined
    let lastCheckedAt: string | undefined
    let lastError: string | undefined
    let state: UpdateStateV2 = EMPTY_STATE
    let pollTimer: ReturnType<typeof setTimeout> | undefined
    let requestTimer: ReturnType<typeof setTimeout> | undefined
    let requestController: AbortController | undefined
    let downloadController: AbortController | undefined
    let inFlight: Promise<UpdateCheckResult | null> | undefined
    let manualTask: Promise<void> | undefined
    let downloadTask: Promise<void> | undefined
    let refreshTray = (): void => {}

    const persistState = async (): Promise<void> => {
      try {
        await writeFileAtomic(adapter.statePath, renderState(state), {
          mode: 0o600,
          dirMode: 0o700,
        })
      } catch {
        // Prompt history is optional and must not affect application activity.
      }
    }

    const stateReady = (async () => {
      try {
        state = parseState(await readState(adapter.statePath))
      } catch (cause) {
        if (isEnoent(cause)) return
        state = EMPTY_STATE
        if (!disposed) await persistState()
      }
    })()

    const rememberPrompt = async (version: string): Promise<void> => {
      await stateReady
      if (state.lastPromptedVersion === version) return
      state = { version: 2, lastPromptedVersion: version }
      await persistState()
    }

    const snapshot = (): UpdateApiSnapshot => {
      const release = latestResult?.release
      return {
        currentVersion: adapter.currentVersion,
        arch: adapter.arch,
        canDownload: adapter.canDownload,
        checking,
        ...(downloadingVersion === undefined ? {} : { downloadingVersion }),
        ...(latestResult === undefined || latestResult === null
          ? {}
          : { latestVersion: latestResult.latestVersion }),
        status: checking
          ? latestResult?.status ?? 'idle'
          : latestResult === null
            ? 'error'
            : latestResult?.status ?? 'idle',
        ...(release === undefined
          ? {}
          : {
              releaseName: release.releaseName,
              releaseNotes: release.releaseNotes,
              publishedAt: release.publishedAt,
              releaseUrl: release.releaseUrl,
            }),
        ...(lastCheckedAt === undefined ? {} : { lastCheckedAt }),
        ...(lastError === undefined ? {} : { error: lastError }),
      }
    }

    const startCheck = (): Promise<UpdateCheckResult | null> => {
      if (inFlight !== undefined) return inFlight
      checking = true
      refreshTray()
      const controller = new AbortController()
      requestController = controller

      const task = (async () => {
        requestTimer = setTimeout(() => { controller.abort() }, config.requestTimeoutMs)
        try {
          return await checkForStableUpdate({
            currentVersion: adapter.currentVersion,
            signal: controller.signal,
            request: adapter.request,
          })
        } catch {
          return null
        }
      })().finally(() => {
        if (requestTimer !== undefined) clearTimeout(requestTimer)
        requestTimer = undefined
        if (requestController === controller) requestController = undefined
        inFlight = undefined
        checking = false
        refreshTray()
      })
      inFlight = task
      return task
    }

    const observeResult = (result: UpdateCheckResult | null): UpdateCheckResult | null => {
      if (disposed) return null
      latestResult = result
      lastCheckedAt = new Date().toISOString()
      lastError = result === null ? '无法检查更新，请稍后重试。' : undefined
      refreshTray()
      return result
    }

    const availableResult = (): UpdateCheckResult | undefined => {
      return latestResult?.status === 'update-available' && adapter.canDownload
        ? latestResult
        : undefined
    }

    const startDownload = (result: UpdateCheckResult): Promise<void> => {
      if (downloadTask !== undefined) return downloadTask
      const task = (async () => {
        let confirmed: boolean
        try {
          confirmed = await adapter.confirmDownload(result.latestVersion)
        } catch {
          return
        }
        if (!confirmed || disposed) return

        const confirmedResult = observeResult(await startCheck())
        if (confirmedResult?.status !== 'update-available'
          || confirmedResult.latestVersion !== result.latestVersion
          || disposed) {
          return
        }

        const controller = new AbortController()
        downloadController = controller
        downloadingVersion = confirmedResult.latestVersion
        lastError = undefined
        refreshTray()
        try {
          await adapter.downloadAndOpen(
            confirmedResult.latestVersion,
            confirmedResult.release,
            controller.signal,
          )
        } catch (cause) {
          if (!controller.signal.aborted) lastError = errorMessage(cause)
        } finally {
          if (downloadController === controller) downloadController = undefined
          downloadingVersion = undefined
          refreshTray()
        }
      })().finally(() => {
        if (downloadTask === task) downloadTask = undefined
      })
      downloadTask = task
      return task
    }

    const offerDownload = async (result: UpdateCheckResult, automatic: boolean): Promise<void> => {
      if (disposed || !adapter.canDownload || result.status !== 'update-available') return
      await stateReady
      if (disposed || (automatic && state.lastPromptedVersion === result.latestVersion)) return
      await rememberPrompt(result.latestVersion)
      if (!disposed) await startDownload(result)
    }

    const runManualCheck = (): Promise<void> => {
      manualTask ??= (async () => {
        const cached = availableResult()
        if (cached !== undefined) {
          await offerDownload(cached, false)
          return
        }
        const result = observeResult(await startCheck())
        if (disposed) return
        if (result?.status === 'update-available' && adapter.canDownload) {
          await offerDownload(result, false)
          return
        }
        await adapter.showManualCheckResult(result)
      })().catch(() => undefined).finally(() => { manualTask = undefined })
      return manualTask
    }

    const runSettingsCheck = async (): Promise<UpdateApiSnapshot> => {
      observeResult(await startCheck())
      return snapshot()
    }

    const runSettingsDownload = async (): Promise<UpdateApiSnapshot> => {
      let result = availableResult()
      if (result === undefined) {
        observeResult(await startCheck())
        result = availableResult()
      }
      if (result === undefined) {
        throw new Error('当前没有可下载的新版本。')
      }
      await startDownload(result)
      return snapshot()
    }

    const runBackgroundCheck = async (): Promise<void> => {
      if (inFlight !== undefined || disposed) return
      try {
        const result = observeResult(await startCheck())
        if (result?.status === 'update-available') await offerDownload(result, true)
      } catch {
        // Scheduled checks never surface failures to the application log.
      }
    }

    const scheduleBackgroundCheck = (delayMs: number): void => {
      pollTimer = setTimeout(() => {
        pollTimer = undefined
        void runBackgroundCheck().finally(() => {
          if (!disposed) scheduleBackgroundCheck(config.intervalMs)
        })
      }, delayMs)
    }

    const registerApi = (
      path: string,
      method: 'GET' | 'POST',
      action: () => UpdateApiSnapshot | Promise<UpdateApiSnapshot>,
    ): (() => void) => ctx.webServer.register({
      kind: 'exact',
      path,
      handler: async (request: IncomingMessage, response: ServerResponse) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
          sendJson(response, 401, { error: 'unauthorized' })
          return
        }
        if (request.method !== method) {
          sendJson(response, 405, { error: 'method not allowed' })
          return
        }
        try {
          sendJson(response, 200, await action())
        } catch (cause) {
          sendJson(response, 409, { error: errorMessage(cause), ...snapshot() })
        }
      },
    })

    const disposeStatus = registerApi(UPDATE_ROUTE + '/status', 'GET', snapshot)
    const disposeCheck = registerApi(UPDATE_ROUTE + '/check', 'POST', runSettingsCheck)
    const disposeDownload = registerApi(UPDATE_ROUTE + '/download', 'POST', runSettingsDownload)
    const disposeFeedback = ctx.webServer.register({
      kind: 'exact',
      path: UPDATE_ROUTE + '/feedback',
      handler: async (request: IncomingMessage, response: ServerResponse) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
          sendJson(response, 401, { error: 'unauthorized' })
          return
        }
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'method not allowed' })
          return
        }
        try {
          await deliverFeedback(await readJsonBody(request), config.requestTimeoutMs)
          sendJson(response, 200, { ok: true })
        } catch (cause) {
          sendJson(response, 409, { error: errorMessage(cause) })
        }
      },
    })

    const isZh = (process.env.LANG ?? process.env.LC_ALL ?? '').toLowerCase().startsWith('zh')
      || Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh')

    const registration = ctx.desktopRuntime.registerTrayItem({
      group: 'status',
      order: 10,
      label: () => downloadingVersion === undefined
        ? availableResult() === undefined
          ? checking
            ? (isZh ? '正在检查更新…' : 'Checking for Updates…')
            : (isZh ? '检查更新…' : 'Check for Updates…')
          : (isZh ? `发现新版本 DeepSeek HarnessX ${availableResult()!.latestVersion}` : `DeepSeek HarnessX ${availableResult()!.latestVersion} Available`)
        : (isZh ? `正在下载 DeepSeek HarnessX ${downloadingVersion}…` : `Downloading DeepSeek HarnessX ${downloadingVersion}…`),
      invoke: runManualCheck,
    })
    refreshTray = registration.refresh

    if (adapter.isPackaged && config.enabled) scheduleBackgroundCheck(config.initialDelayMs)

    return async () => {
      disposed = true
      if (pollTimer !== undefined) clearTimeout(pollTimer)
      if (requestTimer !== undefined) clearTimeout(requestTimer)
      requestController?.abort()
      downloadController?.abort()
      disposeStatus()
      disposeCheck()
      disposeDownload()
      disposeFeedback()
      registration.dispose()
      const pending: Promise<unknown>[] = [stateReady]
      if (inFlight !== undefined) pending.push(inFlight)
      await Promise.allSettled(pending)
    }
  }, 'harnessx-desktop: update polling, settings API, confirmation, and installer handoff')
}

function parseState(text: string): UpdateStateV2 {
  const value: unknown = JSON.parse(text)
  if (!isRecord(value)
    || value.version !== 2
    || (value.lastPromptedVersion !== undefined && !isStableVersion(value.lastPromptedVersion))
    || Object.keys(value).some(key => !['version', 'lastPromptedVersion'].includes(key))) {
    throw new Error('invalid v2 update state')
  }
  return value.lastPromptedVersion === undefined
    ? EMPTY_STATE
    : { version: 2, lastPromptedVersion: value.lastPromptedVersion as string }
}

async function readState(filename: string): Promise<string> {
  const handle = await open(filename, 'r')
  try {
    const buffer = Buffer.alloc(MAX_STATE_BYTES + 1)
    const { bytesRead } = await handle.read(buffer, 0, buffer.byteLength, 0)
    if (bytesRead > MAX_STATE_BYTES) throw new Error('update state exceeds ' + String(MAX_STATE_BYTES) + ' bytes')
    return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, bytesRead))
  } finally {
    await handle.close()
  }
}

function renderState(state: UpdateStateV2): string {
  return JSON.stringify(state, null, 2) + '\n'
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function readJsonBody(request: IncomingMessage): Promise<unknown> {
  return new Promise((resolveBody, reject) => {
    const chunks: Buffer[] = []
    let received = 0
    request.on('data', (chunk: Buffer) => {
      received += chunk.length
      if (received > MAX_FEEDBACK_BODY_BYTES) {
        reject(new Error(FEEDBACK_INVALID))
        request.destroy()
        return
      }
      chunks.push(chunk)
    })
    request.on('end', () => {
      try {
        resolveBody(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      } catch {
        reject(new Error(FEEDBACK_INVALID))
      }
    })
    request.on('error', cause => reject(cause instanceof Error ? cause : new Error(String(cause))))
  })
}

/**
 * Validate a feedback submission and relay it to the maintainer mailbox.
 * @param value - raw request body carrying email, subject, and message.
 * @param timeoutMs - relay request budget before caller-visible failure.
 * @throws with a safe user-facing message on invalid input or relay failure.
 */
async function deliverFeedback(value: unknown, timeoutMs: number): Promise<void> {
  if (!isRecord(value)) throw new Error(FEEDBACK_INVALID)
  const email = typeof value.email === 'string' ? value.email.trim() : ''
  const subject = typeof value.subject === 'string' ? value.subject.trim() : ''
  const message = typeof value.message === 'string' ? value.message.trim() : ''
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || subject.length === 0 || message.length === 0) {
    throw new Error(FEEDBACK_INVALID)
  }
  let success: unknown
  try {
    const response = await fetch(FEEDBACK_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        _captcha: 'false',
        _subject: '[HarnessX] ' + subject.slice(0, 200),
        _template: 'table',
        email,
        message: message.slice(0, 20000),
      }),
      signal: AbortSignal.timeout(timeoutMs),
    })
    success = (await response.json() as { success?: unknown }).success
  } catch {
    throw new Error(FEEDBACK_FAILED)
  }
  if (success !== 'true' && success !== true) throw new Error(FEEDBACK_FAILED)
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function isStableVersion(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const parsed = parseSemVer(value)
  return parsed !== null && parsed.prerelease.length === 0 && parsed.version === value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isEnoent(value: unknown): boolean {
  return isRecord(value) && value.code === 'ENOENT'
}
