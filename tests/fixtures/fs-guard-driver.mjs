/** End-to-end driver for the plugin fs guard spec.
 *
 * Installs the guard with one fake allowed root, then probes deletion from a
 * community-plugin graph and an upstream @deepseek-ai graph. Lives outside the
 * fake zone so its own fs usage stays native; prints one JSON result line.
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { installPluginFsGuard } from '../../src/plugin-fs-guard.ts'

const [homeDir, allowedDir, outsideFile, insideFile] = process.argv.slice(2)

installPluginFsGuard({
  allowedRoots: [allowedDir],
  externalZoneUrl: pathToFileURL(homeDir).href,
  debug: message => { console.error(message) },
})

await mkdir(allowedDir, { recursive: true })

const bad = await import(pathToFileURL(join(homeDir, '.harnessx-desktop', 'plugins', 'bad', 'index.mjs')).href)
const external = await bad.probe(outsideFile, insideFile)

await writeFile(outsideFile, 'delete me too', 'utf8')
const trusted = await import(pathToFileURL(join(homeDir, 'node_modules', '@deepseek-ai', 'trusted', 'index.mjs')).href)

console.log(JSON.stringify({ external, trusted: trusted.probe(outsideFile) }))
