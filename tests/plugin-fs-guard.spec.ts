import { spawn } from 'node:child_process'
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { buildFsGuardShimSource, isExternalModuleParent } from '../src/plugin-fs-guard.ts'

const tempDirs: string[] = []

afterEach(async () => {
  // Children clean their own trees; keep the parent list bounded regardless.
  tempDirs.length = 0
})

describe('external module parent classification', () => {
  const zone = 'file:///C:/Users/dev/.dsh'

  it('treats guard-scheme parents as internal so shims can re-export the real builtin', () => {
    expect(isExternalModuleParent('harnessx-fs-guard:node:fs', undefined)).toBe(false)
  })

  it('treats data and blob parents as external', () => {
    expect(isExternalModuleParent('data:text/javascript,export {}', undefined)).toBe(true)
    expect(isExternalModuleParent('blob:file:///e3b0c442', undefined)).toBe(true)
  })

  it('guards community plugin installs wherever they sit under the external zone', () => {
    expect(isExternalModuleParent(`${zone}/profiles/desktop/.harnessx-desktop/plugins/x/lib/index.js`, `${zone}/`)).toBe(true)
    expect(isExternalModuleParent(`${zone}/loose-plugin.mjs`, `${zone}/`)).toBe(true)
    expect(isExternalModuleParent(`${zone}/profiles/desktop/node_modules/@linxin666/ui/index.js`, `${zone}/`)).toBe(true)
  })

  it('keeps upstream and desktop package graphs on the builtin fs', () => {
    expect(isExternalModuleParent(`${zone}/profiles/desktop/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js`, `${zone}/`)).toBe(false)
    expect(isExternalModuleParent(`${zone}/profiles/desktop/node_modules/harnessx-desktop/windows-pwsh-sandbox.js`, `${zone}/`)).toBe(false)
    expect(isExternalModuleParent('file:///C:/Program Files/HarnessX/resources/app.asar/lib/index.js', `${zone}/`)).toBe(false)
  })

  it('ignores empty parents and prefix-colliding sibling zones', () => {
    expect(isExternalModuleParent(undefined, `${zone}/`)).toBe(false)
    expect(isExternalModuleParent('', `${zone}/`)).toBe(false)
    expect(isExternalModuleParent('file:///C:/Users/dev/.dsh2/plugin/index.js', `${zone}/`)).toBe(false)
  })

  it('still catches plugin dirs when no zone was provided', () => {
    expect(isExternalModuleParent('file:///C:/Users/dev/.harnessx-desktop/plugins/a/index.js', undefined)).toBe(true)
  })
})

describe('guard shim generation', () => {
  it('wraps the whole deletion family on the node:fs surface including nested promises', () => {
    const source = buildFsGuardShimSource('fs')
    for (const api of ['unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'rename', 'renameSync']) {
      expect(source).toContain(JSON.stringify(api))
    }
    expect(source).toContain("from \"node:fs?harnessx-real\"")
    expect(source).toContain("out.promises")
    expect(source).toContain('export default out;')
  })

  it('wraps the promise surface without a nested promises block', () => {
    const source = buildFsGuardShimSource('fs/promises')
    expect(source).toContain("\"unlink\"")
    expect(source).not.toContain("'promises.'")
  })
})

interface ChildProbeResult {
  external: {
    syncOutsideDeleted: boolean
    syncOutsideMessage: string
    syncInsideOk: boolean
    promisesOutsideDeleted: boolean
  }
  trusted: {
    outsideDeleted: boolean
  }
}

/**
 * Run one child Node process that installs the guard and probes deletion from
 * an external plugin graph and a trusted @deepseek-ai graph. Hooks are
 * process-global, so the end-to-end proof must not share this worker's loader.
 */
async function runGuardChild(): Promise<ChildProbeResult> {
  const scratch = await mkdtemp(join(tmpdir(), 'harnessx-fs-guard-'))
  tempDirs.push(scratch)
  const home = join(scratch, 'home')
  const allowed = join(scratch, 'allowed')
  await mkdir(join(home, '.harnessx-desktop', 'plugins', 'bad'), { recursive: true })
  await mkdir(join(home, 'node_modules', '@deepseek-ai', 'trusted'), { recursive: true })
  await mkdir(allowed, { recursive: true })

  await writeFile(
    join(home, '.harnessx-desktop', 'plugins', 'bad', 'index.mjs'),
    [
      'import * as fs from \'node:fs\'',
      'import * as fsp from \'node:fs/promises\'',
      'export function probe(outsideFile, insideFile) {',
      '  let syncOutsideDeleted = false',
      '  let syncOutsideMessage = \'\'',
      '  try {',
      '    fs.unlinkSync(outsideFile)',
      '    syncOutsideDeleted = true',
      '  } catch (error) {',
      '    syncOutsideMessage = error instanceof Error ? error.message : String(error)',
      '  }',
      '  let syncInsideOk = false',
      '  try {',
      '    fs.writeFileSync(insideFile, \'scratch\')',
      '    fs.unlinkSync(insideFile)',
      '    syncInsideOk = true',
      '  } catch {',
      '    syncInsideOk = false',
      '  }',
      '  let promisesOutsideDeleted = false',
      '  return fsp.unlink(outsideFile)',
      '    .then(() => { promisesOutsideDeleted = true }, () => { promisesOutsideDeleted = false })',
      '    .then(() => ({ syncOutsideDeleted, syncOutsideMessage, syncInsideOk, promisesOutsideDeleted }))',
      '}',
    ].join('\n'),
    'utf8',
  )
  await writeFile(
    join(home, 'node_modules', '@deepseek-ai', 'trusted', 'index.mjs'),
    [
      'import * as fs from \'node:fs\'',
      'export function probe(outsideFile) {',
      '  fs.unlinkSync(outsideFile)',
      '  return { outsideDeleted: !fs.existsSync(outsideFile) }',
      '}',
    ].join('\n'),
    'utf8',
  )

  const outsideFile = join(scratch, 'outside.txt')
  const insideFile = join(allowed, 'inside.txt')
  await writeFile(outsideFile, 'delete me', 'utf8')

  const driverPath = fileURLToPath(new URL('./fixtures/fs-guard-driver.mjs', import.meta.url))
  const child = spawn(process.execPath, [
    '--no-warnings',
    driverPath,
    home,
    allowed,
    outsideFile,
    insideFile,
  ], { stdio: ['ignore', 'pipe', 'pipe'] })
  let stdout = ''
  let stderr = ''
  child.stdout.on('data', chunk => { stdout += String(chunk) })
  child.stderr.on('data', chunk => { stderr += String(chunk) })
  const code = await new Promise<number>((resolve, reject) => {
    child.on('error', reject)
    child.on('exit', exitCode => { resolve(exitCode ?? -1) })
  })
  if (code !== 0) {
    throw new Error(`fs guard driver exited ${code}: ${stderr}`)
  }
  const lines = stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1] ?? '{}') as ChildProbeResult
}

describe('plugin fs guard end to end', () => {
  it('blocks external plugin deletions outside allowed roots while trusted graphs stay native', async () => {
    const result = await runGuardChild()
    expect(result.external.syncOutsideDeleted).toBe(false)
    expect(result.external.syncOutsideMessage).toContain('插件防护')
    expect(result.external.promisesOutsideDeleted).toBe(false)
    expect(result.external.syncInsideOk).toBe(true)
    expect(result.trusted.outsideDeleted).toBe(true)
  })
})
