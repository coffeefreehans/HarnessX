/** Shared visual separator for desktop-owned settings sections.
 *
 * Kernel-native settings pages and HarnessX desktop pages (Notifications,
 * Plugin Market, Application Updates, Cloud Sync) render side by side in one
 * settings panel; this header draws the line between the two families without
 * touching any kernel-owned surface.
 */

import type { ReactNode } from 'react'

const DESKTOP_SECTION_CSS = `
.dshDesktopSectionHeader { display: flex; align-items: center; gap: 10px; margin: 2px 0 10px; }
.dshDesktopSectionHeader::after { content: ""; flex: 1; height: 1px; background: var(--dsw-alias-border-l2); }
.dshDesktopSectionBadge { flex: none; display: inline-flex; align-items: center; height: 20px; padding: 0 8px; border-radius: 10px; border: 1px solid var(--dsw-alias-border-l2); background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.03)); font-size: 10px; font-weight: 600; letter-spacing: 0.08em; color: var(--dsw-alias-label-tertiary); }
`

let stylesInjected = false
function ensureDesktopSectionStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.dataset.plugin = 'harnessx-desktop'
  style.dataset.pluginCss = 'harnessx-desktop/desktop-section'
  style.textContent = DESKTOP_SECTION_CSS
  document.head.appendChild(style)
  stylesInjected = true
}

/** One-line separator marking a settings page as desktop-owned rather than kernel-native. */
export function DesktopSectionHeader(): ReactNode {
  ensureDesktopSectionStyles()
  return (
    <div className="dshDesktopSectionHeader">
      <span className="dshDesktopSectionBadge">HARNESSX DESKTOP</span>
    </div>
  )
}
