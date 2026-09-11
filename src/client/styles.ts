import { MACOS_TITLEBAR_HEIGHT, WINDOWS_TITLEBAR_HEIGHT } from '../window-chrome.ts'

/** Advanced-shell stylesheet kept as a plain string so the package client bundle stays self-contained. */
const ADVANCED_STYLES = `
html, body, #root { width: 100%; height: 100%; }
body[data-dsh-desktop-mode="advanced"] { margin: 0; background: transparent !important; }
/* The hidden native title bars (Electron overlay on Windows, inset traffic
 * lights on macOS) sit over the kernel UI; shift it down under them. */
body[data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="win32"] #root { padding-top: ${WINDOWS_TITLEBAR_HEIGHT}px; }
body[data-dsh-desktop-mode="advanced"][data-dsh-desktop-platform="darwin"] #root { padding-top: ${MACOS_TITLEBAR_HEIGHT}px; }
`

/**
 * Install the advanced body-level stylesheet for one shell lifetime.
 * @returns a disposer removing the style element.
 */
export function installAdvancedStyles(): () => void {
  const style = document.createElement('style')
  style.dataset.plugin = 'harnessx-desktop'
  style.dataset.pluginCss = 'harnessx-desktop/advanced-body'
  style.textContent = ADVANCED_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}
