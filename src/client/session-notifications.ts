/** Session completion watcher service. */

import type { ClientContext, SessionId, SessionSummary } from '@deepseek-ai/dsh-client-runtime/client'
import { notifySessionCompleted } from './notifications.ts'

/**
 * Watch for session running transitions (true -> false) and notify on completion.
 * @param ctx - browser Cordis context with `sessions` service.
 */
export function applySessionNotifications(ctx: ClientContext): void {
  ctx.effect(() => {
    // Map of known running state per session: sessionId -> wasRunning
    const runningStates = new Map<SessionId, boolean>()
    const sessionsService = ctx.sessions as unknown as {
      list: {
        subscribe: (fn: () => void) => () => void
        getSnapshot: () => {
          phase: string
          ids: SessionId[]
          byId: Record<SessionId, SessionSummary | undefined>
        }
      }
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

        runningStates.set(id, isRunning)

        // Only trigger on transition from running=true to running=false
        if (wasRunning === true && isRunning === false) {
          notifySessionCompleted({
            sessionId: id,
            title: item.displayTitle || item.title || '',
          })
        }
      }

      // Cleanup pruned sessions
      for (const trackedId of runningStates.keys()) {
        if (!snapshot.byId[trackedId]) {
          runningStates.delete(trackedId)
        }
      }
    })

    return () => {
      unsubscribe()
      runningStates.clear()
    }
  }, 'desktop: session completion notifications')
}
