/** Pure client-state helpers for the HarnessX plugin market. */

/** Install job states returned by the desktop market API. */
export type ClientMarketJobStatus = 'queued' | 'running' | 'success' | 'failed' | 'cancelled'

/** Plugin operation kinds returned by the desktop market API. */
export type ClientMarketJobAction = 'install' | 'uninstall'

/** Minimum job identity needed to associate a task with one catalog plugin. */
export interface ClientMarketJobIdentity {
  /** Opaque job identifier. */
  id: string
  /** Current lifecycle state. */
  status: ClientMarketJobStatus
  /** User-facing operation title. */
  label: string
  /** Package specification targeted by the operation. */
  target: string
}

/** Button presentation derived from installation and task state. */
export interface PluginInstallAction {
  /** User-facing button label. */
  label: string
  /** Whether another installation request may be submitted. */
  disabled: boolean
}

/** Monotonic request gate used to discard stale asynchronous responses. */
export interface LatestRequestGate {
  /** Begin one request and return its monotonic identifier. */
  begin: () => number
  /** Return whether one response still belongs to the latest request. */
  isLatest: (requestId: number) => boolean
}

/** Return a newest-first copy while preserving the task state array order. */
export function newestMarketJobs<T>(jobs: readonly T[]): T[] {
  return jobs.toReversed()
}

/** Return a complete task conclusion containing both action and status. */
export function marketJobHeadline(
  action: ClientMarketJobAction,
  status: ClientMarketJobStatus,
  isZh: boolean = true,
): string {
  if (isZh) {
    const actionLabel = action === 'install' ? '安装' : '卸载'
    switch (status) {
      case 'queued': return `等待${actionLabel}`
      case 'running': return `正在${actionLabel}`
      case 'success': return `${actionLabel}成功`
      case 'failed': return `${actionLabel}失败`
      case 'cancelled': return `${actionLabel}已取消`
    }
  }
  const actionLabel = action === 'install' ? 'Install' : 'Uninstall'
  switch (status) {
    case 'queued': return `Queued for ${actionLabel}`
    case 'running': return `${actionLabel}ing`
    case 'success': return `${actionLabel} Succeeded`
    case 'failed': return `${actionLabel} Failed`
    case 'cancelled': return `${actionLabel} Cancelled`
  }
}

/** Format elapsed task time from an ISO start timestamp to completion or now. */
export function marketJobDuration(
  startedAt: string | undefined,
  completedAt: string | undefined,
  now: number = Date.now(),
  isZh: boolean = true,
): string {
  if (startedAt === undefined) return '—'
  const startTime = Date.parse(startedAt)
  const endTime = completedAt === undefined ? now : Date.parse(completedAt)
  if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return '—'
  const totalSeconds = Math.max(0, Math.floor((endTime - startTime) / 1000))
  if (totalSeconds < 60) return isZh ? `${totalSeconds} 秒` : `${totalSeconds}s`
  const minutes = Math.floor(totalSeconds / 60)
  return isZh ? `${minutes} 分 ${totalSeconds % 60} 秒` : `${minutes}m ${totalSeconds % 60}s`
}

/** Return the newest task associated with one catalog plugin. */
export function findNewestPluginJob<T extends ClientMarketJobIdentity>(
  install: string,
  name: string,
  jobs: readonly T[],
): T | undefined {
  return jobs.findLast(job => job.target === install || job.label === name)
}

/** Derive immediate and task-backed installation button state. */
export function pluginInstallAction(
  installed: boolean,
  status: ClientMarketJobStatus | undefined,
  preparing: boolean,
  isZh: boolean = true,
): PluginInstallAction {
  if (installed) return { label: isZh ? '已安装' : 'Installed', disabled: true }
  if (preparing) return { label: isZh ? '准备中…' : 'Preparing…', disabled: true }
  if (status === 'queued') return { label: isZh ? '排队中…' : 'Queued…', disabled: true }
  if (status === 'running') return { label: isZh ? '安装中…' : 'Installing…', disabled: true }
  if (status === 'success') return { label: isZh ? '确认中…' : 'Confirming…', disabled: true }
  if (status === 'failed') return { label: isZh ? '重试' : 'Retry', disabled: false }
  return { label: isZh ? '安装' : 'Install', disabled: false }
}

/** Create a request gate whose latest started request owns state updates. */
export function createLatestRequestGate(): LatestRequestGate {
  let latestRequestId = 0
  return {
    begin: () => {
      latestRequestId += 1
      return latestRequestId
    },
    isLatest: requestId => requestId === latestRequestId,
  }
}
