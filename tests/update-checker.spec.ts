import { describe, expect, it, vi } from 'vitest'
import {
  DESKTOP_VERSION_ENDPOINT,
  MAX_VERSION_RESPONSE_BYTES,
  checkForStableUpdate,
  compareSemVerVersions,
  parseSemVer,
  type UpdateRequest,
} from '../src/update-checker.ts'

function releaseResponse(version: string, init: ResponseInit = {}): Response {
  return Response.json({
    tag_name: 'v' + version,
    name: 'HarnessX ' + version,
    body: 'Release notes for ' + version,
    published_at: '2026-08-17T00:00:00Z',
    html_url: 'https://github.com/coffeefreehans/HarnessX/releases/tag/v' + version,
    assets: [
      {
        name: 'HarnessX-' + version + '-x64-Setup.exe',
        browser_download_url: 'https://github.com/coffeefreehans/HarnessX/releases/download/v'
          + version + '/HarnessX-' + version + '-x64-Setup.exe',
      },
    ],
  }, init)
}

describe('strict SemVer parsing', () => {
  it('accepts two- and three-part release versions and compares without numeric overflow', () => {
    expect(parseSemVer('v0.1')).toEqual({
      version: '0.1',
      major: '0',
      minor: '1',
      patch: '0',
      prerelease: [],
      build: [],
    })
    expect(parseSemVer('v2.10.3-alpha.1+mac.arm64')).toEqual({
      version: '2.10.3-alpha.1+mac.arm64',
      major: '2',
      minor: '10',
      patch: '3',
      prerelease: ['alpha', '1'],
      build: ['mac', 'arm64'],
    })
    expect(compareSemVerVersions('2.1.0', '2.0.9')).toBeGreaterThan(0)
    expect(compareSemVerVersions('2.0.0-rc.1', '2.0.0')).toBeLessThan(0)
    expect(compareSemVerVersions(
      '10000000000000000.0.0',
      '9007199254740992.0.0',
    )).toBeGreaterThan(0)
  })

  it.each([
    '1',
    '01.2.3',
    '1.02.3',
    '1.2.03',
    '1.2.3-01',
    '1.2.3-alpha..1',
    '1.2.3+',
    'V1.2.3',
    ' 1.2.3',
  ])('rejects invalid SemVer %s', version => {
    expect(parseSemVer(version)).toBeNull()
  })
})

describe('public GitHub Release update check', () => {
  it('uses the fixed GitHub endpoint and returns release metadata', async () => {
    const controller = new AbortController()
    const calls: Array<{ url: string; init: RequestInit }> = []
    const request: UpdateRequest = async (url, init) => {
      calls.push({ url, init })
      return releaseResponse('2.10.0')
    }

    const result = await checkForStableUpdate({
      currentVersion: '2.9.9',
      signal: controller.signal,
      request,
    })

    expect(result).toMatchObject({
      status: 'update-available',
      currentVersion: '2.9.9',
      latestVersion: '2.10.0',
      release: {
        version: '2.10.0',
        tagName: 'v2.10.0',
        releaseName: 'HarnessX 2.10.0',
        releaseNotes: 'Release notes for 2.10.0',
        publishedAt: '2026-08-17T00:00:00Z',
      },
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]?.url).toBe(DESKTOP_VERSION_ENDPOINT)
    expect(calls[0]?.init).toMatchObject({
      method: 'GET',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
    const headers = new Headers(calls[0]?.init.headers)
    expect(headers.get('accept')).toBe('application/vnd.github+json')
    expect(headers.get('x-github-api-version')).toBe('2022-11-28')
  })

  it.each([
    ['2.0.0', '2.0.0'],
    ['2.0.1', '2.0.0'],
    ['2.0.0+installed', '2.0.0+release'],
  ])('reports no update for installed %s and release %s', async (currentVersion, latestVersion) => {
    await expect(checkForStableUpdate({
      currentVersion,
      request: async () => releaseResponse(latestVersion),
    })).resolves.toMatchObject({
      status: 'up-to-date',
      currentVersion,
      latestVersion,
    })
  })

  it('rejects prerelease, malformed, unavailable, and oversized responses', async () => {
    const prerelease = releaseResponse('2.1.0-rc.1')
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => prerelease,
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => new Response('{'),
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => new Response('unavailable', { status: 503 }),
    })).resolves.toBeNull()
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => new Response('{}', {
        headers: { 'content-length': String(MAX_VERSION_RESPONSE_BYTES + 1) },
      }),
    })).resolves.toBeNull()
  })

  it('handles network failure and skips invalid installed versions before requesting', async () => {
    await expect(checkForStableUpdate({
      currentVersion: '2.0.0',
      request: async () => { throw new TypeError('offline') },
    })).resolves.toBeNull()

    const request = vi.fn(async () => releaseResponse('2.1.0'))
    await expect(checkForStableUpdate({ currentVersion: 'v2.0.0', request })).resolves.toBeNull()
    expect(request).not.toHaveBeenCalled()
  })
})
