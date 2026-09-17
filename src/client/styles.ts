
/** Advanced-shell stylesheet kept as a plain string so the package client bundle stays self-contained. */
const ADVANCED_STYLES = `
html, body, #root { width: 100%; height: 100%; }
body[data-dsh-desktop-mode="advanced"] { margin: 0; background: transparent !important; }
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
