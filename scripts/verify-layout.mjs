import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { basename, resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const run = (command, args, cwd = root) => execFileSync(command, args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim()
const fail = message => { throw new Error(`verify-layout: ${message}`) }

const manifest = readJson('package.json')
const upstream = readJson('upstream.json')
const upstreamPackage = readJson('deepseek-harness/package.json')
const noteDirectory = '.agents/notes/implemented/process'
const noteName = '2026-08-15-pinned-upstream-and-isolated-yarn-workspace'
const notePaths = [`${noteDirectory}/${noteName}.md`, `${noteDirectory}/${noteName}.zh.md`]
const noteRecordPath = `${noteDirectory}/${noteName}.i18n.yaml`

if (manifest.packageManager !== 'yarn@4.18.0') {
  fail('the product package must pin yarn@4.18.0')
}
if (manifest.name !== 'harnessx-desktop') {
  fail('the root package must be named harnessx-desktop')
}
if (manifest.workspaces !== undefined) {
  fail('the flattened root package must not declare child workspaces')
}
const claudePath = resolve(root, 'CLAUDE.md')
// Git may materialize symlinks as target-path stubs when Windows symlink support is disabled.
const claudeStat = lstatSync(claudePath)
const hasClaudeSymlink = claudeStat.isSymbolicLink() && readlinkSync(claudePath) === 'AGENTS.md'
const hasClaudeStub = claudeStat.isFile() && readFileSync(claudePath, 'utf8').trim() === 'AGENTS.md'
if (!hasClaudeSymlink && !hasClaudeStub) {
  fail('CLAUDE.md must link to the outer repository AGENTS.md')
}
for (const legacyFile of [
  'pnpm-lock.yaml',
  'pnpm-workspace.yaml',
  'harnessx-desktop',
]) {
  if (existsSync(resolve(root, legacyFile))) fail(`${legacyFile} must not exist`)
}
if (typeof upstreamPackage.packageManager !== 'string' || !upstreamPackage.packageManager.startsWith('pnpm@')) {
  fail('the upstream source snapshot must retain its pnpm package manager')
}

for (const [owner, packageManifest] of [['root', manifest]]) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies', 'resolutions']) {
    for (const [name, range] of Object.entries(packageManifest[field] ?? {})) {
      if (typeof range !== 'string') continue
      if (/^(?:workspace|portal|link):/u.test(range)
        || (range.startsWith('file:') && range.includes('deepseek-harness'))) {
        fail(`${owner} ${field}.${name} bypasses the published DSH package boundary`)
      }
    }
  }
}

const upstreamDir = resolve(root, 'deepseek-harness')
if (!existsSync(upstreamDir) || !lstatSync(upstreamDir).isDirectory()) {
  fail('deepseek-harness must be a regular directory')
}
if (existsSync(resolve(upstreamDir, '.git'))) {
  fail('deepseek-harness must not contain a nested Git directory')
}
if (upstreamPackage.version !== upstream.sourceVersion) {
  fail('deepseek-harness package version differs from upstream.json')
}
for (const name of Object.keys(manifest.dependencies).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))) {
  if (manifest.dependencies[name] !== upstream.runtimePackageVersion) {
    fail(`${name} must use the recorded DSH runtime package family`)
  }
}

const noteRecord = readFileSync(resolve(root, noteRecordPath), 'utf8')
for (const notePath of notePaths) {
  const expected = run('git', ['hash-object', '--', notePath])
  const recordLine = `${basename(notePath)}: ${expected}`
  if (!noteRecord.split(/\r?\n/u).includes(recordLine)) {
    fail(`${noteRecordPath} is stale for ${notePath}`)
  }
}

process.stdout.write(`verify-layout: flattened Yarn package and upstream ${upstream.commit.slice(0, 10)} are consistent\n`)
