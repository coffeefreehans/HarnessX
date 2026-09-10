/** Desktop renderer modes accepted from the Electron-owned page URL. */
export type DesktopClientMode = 'compatibility' | 'advanced'

/** Host platforms whose native chrome has a desktop presentation. */
export type DesktopClientPlatform = 'darwin' | 'win32' | 'linux'

/** Validated renderer environment supplied by the Electron Host. */
export interface DesktopClientEnvironment {
  /** Active shell mode for this BrowserWindow lifetime. */
  mode: DesktopClientMode
  /** Electron Host platform used for native spacing and drag regions. */
  platform: DesktopClientPlatform
}

const MODES = new Set<DesktopClientMode>(['compatibility', 'advanced'])
const PLATFORMS = new Set<DesktopClientPlatform>(['darwin', 'win32', 'linux'])

/**
 * Validate the Electron-owned markers before any desktop client effects run.
 * The 0.1.5-rc.1 Connection carrier's token entry redirects to a clean `/`
 * query, so the markers ride the URL fragment (browsers preserve fragments
 * across redirects); both placements stay accepted.
 * @param search - URL search string, including or omitting the leading question mark.
 * @param hash - URL fragment, including or omitting the leading hash sign.
 * @returns the validated desktop renderer environment.
 */
export function parseDesktopClientEnvironment(search: string, hash: string = ''): DesktopClientEnvironment {
  const params = new URLSearchParams(`${search.replace(/^\?/u, '')}${hash.length > 0 ? `&${hash.replace(/^#/u, '')}` : ''}`)
  const mode = params.get('dsh-desktop-mode')
  const platform = params.get('dsh-desktop-platform')
  if (!MODES.has(mode as DesktopClientMode)) {
    throw new Error(`harnessx-desktop: invalid or missing dsh-desktop-mode ${JSON.stringify(mode)}`)
  }
  if (!PLATFORMS.has(platform as DesktopClientPlatform)) {
    throw new Error(`harnessx-desktop: invalid or missing dsh-desktop-platform ${JSON.stringify(platform)}`)
  }
  return { mode: mode as DesktopClientMode, platform: platform as DesktopClientPlatform }
}
