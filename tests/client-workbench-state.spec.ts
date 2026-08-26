import { describe, expect, it } from 'vitest'
import {
  applyWorkbenchPrefs,
  auxBlockText,
  closeWorkbenchTab,
  collapseWorkbench,
  diffLineKind,
  foldAuxHistory,
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

  it('collapseWorkbench hides the dock but keeps every tab for the next reveal', () => {
    let snapshot = base()
    for (const id of ['explorer', 'terminal'] as const) snapshot = openWorkbenchPanel(snapshot, id)
    const collapsed = collapseWorkbench(snapshot)
    expect(collapsed.open).toBe(false)
    expect(collapsed.tabs).toEqual(['explorer', 'terminal'])
    expect(collapsed.active).toBe('terminal')
    // Collapsing an already-closed dock is a no-op; reopening restores the tabs.
    expect(collapseWorkbench(collapsed)).toBe(collapsed)
    expect(openWorkbenchPanel(collapsed, 'explorer').open).toBe(true)
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

describe('auxiliary chat history folding', () => {
  // Raw SessionEvent records shaped exactly as the wire carries them:
  // { type, seq, time, data } with data holding the per-type payload.
  function userMessage(seq: number, id: string, text: string): Record<string, unknown> {
    return {
      type: 'user/message',
      seq,
      time: 0,
      data: { id, role: 'user', content: [{ type: 'text', text }], source: { kind: 'human' } },
    }
  }

  function assistantMessage(seq: number, id: string, blocks: unknown[]): Record<string, unknown> {
    return {
      type: 'assistant/message',
      seq,
      time: 0,
      data: {
        turn: 1,
        step: 1,
        message: { id, role: 'assistant', content: blocks, source: { kind: 'model' } },
      },
    }
  }

  function chunk(seq: number, chunkType: string, text?: string): Record<string, unknown> {
    return {
      type: 'assistant/chunk',
      seq,
      time: 0,
      data: { turn: 1, step: 1, chunk: text === undefined ? { type: chunkType, index: 0 } : { type: chunkType, index: 0, text } },
    }
  }

  it('auxBlockText keeps only visible text blocks', () => {
    expect(auxBlockText([
      { type: 'text', text: 'a' },
      { type: 'reasoning', text: 'secret' },
      { type: 'text', text: 'b' },
      { type: 'tool-call', id: 'c1', name: 'read', arguments: '{}' },
    ])).toBe('ab')
    expect(auxBlockText(undefined)).toBe('')
    expect(auxBlockText('nope')).toBe('')
  })

  it('folds finalized messages in order and clears the busy flag on each reply', () => {
    const folded = foldAuxHistory([
      { type: 'turn/start', seq: 1, time: 0, data: { turn: 1 } },
      userMessage(2, 'u1', '你好'),
      assistantMessage(3, 'a1', [{ type: 'text', text: '你好！' }]),
      userMessage(4, 'u2', '继续'),
      assistantMessage(5, 'a2', [
        { type: 'reasoning', text: 'thinking' },
        { type: 'text', text: '好的' },
      ]),
      { type: 'turn/end', seq: 6, time: 0, data: { turn: 1, reason: { kind: 'stop' } } },
    ])
    expect(folded.messages).toEqual([
      { id: 'u1', role: 'user', text: '你好' },
      { id: 'a1', role: 'assistant', text: '你好！' },
      { id: 'u2', role: 'user', text: '继续' },
      { id: 'a2', role: 'assistant', text: '好的' },
    ])
    expect(folded.streamingText).toBeUndefined()
    expect(folded.awaitingReply).toBe(false)
  })

  it('treats trailing text deltas after the last finalized message as the streaming partial', () => {
    const folded = foldAuxHistory([
      userMessage(1, 'u1', '写首诗'),
      assistantMessage(2, 'a1', [{ type: 'text', text: '旧作' }]),
      chunk(3, 'block-start'),
      chunk(4, 'text-delta', '春'),
      chunk(5, 'reasoning-delta', 'hidden'),
      chunk(6, 'text-delta', '眠不觉晓'),
    ])
    expect(folded.messages).toEqual([
      { id: 'u1', role: 'user', text: '写首诗' },
      { id: 'a1', role: 'assistant', text: '旧作' },
    ])
    expect(folded.streamingText).toBe('春眠不觉晓')
    // The turn is still open (no turn/end yet): the panel keeps showing busy.
    expect(folded.awaitingReply).toBe(true)
  })

  it('marks an unanswered user message as awaiting even when nothing streams yet', () => {
    const folded = foldAuxHistory([userMessage(1, 'u1', '在吗')])
    expect(folded.messages).toEqual([{ id: 'u1', role: 'user', text: '在吗' }])
    expect(folded.streamingText).toBeUndefined()
    expect(folded.awaitingReply).toBe(true)

    // A rejected/empty turn closes it without any assistant message.
    const ended = foldAuxHistory([
      userMessage(1, 'u1', '在吗'),
      { type: 'turn/end', seq: 2, time: 0, data: { turn: 1, reason: { kind: 'stop' } } },
    ])
    expect(ended.awaitingReply).toBe(false)
  })

  it('skips tool-call-only steps, drops their partials, and stays busy until turn end', () => {
    const folded = foldAuxHistory([
      userMessage(1, 'u1', '看看文件'),
      chunk(2, 'text-delta', 'partial'),
      assistantMessage(3, 'a-tool', [{ type: 'tool-call', id: 'c1', name: 'read_file', arguments: '{}' }]),
    ])
    expect(folded.messages).toEqual([{ id: 'u1', role: 'user', text: '看看文件' }])
    // The finalized tool-call step supersedes the streamed partial…
    expect(folded.streamingText).toBeUndefined()
    // …but the turn keeps running until its turn/end closes it.
    expect(folded.awaitingReply).toBe(true)
  })

  it('returns an empty fold for a blank page and ignores malformed entries', () => {
    expect(foldAuxHistory([])).toEqual({ messages: [], streamingText: undefined, awaitingReply: false })
    expect(foldAuxHistory([null as unknown as Record<string, unknown>, {}, { type: 'unknown/x' }])).toEqual({
      messages: [],
      streamingText: undefined,
      awaitingReply: false,
    })
  })
})

describe('explorer diff line classification', () => {
  it('sorts unified-diff lines into colored render kinds', () => {
    expect(diffLineKind('diff --git a/a b/a')).toBe('meta')
    expect(diffLineKind('index 1234..5678 100644')).toBe('meta')
    expect(diffLineKind('--- a/a.txt')).toBe('meta')
    expect(diffLineKind('+++ b/a.txt')).toBe('meta')
    expect(diffLineKind('@@ -1,3 +1,4 @@')).toBe('hunk')
    expect(diffLineKind('+added line')).toBe('add')
    expect(diffLineKind('-removed line')).toBe('del')
    expect(diffLineKind(' unchanged line')).toBe('plain')
    expect(diffLineKind('')).toBe('plain')
  })
})
