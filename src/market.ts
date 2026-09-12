/** Desktop plugin market Host plugin. */

import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAbsolute, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import {
  initProfile,
  PROFILE_TEMPLATES,
  readProfileManifest,
  resolveBundleDir,
  writeProfileManifest,
} from '@deepseek-ai/dsh-app-boot'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import type {} from './pnpm.ts'
import type {} from './profile-service.ts'
import type { DesktopPnpmHandle } from './pnpm.ts'
import { desktopInstallAnchor, desktopThirdPartyBundles } from './profile.ts'

const BIN_NAME = 'harnessx-desktop'
const MARKET_ROUTE = '/api/desktop/market'
const MAX_JSON_BODY_BYTES = 256 * 1024
const MAX_FETCH_BODY_BYTES = 64 * 1024 * 1024
const MAX_JOB_OUTPUT_LINES = 200
const DEFAULT_NPM_QUERY = 'deepseek-harness'
const REQUEST_TIMEOUT_MS = 30_000
const CATALOG_CACHE_TTL_MS = 5 * 60 * 1000
const DEFAULT_CATALOG_LIMIT = 60
const MAX_CATALOG_LIMIT = 120
const GIT_CLONE_TIMEOUT_MS = 120_000
const GIT_CLONE_MAX_OUTPUT_BYTES = 1024 * 1024
const PROFILE_PNPM_WORKSPACE_FILENAME = 'pnpm-workspace.yaml'

/** Supported plugin source kinds. */
export type PluginSourceKind = 'npm' | 'manifest' | 'github' | 'local'

/** One user-configurable plugin source. */
export interface PluginSourceConfig {
  /** Stable machine identifier used by route queries and persistence. */
  id: string
  /** Human-readable source label. */
  name: string
  /** Source adapter selected for this entry. */
  kind: PluginSourceKind
  /** Registry URL, manifest URL, GitHub repository URL, or absolute local path. */
  url: string
  /** Whether catalog requests include this source. */
  enabled: boolean
}

/** One plugin entry declared by a manifest-style source. */
export interface MarketManifestPlugin {
  /** Stable plugin identifier inside one manifest. */
  id: string
  /** Human-readable plugin name. */
  name: string
  /** Short description shown in market cards. */
  description: string | undefined
  /** Latest version reported by the source. */
  version: string | undefined
  /** Author or publisher label reported by the source. */
  author: string | undefined
  /** Plugin homepage URL. */
  homepage: string | undefined
  /** Plugin repository URL. */
  repository: string | undefined
  /** Package specification passed to `dsh plugin add`. */
  install: string
  /** Search and display tags. */
  tags: string[] | undefined
  /** Popularity signal reported by the source. */
  stars: number | undefined
  /** Source-specific category or marketplace section. */
  category: string | undefined
  /** License identifier reported by the source. */
  license: string | undefined
  /** Last update timestamp reported by the source. */
  updatedAt: string | undefined
}

/** Root document loaded from `manifest`, `github`, and `local` sources. */
export interface MarketManifest {
  /** Manifest schema version; legacy version 1 documents are preserved. */
  version: 1
  /** Plugins exposed by this manifest. */
  plugins: MarketManifestPlugin[]
}

/** One plugin after it has been attributed to a configured source. */
export interface MarketPlugin extends MarketManifestPlugin {
  /** Owning source identifier. */
  sourceId: string
  /** Owning source display name. */
  sourceName: string
  /** Owning source kind. */
  sourceKind: PluginSourceKind
}

/** One source resolution failure returned with the otherwise-successful catalog. */
export interface MarketSourceError {
  /** Source that failed to resolve. */
  sourceId: string
  /** Source display name. */
  sourceName: string
  /** Human-readable failure reason. */
  message: string
}

/** Aggregated catalog response. */
export interface MarketCatalogResult {
  /** Plugins successfully resolved and paged from enabled sources. */
  plugins: MarketPlugin[]
  /** Per-source failures collected without failing the whole request. */
  errors: MarketSourceError[]
  /** Total matching plugins before this page slice. */
  total: number
  /** Page offset echoed from the request. */
  offset: number
  /** Page size echoed from the request. */
  limit: number
}

/** One plugin installed in the active desktop profile. */
export interface MarketInstalledPlugin {
  /** Package or bundle name stored by the profile. */
  name: string
  /** Resolved installed version when `node_modules` contains the package. */
  version: string | undefined
  /** Declared dependency range when present in `package.json`. */
  requested: string | undefined
}

/** Terminal job states exposed by the market API. */
export type MarketJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

/** Plugin operations exposed by the market API. */
export type MarketJobAction = 'install' | 'uninstall'

/** Read-only job snapshot returned by the market API. */
export interface MarketJobSnapshot {
  /** Opaque job identifier. */
  id: string
  /** Package operation performed by the task. */
  action: MarketJobAction
  /** Current lifecycle state. */
  status: MarketJobStatus
  /** User-facing operation title, normally the plugin display name. */
  label: string
  /** Package specification or installed package name targeted by the job. */
  target: string
  /** Process exit code, or `null` while running or after signal termination. */
  exitCode: number | null
  /** Terminating signal, or `null` after a normal exit. */
  signal: NodeJS.Signals | null
  /** ISO timestamp when the task entered the queue. */
  createdAt: string
  /** ISO timestamp when execution began, or `undefined` while queued. */
  startedAt: string | undefined
  /** ISO timestamp when execution ended, or `undefined` while active. */
  completedAt: string | undefined
  /** Tail of combined stdout/stderr lines, newest at the end. */
  output: string[]
}

/** Completion facts for one package-manager operation. */
type MarketOutcome = { exitCode: number | null; signal: NodeJS.Signals | null }

/** Snapshot of the profile manifest captured immediately before pnpm runs. */
type MarketProfileSnapshot = ReturnType<typeof readProfileManifest>

/** One queued package-manager operation. */
interface MarketOperation {
  /** Package operation performed by the task. */
  action: MarketJobAction
  /** User-facing operation title. */
  label: string
  /** Package specification or package name targeted by the operation. */
  target: string
  /** Start the pnpm process. */
  start: () => DesktopPnpmHandle
  /** Capture the profile manifest right before the process starts. */
  captureBefore: () => MarketProfileSnapshot
  /** Reconcile the profile after a successful pnpm operation. */
  onSettled?: (outcome: MarketOutcome, before: MarketProfileSnapshot) => Promise<void>
}

interface MarketJob {
  readonly id: string
  readonly operation: MarketOperation
  readonly output: string[]
  /** ISO timestamp when the task entered the queue. */
  readonly createdAt: string
  /** ISO timestamp when task execution began. */
  startedAt: string | undefined
  /** ISO timestamp when the task reached a terminal state. */
  completedAt: string | undefined
  handle: DesktopPnpmHandle | undefined
  pending: string
  status: MarketJobStatus
  exitCode: number | null
  signal: NodeJS.Signals | null
  cancelRequested: boolean
}

interface CatalogPluginCache {
  readonly expiresAt: number
  readonly plugins: MarketPlugin[]
}

/** Default source configuration created on first launch. */
const DEFAULT_SOURCES: readonly PluginSourceConfig[] = [
  {
    id: 'npm-registry',
    name: 'npm Registry',
    kind: 'npm',
    url: 'https://registry.npmjs.org',
    enabled: true,
  },
  {
    id: 'awesome-dsh',
    name: 'Awesome DSH Plugins',
    kind: 'manifest',
    url: 'https://awesome-dsh-plugin.com/plugins.json',
    enabled: true,
  },
  {
    id: 'dsh-plugin-marketplace',
    name: 'DSH Plugin Marketplace',
    kind: 'manifest',
    url: 'https://w2112515.github.io/dsh-plugin-marketplace/plugin-marketplace/catalog-v1.json',
    enabled: true,
  },
  {
    id: 'yelebai-dsh-marketplace',
    name: 'YELEBAI DSH Marketplace',
    kind: 'manifest',
    url: 'https://raw.githubusercontent.com/YELEBAI/dsh-plugin-marketplace/main/registry/plugins.json',
    enabled: true,
  },
  {
    id: 'brade-dsh-marketplace',
    name: 'BraDe DSH Marketplace',
    kind: 'manifest',
    url: 'https://raw.githubusercontent.com/bradeGithub/DSH-Plugins-Marketplace/main/registry.json',
    enabled: true,
  },
]

/** Stable Cordis plugin name. */
export const name = 'desktop-market'

/** Host services required by the market route surface. */
export const inject = ['webServer', 'desktopPnpm', 'desktopProfiles']

/**
 * Register the market HTTP API and package-installation job surface.
 * @param ctx - Host context carrying the Web carrier and desktop services.
 */
export function apply(ctx: Context): void {
  const profileDir = ctx.desktopProfiles.current.dir
  const profileName = ctx.desktopProfiles.current.name
  const sourcesDirectory = join(profileDir, '.harnessx-desktop', 'market')
  const sourcesPath = join(sourcesDirectory, 'sources.json')
  let sources: PluginSourceConfig[] = [...DEFAULT_SOURCES]
  const jobs = new Map<string, MarketJob>()
  const catalogCache = new Map<string, CatalogPluginCache>()

  const sourcesReady = readMarketSources(sourcesPath).catch((cause: unknown) => {
    ctx.logger.warn(`${BIN_NAME}: failed to read market sources; using defaults`)
    ctx.logger.warn(cause)
    return [...DEFAULT_SOURCES]
  }).then((loaded) => {
    sources = loaded
  })

  const persistSources = async (next: readonly PluginSourceConfig[]): Promise<void> => {
    await mkdir(sourcesDirectory, { recursive: true })
    await withFileLock(sourcesPath, () => writeFileAtomic(
      sourcesPath,
      `${JSON.stringify(next, null, 2)}\n`,
      { mode: 0o600, dirMode: 0o700 },
    ))
    sources = [...next]
  }

  ctx.effect(() => {
    const disposeSources = ctx.webServer.register({
      kind: 'exact',
      path: `${MARKET_ROUTE}/sources`,
      handler: async (request, response) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
          sendJson(response, 401, { error: 'unauthorized' })
          return
        }
        await sourcesReady
        if (request.method === 'GET') {
          sendJson(response, 200, { sources })
          return
        }
        if (request.method === 'POST') {
          try {
            const body = await readJsonBody(request)
            const nextSource = parseSourceConfig(body)
            const next = upsertSource(sources, nextSource)
            await persistSources(next)
            sendJson(response, 200, { sources })
          } catch (cause) {
            sendJson(response, 400, { error: errorMessage(cause) })
          }
          return
        }
        if (request.method === 'DELETE') {
          try {
            const id = readQuery(request).get('id')
            if (id === null || !isSourceId(id)) {
              sendJson(response, 400, { error: 'invalid or missing source id' })
              return
            }
            await persistSources(sources.filter(source => source.id !== id))
            sendJson(response, 200, { sources })
          } catch (cause) {
            sendJson(response, 400, { error: errorMessage(cause) })
          }
          return
        }
        sendJson(response, 405, { error: 'method not allowed' })
      },
    })

    const disposeCatalog = ctx.webServer.register({
      kind: 'exact',
      path: `${MARKET_ROUTE}/catalog`,
      handler: async (request, response) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
          sendJson(response, 401, { error: 'unauthorized' })
          return
        }
        await sourcesReady
        if (request.method !== 'GET') {
          sendJson(response, 405, { error: 'method not allowed' })
          return
        }
        try {
          const query = readQuery(request)
          const search = query.get('query') ?? ''
          const requestedSource = query.get('sourceId')
          if (requestedSource !== null && !isSourceId(requestedSource)) {
            throw new Error('invalid sourceId')
          }
          const limit = parseLimit(query.get('limit'))
          const offset = parseOffset(query.get('offset'))
          const activeSources = sources.filter(source => source.enabled
            && (requestedSource === null || source.id === requestedSource))
          const result = await collectCatalog(activeSources, search, { limit, offset }, catalogCache)
          sendJson(response, 200, result)
        } catch (cause) {
          sendJson(response, 400, { error: errorMessage(cause) })
        }
      },
    })

    const disposeInstall = ctx.webServer.register({
      kind: 'exact',
      path: `${MARKET_ROUTE}/install`,
      handler: async (request, response) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
          sendJson(response, 401, { error: 'unauthorized' })
          return
        }
        await sourcesReady
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'method not allowed' })
          return
        }
        try {
          const body = await readJsonBody(request)
          const install = parseInstallSpec(body.install)
          const label = parseOptionalJobLabel(body.label) ?? installLabel(install)
          ensureProfilePackage(profileDir, profileName)
          await ensureProfilePnpmWorkspace(profileDir)
          const githubPlan = install.startsWith('github:')
            ? await prepareGithubInstall(install, profileDir)
            : undefined
          const installSpec = githubPlan === undefined ? install : githubPlan.installSpec
          const job = enqueueJob(jobs, {
            action: 'install',
            label,
            target: install,
            start: () => ctx.desktopPnpm.run(['add', '--ignore-scripts', '--save-exact', installSpec]),
            captureBefore: () => readProfileManifest(BIN_NAME, profileDir),
            onSettled: async (outcome, before) => {
              if (outcome.exitCode === 0) reconcileProfileBundles(before, profileDir)
            },
          })
          sendJson(response, 202, { jobId: job.id, job: jobSnapshot(job) })
        } catch (cause) {
          sendJson(response, 400, { error: errorMessage(cause) })
        }
      },
    })

    const disposeInstalled = ctx.webServer.register({
      kind: 'exact',
      path: `${MARKET_ROUTE}/installed`,
      handler: async (request, response) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
          sendJson(response, 401, { error: 'unauthorized' })
          return
        }
        await sourcesReady
        if (request.method !== 'GET') {
          sendJson(response, 405, { error: 'method not allowed' })
          return
        }
        try {
          sendJson(response, 200, { plugins: await readInstalledPlugins(profileDir) })
        } catch (cause) {
          sendJson(response, 400, { error: errorMessage(cause) })
        }
      },
    })

    const disposeUninstall = ctx.webServer.register({
      kind: 'exact',
      path: `${MARKET_ROUTE}/uninstall`,
      handler: async (request, response) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
          sendJson(response, 401, { error: 'unauthorized' })
          return
        }
        await sourcesReady
        if (request.method !== 'POST') {
          sendJson(response, 405, { error: 'method not allowed' })
          return
        }
        try {
          const body = await readJsonBody(request)
          const pluginName = parsePluginName(body.name)
          ensureProfilePackage(profileDir, profileName)
          await ensureProfilePnpmWorkspace(profileDir)
          const job = enqueueJob(jobs, {
            action: 'uninstall',
            label: pluginName,
            target: pluginName,
            start: () => ctx.desktopPnpm.run(['remove', pluginName]),
            captureBefore: () => readProfileManifest(BIN_NAME, profileDir),
            onSettled: async (outcome, before) => {
              if (outcome.exitCode === 0) {
                reconcileProfileBundles(before, profileDir)
                assertPluginUninstalled(pluginName, profileDir)
              }
            },
          })
          sendJson(response, 202, { jobId: job.id, job: jobSnapshot(job) })
        } catch (cause) {
          sendJson(response, 400, { error: errorMessage(cause) })
        }
      },
    })

    const disposeJobs = ctx.webServer.register({
      kind: 'prefix',
      path: `${MARKET_ROUTE}/jobs`,
      handler: async (request, response) => {
        if (!ctx.desktopRuntime.authorizeLocalApiRequest(request)) {
          sendJson(response, 401, { error: 'unauthorized' })
          return
        }
        await sourcesReady
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        const suffix = pathname.slice(`${MARKET_ROUTE}/jobs`.length)
        const id = suffix.split('/').find(part => part.length > 0)
        if (id === undefined || !isJobId(id)) {
          if (request.method === 'GET') {
            sendJson(response, 200, { jobs: [...jobs.values()].map(jobSnapshot) })
            return
          }
          sendJson(response, 404, { error: 'job not found' })
          return
        }
        const job = jobs.get(id)
        if (job === undefined) {
          sendJson(response, 404, { error: 'job not found' })
          return
        }
        if (suffix.endsWith('/cancel') && request.method === 'POST') {
          requestJobCancel(job)
          sendJson(response, 200, jobSnapshot(job))
          return
        }
        if (request.method === 'GET') {
          sendJson(response, 200, jobSnapshot(job))
          return
        }
        sendJson(response, 405, { error: 'method not allowed' })
      },
    })

    return () => {
      disposeSources()
      disposeCatalog()
      disposeInstall()
      disposeInstalled()
      disposeUninstall()
      disposeJobs()
    }
  }, 'harnessx-desktop: market API routes')

  ctx.effect(() => async () => {
    for (const job of jobs.values()) {
      requestJobCancel(job)
    }
    await Promise.allSettled([...jobs.values()].map(async job => {
      if (job.handle === undefined) return
      await job.handle.done.catch(() => undefined)
    }))
    jobs.clear()
  }, 'harnessx-desktop: market job teardown')
}

/** Add one package-manager operation to the serialized job queue. */
function enqueueJob(jobs: Map<string, MarketJob>, operation: MarketOperation): MarketJob {
  const job: MarketJob = {
    id: randomUUID(),
    operation,
    handle: undefined,
    output: [],
    createdAt: new Date().toISOString(),
    startedAt: undefined,
    completedAt: undefined,
    pending: '',
    status: 'queued',
    exitCode: null,
    signal: null,
    cancelRequested: false,
  }
  jobs.set(job.id, job)
  pumpJobs(jobs)
  return job
}

/** Start the next queued job when no pnpm operation is active. */
function pumpJobs(jobs: Map<string, MarketJob>): void {
  if ([...jobs.values()].some(job => job.status === 'running')) return
  const job = [...jobs.values()].find(item => item.status === 'queued')
  if (job === undefined) return
  job.status = 'running'
  job.startedAt = new Date().toISOString()

  let handle: DesktopPnpmHandle
  let before: MarketProfileSnapshot
  try {
    before = job.operation.captureBefore()
    handle = job.operation.start()
  } catch (cause) {
    failJob(job, cause)
    pumpJobs(jobs)
    return
  }
  job.handle = handle

  const onData = (chunk: Buffer | string): void => {
    appendJobOutput(job, String(chunk))
  }
  handle.stdout.on('data', onData)
  handle.stderr.on('data', onData)
  void settleJob(job, handle, before, jobs)
}

/** Observe one running pnpm operation until it settles and continue the queue. */
async function settleJob(
  job: MarketJob,
  handle: DesktopPnpmHandle,
  before: MarketProfileSnapshot,
  jobs: Map<string, MarketJob>,
): Promise<void> {
  try {
    const outcome = await handle.done
    flushPendingJobOutput(job)
    job.exitCode = outcome.exitCode
    job.signal = outcome.signal
    if (job.cancelRequested) {
      job.status = 'cancelled'
    } else if (outcome.exitCode !== 0) {
      job.status = 'failed'
    } else {
      try {
        await job.operation.onSettled?.(outcome, before)
        job.status = 'success'
      } catch (cause) {
        job.output.push(errorMessage(cause))
        job.status = 'failed'
      }
    }
  } catch (cause) {
    flushPendingJobOutput(job)
    job.output.push(errorMessage(cause))
    job.status = 'failed'
  } finally {
    job.completedAt = new Date().toISOString()
    job.handle = undefined
    pumpJobs(jobs)
  }
}

/** Mark a job failed before its pnpm process could start. */
function failJob(job: MarketJob, cause: unknown): void {
  flushPendingJobOutput(job)
  job.output.push(errorMessage(cause))
  job.status = 'failed'
  job.completedAt = new Date().toISOString()
}

/** Request cancellation for either a queued or running job. */
function requestJobCancel(job: MarketJob): void {
  if (job.status === 'queued') {
    job.cancelRequested = true
    job.status = 'cancelled'
    job.completedAt = new Date().toISOString()
    return
  }
  if (job.status !== 'running') return
  job.cancelRequested = true
  job.handle?.cancel()
}

/** Flush any trailing partial output line into the job buffer. */
function flushPendingJobOutput(job: MarketJob): void {
  if (job.pending.length === 0) return
  job.output.push(job.pending)
  job.pending = ''
}

/** Append one stream chunk to a job's bounded line buffer. */
function appendJobOutput(job: MarketJob, chunk: string): void {
  const lines = `${job.pending}${chunk}`.split(/\r?\n/u)
  job.pending = lines.pop() ?? ''
  job.output.push(...lines)
  if (job.output.length > MAX_JOB_OUTPUT_LINES) {
    job.output.splice(0, job.output.length - MAX_JOB_OUTPUT_LINES)
  }
}

/** Convert one live job into its public snapshot. */
function jobSnapshot(job: MarketJob): MarketJobSnapshot {
  return {
    id: job.id,
    action: job.operation.action,
    status: job.status,
    label: job.operation.label,
    target: job.operation.target,
    exitCode: job.exitCode,
    signal: job.signal,
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
    output: [...job.output],
  }
}

/** Ensure the active desktop profile has a package manifest before pnpm mutates it. */
function ensureProfilePackage(profileDir: string, profileName: string): void {
  if (existsSync(join(profileDir, 'package.json'))) return
  initProfile(profileDir, PROFILE_TEMPLATES[profileName] ?? [])
}

/** Keep the profile pnpm workspace installable while denying dependency build scripts. */
export async function ensureProfilePnpmWorkspace(profileDir: string): Promise<void> {
  const workspacePath = join(profileDir, PROFILE_PNPM_WORKSPACE_FILENAME)
  let current = ''
  try {
    current = await readFile(workspacePath, 'utf8')
  } catch {
    current = ''
  }
  if (current.includes('strictDepBuilds: true') && !current.includes('allowBuilds:')) return
  await writeFile(
    workspacePath,
    [
      'packages:',
      '  - .',
      'nodeLinker: hoisted',
      'autoInstallPeers: false',
      'strictDepBuilds: true',
      '',
    ].join('\n'),
    'utf8',
  )
}

/** Whether an installed dependency declares a DSH profile bundle patch. */
function exportsProfilePatch(packageName: string, profileDir: string): boolean {
  try {
    const directory = resolveBundleDir(BIN_NAME, packageName, desktopInstallAnchor(), profileDir)
    return readProfileManifest(BIN_NAME, directory).dsh?.bundle?.patch !== undefined
  } catch {
    return false
  }
}

/**
 * Whether the installed package actually exposes its declared entry file.
 * Source-only GitHub checkouts installed with `--ignore-scripts` declare
 * `main: lib/index.js` but never build it; loading such a bundle breaks boot.
 */
function exportsLoadableEntry(packageName: string, profileDir: string): boolean {
  try {
    const directory = resolveBundleDir(BIN_NAME, packageName, desktopInstallAnchor(), profileDir)
    const raw = JSON.parse(readFileSync(join(directory, 'package.json'), 'utf8')) as { main?: unknown }
    const entry = typeof raw.main === 'string' && raw.main.length > 0 ? raw.main : 'index.js'
    return existsSync(join(directory, entry))
  } catch {
    return false
  }
}

/**
 * Reconcile `dsh.profile.bundles` after pnpm changes profile dependencies.
 * This mirrors the upstream `dsh plugin` reconciliation without spawning it
 * through a Windows shell, so no visible `cmd.exe` window is created.
 */
function reconcileProfileBundles(before: ReturnType<typeof readProfileManifest>, profileDir: string): void {
  const after = readProfileManifest(BIN_NAME, profileDir)
  const beforeDependencies = new Set(Object.keys(before.dependencies ?? {}))
  const dependencies = Object.keys(after.dependencies ?? {})
  const plugins = (after.dsh?.profile as { bundles?: unknown } | undefined)?.bundles
  const bundles = Array.isArray(plugins) && plugins.every(value => typeof value === 'string')
    ? plugins as string[]
    : []
  let changed = false
  for (const packageName of dependencies) {
    const isBundle = exportsProfilePatch(packageName, profileDir)
    if (!isBundle) continue
    if (bundles.includes(packageName)) continue
    if (!exportsLoadableEntry(packageName, profileDir)) {
      throw new Error(
        `plugin ${packageName} has no built entry file (its main is missing under the profile); `
        + 'it was not enabled. The plugin likely needs a prebuilt release instead of a source checkout.',
      )
    }
    bundles.push(packageName)
    changed = true
  }
  const dependencySet = new Set(dependencies)
  for (let index = bundles.length - 1; index >= 0; index -= 1) {
    const packageName = bundles[index]
    if (packageName === undefined) continue
    const wasDependency = beforeDependencies.has(packageName) || dependencySet.has(packageName)
    const stillBundle = dependencySet.has(packageName) && exportsProfilePatch(packageName, profileDir)
    if (wasDependency && !stillBundle) {
      bundles.splice(index, 1)
      changed = true
    }
  }
  if (!changed) return
  writeProfileManifest(profileDir, {
    ...after,
    dsh: {
      ...after.dsh,
      profile: {
        ...after.dsh?.profile,
        bundles,
      },
    },
  })
}

/**
 * Reject a nominally successful uninstall when pnpm or bundle reconciliation left residue.
 * @param pluginName - exact installed dependency name requested for removal.
 * @param profileDir - active profile directory containing package and bundle state.
 */
export function assertPluginUninstalled(pluginName: string, profileDir: string): void {
  const manifest = readProfileManifest(BIN_NAME, profileDir)
  if (Object.hasOwn(manifest.dependencies ?? {}, pluginName)) {
    throw new Error(`uninstall incomplete: dependency ${pluginName} is still installed`)
  }
  const configured = (manifest.dsh?.profile as { bundles?: unknown } | undefined)?.bundles
  if (Array.isArray(configured) && configured.includes(pluginName)) {
    throw new Error(`uninstall incomplete: bundle ${pluginName} is still enabled`)
  }
}

/** Read and validate the persisted source list while merging newly shipped defaults. */
export async function readMarketSources(filename: string): Promise<PluginSourceConfig[]> {
  let text: string
  try {
    text = await readFile(filename, 'utf8')
  } catch (cause) {
    if (isEnoent(cause)) return [...DEFAULT_SOURCES]
    throw cause
  }
  const value: unknown = JSON.parse(text)
  if (!Array.isArray(value)) throw new Error('market sources file must contain an array')
  const parsed: PluginSourceConfig[] = []
  for (const entry of value) {
    try {
      parsed.push(parseSourceConfig(entry))
    } catch {
      // Invalid rows are dropped so one bad entry does not disable the market.
    }
  }
  return mergeDefaultSources(parsed)
}

/** Add newly shipped defaults to an existing persisted source list. */
function mergeDefaultSources(current: readonly PluginSourceConfig[]): PluginSourceConfig[] {
  const next = [...current]
  for (const source of DEFAULT_SOURCES) {
    if (!next.some(entry => entry.id === source.id)) next.push({ ...source })
  }
  return next
}

/** Insert or replace one source while preserving array order. */
function upsertSource(
  current: readonly PluginSourceConfig[],
  nextSource: PluginSourceConfig,
): PluginSourceConfig[] {
  const at = current.findIndex(source => source.id === nextSource.id)
  if (at === -1) return [...current, nextSource]
  const next = [...current]
  next[at] = nextSource
  return next
}

/** Resolve every enabled source, filter, deduplicate, sort, and page the merged catalog. */
async function collectCatalog(
  sources: readonly PluginSourceConfig[],
  query: string,
  page: { readonly limit: number; readonly offset: number },
  cache: Map<string, CatalogPluginCache>,
): Promise<MarketCatalogResult> {
  const plugins: MarketPlugin[] = []
  const errors: MarketSourceError[] = []
  const controller = new AbortController()
  const timeout = setTimeout(() => { controller.abort() }, REQUEST_TIMEOUT_MS)
  try {
    const settled = await Promise.allSettled(sources.map(async (source) => {
      const resolved = await resolveCachedSource(source, query, controller.signal, cache)
      plugins.push(...resolved)
    }))
    settled.forEach((result, index) => {
      if (result.status === 'fulfilled') return
      const source = sources[index]
      if (source !== undefined) {
        errors.push({
          sourceId: source.id,
          sourceName: source.name,
          message: errorMessage(result.reason),
        })
      }
    })
  } finally {
    clearTimeout(timeout)
  }
  const matched = filterPlugins(plugins, query)
  const deduped = dedupePlugins(matched)
  const sorted = sortPlugins(deduped)
  return {
    plugins: sorted.slice(page.offset, page.offset + page.limit),
    errors,
    total: sorted.length,
    offset: page.offset,
    limit: page.limit,
  }
}

/** Resolve one source through the short-lived manifest cache. */
async function resolveCachedSource(
  source: PluginSourceConfig,
  query: string,
  signal: AbortSignal,
  cache: Map<string, CatalogPluginCache>,
): Promise<MarketPlugin[]> {
  if (source.kind !== 'npm') {
    const cached = cache.get(source.id)
    if (cached !== undefined && cached.expiresAt > Date.now()) return cached.plugins
  }
  const plugins = await resolveSource(source, query, signal)
  if (source.kind !== 'npm') {
    cache.set(source.id, { expiresAt: Date.now() + CATALOG_CACHE_TTL_MS, plugins })
  }
  return plugins
}

/** Dispatch one source to its configured adapter. */
async function resolveSource(
  source: PluginSourceConfig,
  query: string,
  signal: AbortSignal,
): Promise<MarketPlugin[]> {
  switch (source.kind) {
    case 'npm': return resolveNpmSource(source, query, signal)
    case 'manifest': return resolveManifestSource(source, signal)
    case 'github': return resolveGithubSource(source, signal)
    case 'local': return resolveLocalSource(source)
  }
}

/** Search an npm-compatible registry and map matching packages to market entries. */
async function resolveNpmSource(
  source: PluginSourceConfig,
  query: string,
  signal: AbortSignal,
): Promise<MarketPlugin[]> {
  const registry = source.url.replace(/\/+$/u, '')
  const url = new URL('/-/v1/search', `${registry}/`)
  url.searchParams.set('text', query.length > 0 ? query : DEFAULT_NPM_QUERY)
  url.searchParams.set('size', '50')
  const value = await fetchJson(url, signal)
  if (!isRecord(value) || !Array.isArray(value.objects)) {
    throw new Error('npm search response did not contain an objects array')
  }
  const plugins: MarketPlugin[] = []
  for (const object of value.objects) {
    if (!isRecord(object) || !isRecord(object.package)) continue
    const pkg = object.package
    if (typeof pkg.name !== 'string' || pkg.name.length === 0) continue
    const scoreDetail = isRecord(pkg.score) && isRecord(pkg.score.detail) ? pkg.score.detail : undefined
    plugins.push({
      id: pkg.name,
      name: pkg.name,
      description: optionalString(pkg.description),
      version: optionalString(pkg.version),
      author: optionalString(isRecord(pkg.publisher) ? pkg.publisher.username : undefined),
      homepage: optionalString(isRecord(pkg.links) ? pkg.links.homepage : undefined),
      repository: optionalString(isRecord(pkg.links) ? pkg.links.repository : undefined),
      install: pkg.name,
      tags: Array.isArray(pkg.keywords)
        ? pkg.keywords.filter((keyword): keyword is string => typeof keyword === 'string')
        : undefined,
      stars: optionalNumber(scoreDetail?.popularity),
      category: undefined,
      license: optionalString(pkg.license),
      updatedAt: undefined,
      sourceId: source.id,
      sourceName: source.name,
      sourceKind: source.kind,
    })
  }
  return plugins
}

/** Fetch one remote JSON manifest and map its plugins to market entries. */
async function resolveManifestSource(
  source: PluginSourceConfig,
  signal: AbortSignal,
): Promise<MarketPlugin[]> {
  const manifest = parseMarketManifest(await fetchJson(new URL(source.url), signal))
  return manifest.plugins.map(plugin => ({
    ...plugin,
    sourceId: source.id,
    sourceName: source.name,
    sourceKind: source.kind,
  }))
}

/** Load a `dsh-market.json` manifest from a public GitHub repository. */
async function resolveGithubSource(
  source: PluginSourceConfig,
  signal: AbortSignal,
): Promise<MarketPlugin[]> {
  const repository = parseGitHubRepository(source.url)
  const url = new URL(`https://api.github.com/repos/${repository}/contents/dsh-market.json`)
  const text = await fetchText(url, signal, {
    accept: 'application/vnd.github.raw+json',
  })
  const manifest = parseMarketManifest(JSON.parse(text))
  return manifest.plugins.map(plugin => ({
    ...plugin,
    sourceId: source.id,
    sourceName: source.name,
    sourceKind: source.kind,
  }))
}

/** Load a `dsh-market.json` or `market.json` manifest from the local filesystem. */
async function resolveLocalSource(source: PluginSourceConfig): Promise<MarketPlugin[]> {
  const candidates = source.url.endsWith('.json')
    ? [source.url]
    : [join(source.url, 'dsh-market.json'), join(source.url, 'market.json')]
  let lastError: unknown
  for (const filename of candidates) {
    try {
      const manifest = parseMarketManifest(JSON.parse(await readFile(filename, 'utf8')))
      return manifest.plugins.map(plugin => ({
        ...plugin,
        sourceId: source.id,
        sourceName: source.name,
        sourceKind: source.kind,
      }))
    } catch (cause) {
      lastError = cause
      if (!isEnoent(cause)) break
    }
  }
  throw lastError ?? new Error('local market manifest not found')
}

/** Fetch and parse a JSON response with a bounded body. */
async function fetchJson(url: URL, signal: AbortSignal): Promise<unknown> {
  return JSON.parse(await fetchText(url, signal, { accept: 'application/json' }))
}

/** Fetch one URL as UTF-8 text with a bounded body and explicit accept header. */
async function fetchText(
  url: URL,
  signal: AbortSignal,
  headers: { accept: string },
): Promise<string> {
  const response = await fetch(url, { signal, headers })
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`)
  }
  const text = await response.text()
  if (text.length > MAX_FETCH_BODY_BYTES) {
    throw new Error('response body is too large')
  }
  return text
}

/** Parse either a version 1 manifest or one of the known marketplace document shapes. */
export function parseMarketManifest(value: unknown): MarketManifest {
  if (!isRecord(value)) throw new Error('market manifest must be an object')
  if (value.version === 1 && Array.isArray(value.plugins)) {
    if (value.plugins.length === 0) throw new Error('market manifest plugin array is empty')
    return {
      version: 1,
      plugins: value.plugins.map(parseManifestPlugin) as MarketManifestPlugin[],
    }
  }
  if (Array.isArray(value.plugins)) {
    if (value.plugins.length === 0) throw new Error('market manifest plugin array is empty')
    const first = value.plugins[0]
    if (isRecord(first)) {
      if (isRegistryPluginShape(first)) {
        return { version: 1, plugins: parseMany(value.plugins, parseRegistryPlugin, 'registry plugin list') }
      }
      if (isAwesomePluginShape(first)) {
        return { version: 1, plugins: parseMany(value.plugins, parseAwesomePlugin, 'awesome plugin list') }
      }
    }
    return { version: 1, plugins: parseMany(value.plugins, parseManifestPlugin, 'plugin list') }
  }
  if (Array.isArray(value.entries)) {
    return { version: 1, plugins: parseMany(value.entries, parseMarketplaceEntry, 'marketplace entries') }
  }
  if (Array.isArray(value.repos)) {
    return { version: 1, plugins: parseMany(value.repos, parseRepoPlugin, 'repository list') }
  }
  throw new Error('market manifest must contain plugins, entries, or repos')
}

/** Validate one legacy version 1 manifest plugin entry. */
function parseManifestPlugin(value: unknown): MarketManifestPlugin | undefined {
  if (!isRecord(value)) throw new Error('market plugin entry must be an object')
  const id = parseNonEmptyString(value.id, 'plugin id')
  const name = parseNonEmptyString(value.name, 'plugin name')
  const install = parseInstallSpec(value.install)
  return {
    id,
    name,
    description: optionalString(value.description),
    version: optionalString(value.version),
    author: optionalString(value.author),
    homepage: optionalString(value.homepage),
    repository: optionalString(value.repository),
    install,
    tags: optionalStringArray(value.tags),
    stars: optionalNumber(value.stars),
    category: optionalString(value.category),
    license: optionalString(value.license),
    updatedAt: optionalString(value.updatedAt),
  }
}

/** Detect the Awesome DSH Plugins row shape without relying on a schema version. */
function isAwesomePluginShape(value: Record<string, unknown>): boolean {
  return typeof value.owner === 'string'
    || typeof value.npm === 'string'
    || typeof value.page === 'string'
    || isRecord(value.description)
}

/** Parse one Awesome DSH Plugins row. */
function parseAwesomePlugin(value: unknown): MarketManifestPlugin | undefined {
  if (!isRecord(value)) return undefined
  const name = optionalString(value.name)
  if (name === undefined) return undefined
  const owner = optionalString(value.owner)
  const repository = optionalString(value.url)
  // Source-only checkouts cannot load under `--ignore-scripts`; only rows
  // naming a published npm package are installable, so filter the rest out.
  const install = optionalString(value.npm)
  if (install === undefined) return undefined
  const id = owner === undefined ? name : `${owner}/${name}`
  return {
    id,
    name,
    description: marketplaceDescription(value.description),
    version: undefined,
    author: owner,
    homepage: optionalString(value.page),
    repository,
    install,
    tags: optionalString(value.category) === undefined ? undefined : [optionalString(value.category) as string],
    stars: optionalNumber(value.stars),
    category: optionalString(value.category),
    license: undefined,
    updatedAt: optionalString(value.added),
  }
}

/** Detect the YELEBAI registry row shape. */
function isRegistryPluginShape(value: Record<string, unknown>): boolean {
  return typeof value.fullName === 'string' || isRecord(value.install)
}

/** Parse one YELEBAI registry plugin row. */
function parseRegistryPlugin(value: unknown): MarketManifestPlugin | undefined {
  if (!isRecord(value)) return undefined
  const fullName = optionalString(value.fullName)
  if (fullName === undefined) return undefined
  const installRecord = isRecord(value.install) ? value.install : undefined
  if (installRecord !== undefined && installRecord.mode !== 'automatic') return undefined
  const name = optionalString(value.packageName)
    ?? optionalString(value.repo)
    ?? fullName.split('/').at(-1)
    ?? fullName
  // Only npm-backed rows are installable: published releases carry built
  // artifacts, while source checkouts under `--ignore-scripts` do not and
  // cannot load, so source-only rows are filtered out of the catalog.
  const packageName = optionalString(value.packageName)
  if (packageName === undefined) return undefined
  const installRecordSpec = installRecord === undefined ? undefined : optionalString(installRecord.spec)
  const install = installRecordSpec !== undefined && !installRecordSpec.startsWith('github:')
    ? installRecordSpec
    : packageName
  if (install === undefined) return undefined
  return {
    id: fullName,
    name,
    description: optionalString(value.description),
    version: optionalString(value.version),
    author: optionalString(value.owner),
    homepage: undefined,
    repository: optionalString(value.htmlUrl),
    install,
    tags: optionalStringArray(value.topics),
    stars: optionalNumber(value.stars),
    category: undefined,
    license: optionalString(value.license),
    updatedAt: optionalString(value.updatedAt),
  }
}

/** Parse one DSH Plugin Marketplace entry with its repository/package metadata. */
function parseMarketplaceEntry(value: unknown): MarketManifestPlugin | undefined {
  if (!isRecord(value)) return undefined
  if (value.installability === 'manual') return undefined
  const repository = isRecord(value.repository) ? value.repository : undefined
  const pkg = isRecord(value.package) ? value.package : undefined
  if (repository === undefined || pkg === undefined) return undefined
  const fullName = optionalString(repository.fullName)
  if (fullName === undefined) return undefined
  const packageName = optionalString(pkg.name)
  const name = packageName ?? fullName.split('/').at(-1) ?? fullName
  // Only npm-backed rows are installable; source-only checkouts are filtered.
  if (packageName === undefined) return undefined
  const install = packageName
  return {
    id: fullName,
    name,
    description: optionalString(pkg.description),
    version: optionalString(pkg.version),
    author: optionalString(pkg.author),
    homepage: undefined,
    repository: optionalString(repository.url),
    install,
    tags: optionalStringArray(value.keywords ?? value.topics),
    stars: optionalNumber(value.stars),
    category: optionalString(value.compatibility),
    license: optionalString(pkg.license),
    updatedAt: optionalString(value.lastCodePushAt ?? value.indexedAt),
  }
}

/** Parse one GitHub-repository marketplace row. */
function parseRepoPlugin(value: unknown): MarketManifestPlugin | undefined {
  if (!isRecord(value)) return undefined
  if (value.installable === 'non-plugin' || value.installable === 'manual') return undefined
  const fullName = optionalString(value.full_name)
  if (fullName === undefined) return undefined
  // Only npm-backed rows are installable; source-only checkouts are filtered.
  const packageName = optionalString(value.pkg_name)
  if (packageName === undefined) return undefined
  const name = packageName
    ?? optionalString(value.name)
    ?? fullName.split('/').at(-1)
    ?? fullName
  const install = packageName
  return {
    id: fullName,
    name,
    description: optionalString(value.description),
    version: optionalString(value.version),
    author: fullName.split('/')[0],
    homepage: undefined,
    repository: optionalString(value.html_url),
    install,
    tags: optionalStringArray(value.topics ?? value.market_tags),
    stars: optionalNumber(value.stargazers_count),
    category: optionalString(value.category),
    license: optionalString(value.license),
    updatedAt: optionalString(value.updated_at),
  }
}

/** Parse many source rows while dropping malformed rows and preserving a useful failure. */
function parseMany(
  values: unknown[],
  parser: (value: unknown) => MarketManifestPlugin | undefined,
  label: string,
): MarketManifestPlugin[] {
  const plugins: MarketManifestPlugin[] = []
  for (const value of values) {
    try {
      const plugin = parser(value)
      if (plugin !== undefined) plugins.push(plugin)
    } catch {
      // A single malformed row must not disable an entire marketplace source.
    }
  }
  if (plugins.length === 0 && values.length > 0) {
    throw new Error(`${label} contains no valid plugin entries`)
  }
  return plugins
}

/** Return the most useful description from either a string or localized object. */
function marketplaceDescription(value: unknown): string | undefined {
  if (typeof value === 'string') return optionalString(value)
  if (!isRecord(value)) return undefined
  return optionalString(value.zh)
    ?? optionalString(value.en)
    ?? Object.values(value).find(entry => typeof entry === 'string')
}

/** Filter merged plugins against a case-insensitive free-text query. */
function filterPlugins(plugins: readonly MarketPlugin[], query: string): MarketPlugin[] {
  const needle = query.trim().toLocaleLowerCase()
  if (needle.length === 0) return [...plugins]
  return plugins.filter(plugin => {
    const haystack = [
      plugin.name,
      plugin.id,
      plugin.description,
      plugin.author,
      plugin.category,
      ...(plugin.tags ?? []),
    ].filter((value): value is string => typeof value === 'string').join(' ').toLocaleLowerCase()
    return haystack.includes(needle)
  })
}

/** Remove duplicate install specifications while preserving the most popular entry. */
function dedupePlugins(plugins: readonly MarketPlugin[]): MarketPlugin[] {
  const seen = new Set<string>()
  const result: MarketPlugin[] = []
  for (const plugin of plugins) {
    const key = plugin.install
    if (seen.has(key)) continue
    seen.add(key)
    result.push(plugin)
  }
  return result
}

/** Sort plugins by popularity then name so marketplace pages feel curated. */
function sortPlugins(plugins: readonly MarketPlugin[]): MarketPlugin[] {
  return [...plugins].sort((left, right) => {
    const stars = (right.stars ?? 0) - (left.stars ?? 0)
    if (stars !== 0) return stars
    return left.name.localeCompare(right.name)
  })
}

/** Read the third-party plugins installed in the active profile. */
async function readInstalledPlugins(profileDir: string): Promise<MarketInstalledPlugin[]> {
  const manifestPath = join(profileDir, 'package.json')
  let manifestText: string
  try {
    manifestText = await readFile(manifestPath, 'utf8')
  } catch (cause) {
    if (isEnoent(cause)) return []
    throw cause
  }
  const manifest: unknown = JSON.parse(manifestText)
  if (!isRecord(manifest)) return []
  const dsh = isRecord(manifest.dsh) ? manifest.dsh : undefined
  const profile = isRecord(dsh?.profile) ? dsh.profile : undefined
  const bundles = Array.isArray(profile?.bundles)
    ? profile.bundles.filter((bundle): bundle is string => typeof bundle === 'string')
    : []
  const dependencies = isRecord(manifest.dependencies) ? manifest.dependencies : {}
  const result: MarketInstalledPlugin[] = []
  const seen = new Set<string>()
  for (const name of desktopThirdPartyBundles(bundles)) {
    if (seen.has(name)) continue
    seen.add(name)
    result.push({
      name,
      requested: optionalString(dependencies[name]),
      version: await installedPluginVersion(profileDir, name),
    })
  }
  return result
}

/** Resolve the installed package version from the profile `node_modules`. */
async function installedPluginVersion(profileDir: string, name: string): Promise<string | undefined> {
  try {
    const manifestPath = join(profileDir, 'node_modules', ...name.split('/'), 'package.json')
    const value: unknown = JSON.parse(await readFile(manifestPath, 'utf8'))
    return isRecord(value) ? optionalString(value.version) : undefined
  } catch {
    return undefined
  }
}

/** Parse and validate one source configuration object. */
export function parseSourceConfig(value: unknown): PluginSourceConfig {
  if (!isRecord(value)) throw new Error('source must be an object')
  const id = parseSourceId(value.id)
  const name = parseNonEmptyString(value.name, 'source name')
  const kind = parseSourceKind(value.kind)
  const url = parseNonEmptyString(value.url, 'source url')
  validateSourceUrl(kind, url)
  return {
    id,
    name,
    kind,
    url,
    enabled: value.enabled === undefined ? true : Boolean(value.enabled),
  }
}

/** Validate a source identifier used in query strings and filenames. */
function parseSourceId(value: unknown): string {
  if (typeof value !== 'string' || !isSourceId(value)) {
    throw new Error('source id must be 1-64 letters, numbers, dot, dash, or underscore')
  }
  return value
}

function isSourceId(value: string): boolean {
  return /^[a-z0-9][a-z0-9._-]{0,63}$/u.test(value)
}

function parseSourceKind(value: unknown): PluginSourceKind {
  if (value !== 'npm' && value !== 'manifest' && value !== 'github' && value !== 'local') {
    throw new Error('source kind must be npm, manifest, github, or local')
  }
  return value
}

function validateSourceUrl(kind: PluginSourceKind, url: string): void {
  if (kind === 'local') {
    if (!isAbsolute(url) || /[\0\r\n]/u.test(url)) {
      throw new Error('local source url must be an absolute path without control characters')
    }
    return
  }
  if (kind === 'github') {
    parseGitHubRepository(url)
    return
  }
  const parsed = new URL(url)
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('source url must use http or https')
  }
}

/** Parsed `github:owner/repo#ref` install specification. */
interface GithubInstallSpec {
  /** GitHub owner or organization name. */
  owner: string
  /** GitHub repository name. */
  repo: string
  /** Optional commit hash, branch, or tag. */
  ref: string | undefined
}

/** Parse a GitHub package specification used by market catalog entries. */
function parseGithubInstallSpec(install: string): GithubInstallSpec {
  const match = /^github:([\w.-]+)\/([\w.-]+)(?:#([^\s#]+))?$/u.exec(install)
  const owner = match?.[1]
  const repo = match?.[2]
  if (match === null || owner === undefined || repo === undefined) {
    throw new Error(`invalid github install specification: ${install}`)
  }
  return { owner, repo, ref: match[3] }
}

/** Terminate a Git process tree without spawning a visible Windows shell. */
function terminateGitTree(child: ReturnType<typeof spawn>): void {
  if (process.platform !== 'win32' || child.pid === undefined) {
    child.kill()
    return
  }
  const killer = spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], {
    shell: false,
    windowsHide: true,
    stdio: 'ignore',
  })
  killer.on('error', () => { child.kill() })
}

/** Run a Git command without spawning a visible Windows shell. */
function runGitCloneProcess(args: readonly string[], cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', [...args], {
      cwd,
      shell: false,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    let output = ''
    const append = (chunk: Buffer | string): void => {
      const text = String(chunk)
      if (Buffer.byteLength(output) + Buffer.byteLength(text) <= GIT_CLONE_MAX_OUTPUT_BYTES) {
        output += text
      }
    }
    child.stdout?.on('data', append)
    child.stderr?.on('data', append)
    const timeout = setTimeout(() => {
      terminateGitTree(child)
      reject(new Error('git clone timed out'))
    }, GIT_CLONE_TIMEOUT_MS)
    child.on('error', (cause) => {
      clearTimeout(timeout)
      reject(cause)
    })
    child.on('close', (code, signal) => {
      clearTimeout(timeout)
      if (code === 0) {
        resolve()
        return
      }
      reject(new Error(output.trim() || `git clone exited with ${signal ?? String(code)}`))
    })
  })
}

/** Resolved installation plan for a `github:` spec. */
interface GithubInstallPlan {
  /** Spec handed to pnpm: a local `file:` URL or an npm `name@version`. */
  installSpec: string
  /** True when the source checkout had no built entry and npm publishes one. */
  fallbackToNpm: boolean
}

/**
 * Clone a GitHub plugin into a stable profile-owned directory.
 * Source-only repositories (no built entry file, since `--ignore-scripts`
 * never runs their build) transparently fall back to the author's published
 * npm package, which carries the built artifacts.
 */
async function prepareGithubInstall(install: string, profileDir: string): Promise<GithubInstallPlan> {
  const { owner, repo, ref } = parseGithubInstallSpec(install)
  const cloneUrl = `https://github.com/${owner}/${repo}.git`
  const pluginsDir = join(profileDir, '.harnessx-desktop', 'plugins')
  const finalTarget = join(pluginsDir, `${owner}-${repo}`)
  const stagingTarget = join(pluginsDir, `.${owner}-${repo}-${randomUUID()}`)
  await mkdir(pluginsDir, { recursive: true })
  try {
    if (ref === undefined) {
      await runGitCloneProcess(['clone', '--depth', '1', '--filter=blob:none', cloneUrl, stagingTarget], pluginsDir)
    } else {
      await runGitCloneProcess(['clone', '--filter=blob:none', '--no-checkout', cloneUrl, stagingTarget], pluginsDir)
      await runGitCloneProcess(['-C', stagingTarget, 'checkout', '--detach', ref], stagingTarget)
    }
    await assertDshPluginDirectory(stagingTarget)
    const manifest = JSON.parse(await readFile(join(stagingTarget, 'package.json'), 'utf8')) as {
      name?: unknown
      version?: unknown
      main?: unknown
    }
    const entry = typeof manifest.main === 'string' && manifest.main.length > 0 ? manifest.main : 'index.js'
    const hasBuiltEntry = existsSync(join(stagingTarget, entry))
    let installSpec: string
    if (hasBuiltEntry) {
      installSpec = ''
    } else {
      const name = typeof manifest.name === 'string' ? manifest.name : ''
      if (name.length === 0) {
        throw new Error('github plugin ships no built entry file and declares no package name for an npm fallback')
      }
      installSpec = await resolveNpmFallbackSpec(
        name,
        typeof manifest.version === 'string' ? manifest.version : undefined,
      )
    }
    await rm(finalTarget, { recursive: true, force: true })
    await rename(stagingTarget, finalTarget)
    return {
      installSpec: hasBuiltEntry ? pathToFileURL(finalTarget).href : installSpec,
      fallbackToNpm: !hasBuiltEntry,
    }
  } catch (cause) {
    await rm(stagingTarget, { recursive: true, force: true }).catch(() => undefined)
    throw cause
  }
}

/** Find the author's published npm release for a source-only GitHub checkout. */
async function resolveNpmFallbackSpec(name: string, version: string | undefined): Promise<string> {
  const url = new URL(`https://registry.npmjs.org/${encodeURIComponent(name)}`)
  let body: unknown
  try {
    body = await fetchJson(url, AbortSignal.timeout(15_000))
  } catch {
    throw new Error(
      `github repository ships no built entry file and ${name} could not be resolved on npm; `
      + 'install the npm release instead',
    )
  }
  if (!isRecord(body)) {
    throw new Error(`npm registry returned an unexpected document for ${name}`)
  }
  const versions = isRecord(body.versions) ? body.versions : {}
  const distTags = isRecord(body['dist-tags']) ? body['dist-tags'] : {}
  const requested = version !== undefined && versions[version] !== undefined ? version : undefined
  const latest = typeof distTags.latest === 'string' ? distTags.latest : undefined
  const chosen = requested ?? latest ?? Object.keys(versions).at(-1)
  if (chosen === undefined) {
    throw new Error(
      `github repository ships no built entry file and ${name} has no npm releases; `
      + 'the plugin needs a prebuilt release before it can be installed',
    )
  }
  return `${name}@${chosen}`
}

/** Reject a repository that does not declare a loadable DeepSeek Harness bundle. */
export async function assertDshPluginDirectory(directory: string): Promise<void> {
  let manifest: unknown
  try {
    manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8')) as unknown
  } catch {
    throw new Error('repository is not a DeepSeek Harness plugin: package.json with dsh.bundle.patch is required')
  }
  const dsh = isRecord(manifest) && isRecord(manifest.dsh) ? manifest.dsh : undefined
  const bundle = isRecord(dsh?.bundle) ? dsh.bundle : undefined
  const patch = optionalString(bundle?.patch)
  if (patch === undefined) {
    throw new Error('repository is not a DeepSeek Harness plugin: package.json with dsh.bundle.patch is required')
  }
}

function parseInstallSpec(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 500) {
    throw new Error('install must be a non-empty package specification of at most 500 characters')
  }
  if (/[\0\r\n]/u.test(value)) {
    throw new Error('install must not contain control characters')
  }
  return value.trim()
}

function parsePluginName(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
    throw new Error('plugin name must be a non-empty string of at most 200 characters')
  }
  if (/[\0\r\n]/u.test(value)) {
    throw new Error('plugin name must not contain control characters')
  }
  return value.trim()
}

/** Parse an optional job label supplied by the client. */
function parseOptionalJobLabel(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
    throw new Error('label must be a string of at most 200 characters')
  }
  if (/[\0\r\n]/u.test(value)) {
    throw new Error('label must not contain control characters')
  }
  return value.trim()
}

/** Derive a readable job title from a package specification when no label was supplied. */
function installLabel(install: string): string {
  if (install.startsWith('github:')) {
    return parseGithubInstallSpec(install).repo
  }
  if (install.startsWith('file:')) {
    const path = install.slice('file:'.length).replace(/^\/+/u, '')
    return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? install
  }
  return install
}

function parseNonEmptyString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > 200) {
    throw new Error(`${label} must be a non-empty string of at most 200 characters`)
  }
  return value.trim()
}

function parseLimit(value: string | null): number {
  if (value === null) return DEFAULT_CATALOG_LIMIT
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > MAX_CATALOG_LIMIT) {
    throw new Error(`limit must be an integer from 1 to ${MAX_CATALOG_LIMIT}`)
  }
  return parsed
}

function parseOffset(value: string | null): number {
  if (value === null) return 0
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error('offset must be a non-negative integer')
  }
  return parsed
}

/** Parse an owner/repository pair from common GitHub repository URL forms. */
export function parseGitHubRepository(value: string): string {
  const match = /^https?:\/\/github\.com\/([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/iu.exec(value)
  if (match === null) throw new Error('github source url must be a GitHub repository URL')
  const repository = match[1]
  if (repository === undefined || !/^[\w.-]+\/[\w.-]+$/u.test(repository)) {
    throw new Error('github source url has an invalid repository path')
  }
  return repository
}

function isJobId(value: string): boolean {
  return /^[0-9a-f-]{36}$/u.test(value)
}

async function readJsonBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.byteLength
    if (size > MAX_JSON_BODY_BYTES) throw new Error('request body is too large')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  const value: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
  if (!isRecord(value)) throw new Error('request body must be a JSON object')
  return value
}

function readQuery(request: IncomingMessage): URLSearchParams {
  return new URL(request.url ?? '/', 'http://localhost').searchParams
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8' })
  response.end(JSON.stringify(value))
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function optionalStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const strings = value.filter((entry): entry is string => typeof entry === 'string')
  return strings.length > 0 ? strings : undefined
}

function isEnoent(value: unknown): boolean {
  return isRecord(value) && value.code === 'ENOENT'
}
