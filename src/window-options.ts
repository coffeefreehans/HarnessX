/** BrowserWindow construction for compatibility and advanced shells. */

import type { BrowserWindowConstructorOptions, NativeImage } from 'electron'
import type { DesktopPlatform, DesktopShellSpec } from './runtime.ts'

/**
 * Build a secure BrowserWindow while preserving the operating system frame.
 * @param spec - shell values resolved from the active Cordis row.
 * @param icon - validated application icon.
 * @param platform - current Electron platform.
 * @returns options with a native frame and no custom materials.
 */
export function compatibilityWindowOptions(
  spec: DesktopShellSpec,
  icon: NativeImage,
  platform: DesktopPlatform,
): BrowserWindowConstructorOptions {
  if (spec.mode !== 'compatibility') {
    throw new Error(`harnessx-desktop: unsupported compatibility window mode ${spec.mode}`)
  }
  const options: BrowserWindowConstructorOptions = {
    title: platform === 'win32' ? spec.windowTitle : '',
    width: spec.width,
    height: spec.height,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    show: false,
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  }
  if (platform === 'win32') options.autoHideMenuBar = true
  return options
}

/**
 * Build the native material window used by the desktop-owned advanced shell.
 * @param spec - shell values resolved from the active Cordis row.
 * @param icon - validated application icon.
 * @param platform - current Electron platform.
 * @returns platform-native glass and window-control options.
 */
export function advancedWindowOptions(
  spec: DesktopShellSpec,
  icon: NativeImage,
  platform: DesktopPlatform,
): BrowserWindowConstructorOptions {
  if (spec.mode !== 'advanced') {
    throw new Error(`harnessx-desktop: unsupported advanced window mode ${spec.mode}`)
  }
  if (platform === 'linux') {
    throw new Error('harnessx-desktop: advanced shell mode is supported on macOS and Windows')
  }
  const options: BrowserWindowConstructorOptions = {
    title: platform === 'win32' ? spec.windowTitle : '',
    width: spec.width,
    height: spec.height,
    minWidth: spec.minWidth,
    minHeight: spec.minHeight,
    show: false,
    icon,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      // The advanced shell's workbench browser tab embeds guest pages through
      // the <webview> tag; guests keep the sandboxed defaults.
      webviewTag: true,
    },
  }
  // The kernel UI is now the entire interface, so advanced mode keeps the
  // same native OS frame as compatibility mode; only webviewTag differs (the
  // workbench browser tab). The former frameless/mica/overlay window left a
  // hard black strip above the kernel UI.
  if (platform === 'win32') options.autoHideMenuBar = true
  return options
}

/**
 * Select the BrowserWindow options for the active presentation mode.
 * @param spec - active shell generation.
 * @param icon - validated application icon.
 * @param platform - current Electron platform.
 * @returns mode-specific BrowserWindow options.
 */
export function desktopWindowOptions(
  spec: DesktopShellSpec,
  icon: NativeImage,
  platform: DesktopPlatform,
): BrowserWindowConstructorOptions {
  return spec.mode === 'compatibility'
    ? compatibilityWindowOptions(spec, icon, platform)
    : advancedWindowOptions(spec, icon, platform)
}
