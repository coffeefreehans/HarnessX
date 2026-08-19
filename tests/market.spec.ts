import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  assertPluginUninstalled,
  assertDshPluginDirectory,
  ensureProfilePnpmWorkspace,
  parseGitHubRepository,
  parseMarketManifest,
  parseSourceConfig,
  readMarketSources,
  type PluginSourceConfig,
} from '../src/market.ts'

describe('plugin source validation', () => {
  it('accepts the four supported source kinds', () => {
    const sources: PluginSourceConfig[] = [
      { id: 'npm', name: 'npm', kind: 'npm', url: 'https://registry.npmjs.org', enabled: true },
      { id: 'manifest', name: 'manifest', kind: 'manifest', url: 'https://example.com/dsh-market.json', enabled: false },
      { id: 'github', name: 'github', kind: 'github', url: 'https://github.com/owner/repo', enabled: true },
      { id: 'local', name: 'local', kind: 'local', url: join(tmpdir(), 'plugin-manifest'), enabled: true },
    ]
    expect(sources.map(source => parseSourceConfig(source))).toEqual(sources)
  })

  it('rejects unknown kinds and invalid URLs', () => {
    expect(() => parseSourceConfig({ id: 'bad', name: 'bad', kind: 'unknown', url: 'x' })).toThrow()
    expect(() => parseSourceConfig({ id: 'bad', name: 'bad', kind: 'github', url: 'https://example.com/a/b' })).toThrow()
    expect(() => parseSourceConfig({ id: 'bad', name: 'bad', kind: 'local', url: 'relative/path' })).toThrow()
  })

  it('parses common GitHub repository URL shapes', () => {
    expect(parseGitHubRepository('https://github.com/owner/repo')).toBe('owner/repo')
    expect(parseGitHubRepository('https://github.com/owner/repo.git')).toBe('owner/repo')
    expect(() => parseGitHubRepository('https://gitlab.com/owner/repo')).toThrow()
  })
})

describe('market manifest validation', () => {
  it('accepts a valid version 1 manifest', () => {
    const manifest = parseMarketManifest({
      version: 1,
      plugins: [
        { id: 'example', name: 'Example', install: 'example-plugin' },
      ],
    })
    expect(manifest.plugins[0]).toMatchObject({ id: 'example', install: 'example-plugin' })
  })

  it('accepts awesome, registry, entries, and repository marketplace shapes', () => {
    expect(parseMarketManifest({
      plugins: [{ name: 'example-plugin', owner: 'owner', url: 'https://github.com/owner/example-plugin', npm: 'example-plugin' }],
    }).plugins[0]).toMatchObject({ id: 'owner/example-plugin', install: 'example-plugin' })

    expect(parseMarketManifest({
      plugins: [{ fullName: 'owner/example-plugin', repo: 'example-plugin', install: { mode: 'automatic', spec: 'github:owner/example-plugin' } }],
    }).plugins[0]).toMatchObject({ id: 'owner/example-plugin', install: 'github:owner/example-plugin' })

    expect(parseMarketManifest({
      entries: [{ repository: { fullName: 'owner/example-plugin', url: 'https://github.com/owner/example-plugin' }, package: { name: 'example-plugin', version: '1.0.0' } }],
    }).plugins[0]).toMatchObject({ id: 'owner/example-plugin', install: 'github:owner/example-plugin' })

    expect(parseMarketManifest({
      repos: [{ full_name: 'owner/example-plugin', name: 'example-plugin', html_url: 'https://github.com/owner/example-plugin' }],
    }).plugins[0]).toMatchObject({ id: 'owner/example-plugin', install: 'github:owner/example-plugin' })
  })

  it('rejects malformed manifests and malformed plugin entries', () => {
    expect(() => parseMarketManifest({ version: 2, plugins: [] })).toThrow()
    expect(() => parseMarketManifest({ version: 1, plugins: {} })).toThrow()
    expect(() => parseMarketManifest({ version: 1, plugins: [{ name: 'missing' }] })).toThrow()
  })
})

describe('market source persistence', () => {
  it('returns the default npm source when the file does not exist', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-market-'))
    try {
      const sources = await readMarketSources(join(directory, 'missing.json'))
      expect(sources.map(source => source.id)).toEqual([
        'npm-registry',
        'awesome-dsh',
        'dsh-plugin-marketplace',
        'yelebai-dsh-marketplace',
        'brade-dsh-marketplace',
      ])
      expect(sources.every(source => source.enabled)).toBe(true)
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('profile pnpm workspace', () => {
  it('denies plugin dependency build scripts for pnpm v11 installs', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'dsh-market-profile-'))
    try {
      await ensureProfilePnpmWorkspace(directory)

      const workspace = await readFile(join(directory, 'pnpm-workspace.yaml'), 'utf8')

      expect(workspace).toContain('packages:\n  - .')
      expect(workspace).toContain('nodeLinker: hoisted')
      expect(workspace).toContain('autoInstallPeers: false')
      expect(workspace).toContain('strictDepBuilds: true')
      expect(workspace).not.toContain('allowBuilds:')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('plugin uninstall verification', () => {
  it('rejects dependency or bundle residue after a successful package-manager exit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harnessx-uninstall-'))
    try {
      await writeFile(join(directory, 'package.json'), JSON.stringify({
        name: 'test-profile',
        private: true,
        dependencies: { 'broken-plugin': '1.0.0' },
        dsh: { profile: { bundles: ['broken-plugin'] } },
      }))

      expect(() => assertPluginUninstalled('broken-plugin', directory)).toThrow('still installed')
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})

describe('GitHub plugin validation', () => {
  it('rejects a skill repository without a DSH bundle declaration', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'harnessx-non-plugin-'))
    try {
      await expect(assertDshPluginDirectory(directory)).rejects.toThrow(
        'not a DeepSeek Harness plugin',
      )
    } finally {
      await rm(directory, { recursive: true, force: true })
    }
  })
})
