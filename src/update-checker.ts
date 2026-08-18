/** Headless version checks against the public HarnessX GitHub releases. */

/** Public GitHub API endpoint returning the latest public HarnessX release. */
export const DESKTOP_VERSION_ENDPOINT = 'https://api.github.com/repos/coffeefreehans/HarnessX/releases/latest'

/** Public GitHub repository URL for HarnessX releases. */
export const DESKTOP_RELEASES_URL = 'https://github.com/coffeefreehans/HarnessX/releases'

/** Maximum response body bytes accepted from the GitHub release API. */
export const MAX_VERSION_RESPONSE_BYTES = 1024 * 1024

/** Parsed release-version components. Numeric components remain strings to avoid overflow. */
export interface ParsedSemVer {
  /** Canonical version without the optional leading `v`. */
  readonly version: string
  /** Major numeric identifier. */
  readonly major: string
  /** Minor numeric identifier. */
  readonly minor: string
  /** Patch numeric identifier; omitted two-part versions compare as patch zero. */
  readonly patch: string
  /** Ordered prerelease identifiers, or an empty list for a stable version. */
  readonly prerelease: readonly string[]
  /** Build identifiers, ignored for version precedence. */
  readonly build: readonly string[]
}

/** Release asset metadata accepted from GitHub. */
export interface UpdateReleaseAsset {
  /** File name shown on the GitHub Release asset. */
  readonly name: string
  /** Browser download URL supplied by GitHub for this asset. */
  readonly downloadUrl: string
}

/** Public release metadata used by checker, downloader, and settings UI. */
export interface UpdateReleaseInfo {
  /** Canonical stable version parsed from the release tag. */
  readonly version: string
  /** Original GitHub release tag. */
  readonly tagName: string
  /** User-visible GitHub release title. */
  readonly releaseName: string
  /** Plain-text release notes from GitHub. */
  readonly releaseNotes: string
  /** ISO timestamp when GitHub published the release. */
  readonly publishedAt: string
  /** Browser URL for the GitHub release page. */
  readonly releaseUrl: string
  /** Downloadable assets attached to the release. */
  readonly assets: readonly UpdateReleaseAsset[]
}

/** Fetch-compatible request function used by the headless checker. */
export type UpdateRequest = (url: string, init: RequestInit) => Promise<Response>

/** Inputs for one stable version check. */
export interface UpdateCheckOptions {
  /** Installed application version, expressed as canonical stable SemVer. */
  readonly currentVersion: string
  /** Caller-owned cancellation signal; the checker does not create its own timeout. */
  readonly signal?: AbortSignal
  /** Optional fetch implementation for a host adapter or test. */
  readonly request?: UpdateRequest
}

/** Successful comparison returned by the stable version service. */
export type UpdateCheckResult = {
  /** Whether GitHub reports a version newer than the installed application. */
  readonly status: 'up-to-date' | 'update-available'
  /** Canonical installed stable version. */
  readonly currentVersion: string
  /** Canonical latest stable version returned by GitHub. */
  readonly latestVersion: string
  /** Public release metadata for the latest stable GitHub release. */
  readonly release: UpdateReleaseInfo
}

const RELEASE_VERSION_PATTERN =
  /^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(?:\.(0|[1-9][0-9]*))?(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/u

/**
 * Parse a two- or three-part release version with an optional lowercase `v` prefix.
 * @param input - complete version or release tag.
 * @returns parsed identifiers, or null when the input is not valid SemVer.
 */
export function parseSemVer(input: string): ParsedSemVer | null {
  const version = input.startsWith('v') ? input.slice(1) : input
  const match = RELEASE_VERSION_PATTERN.exec(version)
  if (match === null) return null

  const prerelease = match[4]?.split('.') ?? []
  if (prerelease.some(identifier => isNumeric(identifier) && hasLeadingZero(identifier))) return null

  return {
    version,
    major: match[1]!,
    minor: match[2]!,
    patch: match[3] ?? '0',
    prerelease,
    build: match[5]?.split('.') ?? [],
  }
}

/**
 * Compare two strict SemVer strings without numeric overflow.
 * @param left - first strict SemVer value.
 * @param right - second strict SemVer value.
 * @returns negative, zero, or positive precedence, or null when either value is invalid.
 */
export function compareSemVerVersions(left: string, right: string): number | null {
  const leftVersion = parseSemVer(left)
  const rightVersion = parseSemVer(right)
  if (leftVersion === null || rightVersion === null) return null
  return compareParsedSemVer(leftVersion, rightVersion)
}

/**
 * Check the fixed HarnessX GitHub release endpoint for a newer stable release.
 * @param options - installed version, caller-owned signal, and optional request adapter.
 * @returns a successful comparison, or null when any request or validation step fails.
 */
export async function checkForStableUpdate(
  options: UpdateCheckOptions,
): Promise<UpdateCheckResult | null> {
  const current = parseCanonicalStableVersion(options.currentVersion)
  if (current === null) return null

  const release = await fetchLatestStableRelease({
    request: options.request ?? defaultRequest,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (release === null) return null

  const latest = parseCanonicalStableVersion(release.version)
  if (latest === null) return null
  return {
    status: compareParsedSemVer(latest, current) > 0 ? 'update-available' : 'up-to-date',
    currentVersion: current.version,
    latestVersion: latest.version,
    release,
  }
}

/**
 * Fetch and parse the latest public GitHub release.
 * @param options - request adapter and optional cancellation signal.
 * @returns stable release metadata, or null for invalid/unavailable responses.
 */
export async function fetchLatestStableRelease(options: {
  /** Request adapter used by Electron or tests. */
  readonly request?: UpdateRequest
  /** Optional caller-owned cancellation signal. */
  readonly signal?: AbortSignal
} = {}): Promise<UpdateReleaseInfo | null> {
  const init: RequestInit = {
    method: 'GET',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    cache: 'no-store',
    redirect: 'error',
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  }
  const request = options.request ?? defaultRequest

  let response: Response
  try {
    response = await request(DESKTOP_VERSION_ENDPOINT, init)
  } catch {
    return null
  }
  if (response.status !== 200) return null

  let body: string
  try {
    body = await readLimitedBody(response)
  } catch {
    return null
  }

  return parseGitHubReleaseResponse(body)
}

async function defaultRequest(url: string, init: RequestInit): Promise<Response> {
  return globalThis.fetch(url, init)
}

async function readLimitedBody(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null
    && /^[0-9]+$/u.test(declaredLength)
    && BigInt(declaredLength) > BigInt(MAX_VERSION_RESPONSE_BYTES)) {
    throw new Error('version response is too large')
  }

  if (response.body === null) return ''
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > MAX_VERSION_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw new Error('version response is too large')
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

function parseGitHubReleaseResponse(body: string): UpdateReleaseInfo | null {
  let value: unknown
  try {
    value = JSON.parse(body)
  } catch {
    return null
  }
  if (!isRecord(value)
    || typeof value.tag_name !== 'string'
    || typeof value.html_url !== 'string'
    || typeof value.published_at !== 'string'
    || !Array.isArray(value.assets)) {
    return null
  }
  const parsed = parseCanonicalStableVersion(value.tag_name.startsWith('v') ? value.tag_name.slice(1) : value.tag_name)
  if (parsed === null) return null
  const assets = value.assets.map(parseReleaseAsset).filter((asset): asset is UpdateReleaseAsset => asset !== null)
  return {
    version: parsed.version,
    tagName: value.tag_name,
    releaseName: typeof value.name === 'string' && value.name.trim().length > 0 ? value.name : value.tag_name,
    releaseNotes: typeof value.body === 'string' ? value.body : '',
    publishedAt: value.published_at,
    releaseUrl: value.html_url,
    assets,
  }
}

function parseReleaseAsset(value: unknown): UpdateReleaseAsset | null {
  if (!isRecord(value) || typeof value.name !== 'string' || typeof value.browser_download_url !== 'string') return null
  if (value.name.length === 0 || value.browser_download_url.length === 0) return null
  return { name: value.name, downloadUrl: value.browser_download_url }
}

function parseCanonicalStableVersion(input: string): ParsedSemVer | null {
  const parsed = parseSemVer(input)
  return parsed !== null && parsed.prerelease.length === 0 && parsed.version === input
    ? parsed
    : null
}

function compareParsedSemVer(left: ParsedSemVer, right: ParsedSemVer): number {
  for (const key of ['major', 'minor', 'patch'] as const) {
    const comparison = compareNumeric(left[key], right[key])
    if (comparison !== 0) return comparison
  }
  if (left.prerelease.length === 0) return right.prerelease.length === 0 ? 0 : 1
  if (right.prerelease.length === 0) return -1

  const length = Math.max(left.prerelease.length, right.prerelease.length)
  for (let index = 0; index < length; index += 1) {
    const leftIdentifier = left.prerelease[index]
    const rightIdentifier = right.prerelease[index]
    if (leftIdentifier === undefined) return -1
    if (rightIdentifier === undefined) return 1
    if (leftIdentifier === rightIdentifier) continue

    const leftNumeric = isNumeric(leftIdentifier)
    const rightNumeric = isNumeric(rightIdentifier)
    if (leftNumeric && rightNumeric) return compareNumeric(leftIdentifier, rightIdentifier)
    if (leftNumeric) return -1
    if (rightNumeric) return 1
    return leftIdentifier < rightIdentifier ? -1 : 1
  }
  return 0
}

function compareNumeric(left: string, right: string): number {
  if (left.length !== right.length) return left.length < right.length ? -1 : 1
  if (left === right) return 0
  return left < right ? -1 : 1
}

function isNumeric(identifier: string): boolean {
  return /^[0-9]+$/u.test(identifier)
}

function hasLeadingZero(identifier: string): boolean {
  return identifier.length > 1 && identifier.startsWith('0')
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
