import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { afterEach, describe, expect, it } from 'vitest'
import {
  UpdateDownloadError,
  downloadDesktopUpdate,
  releaseArtifactName,
  releaseManifestName,
  type DesktopDownloadArch,
  type DesktopDownloadPlatform,
  type UpdateArtifactRequest,
} from '../src/update-download.ts'
import type { UpdateReleaseInfo } from '../src/update-checker.ts'

const temporaryRoots: string[] = []

async function temporaryUserData(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'harnessx-update-download-'))
  temporaryRoots.push(root)
  return root
}

function dmgArtifact(): Uint8Array {
  const artifact = Buffer.alloc(1024, 0x5a)
  artifact.write('koly', artifact.byteLength - 512, 'ascii')
  return artifact
}

function windowsArtifact(): Uint8Array {
  const artifact = Buffer.alloc(512, 0)
  artifact.write('MZ', 0, 'ascii')
  artifact.writeUInt32LE(0x80, 0x3c)
  artifact.set([0x50, 0x45, 0x00, 0x00], 0x80)
  return artifact
}

function sha512Base64(value: Uint8Array): string {
  return createHash('sha512').update(value).digest('base64')
}

function releaseFixture(
  version: string,
  platform: DesktopDownloadPlatform,
  arch: DesktopDownloadArch,
): UpdateReleaseInfo {
  const artifactName = releaseArtifactName(platform, arch, version)
  const manifestName = releaseManifestName(platform)
  return {
    version,
    tagName: 'v' + version,
    releaseName: 'HarnessX ' + version,
    releaseNotes: 'Release notes',
    publishedAt: '2026-08-17T00:00:00Z',
    releaseUrl: 'https://github.com/coffeefreehans/HarnessX/releases/tag/v' + version,
    assets: [
      {
        name: artifactName,
        downloadUrl: 'https://example.test/' + artifactName,
      },
      {
        name: manifestName,
        downloadUrl: 'https://example.test/' + manifestName,
      },
    ],
  }
}

function requestFixture(
  artifactName: string,
  manifestName: string,
  version: string,
  artifact: Uint8Array,
  expectedHash: string = sha512Base64(artifact),
): UpdateArtifactRequest {
  const manifestContent = stringifyYaml({
    version,
    files: [
      {
        url: artifactName,
        sha512: expectedHash,
        size: artifact.byteLength,
      },
    ],
    path: artifactName,
    sha512: expectedHash,
    releaseDate: '2026-08-17T00:00:00Z',
  })

  return async (url) => {
    if (url.endsWith('/' + manifestName)) {
      return new Response(manifestContent)
    }
    if (url.endsWith('/' + artifactName)) return new Response(Buffer.from(artifact))
    return new Response('not found', { status: 404 })
  }
}

async function expectFailure(
  promise: Promise<unknown>,
  code: UpdateDownloadError['code'],
): Promise<void> {
  await expect(promise).rejects.toMatchObject({ name: 'UpdateDownloadError', code })
}

async function expectNoPartialFiles(userDataPath: string, version: string): Promise<void> {
  const entries = await readdir(join(userDataPath, 'updates', version))
  expect(entries.filter(entry => entry.endsWith('.partial'))).toEqual([])
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

describe('GitHub Release update download with latest.yml / latest-mac.yml', () => {
  it.each([
    ['darwin', 'x64', dmgArtifact()],
    ['win32', 'arm64', windowsArtifact()],
  ] as const)('selects the %s %s asset and verifies SHA-512 from manifest', async (platform, arch, artifact) => {
    const version = '0.0.2'
    const userDataPath = await temporaryUserData()
    const artifactName = releaseArtifactName(platform, arch, version)
    const manifestName = releaseManifestName(platform)
    const release = releaseFixture(version, platform, arch)

    const result = await downloadDesktopUpdate({
      platform,
      arch,
      version,
      release,
      userDataPath,
      request: requestFixture(artifactName, manifestName, version, artifact),
    })

    expect(result).toBe(join(userDataPath, 'updates', version, artifactName))
    expect(await readFile(result)).toEqual(Buffer.from(artifact))
    await expectNoPartialFiles(userDataPath, version)
  })

  it('rejects a checksum mismatch and removes the partial file', async () => {
    const version = '0.0.2'
    const platform = 'darwin'
    const arch = 'arm64'
    const artifact = dmgArtifact()
    const userDataPath = await temporaryUserData()
    const artifactName = releaseArtifactName(platform, arch, version)
    const manifestName = releaseManifestName(platform)

    const invalidHash = Buffer.alloc(64, 0).toString('base64')

    await expectFailure(downloadDesktopUpdate({
      platform,
      arch,
      version,
      release: releaseFixture(version, platform, arch),
      userDataPath,
      request: requestFixture(artifactName, manifestName, version, artifact, invalidHash),
    }), 'checksum-mismatch')
    await expectNoPartialFiles(userDataPath, version)
  })

  it('rejects a release without the selected CPU asset', async () => {
    const version = '0.0.2'
    const userDataPath = await temporaryUserData()
    const release = releaseFixture(version, 'win32', 'x64')

    await expectFailure(downloadDesktopUpdate({
      platform: 'win32',
      arch: 'arm64',
      version,
      release,
      userDataPath,
      request: async () => new Response('unused'),
    }), 'missing-asset')
  })

  it('rejects an invalid installer even when its checksum matches', async () => {
    const version = '0.0.2'
    const platform = 'win32'
    const arch = 'x64'
    const artifact = new Uint8Array(512)
    const userDataPath = await temporaryUserData()
    const artifactName = releaseArtifactName(platform, arch, version)
    const manifestName = releaseManifestName(platform)

    await expectFailure(downloadDesktopUpdate({
      platform,
      arch,
      version,
      release: releaseFixture(version, platform, arch),
      userDataPath,
      request: requestFixture(artifactName, manifestName, version, artifact),
    }), 'invalid-artifact')
    await expectNoPartialFiles(userDataPath, version)
  })

  it('rejects release/version mismatches before requesting', async () => {
    const userDataPath = await temporaryUserData()
    let requested = false
    await expectFailure(downloadDesktopUpdate({
      platform: 'darwin',
      arch: 'x64',
      version: '0.0.3',
      release: releaseFixture('0.0.2', 'darwin', 'x64'),
      userDataPath,
      request: async () => {
        requested = true
        return new Response('unused')
      },
    }), 'invalid-options')
    expect(requested).toBe(false)
  })
})
