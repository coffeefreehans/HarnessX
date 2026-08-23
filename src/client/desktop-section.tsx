/** Left-nav separation between kernel-native and desktop-owned settings sections.
 *
 * The settings nav list is kernel-owned, but its row labels are registrant
 * data: each desktop section registers its label here, and a MutationObserver
 * annotates the matching nav buttons (dialog-scoped <nav>) with data
 * attributes. Styling keys off those attributes only — no kernel class names,
 * no kernel code, and locale changes simply re-run the decoration.
 */

const NAV_SEPARATOR_CSS = `
[role="dialog"] nav button[data-harnessx-desktop] > span::before { content: ""; display: inline-block; width: 5px; height: 5px; margin-right: 7px; border-radius: 50%; background: var(--dsw-alias-accent, #2563eb); opacity: 0.65; vertical-align: middle; }
[role="dialog"] nav button[data-harnessx-desktop-first] { margin-top: 6px; border-top: 1px solid var(--dsw-alias-border-l2); }
`

type LabelReader = () => string

const labelReaders = new Set<LabelReader>()
let stylesInstalled = false
let observer: MutationObserver | undefined

function ensureStyles(): void {
  if (stylesInstalled || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.dataset.plugin = 'harnessx-desktop'
  style.dataset.pluginCss = 'harnessx-desktop/settings-nav-separator'
  style.textContent = NAV_SEPARATOR_CSS
  document.head.appendChild(style)
  stylesInstalled = true
}

function isDesktopLabel(text: string): boolean {
  for (const read of labelReaders) {
    if (read() === text) return true
  }
  return false
}

function decorate(): void {
  if (typeof document === 'undefined') return
  let firstSeen = false
  for (const button of document.querySelectorAll<HTMLElement>('[role="dialog"] nav button')) {
    const label = (button.textContent ?? '').trim()
    if (label.length > 0 && isDesktopLabel(label)) {
      button.dataset.harnessxDesktop = 'true'
      if (!firstSeen) {
        button.dataset.harnessxDesktopFirst = 'true'
        firstSeen = true
      } else {
        delete button.dataset.harnessxDesktopFirst
      }
    } else {
      delete button.dataset.harnessxDesktop
      delete button.dataset.harnessxDesktopFirst
    }
  }
}

/** Register one desktop-owned section's current nav label and start decorating. */
export function registerDesktopSettingsNavLabel(read: LabelReader): void {
  labelReaders.add(read)
  if (typeof document === 'undefined') return
  ensureStyles()
  if (observer === undefined) {
    observer = new MutationObserver(() => { decorate() })
    observer.observe(document.body, { childList: true, subtree: true, characterData: true })
  }
  decorate()
}
