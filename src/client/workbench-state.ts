/** Desktop workbench dock state: visibility, width, and browser-style tabs.
 *
 * The workbench is desktop-owned advanced-shell presentation. State lives in
 * one observable store so the root slot, the dock, and host-side preference
 * hydration all read the same immutable snapshots.
 */

/** Panel identities exposed by the top icon rail. */
export type WorkbenchPanelId = 'explorer' | 'terminal' | 'git' | 'browser'

/** Immutable dock snapshot published on every change. */
export interface WorkbenchSnapshot {
  /** Whether the dock column is expanded. */
  open: boolean
  /** Dock width in CSS pixels while expanded. */
  width: number
  /** Opened tabs in click order, rendered browser-style. */
  tabs: readonly WorkbenchPanelId[]
  /** Focused tab; null when nothing is open. */
  active: WorkbenchPanelId | null
  /** Start URL used by the embedded browser panel. */
  browserHome: string | undefined
}

export const WORKBENCH_WIDTH_DEFAULT = 400
export const WORKBENCH_WIDTH_MIN = 280
export const WORKBENCH_WIDTH_MAX = 640

/** Ordered rail entries; the array order is the button order. */
export const WORKBENCH_PANEL_IDS: readonly WorkbenchPanelId[] = ['explorer', 'terminal', 'git', 'browser']

function clampWidth(width: number): number {
  return Math.min(WORKBENCH_WIDTH_MAX, Math.max(WORKBENCH_WIDTH_MIN, Math.round(width)))
}

/**
 * Toggle the whole dock. Opening an empty dock reveals the explorer tab.
 * @param snapshot - current snapshot.
 * @returns the next snapshot.
 */
export function toggleWorkbench(snapshot: WorkbenchSnapshot): WorkbenchSnapshot {
  if (!snapshot.open) {
    const tabs = snapshot.tabs.length > 0 ? snapshot.tabs : (['explorer'] as const)
    const active = snapshot.active ?? tabs[0] ?? null
    return { ...snapshot, open: true, tabs: [...tabs], ...(active !== null ? { active } : {}) }
  }
  return { ...snapshot, open: false }
}

/**
 * Focus a rail icon: opens its tab when missing and focuses it otherwise,
 * browser-style. Multiple tabs stay open; only the caption toggle or the
 * in-dock collapse button hides the dock.
 * @param snapshot - current snapshot.
 * @param id - panel identity from the rail.
 * @returns the next snapshot.
 */
export function openWorkbenchPanel(snapshot: WorkbenchSnapshot, id: WorkbenchPanelId): WorkbenchSnapshot {
  const tabs = snapshot.tabs.includes(id) ? snapshot.tabs : [...snapshot.tabs, id]
  return { ...snapshot, open: true, tabs, active: id }
}

/**
 * Close one tab; focus moves to the right-hand neighbor, else the left-hand one.
 * @param snapshot - current snapshot.
 * @param id - tab to remove.
 * @returns the next snapshot.
 */
export function closeWorkbenchTab(snapshot: WorkbenchSnapshot, id: WorkbenchPanelId): WorkbenchSnapshot {
  const index = snapshot.tabs.indexOf(id)
  if (index < 0) return snapshot
  const tabs = snapshot.tabs.filter(tab => tab !== id)
  if (tabs.length === 0) return { ...snapshot, tabs, active: null, open: false }
  if (snapshot.active !== id) return { ...snapshot, tabs }
  const fallback = index >= tabs.length ? tabs[tabs.length - 1] : tabs[index]
  return { ...snapshot, tabs, ...(fallback !== undefined ? { active: fallback } : { active: null }) }
}

/**
 * Focus one already-opened tab without changing membership.
 * @param snapshot - current snapshot.
 * @param id - tab to focus.
 * @returns the next snapshot.
 */
export function activateWorkbenchTab(snapshot: WorkbenchSnapshot, id: WorkbenchPanelId): WorkbenchSnapshot {
  if (!snapshot.tabs.includes(id)) return snapshot
  return { ...snapshot, open: true, active: id }
}

/** Small observable store owned by the advanced shell and hydrated from prefs. */
export class WorkbenchState {
  private snapshot: WorkbenchSnapshot = Object.freeze({
    open: false,
    width: WORKBENCH_WIDTH_DEFAULT,
    tabs: [],
    active: null,
    browserHome: undefined,
  })
  private readonly listeners = new Set<() => void>()

  /** @returns the immutable current snapshot. */
  getSnapshot(): WorkbenchSnapshot {
    return this.snapshot
  }

  /** @param listener - callback notified after a snapshot replacement. @returns its disposer. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Toggle dock visibility. */
  toggle(): void {
    this.publish(toggleWorkbench(this.snapshot))
  }

  /** Open or focus a rail panel; clicking the focused panel collapses the dock. */
  openPanel(id: WorkbenchPanelId): void {
    this.publish(openWorkbenchPanel(this.snapshot, id))
  }

  /** Close one opened tab. */
  closeTab(id: WorkbenchPanelId): void {
    this.publish(closeWorkbenchTab(this.snapshot, id))
  }

  /** Focus one opened tab. */
  setActive(id: WorkbenchPanelId): void {
    this.publish(activateWorkbenchTab(this.snapshot, id))
  }

  /** @param width - requested dock width from a resize gesture. */
  setWidth(width: number): void {
    this.publish({ ...this.snapshot, width: clampWidth(width) })
  }

  /** @param home - start URL for the embedded browser panel. */
  setBrowserHome(home: string): void {
    this.publish({ ...this.snapshot, browserHome: home })
  }

  /** Publish an externally assembled snapshot; used by preference hydration. */
  publishExternal(next: WorkbenchSnapshot): void {
    this.publish({ ...next, tabs: [...next.tabs] })
  }

  private publish(next: WorkbenchSnapshot): void {
    this.snapshot = Object.freeze({ ...next, tabs: [...next.tabs] })
    for (const listener of this.listeners) listener()
  }
}

let store: WorkbenchState | undefined

/** @returns the process-wide workbench store shared by shell and prefs hydration. */
export function getWorkbenchStore(): WorkbenchState {
  store ??= new WorkbenchState()
  return store
}

/**
 * Apply one untrusted `workbench` prefs section into the store. Unknown fields
 * are dropped; malformed values keep their current in-memory defaults.
 * @param patch - parsed prefs section.
 */
export function applyWorkbenchPrefs(patch: unknown): void {
  if (typeof patch !== 'object' || patch === null) return
  const source = patch as Record<string, unknown>
  const current = getWorkbenchStore().getSnapshot()
  let next = current
  if (typeof source.open === 'boolean' && source.open !== current.open) next = { ...next, open: source.open }
  if (typeof source.width === 'number' && Number.isFinite(source.width)) next = { ...next, width: clampWidth(source.width) }
  if (typeof source.browserHome === 'string' && source.browserHome.length > 0) next = { ...next, browserHome: source.browserHome }
  if (next !== current) getWorkbenchStore().publishExternal(next)
}

/**
 * Extract the persistable prefs section from the store.
 * @returns a plain object merged into the desktop prefs file.
 */
export function readWorkbenchPrefs(): {
  open?: boolean
  width?: number
  browserHome?: string
} {
  const snapshot = getWorkbenchStore().getSnapshot()
  return {
    open: snapshot.open,
    width: snapshot.width,
    ...(snapshot.browserHome !== undefined ? { browserHome: snapshot.browserHome } : {}),
  }
}
