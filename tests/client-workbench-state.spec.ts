import { describe, expect, it } from 'vitest'
import {
  applyWorkbenchPrefs,
  closeWorkbenchTab,
  getWorkbenchStore,
  openWorkbenchPanel,
  readWorkbenchPrefs,
  resizeWorkbenchPane,
  toggleWorkbench,
  WorkbenchState,
  WORKBENCH_PANEL_IDS,
  WORKBENCH_PANE_MAX,
  WORKBENCH_PANE_MIN,
  WORKBENCH_WIDTH_MAX,
  WORKBENCH_WIDTH_MIN,
  type WorkbenchSnapshot,
} from '../src/client/workbench-state.ts'

function base(): WorkbenchSnapshot {
  return {
    open: false,
    width: 400,
    tabs: [],
    active: null,
    browserHome: undefined,
    sizes: {},
  }
}

describe('workbench pure transitions', () => {
  it('exposes five rail panels with chat right after the browser', () => {
    expect(WORKBENCH_PANEL_IDS).toEqual(['explorer', 'terminal', 'git', 'browser', 'chat'])
  })

  it('toggle reveals an explorer tab on the empty dock and keeps tabs after collapse', () => {
    const opened = toggleWorkbench(base())
    expect(opened.open).toBe(true)
    expect(opened.tabs).toEqual(['explorer'])
    expect(opened.active).toBe('explorer')

    const closed = toggleWorkbench(opened)
    expect(closed.open).toBe(false)
    expect(closed.tabs).toEqual(['explorer'])

    const reopened = toggleWorkbench(closed)
    expect(reopened.open).toBe(true)
    expect(reopened.tabs).toEqual(['explorer'])
  })

  it('openPanel appends tabs in click order and focuses them', () => {
    let snapshot = base()
    snapshot = openWorkbenchPanel(snapshot, 'terminal')
    snapshot = openWorkbenchPanel(snapshot, 'explorer')
    snapshot = openWorkbenchPanel(snapshot, 'git')
    expect(snapshot.tabs).toEqual(['terminal', 'explorer', 'git'])
    expect(snapshot.active).toBe('git')
    expect(snapshot.open).toBe(true)

    // Re-focusing an existing tab must not duplicate it.
    snapshot = openWorkbenchPanel(snapshot, 'terminal')
    expect(snapshot.tabs).toEqual(['terminal', 'explorer', 'git'])
    expect(snapshot.active).toBe('terminal')
  })

  it('openPanel is a no-op when clicking the already-focused panel, like a browser', () => {
    let snapshot = openWorkbenchPanel(base(), 'git')
    snapshot = openWorkbenchPanel(snapshot, 'git')
    expect(snapshot.open).toBe(true)
    expect(snapshot.active).toBe('git')
    expect(snapshot.tabs).toEqual(['git'])

    // Re-opening an existing tab refocuses without duplicating or collapsing.
    const reopened = openWorkbenchPanel(snapshot, 'git')
    expect(reopened.open).toBe(true)
    expect(reopened.active).toBe('git')
    expect(reopened.tabs).toEqual(['git'])
  })

  it('closeTab moves focus right-then-left and closing the last tab collapses the dock', () => {
    let snapshot = base()
    for (const id of ['explorer', 'terminal', 'git'] as const) snapshot = openWorkbenchPanel(snapshot, id)
    snapshot = { ...snapshot, active: 'terminal' }

    expect(closeWorkbenchTab(snapshot, 'terminal').active).toBe('git')
    expect(closeWorkbenchTab({ ...snapshot, active: 'git' }, 'git').active).toBe('terminal')

    let single = openWorkbenchPanel(base(), 'browser')
    single = closeWorkbenchTab(single, 'browser')
    expect(single.tabs).toEqual([])
    expect(single.active).toBeNull()
    expect(single.open).toBe(false)
  })

  it('closing a non-active tab preserves focus', () => {
    let snapshot = base()
    for (const id of ['explorer', 'terminal'] as const) snapshot = openWorkbenchPanel(snapshot, id)
    snapshot = { ...snapshot, active: 'terminal' }
    const next = closeWorkbenchTab(snapshot, 'explorer')
    expect(next.tabs).toEqual(['terminal'])
    expect(next.active).toBe('terminal')
    expect(next.open).toBe(true)
  })

  it('widths clamp into the supported band', () => {
    const state = new WorkbenchState()
    state.setWidth(10)
    expect(state.getSnapshot().width).toBe(WORKBENCH_WIDTH_MIN)
    state.setWidth(99_999)
    expect(state.getSnapshot().width).toBe(WORKBENCH_WIDTH_MAX)
  })

  it('pane sizes clamp and persist per panel across other mutations', () => {
    let snapshot = openWorkbenchPanel(base(), 'explorer')
    snapshot = openWorkbenchPanel(snapshot, 'git')
    snapshot = resizeWorkbenchPane(snapshot, 'explorer', 180)
    snapshot = resizeWorkbenchPane(snapshot, 'git', 1)
    snapshot = resizeWorkbenchPane(snapshot, 'explorer', 99_999)
    expect(snapshot.sizes.explorer).toBe(WORKBENCH_PANE_MAX)
    expect(snapshot.sizes.git).toBe(WORKBENCH_PANE_MIN)

    // Closing a tab keeps its stored height so reopening restores it.
    snapshot = closeWorkbenchTab(snapshot, 'explorer')
    expect(snapshot.sizes.explorer).toBe(WORKBENCH_PANE_MAX)
    expect(snapshot.sizes.git).toBe(WORKBENCH_PANE_MIN)
  })
})

describe('workbench prefs round-trip', () => {
  it('applies well-formed values and drops malformed ones', () => {
    const store = getWorkbenchStore()
    applyWorkbenchPrefs({
      open: true,
      width: 512,
      browserHome: 'https://example.com',
      bogus: 'ignored',
    })
    const snapshot = store.getSnapshot()
    expect(snapshot.open).toBe(true)
    expect(snapshot.width).toBe(512)
    expect(snapshot.browserHome).toBe('https://example.com')

    applyWorkbenchPrefs({ width: Number.NaN, browserHome: '' })
    expect(store.getSnapshot().width).toBe(512)
    expect(store.getSnapshot().browserHome).toBe('https://example.com')
  })

  it('readWorkbenchPrefs reports geometry and only known keys', () => {
    const store = getWorkbenchStore()
    const prefs = readWorkbenchPrefs()
    expect(prefs.open).toBe(store.getSnapshot().open)
    expect(prefs.width).toBe(store.getSnapshot().width)
    expect(Object.keys(prefs).every(key => ['open', 'width', 'browserHome'].includes(key))).toBe(true)
    // String fields are either absent or non-empty (empty values are dropped).
    for (const key of ['browserHome'] as const) {
      const value = prefs[key]
      expect(value === undefined || value.length > 0).toBe(true)
    }
  })
})
