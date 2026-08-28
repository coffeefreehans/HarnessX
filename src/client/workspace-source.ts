/**
 * Workspace-source resolution for the dock panels: which absolute directory
 * the explorer/terminal/git/browser follow. Three sources exist — the live
 * session cwd, the workspaces-store projection, and the polled host route —
 * and a source that is defined but not absolute (a placeholder emitted before
 * a session has run) must fall through to the next one instead of shadowing
 * it.
 */

/** Only real absolute directories may drive dock panels; anything else is unknown. */
export function isAbsoluteWorkspacePath(value: string | undefined): value is string {
  if (value === undefined || value.length === 0) return false
  // `[\\/]` — the class must hold BOTH separators; `[\/]` is a lone slash and
  // rejects every genuine Windows `X:\...` path.
  return value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value)
}

/**
 * Pick the dock workspace by source priority.
 * @param sessionCwd - current session's working directory, when known.
 * @param storeWorkspace - workspace path projected by the workspaces store.
 * @param hostWorkspace - workspace path answered by the polled host route.
 * @returns the first absolute path, or undefined when no source has one.
 */
export function resolveDockWorkspace(
  sessionCwd: string | undefined,
  storeWorkspace: string | undefined,
  hostWorkspace: string | undefined,
): string | undefined {
  if (isAbsoluteWorkspacePath(sessionCwd)) return sessionCwd
  if (isAbsoluteWorkspacePath(storeWorkspace)) return storeWorkspace
  return isAbsoluteWorkspacePath(hostWorkspace) ? hostWorkspace : undefined
}
