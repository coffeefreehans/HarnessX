import { mkdtemp, rm } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DesktopRuntime, DesktopTrayItem } from '../src/runtime.ts'
import type { UpdateReleaseInfo } from '../src/update-checker.ts'
import { apply, Config, inject, type Config as UpdateConfig } from '../src/updates.ts'

const testConfig: UpdateConfig = {
  enabled: false,
  initialDelayMs: 10,
  intervalMs: 1000,
  requestTimeoutMs: 1000,
}

const RELEASE: UpdateReleaseInfo = {
  version: '0.2',
  tagName: 'v0.2',
  releaseName: 'HarnessX 0.2',
  releaseNotes: 'New release notes',
  publishedAt: '2026-08-17T00:00:00Z',
  releaseUrl: 'https://github.com/coffeefreehans/HarnessX/releases/tag/v0.2',
  assets: [],
}

type RouteHandler = (request: IncomingMessage, response: ServerResponse) => void | Promise<void>

interface Harness {
  /** Registered native tray contribution. */
  readonly tray: DesktopTrayItem
  /** Native download handoff spy. */
  readonly downloadAndOpen: ReturnType<typeof vi.fn>
  /** Native confirmation spy. */
  readonly confirmDownload: ReturnType<typeof vi.fn>
  /** Invoke one settings API and parse its JSON response. */
  invoke(path: string, method: 'GET' | 'POST'): Promise<{ status: number; body: Record<string, unknown> }>
  /** Dispose the plugin effect. */
  dispose(): Promise<void>
}

function releaseResponse(version: string = RELEASE.version): Response {
  return Response.json({
    tag_name: 'v' + version,
    name: 'HarnessX ' + version,
    body: 'New release notes',
    published_at: RELEASE.publishedAt,
    html_url: 'https://github.com/coffeefreehans/HarnessX/releases/tag/v' + version,
    assets: [],
  })
}

async function createHarness(options: {
  /** Request adapter returned by the native runtime. */
  readonly request?: DesktopRuntime['updates']['request']
  /** Native confirmation behavior. */
  readonly confirmDownload?: () => Promise<boolean>
  /** Whether the local API request is authorized. */
  readonly authorized?: boolean
} = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'harnessx-updates-'))
  temporaryRoots.push(root)
  const routes = new Map<string, RouteHandler>()
  const disposers: Array<ReturnType<typeof vi.fn>> = []
  const confirmDownload = vi.fn(options.confirmDownload ?? (async () => true))
  const downloadAndOpen = vi.fn(async () => {})
  let tray: DesktopTrayItem | undefined
  let disposeEffect: (() => void | Promise<void>) | undefined

  const runtime = {
    platform: 'win32',
    authorizeLocalApiRequest: () => options.authorized ?? true,
    updates: {
      isPackaged: false,
      canDownload: true,
      currentVersion: '0.1',
      arch: 'x64',
      statePath: join(root, 'updates', 'state.json'),
      request: options.request ?? (async () => releaseResponse()),
      confirmDownload,
      showManualCheckResult: async () => {},
      downloadAndOpen,
      notify: () => {},
    },
    registerTrayItem: (item: DesktopTrayItem) => {
      tray = item
      return { refresh: () => {}, dispose: () => {} }
    },
  } as unknown as DesktopRuntime

  const ctx = {
    desktopRuntime: runtime,
    webServer: {
      register: (route: { path: string; handler: RouteHandler }) => {
        routes.set(route.path, route.handler)
        const dispose = vi.fn(() => { routes.delete(route.path) })
        disposers.push(dispose)
        return dispose
      },
    },
    effect: (register: () => (() => void | Promise<void>)) => {
      disposeEffect = register()
      return disposeEffect
    },
  } as unknown as Context

  apply(ctx, testConfig)
  if (tray === undefined) throw new Error('update tray item was not registered')

  return {
    tray,
    downloadAndOpen,
    confirmDownload,
    invoke: async (path, method) => {
      const handler = routes.get(path)
      if (handler === undefined) throw new Error('route not found: ' + path)
      let status = 0
      let body = ''
      const response = {
        writeHead: (nextStatus: number) => { status = nextStatus },
        end: (value: string) => { body = value },
      } as unknown as ServerResponse
      await handler({ method } as IncomingMessage, response)
      return { status, body: JSON.parse(body) as Record<string, unknown> }
    },
    dispose: async () => {
      await disposeEffect?.()
      expect(disposers.every(dispose => dispose.mock.calls.length === 1)).toBe(true)
    },
  }
}

const temporaryRoots: string[] = []

afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('desktop update Host plugin', () => {
  it('declares native and web services with the existing polling defaults', () => {
    expect(inject).toEqual(['desktopRuntime', 'webServer'])
    expect(Config({} as UpdateConfig)).toEqual({
      enabled: true,
      initialDelayMs: 60_000,
      intervalMs: 21_600_000,
      requestTimeoutMs: 15_000,
    })
  })

  it('returns the installed version before the first check', async () => {
    const harness = await createHarness()
    const response = await harness.invoke('/api/desktop/updates/status', 'GET')
    expect(response).toMatchObject({
      status: 200,
      body: {
        currentVersion: '0.1',
        arch: 'x64',
        canDownload: true,
        checking: false,
        status: 'idle',
      },
    })
    await harness.dispose()
  })

  it('rejects requests without the per-launch local API session', async () => {
    const harness = await createHarness({ authorized: false })
    const response = await harness.invoke('/api/desktop/updates/status', 'GET')
    expect(response).toEqual({ status: 401, body: { error: 'unauthorized' } })
    await harness.dispose()
  })

  it('checks GitHub Releases and exposes release metadata', async () => {
    const harness = await createHarness()
    const response = await harness.invoke('/api/desktop/updates/check', 'POST')
    expect(response.status).toBe(200)
    expect(response.body).toMatchObject({
      currentVersion: '0.1',
      latestVersion: '0.2',
      status: 'update-available',
      releaseName: RELEASE.releaseName,
      releaseNotes: RELEASE.releaseNotes,
      publishedAt: RELEASE.publishedAt,
      releaseUrl: RELEASE.releaseUrl,
    })
    const isZh = (process.env.LANG ?? process.env.LC_ALL ?? '').toLowerCase().startsWith('zh')
      || Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh')
    expect(harness.tray.label()).toBe(isZh ? '发现新版本 DeepSeek HarnessX 0.2' : 'DeepSeek HarnessX 0.2 Available')
    await harness.dispose()
  })

  it('rechecks and passes version plus release to the native downloader', async () => {
    const harness = await createHarness()
    const response = await harness.invoke('/api/desktop/updates/download', 'POST')
    expect(response.status).toBe(200)
    expect(harness.confirmDownload).toHaveBeenCalledWith('0.2')
    expect(harness.downloadAndOpen).toHaveBeenCalledWith(
      '0.2',
      expect.objectContaining({ version: '0.2', tagName: 'v0.2' }),
      expect.any(AbortSignal),
    )
    await harness.dispose()
  })

  it('returns a safe error when GitHub is unavailable', async () => {
    const harness = await createHarness({
      request: async () => new Response('unavailable', { status: 503 }),
    })
    const response = await harness.invoke('/api/desktop/updates/check', 'POST')
    expect(response).toMatchObject({
      status: 200,
      body: {
        currentVersion: '0.1',
        status: 'error',
        error: '无法检查更新，请稍后重试。',
      },
    })
    await harness.dispose()
  })
})
