/** Headless, confirmation-gated downloads for HarnessX GitHub release installers. */

import { createHash, randomUUID, timingSafeEqual } from 'node:crypto'
import { chmod, lstat, mkdir, open, rename, unlink } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { parse as parseYaml } from 'yaml'
import { parseSemVer, type UpdateReleaseInfo } from './update-checker.ts'

/** Desktop platforms with packaged update artifacts. */
export type DesktopDownloadPlatform = 'darwin' | 'win32'

/** CPU architectures with packaged update artifacts. */
export type DesktopDownloadArch = 'x64' | 'arm64'

/** Return the expected update manifest asset name (electron-builder latest.yml / latest-mac.yml). */
export function releaseManifestName(platform: DesktopDownloadPlatform): string {
  return platform === 'darwin' ? 'latest-mac.yml' : 'latest.yml'
}

/** Maximum accepted installer size, in bytes. */
export const MAX_UPDATE_DOWNLOAD_BYTES = 1024 * 1024 * 1024

/** Maximum accepted update manifest size, in bytes. */
export const MAX_UPDATE_MANIFEST_BYTES = 64 * 1024

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
const BASE64_SHA512 = /^[A-Za-z0-9+/]{86}==$/u
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
  /** Update manifest browser download URL (latest.yml / latest-mac.yml). */
  readonly manifestUrl: string
}

interface ExpectedAssetMetadata {
  /** Decoded 64-byte SHA-512 digest. */
  readonly sha512: Buffer
  /** Expected byte size declared in the manifest, if present. */
  readonly size?: number
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

  const expectedAsset = await fetchExpectedAssetMetadata({
    artifactName: selection.artifactName,
    manifestUrl: selection.manifestUrl,
    version,
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
    const written = await writeResponseBody(paths.temporary, response.body, options.signal)
    throwIfAborted(options.signal)
    verifyHashAndSize(written, expectedAsset)
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
  const manifestName = releaseManifestName(platform)
  const artifact = release.assets.find(asset => asset.name === artifactName)
  const manifest = release.assets.find(asset => asset.name === manifestName)
  if (artifact === undefined || manifest === undefined) {
    throw new UpdateDownloadError('missing-asset', 'The GitHub release is missing the required update assets.')
  }
  return {
    artifactName,
    artifactUrl: artifact.downloadUrl,
    manifestUrl: manifest.downloadUrl,
  }
}

async function fetchExpectedAssetMetadata(options: {
  readonly artifactName: string
  readonly manifestUrl: string
  readonly version: string
  readonly request: UpdateArtifactRequest
  readonly signal?: AbortSignal
}): Promise<ExpectedAssetMetadata> {
  let response: Response
  try {
    response = await options.request(options.manifestUrl, {
      method: 'GET',
      cache: 'no-store',
      redirect: 'follow',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (cause) {
    if (options.signal?.aborted === true || isAbortFailure(cause)) throw aborted(cause)
    throw new UpdateDownloadError('network', 'The update manifest could not be downloaded.', { cause })
  }
  if (response.status !== 200) {
    throw new UpdateDownloadError(
      'http-status',
      `The update manifest service returned HTTP ${String(response.status)}.`,
      { status: response.status },
    )
  }
  assertDeclaredSize(response, MAX_UPDATE_MANIFEST_BYTES)
  const body = await readLimitedText(response, MAX_UPDATE_MANIFEST_BYTES)
  return parseExpectedManifest(body, options.artifactName, options.version)
}

function parseExpectedManifest(body: string, artifactName: string, version: string): ExpectedAssetMetadata {
  let parsed: unknown
  try {
    parsed = parseYaml(body)
  } catch (cause) {
    throw new UpdateDownloadError('invalid-artifact', 'The update manifest is not valid YAML.', { cause })
  }
  if (typeof parsed !== 'object' || parsed === null) {
    throw new UpdateDownloadError('invalid-artifact', 'The update manifest is empty or invalid.')
  }

  const manifest = parsed as Record<string, unknown>
  if (typeof manifest.version === 'string' && manifest.version !== version) {
    throw new UpdateDownloadError('invalid-artifact', 'The update manifest version does not match the release.')
  }

  let matchedFileEntry: { sha512?: unknown; size?: unknown } | undefined
  if (Array.isArray(manifest.files)) {
    for (const item of manifest.files) {
      if (typeof item === 'object' && item !== null) {
        const fileObj = item as Record<string, unknown>
        const itemUrl = typeof fileObj.url === 'string' ? basename(fileObj.url.trim()) : undefined
        const itemPath = typeof fileObj.path === 'string' ? basename(fileObj.path.trim()) : undefined
        if (itemUrl === artifactName || itemPath === artifactName) {
          matchedFileEntry = fileObj
          break
        }
      }
    }
  }

  if (matchedFileEntry === undefined) {
    const topPath = typeof manifest.path === 'string' ? basename(manifest.path.trim()) : undefined
    if (topPath === artifactName && typeof manifest.sha512 === 'string') {
      matchedFileEntry = manifest
    }
  }

  if (matchedFileEntry === undefined) {
    throw new UpdateDownloadError('missing-asset', 'The update manifest does not contain the selected update asset.')
  }

  const rawSha512 = typeof matchedFileEntry.sha512 === 'string' ? matchedFileEntry.sha512.trim() : undefined
  if (rawSha512 === undefined || !BASE64_SHA512.test(rawSha512)) {
    throw new UpdateDownloadError('invalid-artifact', 'The update manifest contains an invalid SHA-512 hash.')
  }
  const sha512Buffer = Buffer.from(rawSha512, 'base64')
  if (sha512Buffer.byteLength !== 64) {
    throw new UpdateDownloadError('invalid-artifact', 'The update manifest contains an invalid SHA-512 buffer length.')
  }

  const size = typeof matchedFileEntry.size === 'number' && Number.isSafeInteger(matchedFileEntry.size) && matchedFileEntry.size > 0
    ? matchedFileEntry.size
    : undefined

  return {
    sha512: sha512Buffer,
    ...(size === undefined ? {} : { size }),
  }
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

interface WrittenArtifactResult {
  /** Computed SHA-512 digest buffer. */
  readonly sha512: Buffer
  /** Exact written byte size. */
  readonly size: number
}

async function writeResponseBody(
  filename: string,
  body: ReadableStream<Uint8Array>,
  signal: AbortSignal | undefined,
): Promise<WrittenArtifactResult> {
  const handle = await open(filename, 'wx', PRIVATE_FILE_MODE)
  const reader = body.getReader()
  const hash = createHash('sha512')
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
    return {
      sha512: hash.digest(),
      size: bytesWritten,
    }
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

function verifyHashAndSize(actual: WrittenArtifactResult, expected: ExpectedAssetMetadata): void {
  if (expected.size !== undefined && actual.size !== expected.size) {
    throw new UpdateDownloadError('checksum-mismatch', 'The downloaded update size did not match the update manifest.')
  }
  if (actual.sha512.byteLength !== expected.sha512.byteLength || !timingSafeEqual(actual.sha512, expected.sha512)) {
    throw new UpdateDownloadError('checksum-mismatch', 'The downloaded update hash did not match the update manifest.')
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
