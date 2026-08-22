/** Session completion and approval-wait notification watcher. */

import type { ClientContext, SessionId } from '@deepseek-ai/dsh-client-runtime/client'
import { notifySessionCompleted } from './notifications.ts'

/** Project basename from a session cwd for notification context. */
function workspaceBasename(cwd: string | undefined): string | undefined {
  if (cwd === undefined || cwd.length === 0) return undefined
  const segments = cwd.split(/[\\/]/).filter(segment => segment.length > 0)
  return segments.at(-1)
}

/**
 * Watch session transitions and notify: running→stopped (turn finished) and
 * no-wait→waiting (agent stopped for user approval or a question).
 * @param ctx - browser Cordis context with the `sessions` service.
 */
export function applySessionNotifications(ctx: ClientContext): void {
  ctx.effect(() => {
    // Per-session tracked state: wasRunning and wasWaiting flags.
    const runningStates = new Map<SessionId, boolean>()
    const waitingStates = new Map<SessionId, boolean>()
    const sessionsService = ctx.sessions as unknown as {
      list: {
        subscribe: (fn: () => void) => () => void
        getSnapshot: () => {
          phase: string
          ids: SessionId[]
          byId: Record<SessionId, {
            displayTitle: string
            cwd?: string
            running: boolean
            pendingInteraction?: unknown
          } | undefined>
        }
      }
      open: (id: SessionId) => void
    }

    if (!sessionsService?.list?.subscribe) return () => {}

    const unsubscribe = sessionsService.list.subscribe(() => {
      const snapshot = sessionsService.list.getSnapshot()
      // Skip until list is ready
      if (snapshot.phase === 'pending') return

      for (const id of snapshot.ids) {
        const item = snapshot.byId[id]
        if (!item) continue

        const wasRunning = runningStates.get(id)
        const isRunning = item.running
        const wasWaiting = waitingStates.get(id)
        const isWaiting = item.pendingInteraction !== undefined

        runningStates.set(id, isRunning)
        waitingStates.set(id, isWaiting)

        const notify = (kind: 'complete' | 'approval'): void => {
          notifySessionCompleted({
            sessionId: id,
            title: item.displayTitle || '',
            workspace: workspaceBasename(item.cwd),
            kind,
            onOpen: () => { sessionsService.open(id) },
          })
        }

        // Turn finished: running=true -> false.
        if (wasRunning === true && isRunning === false) {
          notify('complete')
        }

        // Agent paused for the user: wait appeared while still running.
        if (wasWaiting === false && isWaiting && isRunning) {
          notify('approval')
        }
      }

      // Cleanup pruned sessions
      for (const trackedId of runningStates.keys()) {
        if (!snapshot.byId[trackedId]) {
          runningStates.delete(trackedId)
          waitingStates.delete(trackedId)
        }
      }
    })

    return () => {
      unsubscribe()
      runningStates.clear()
      waitingStates.clear()
    }
  }, 'desktop: session completion notifications')
}
