/** Desktop-owned settings nav rows: group caption and per-section glyphs.
 *
 * The settings nav list is kernel-owned, but its row labels are registrant
 * data: each desktop section registers its label (and glyph) here, and a
 * MutationObserver decorates the matching nav buttons (dialog-scoped <nav>)
 * with data attributes plus a desktop glyph span. Styling keys off those
 * markers only — no kernel class names, no kernel code, and locale changes
 * simply re-run the decoration.
 */

const ICON_STROKE = 'fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"'

/** 16px outline glyphs drawn to sit beside the kernel's nav icon set. */
export const DESKTOP_NAV_ICONS = {
  /** Notifications: bell. */
  bell: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ${ICON_STROKE}><path d="M8 2.6a3.4 3.4 0 0 1 3.4 3.4v2.4l1.3 2.2H3.3l1.3-2.2V6A3.4 3.4 0 0 1 8 2.6Z"/><path d="M6.7 12.9a1.3 1.3 0 0 0 2.6 0"/></svg>`,
  /** Plugin market: app grid. */
  grid: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ${ICON_STROKE}><rect x="3" y="3" width="4.4" height="4.4" rx="1.1"/><rect x="8.6" y="3" width="4.4" height="4.4" rx="1.1"/><rect x="3" y="8.6" width="4.4" height="4.4" rx="1.1"/><rect x="8.6" y="8.6" width="4.4" height="4.4" rx="1.1"/></svg>`,
  /** Application updates: refresh. */
  refresh: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ${ICON_STROKE}><path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M13 3v3h-3"/></svg>`,
  /** Cloud sync: cloud. */
  cloud: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ${ICON_STROKE}><path d="M5 12.4h6.2a2.6 2.6 0 0 0 .5-5.2 4.2 4.2 0 0 0-8-.6 2.7 2.7 0 0 0-.7 5.3Z"/></svg>`,
  /** Multimodal models: eye. */
  eye: `<svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" ${ICON_STROKE}><path d="M1.8 8s2.2-4 6.2-4 6.2 4 6.2 4-2.2 4-6.2 4-6.2-4-6.2-4Z"/><circle cx="8" cy="8" r="2.1"/></svg>`,
} as const

const NAV_SECTION_CSS = `
[role="dialog"] nav button[data-harnessx-desktop] { position: relative; }
[role="dialog"] nav button[data-harnessx-desktop] > svg { display: none; }
[role="dialog"] nav .dshNavIconDesktop { flex: none; display: inline-flex; width: 16px; height: 16px; color: inherit; }
[role="dialog"] nav button[data-harnessx-desktop-first] { margin-top: 30px; }
[role="dialog"] nav button[data-harnessx-desktop-first]::before { content: "HARNESSX"; position: absolute; top: -22px; left: 12px; font-size: 10px; line-height: 14px; font-weight: 600; letter-spacing: 0.1em; color: var(--dsw-alias-label-tertiary); pointer-events: none; }
`

interface DesktopNavSection {
  readonly readLabel: () => string
  readonly icon: string
}

const navSections: DesktopNavSection[] = []
let stylesInstalled = false
let observer: MutationObserver | undefined

function ensureStyles(): void {
  if (stylesInstalled || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.dataset.plugin = 'harnessx-desktop'
  style.dataset.pluginCss = 'harnessx-desktop/settings-nav-separator'
  style.textContent = NAV_SECTION_CSS
  document.head.appendChild(style)
  stylesInstalled = true
}

function decorate(): void {
  if (typeof document === 'undefined') return
  let firstSeen = false
  for (const button of document.querySelectorAll<HTMLElement>('[role="dialog"] nav button')) {
    const label = (button.textContent ?? '').trim()
    const section = label.length > 0 ? navSections.find(entry => entry.readLabel() === label) : undefined
    if (section === undefined) {
      delete button.dataset.harnessxDesktop
      delete button.dataset.harnessxDesktopFirst
      button.querySelector(':scope > .dshNavIconDesktop')?.remove()
      continue
    }
    button.dataset.harnessxDesktop = 'true'
    if (!firstSeen) {
      button.dataset.harnessxDesktopFirst = 'true'
      firstSeen = true
    } else {
      delete button.dataset.harnessxDesktopFirst
    }
    let glyph = button.querySelector<HTMLElement>(':scope > .dshNavIconDesktop')
    if (glyph === null) {
      glyph = document.createElement('span')
      glyph.className = 'dshNavIconDesktop'
      button.insertBefore(glyph, button.firstChild)
    }
    if (glyph.dataset.icon !== section.icon) {
      glyph.dataset.icon = section.icon
      glyph.innerHTML = section.icon
    }
  }
}

/** Register one desktop-owned section's nav label and glyph, then decorate. */
export function registerDesktopSettingsNavSection(readLabel: () => string, icon: string): void {
  navSections.push({ readLabel, icon })
  if (typeof document === 'undefined') return
  ensureStyles()
  if (observer === undefined) {
    observer = new MutationObserver(() => { decorate() })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  }
  decorate()
}
