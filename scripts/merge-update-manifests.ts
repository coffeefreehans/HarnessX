/**
 * Merge electron-builder update manifests after multi-architecture builds.
 *
 * electron-builder overwrites latest.yml / latest-mac.yml on each invocation,
 * so only the last architecture survives. This script reads actual dist/ artifacts,
 * computes SHA-512 digests, and writes a unified manifest containing all architectures.
 */

import { createHash } from 'node:crypto'
import { readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { stringify as stringifyYaml } from 'yaml'
import { fileURLToPath } from 'node:url'

interface ManifestFileEntry {
  url: string
  sha512: string
  size: number
}

interface UpdateManifest {
  version: string
  files: ManifestFileEntry[]
  path: string
  sha512: string
  releaseDate: string
}

async function sha512Base64(filePath: string): Promise<string> {
  const content = await readFile(filePath)
  return createHash('sha512').update(content).digest('base64')
}

async function buildManifest(distDir: string, pattern: RegExp, version: string): Promise<UpdateManifest | null> {
  const entries = await readdir(distDir)
  const matched = entries.filter(name => pattern.test(name))
  if (matched.length === 0) return null

  const files: ManifestFileEntry[] = []
  for (const name of matched.sort()) {
    const filePath = join(distDir, name)
    const fileStat = await stat(filePath)
    const hash = await sha512Base64(filePath)
    files.push({
      url: name,
      sha512: hash,
      size: fileStat.size,
    })
  }

  return {
    version,
    files,
    path: files[0]!.url,
    sha512: files[0]!.sha512,
    releaseDate: new Date().toISOString(),
  }
}

export async function mergeUpdateManifests(distDir: string, version: string): Promise<void> {
  const escapedVersion = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  const windowsManifest = await buildManifest(
    distDir,
    new RegExp(`^HarnessX-${escapedVersion}-.*-Setup\\.exe$`),
    version,
  )
  if (windowsManifest !== null) {
    const yamlContent = stringifyYaml(windowsManifest)
    await writeFile(join(distDir, 'latest.yml'), yamlContent, 'utf8')
    console.log(`latest.yml: ${windowsManifest.files.map(f => f.url).join(', ')}`)
  }

  const macManifest = await buildManifest(
    distDir,
    new RegExp(`^HarnessX-${escapedVersion}-.*\\.dmg$`),
    version,
  )
  if (macManifest !== null) {
    const yamlContent = stringifyYaml(macManifest)
    await writeFile(join(distDir, 'latest-mac.yml'), yamlContent, 'utf8')
    console.log(`latest-mac.yml: ${macManifest.files.map(f => f.url).join(', ')}`)
  }
}

const invokedPath = process.argv[1]
if (invokedPath !== undefined && resolve(invokedPath) === fileURLToPath(import.meta.url)) {
  const packageRoot = resolve(fileURLToPath(import.meta.url), '..', '..')
  const pkg = JSON.parse(await readFile(resolve(packageRoot, 'package.json'), 'utf8')) as { version: string }
  // electron-builder wrote every artifact into the per-version release folder.
  await mergeUpdateManifests(join(packageRoot, 'dist', pkg.version), pkg.version)
}
