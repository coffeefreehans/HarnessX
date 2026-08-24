/** Desktop filesystem guard for externally installed host plugins.
 *
 * Community plugins run in-process with full Node.js access. This module uses
 * Node's synchronous module customization hooks so that ONLY module graphs
 * rooted outside the trusted tree observe a wrapped `node:fs` /
 * `node:fs/promises`: graphs rooted under the desktop external zone (the DSH
 * home, where profiles and community plugin installs live) whose innermost
 * `node_modules` segment is not an upstream `@deepseek-ai/*` or desktop
 * package, plus unknown dynamic origins (`data:`, `blob:`). In guarded graphs
 * the deletion family (unlink / rm / rmdir / rename) throws unless every
 * affected path sits inside an allowed root — the DSH home, the OS temp
 * directory, or the app's userData directory — so a plugin can manage its own
 * data but cannot delete system files. Every other module graph keeps the
 * untouched builtin.
 */

import { registerHooks } from 'node:module'
import * as fsReal from 'node:fs'
import * as fsPromisesReal from 'node:fs/promises'

const GUARD_QUERY = '?harnessx-real'
const GUARD_SCHEME = 'harnessx-fs-guard:'
const FS_SPECIFIERS = new Set(['fs', 'node:fs', 'fs/promises', 'node:fs/promises'])
/** Deletion family on the node:fs surface (callback + sync variants). */
const DESTRUCTIVE_FS_APIS = ['unlink', 'unlinkSync', 'rm', 'rmSync', 'rmdir', 'rmdirSync', 'rename', 'renameSync'] as const
/** Deletion family on the node:fs/promises surface. */
const DESTRUCTIVE_PROMISE_APIS = ['unlink', 'rm', 'rmdir', 'rename'] as const

interface FsGuardConfig {
  allowedRoots: readonly string[]
}

/** Process-wide configuration consumed by generated guard shims. */
function setGuardConfig(allowedRoots: readonly string[]): void {
  ;(globalThis as { __HARNESSX_FS_GUARD__?: FsGuardConfig }).__HARNESSX_FS_GUARD__ = {
    allowedRoots: [...allowedRoots],
  }
}

/**
 * Decide whether a module graph rooted at `parentUrl` observes guarded fs.
 *
 * `externalZoneUrl` is the file URL of the desktop external zone (the DSH
 * home). The Cordis loader resolves plugin entries with the profile directory
 * itself as the parent URL — no `node_modules` segment exists yet — so zone
 * membership is checked first and only then the trusted-tail test; otherwise
 * whole plugin entry modules would slip through unguarded.
 */
export function isExternalModuleParent(parentUrl: string | undefined, externalZoneUrl: string | undefined): boolean {
  if (parentUrl === undefined || parentUrl === '') return false
  if (parentUrl.startsWith(GUARD_SCHEME)) return false
  // data:/blob: parents carry third-party code by construction.
  if (parentUrl.startsWith('data:') || parentUrl.startsWith('blob:')) return true
  if (!parentUrl.startsWith('file://')) return false
  const normalized = parentUrl.replaceAll('\\', '/')
  if (normalized.includes('/.harnessx-desktop/plugins/')) return true
  if (externalZoneUrl !== undefined && normalized.startsWith(externalZoneUrl)) {
    return !isTrustedModuleTail(normalized)
  }
  return false
}

/** Whether the innermost `node_modules` segment names a trusted package tree. */
function isTrustedModuleTail(url: string): boolean {
  const marker = '/node_modules/'
  const markerIndex = url.lastIndexOf(marker)
  if (markerIndex === -1) return false
  const tail = url.slice(markerIndex + marker.length)
  return tail.startsWith('@deepseek-ai/') || tail.startsWith('harnessx-desktop/')
}

function exportedKeys(namespace: object): string[] {
  return Object.keys(namespace).filter(key => /^[A-Za-z_$][\w$]*$/.test(key))
}

/**
 * Generate the virtual module source shadowing one real builtin namespace.
 * Every original export is re-exported; deletion-family functions become
 * allowlist-checked wrappers, everything else passes through untouched.
 */
export function buildFsGuardShimSource(realSpecifier: 'fs' | 'fs/promises'): string {
  const real = realSpecifier === 'fs' ? fsReal : fsPromisesReal
  const apis = realSpecifier === 'fs' ? DESTRUCTIVE_FS_APIS : DESTRUCTIVE_PROMISE_APIS
  const names = exportedKeys(real).filter(key => key !== 'default' && key !== 'promises')
  return `
import * as real from ${JSON.stringify(`node:${realSpecifier}${GUARD_QUERY}`)};
import * as pathMod from 'node:path';
const config = globalThis.__HARNESSX_FS_GUARD__ ?? { allowedRoots: [] };
function isAllowed(target) {
  try {
    const resolved = pathMod.resolve(String(target));
    return config.allowedRoots.some(root => resolved === root || resolved.startsWith(root + pathMod.sep));
  } catch {
    return false;
  }
}
function blockedError(name, target) {
  return new Error('HarnessX 插件防护: 外部插件禁止在应用数据与临时目录之外执行 ' + name + '(' + target + ')');
}
function wrap(original, name, checksRename, asyncMode) {
  return function (...args) {
    const first = String(args[0] ?? '');
    if (isAllowed(first) && (!checksRename || isAllowed(String(args[1] ?? '')))) {
      return original.apply(this, args);
    }
    const target = isAllowed(first) ? String(args[1] ?? '') : first;
    const error = blockedError(name, target);
    // Promise-surface callers expect rejection, not a synchronous throw.
    return asyncMode ? Promise.reject(error) : (() => { throw error; })();
  };
}
const out = { ...real };
const topLevelAsync = ${realSpecifier === 'fs' ? 'false' : 'true'};
for (const name of ${JSON.stringify([...apis])}) {
  const original = out[name];
  if (typeof original === 'function') out[name] = wrap(original, name, name.startsWith('rename'), topLevelAsync);
}
${realSpecifier === 'fs'
    ? `out.promises = { ...real.promises };
for (const name of ['unlink', 'rm', 'rmdir', 'rename']) {
  const original = out.promises[name];
  if (typeof original === 'function') out.promises[name] = wrap(original, 'promises.' + name, name === 'rename', true);
}`
    : ''}
export const { ${names.join(', ')} } = out;
export default out;
`
}

/**
 * Install the guard hooks for the remainder of this process.
 * @param options.allowedRoots - Paths whose contents guarded graphs may delete inside.
 * @param options.externalZoneUrl - File URL of the DSH home; module graphs under it are external.
 * @param options.debug - Optional diagnostics sink.
 * @returns an idempotent hook disposer.
 */
export function installPluginFsGuard(options: {
  allowedRoots: readonly string[]
  externalZoneUrl?: string
  debug?: (message: string) => void
}): () => void {
  setGuardConfig(options.allowedRoots)
  // Zone membership compares URL prefixes; without the trailing slash a
  // sibling directory sharing the zone's name prefix would count as inside.
  const zoneUrl = options.externalZoneUrl === undefined || options.externalZoneUrl.endsWith('/')
    ? options.externalZoneUrl
    : `${options.externalZoneUrl}/`
  const shimCache = new Map<string, string>()
  const shimFor = (kind: 'fs' | 'fs/promises'): string => {
    let source = shimCache.get(kind)
    if (source === undefined) {
      source = buildFsGuardShimSource(kind)
      shimCache.set(kind, source)
    }
    return source
  }
  const hooks = registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.endsWith(GUARD_QUERY)) {
        return nextResolve(specifier.slice(0, -GUARD_QUERY.length), context)
      }
      if (FS_SPECIFIERS.has(specifier) && isExternalModuleParent(context.parentURL, zoneUrl)) {
        return { url: `${GUARD_SCHEME}${specifier}`, shortCircuit: true }
      }
      return nextResolve(specifier, context)
    },
    load(url, _context, nextLoad) {
      if (url.startsWith(GUARD_SCHEME)) {
        const specifier = url.slice(GUARD_SCHEME.length)
        const kind = specifier.includes('/promises') ? 'fs/promises' : 'fs'
        return { format: 'module', source: shimFor(kind), shortCircuit: true }
      }
      return nextLoad(url, _context)
    },
  })
  options.debug?.(
    `plugin fs guard active: external modules may only delete inside ${options.allowedRoots.join(', ')}`,
  )
  let active = true
  return () => {
    if (!active) return
    active = false
    hooks.deregister()
  }
}
