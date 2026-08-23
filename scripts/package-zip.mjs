import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rmSync, writeFileSync } from 'node:fs'

const require = createRequire(import.meta.url)
const packageRoot = dirname(dirname(fileURLToPath(import.meta.url)))
const builderCli = require.resolve('electron-builder/cli.js')

/**
 * The portable build ships every provider (including the optional Pi-AI cluster
 * that pulls the heavy @mistralai/@aws-sdk/@smithy SDKs with intrinsically long
 * vendored filenames). Windows Explorer's built-in zip handler still fails past
 * the 260-character path ceiling, so the portable artifact is emitted as a 7z
 * archive instead: the 7z format and its extractors are long-path safe and have
 * no such limit. The full NSIS installer keeps the same payload unchanged.
 */
const manifest = require(join(packageRoot, 'package.json'))
const portableConfig = {
  ...manifest.build,
  files: manifest.build?.files ?? [],
}
const configPath = join(packageRoot, 'dist', '.portable-electron-builder.json')
writeFileSync(configPath, JSON.stringify(portableConfig))

try {
  const result = spawnSync(process.execPath, [
    builderCli,
    '--win',
    '7z',
    '--x64',
    '--publish',
    'never',
    '--config',
    configPath,
    '--config.win.signExecutable=false',
    '--config.npmRebuild=false',
  ], {
    cwd: packageRoot,
    env: {
      ...process.env,
      CSC_IDENTITY_AUTO_DISCOVERY: 'false',
    },
    stdio: 'inherit',
  })

  if (result.error !== undefined) throw result.error
  if (result.status !== 0) {
    throw new Error(`electron-builder 7z exited with ${String(result.status)}`)
  }
} finally {
  rmSync(configPath, { force: true })
}
