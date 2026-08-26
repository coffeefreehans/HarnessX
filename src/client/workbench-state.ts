/** Desktop workbench dock state: visibility, width, and browser-style tabs.
 *
 * The workbench is desktop-owned advanced-shell presentation. State lives in
 * one observable store so the root slot, the dock, and host-side preference
 * hydration all read the same immutable snapshots.
 */

/** Panel identities exposed by the top icon rail. */
export type WorkbenchPanelId = 'explorer' | 'terminal' | 'git' | 'browser' | 'chat'

/** Immutable dock snapshot published on every change. */
export interface WorkbenchSnapshot {
  /** Whether the dock column is expanded. */
  open: boolean
  /** Dock width in CSS pixels while expanded. */
  width: number
  /** Opened panels in click order, stacked vertically inside the body. */
  tabs: readonly WorkbenchPanelId[]
  /** Focused panel; null when nothing is open. */
  active: WorkbenchPanelId | null
  /** Start URL used by the embedded browser panel. */
  browserHome: string | undefined
  /** Pane heights in CSS pixels; absent entries use per-panel defaults. */
  sizes: Readonly<Partial<Record<WorkbenchPanelId, number>>>
}

export const WORKBENCH_WIDTH_DEFAULT = 400
export const WORKBENCH_WIDTH_MIN = 280
export const WORKBENCH_WIDTH_MAX = 640

export const WORKBENCH_PANE_MIN = 96
export const WORKBENCH_PANE_MAX = 4000

/** Default pane height per panel until the user drags its splitter. */
export const WORKBENCH_PANE_DEFAULTS: Readonly<Record<WorkbenchPanelId, number>> = {
  explorer: 240,
  terminal: 200,
  git: 260,
  browser: 280,
  chat: 320,
}

/** Ordered rail entries; the array order is the button order. */
export const WORKBENCH_PANEL_IDS: readonly WorkbenchPanelId[] = ['explorer', 'terminal', 'git', 'browser', 'chat']

function clampWidth(width: number): number {
  return Math.min(WORKBENCH_WIDTH_MAX, Math.max(WORKBENCH_WIDTH_MIN, Math.round(width)))
}

function clampPane(size: number): number {
  return Math.min(WORKBENCH_PANE_MAX, Math.max(WORKBENCH_PANE_MIN, Math.round(size)))
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
 * Focus a rail icon: reveals its pane when missing and focuses it otherwise.
 * Several panes stay visible at once, stacked vertically; only the caption
 * toggle or the in-dock collapse button hides the dock.
 * @param snapshot - current snapshot.
 * @param id - panel identity from the rail.
 * @returns the next snapshot.
 */
export function openWorkbenchPanel(snapshot: WorkbenchSnapshot, id: WorkbenchPanelId): WorkbenchSnapshot {
  const tabs = snapshot.tabs.includes(id) ? snapshot.tabs : [...snapshot.tabs, id]
  return { ...snapshot, open: true, tabs, active: id }
}

/**
 * Set one pane's height after a splitter drag.
 * @param snapshot - current snapshot.
 * @param id - pane to resize.
 * @param size - requested height in CSS pixels.
 * @returns the next snapshot.
 */
export function resizeWorkbenchPane(snapshot: WorkbenchSnapshot, id: WorkbenchPanelId, size: number): WorkbenchSnapshot {
  return { ...snapshot, sizes: { ...snapshot.sizes, [id]: clampPane(size) } }
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
    sizes: {},
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

  /** Open or focus a rail panel; clicking an already-visible one is a no-op focus. */
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

  /** @param id - pane to resize. @param size - requested height from a splitter drag. */
  setPaneSize(id: WorkbenchPanelId, size: number): void {
    this.publish(resizeWorkbenchPane(this.snapshot, id, size))
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
    this.snapshot = Object.freeze({ ...next, tabs: [...next.tabs], sizes: { ...next.sizes } })
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

/* ------------------------------------------------------------------ */
/* Auxiliary chat history folding                                      */
/* ------------------------------------------------------------------ */

/** One folded auxiliary-chat bubble. */
export interface AuxMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
}

/** Auxiliary-conversation view state backed by one real upstream session. */
export interface AuxConversation {
  sessionId: string
  /** Stable per-page ordinal shown in the tab title. */
  index: number
  messages: AuxMessage[]
  /** Text accepted by the host but not yet echoed back by history. */
  pendingText: string | undefined
  /** In-flight assistant partial folded from trailing chunk events. */
  streamingText: string | undefined
  /** A user message still waits for its turn to finish (or fail). */
  awaitingReply: boolean
  error: string | undefined
}

/**
 * Extract the visible text out of a content-block array; reasoning and tool
 * blocks never render as chat text.
 * @param content - raw ContentBlock[] off the wire.
 * @returns the concatenated text.
 */
export function auxBlockText(content: unknown): string {
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (typeof block === 'object' && block !== null && (block as { type?: unknown }).type === 'text') {
      text += String((block as { text?: unknown }).text ?? '')
    }
  }
  return text
}

/**
 * Fold one session-history tail page into chat bubbles. Pages carry every
 * finalized message plus their raw chunk events; only chunks trailing the last
 * finalized assistant message form the in-flight partial of a running turn.
 * A user message keeps the busy flag up until its whole turn closes
 * (`turn/end`), so tool-running steps stay visibly active.
 * @param events - raw SessionEvent records from `sessions.history`.
 * @returns bubbles, the streaming partial, and the awaiting-reply flag.
 */
export function foldAuxHistory(events: ReadonlyArray<Record<string, unknown>>): {
  messages: AuxMessage[]
  streamingText: string | undefined
  awaitingReply: boolean
} {
  const messages: AuxMessage[] = []
  let streaming = ''
  let awaiting = false
  for (const event of events) {
    if (typeof event !== 'object' || event === null) continue
    const record = event as { type?: unknown; seq?: unknown; data?: unknown }
    const data = typeof record.data === 'object' && record.data !== null
      ? record.data as Record<string, unknown>
      : undefined
    if (record.type === 'user/message' && data !== undefined) {
      const text = auxBlockText(data.content)
      if (text.length > 0) messages.push({ id: String(data.id ?? record.seq), role: 'user', text })
      awaiting = true
    } else if (record.type === 'assistant/message' && data !== undefined) {
      const message = typeof data.message === 'object' && data.message !== null
        ? data.message as Record<string, unknown>
        : undefined
      // Steps that only issued tool calls carry no visible text; skip them.
      const text = message === undefined ? '' : auxBlockText(message.content)
      if (text.length > 0) messages.push({ id: String(message?.id ?? record.seq), role: 'assistant', text })
      // The turn may keep running (tool rounds); only turn/end closes it.
      streaming = ''
    } else if (record.type === 'assistant/chunk' && data !== undefined) {
      const chunk = typeof data.chunk === 'object' && data.chunk !== null
        ? data.chunk as Record<string, unknown>
        : undefined
      if (chunk?.type === 'text-delta') streaming += String(chunk.text ?? '')
    } else if (record.type === 'turn/end') {
      // Closes normal, rejected, aborted, and empty turns alike.
      awaiting = false
    }
  }
  return {
    messages,
    streamingText: streaming.length > 0 ? streaming : undefined,
    awaitingReply: awaiting,
  }
}
