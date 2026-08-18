/** Headless, confirmation-gated downloads for HarnessX GitHub release installers. */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { parseSemVer, type UpdateReleaseInfo } from './update-checker.ts'

/** Desktop platforms with packaged update artifacts. */
export type DesktopDownloadPlatform = 'darwin' | 'win32'

/** CPU architectures with packaged update artifacts. */
export type DesktopDownloadArch = 'x64' | 'arm64'

/** SHA-256 manifest asset expected on every release. */
export const UPDATE_CHECKSUMS_FILENAME = 'SHA256SUMS.txt'

/** Maximum accepted installer size, in bytes. */
export const MAX_UPDATE_DOWNLOAD_BYTES = 1024 * 1024 * 1024

/** Maximum accepted checksum manifest size, in bytes. */
export const MAX_UPDATE_CHECKSUM_BYTES = 64 * 1024

/** Failure categories exposed to the update coordinator. */
export type UpdateDownloadErrorCode =
  | 'aborted'
  | 'checksum-mismatch'
  | 'empty-body'
  | 'http-status'
  | 'invalid-artifact'
  | 'invalid-options'
  | 'missing-asset'
  | 'network'
  | 'response-too-large'

/** Fetch-compatible request boundary supplied by the Electron adapter or a test. */
export type UpdateArtifactRequest = (url: string, init: RequestInit) => Promise<Response>

/** Inputs for one user-confirmed installer download. */
export interface DownloadDesktopUpdateOptions {
  /** Host platform selecting the installer validation. */
  readonly platform: DesktopDownloadPlatform
  /** Host CPU architecture selecting the release asset. */
  readonly arch: DesktopDownloadArch
  /** Stable release version used as one private directory segment. */
  readonly version: string
  /** GitHub release metadata that owns the installer and checksum assets. */
  readonly release: UpdateReleaseInfo
  /** Absolute Electron user-data directory that owns update artifacts. */
  readonly userDataPath: string
  /** Request implementation, normally backed by Electron `net.fetch`. */
  readonly request: UpdateArtifactRequest
  /** Optional cancellation signal owned by the update coordinator. */
  readonly signal?: AbortSignal
}

/** Typed failure from installer request, validation, or cancellation. */
export class UpdateDownloadError extends Error {
  /** Stable programmatic failure category. */
  readonly code: UpdateDownloadErrorCode
  /** HTTP status for an unsuccessful response, otherwise undefined. */
  readonly status: number | undefined

  /**
   * Create one safe update-download failure.
   * @param code - Stable failure category.
   * @param message - Diagnostic text without response content.
   * @param options - Optional HTTP status and underlying failure.
   */
  constructor(
    code: UpdateDownloadErrorCode,
    message: string,
    options: { readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'UpdateDownloadError'
    this.code = code
    this.status = options.status
  }
}

const PRIVATE_DIRECTORY_MODE = 0o700
const PRIVATE_FILE_MODE = 0o600
const DECIMAL_BYTES = /^(0|[1-9][0-9]*)$/u
const HEX_SHA256 = /^[0-9a-f]{64}$/u
const DMG_TRAILER_BYTES = 512
const DMG_TRAILER_MAGIC = Buffer.from('koly', 'ascii')
const DOS_HEADER_BYTES = 64
const PE_OFFSET_POSITION = 0x3c
const PE_MAGIC = Buffer.from([0x50, 0x45, 0x00, 0x00])

interface DownloadPaths {
  /** Directory that contains the release artifact. */
  readonly directory: string
  /** Final validated artifact path. */
  readonly completed: string
  /** Temporary partial artifact path. */
  readonly temporary: string
}

interface ReleaseAssetSelection {
  /** Installer asset file name. */
  readonly artifactName: string
  /** Installer browser download URL. */
  readonly artifactUrl: string
  /** SHA-256 manifest browser download URL. */
  readonly checksumsUrl: string
}

/**
 * Download one installer after its caller has obtained user confirmation.
 * @param options - Fixed platform, release version, private storage, request, and cancellation inputs.
 * @returns Absolute path to the completely written and validated installer.
 * @throws {UpdateDownloadError} For invalid inputs, transport failures, rejected responses, cancellation, and invalid installers.
 */
export async function downloadDesktopUpdate(options: DownloadDesktopUpdateOptions): Promise<string> {
  const platform = validatedPlatform(options.platform)
  const arch = validatedArch(options.arch)
  const version = validatedVersion(options.version)
  const release = validatedRelease(options.release, version)
  const userDataPath = validatedUserDataPath(options.userDataPath)
  const selection = selectReleaseAssets(release, platform, arch, version)
  const paths = await prepareDownloadPaths(userDataPath, selection.artifactName, version)
  throwIfAborted(options.signal)

  const expectedHash = await fetchExpectedHash({
    artifactName: selection.artifactName,
    checksumsUrl: selection.checksumsUrl,
    request: options.request,
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  throwIfAborted(options.signal)

  let response: Response
  try {
    response = await options.request(selection.artifactUrl, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (cause) {
    if (options.signal?.aborted === true || isAbortFailure(cause)) throw aborted(cause)
    throw new UpdateDownloadError('network', 'The update installer could not be downloaded.', { cause })
  }

  if (response.status !== 200) {
    throw new UpdateDownloadError(
      'http-status',
      `The update download service returned HTTP ${String(response.status)}.`,
      { status: response.status },
    )
  }
  if (response.body === null) {
    throw new UpdateDownloadError('empty-body', 'The update download service returned an empty body.')
  }
  assertDeclaredSize(response, MAX_UPDATE_DOWNLOAD_BYTES)

  let failure: unknown
  try {
    const actualHash = await writeResponseBody(paths.temporary, response.body, options.signal)
    throwIfAborted(options.signal)
    verifyHash(actualHash, expectedHash)
    await validateArtifact(paths.temporary, platform)
    throwIfAborted(options.signal)
    await rename(paths.temporary, paths.completed)
    return paths.completed
  } catch (cause) {
    failure = options.signal?.aborted === true || isAbortFailure(cause) ? aborted(cause) : cause
    throw failure
  } finally {
    try {
      await unlinkIfPresent(paths.temporary)
    } catch (cleanupCause) {
      if (failure === undefined) throw cleanupCause
      throw new AggregateError([failure, cleanupCause], 'Failed to download and clean up the update installer.')
    }
  }
}

/** Return the expected public Release asset name for a platform and architecture. */
export function releaseArtifactName(platform: DesktopDownloadPlatform, arch: DesktopDownloadArch, version: string): string {
  return platform === 'darwin'
    ? `HarnessX-${version}-${arch}.dmg`
    : `HarnessX-${version}-${arch}-Setup.exe`
}

function validatedPlatform(platform: DesktopDownloadPlatform): DesktopDownloadPlatform {
  if (platform !== 'darwin' && platform !== 'win32') {
    throw new UpdateDownloadError('invalid-options', `Unsupported update download platform: ${String(platform)}`)
  }
  return platform
}

function validatedArch(arch: DesktopDownloadArch): DesktopDownloadArch {
  if (arch !== 'x64' && arch !== 'arm64') {
    throw new UpdateDownloadError('invalid-options', `Unsupported update download architecture: ${String(arch)}`)
  }
  return arch
}

function validatedVersion(version: string): string {
  const parsed = parseSemVer(version)
  if (parsed === null || parsed.prerelease.length > 0 || parsed.version !== version) {
    throw new UpdateDownloadError('invalid-options', 'The update version must be stable Semantic Versioning.')
  }
  return version
}

function validatedRelease(release: UpdateReleaseInfo, version: string): UpdateReleaseInfo {
  if (release.version !== version) {
    throw new UpdateDownloadError('invalid-options', 'The update release does not match the requested version.')
  }
  return release
}

function validatedUserDataPath(userDataPath: string): string {
  if (userDataPath.length === 0 || /[\0\r\n]/u.test(userDataPath) || !isAbsolute(userDataPath)) {
    throw new UpdateDownloadError('invalid-options', 'The update user-data path must be an absolute path.')
  }
  return resolve(userDataPath)
}

function selectReleaseAssets(
  release: UpdateReleaseInfo,
  platform: DesktopDownloadPlatform,
  arch: DesktopDownloadArch,
  version: string,
): ReleaseAssetSelection {
  const artifactName = releaseArtifactName(platform, arch, version)
  const artifact = release.assets.find(asset => asset.name === artifactName)
  const checksums = release.assets.find(asset => asset.name === UPDATE_CHECKSUMS_FILENAME)
  if (artifact === undefined || checksums === undefined) {
    throw new UpdateDownloadError('missing-asset', 'The GitHub release is missing the required update assets.')
  }
  return {
    artifactName,
    artifactUrl: artifact.downloadUrl,
    checksumsUrl: checksums.downloadUrl,
  }
}

async function fetchExpectedHash(options: {
  /** Installer file name to select from the checksum manifest. */
  readonly artifactName: string
  /** URL for the checksum manifest asset. */
  readonly checksumsUrl: string
  /** Request adapter used by Electron or tests. */
  readonly request: UpdateArtifactRequest
  /** Optional cancellation signal. */
  readonly signal?: AbortSignal
}): Promise<string> {
  let response: Response
  try {
    response = await options.request(options.checksumsUrl, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (cause) {
    if (options.signal?.aborted === true || isAbortFailure(cause)) throw aborted(cause)
    throw new UpdateDownloadError('network', 'The update checksum manifest could not be downloaded.', { cause })
  }
  if (response.status !== 200) {
    throw new UpdateDownloadError(
      'http-status',
      `The update checksum service returned HTTP ${String(response.status)}.`,
      { status: response.status },
    )
  }
  assertDeclaredSize(response, MAX_UPDATE_CHECKSUM_BYTES)
  const body = await readLimitedText(response, MAX_UPDATE_CHECKSUM_BYTES)
  return parseExpectedHash(body, options.artifactName)
}

function parseExpectedHash(body: string, artifactName: string): string {
  for (const rawLine of body.split(/\r?\n/u)) {
    const line = rawLine.trim()
    if (line.length === 0 || line.startsWith('#')) continue
    const match = /^([0-9a-fA-F]{64})\s+\*?(.+)$/u.exec(line)
    const hash = match?.[1]?.toLowerCase()
    const name = match?.[2]
    if (hash === undefined || name === undefined) continue
    if (basename(name.trim()) === artifactName && HEX_SHA256.test(hash)) return hash
  }
  throw new UpdateDownloadError('missing-asset', 'The checksum manifest does not contain the selected update asset.')
}

async function prepareDownloadPaths(
  userDataPath: string,
  artifactName: string,
  version: string,
): Promise<DownloadPaths> {
  const userDataStat = await lstat(userDataPath)
  if (!userDataStat.isDirectory() || userDataStat.isSymbolicLink()) {
    throw new UpdateDownloadError('invalid-options', 'The update user-data path must be a real directory.')
  }

  const updatesDirectory = join(userDataPath, 'updates')
  const directory = join(updatesDirectory, version)
  if (resolve(directory) !== directory) {
    throw new UpdateDownloadError('invalid-options', 'The update destination escaped the user-data directory.')
  }
  await preparePrivateDirectory(updatesDirectory)
  await preparePrivateDirectory(directory)

  const completed = join(directory, artifactName)
  const completedStat = await lstatOptional(completed)
  if (completedStat !== undefined) {
    if (!completedStat.isFile() || completedStat.isSymbolicLink()) {
      throw new UpdateDownloadError('invalid-options', 'The completed update path is not a regular file.')
    }
    await unlink(completed)
  }

  return {
    directory,
    completed,
    temporary: join(directory, `.${artifactName}.${process.pid}.${randomUUID()}.partial`),
  }
}

async function preparePrivateDirectory(directory: string): Promise<void> {
  await mkdir(directory, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const stat = await lstat(directory)
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new UpdateDownloadError('invalid-options', 'An update destination component is not a real directory.')
  }
  await chmod(directory, PRIVATE_DIRECTORY_MODE)
}

async function lstatOptional(filename: string): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  try {
    return await lstat(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw cause
  }
}

function assertDeclaredSize(response: Response, maxBytes: number): void {
  const declared = response.headers.get('content-length')
  if (declared === null || !DECIMAL_BYTES.test(declared)) return
  if (BigInt(declared) > BigInt(maxBytes)) {
    throw new UpdateDownloadError('response-too-large', `The update response exceeds ${String(maxBytes)} bytes.`)
  }
}

async function readLimitedText(response: Response, maxBytes: number): Promise<string> {
  if (response.body === null) throw new UpdateDownloadError('empty-body', 'The update service returned an empty body.')
  const reader = response.body.getReader()
  const decoder = new TextDecoder('utf-8', { fatal: true })
  let bytesRead = 0
  let body = ''
  try {
    while (true) {
      const chunk = await reader.read()
      if (chunk.done) break
      bytesRead += chunk.value.byteLength
      if (bytesRead > maxBytes) {
        await reader.cancel().catch(() => undefined)
        throw new UpdateDownloadError('response-too-large', `The update response exceeds ${String(maxBytes)} bytes.`)
      }
      body += decoder.decode(chunk.value, { stream: true })
    }
    return body + decoder.decode()
  } finally {
    reader.releaseLock()
  }
}

async function writeResponseBody(
  filename: string,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<string> {
  const handle = await open(filename, 'wx', PRIVATE_FILE_MODE)
  const reader = body.getReader()
  const hash = createHash('sha256')
  let bytesWritten = 0
  try {
    while (true) {
      throwIfAborted(signal)
      const chunk = await reader.read()
      throwIfAborted(signal)
      if (chunk.done) break
      if (chunk.value.byteLength > MAX_UPDATE_DOWNLOAD_BYTES - bytesWritten) {
        throw new UpdateDownloadError(
          'response-too-large',
          `The update installer exceeds ${String(MAX_UPDATE_DOWNLOAD_BYTES)} bytes.`,
        )
      }
      await writeAll(handle, chunk.value)
      hash.update(chunk.value)
      bytesWritten += chunk.value.byteLength
    }
    if (bytesWritten === 0) {
      throw new UpdateDownloadError('empty-body', 'The update download service returned an empty body.')
    }
    await handle.sync()
    return hash.digest('hex')
  } catch (cause) {
    await reader.cancel(cause).catch(() => undefined)
    throw cause
  } finally {
    reader.releaseLock()
    await handle.close()
  }
}

async function writeAll(
  handle: Awaited<ReturnType<typeof open>>,
  chunk: Uint8Array,
): Promise<void> {
  let offset = 0
  while (offset < chunk.byteLength) {
    const result = await handle.write(chunk, offset, chunk.byteLength - offset, null)
    if (result.bytesWritten === 0) throw new Error('The update installer write made no progress.')
    offset += result.bytesWritten
  }
}

function verifyHash(actualHash: string, expectedHash: string): void {
  const actual = Buffer.from(actualHash, 'hex')
  const expected = Buffer.from(expectedHash, 'hex')
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    throw new UpdateDownloadError('checksum-mismatch', 'The downloaded update did not match SHA256SUMS.txt.')
  }
}

async function validateArtifact(filename: string, platform: DesktopDownloadPlatform): Promise<void> {
  const handle = await open(filename, 'r')
  try {
    const stat = await handle.stat()
    if (!stat.isFile() || stat.size <= 0 || stat.size > MAX_UPDATE_DOWNLOAD_BYTES) {
      throw invalidArtifact(platform)
    }
    if (platform === 'darwin') {
      if (stat.size < DMG_TRAILER_BYTES) throw invalidArtifact(platform)
      const magic = Buffer.alloc(DMG_TRAILER_MAGIC.byteLength)
      const result = await handle.read(magic, 0, magic.byteLength, stat.size - DMG_TRAILER_BYTES)
      if (result.bytesRead !== magic.byteLength || !magic.equals(DMG_TRAILER_MAGIC)) {
        throw invalidArtifact(platform)
      }
      return
    }

    if (stat.size < DOS_HEADER_BYTES) throw invalidArtifact(platform)
    const dosHeader = Buffer.alloc(DOS_HEADER_BYTES)
    const dosResult = await handle.read(dosHeader, 0, dosHeader.byteLength, 0)
    if (dosResult.bytesRead !== dosHeader.byteLength || dosHeader[0] !== 0x4d || dosHeader[1] !== 0x5a) {
      throw invalidArtifact(platform)
    }
    const peOffset = dosHeader.readUInt32LE(PE_OFFSET_POSITION)
    if (peOffset > stat.size - PE_MAGIC.byteLength) throw invalidArtifact(platform)
    const peMagic = Buffer.alloc(PE_MAGIC.byteLength)
    const peResult = await handle.read(peMagic, 0, peMagic.byteLength, peOffset)
    if (peResult.bytesRead !== peMagic.byteLength || !peMagic.equals(PE_MAGIC)) {
      throw invalidArtifact(platform)
    }
  } finally {
    await handle.close()
  }
}

function invalidArtifact(platform: DesktopDownloadPlatform): UpdateDownloadError {
  return new UpdateDownloadError(
    'invalid-artifact',
    platform === 'darwin'
      ? 'The downloaded file is not a UDIF disk image.'
      : 'The downloaded file is not a PE executable.',
  )
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted !== true) return
  throw aborted(signal.reason)
}

function aborted(cause: unknown): UpdateDownloadError {
  return new UpdateDownloadError('aborted', 'The update installer download was cancelled.', { cause })
}

function isAbortFailure(value: unknown): boolean {
  return value instanceof UpdateDownloadError
    ? value.code === 'aborted'
    : typeof value === 'object'
      && value !== null
      && 'name' in value
      && value.name === 'AbortError'
}

async function unlinkIfPresent(filename: string): Promise<void> {
  try {
    await unlink(filename)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
  }
}
