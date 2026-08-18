/** Browser-side HarnessX update settings page. */

import { useEffect, useState, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'

/** Update state returned by the desktop Host API. */
interface UpdateSnapshot {
  /** Installed application version. */
  currentVersion: string
  /** Current CPU architecture. */
  arch: string
  /** Whether this package can download an installer. */
  canDownload: boolean
  /** Whether a version request is running. */
  checking: boolean
  /** Version currently being downloaded. */
  downloadingVersion?: string
  /** Latest version returned by GitHub. */
  latestVersion?: string
  /** Update comparison result. */
  status: 'idle' | 'error' | 'up-to-date' | 'update-available'
  /** GitHub release title. */
  releaseName?: string
  /** Plain-text GitHub release notes. */
  releaseNotes?: string
  /** GitHub release publication timestamp. */
  publishedAt?: string
  /** Public GitHub release URL. */
  releaseUrl?: string
  /** Timestamp of the latest completed check. */
  lastCheckedAt?: string
  /** Latest safe user-facing failure message. */
  error?: string
}

const UPDATE_STYLES = `
.harnessxUpdates { width: 100%; min-height: 100%; box-sizing: border-box; padding: 24px; color: var(--dsw-alias-text, #17171c); background: var(--dsw-alias-bg-base, #fff); }
.harnessxUpdatesHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxUpdatesTitle { margin: 0; font-size: 20px; line-height: 1.35; font-weight: 700; letter-spacing: 0; }
.harnessxUpdatesStatus { margin: 5px 0 0; color: var(--dsw-alias-text-secondary, #686875); font-size: 13px; line-height: 1.5; }
.harnessxUpdatesActions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.harnessxUpdatesButton { min-height: 36px; padding: 8px 13px; border: 1px solid var(--dsw-alias-border-l2, #d7d7df); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font-size: 13px; }
.harnessxUpdatesButton:hover { border-color: var(--dsw-alias-accent, #2563eb); color: var(--dsw-alias-accent, #2563eb); }
.harnessxUpdatesButtonPrimary { border-color: var(--dsw-alias-accent, #2563eb); background: var(--dsw-alias-accent, #2563eb); color: #fff; }
.harnessxUpdatesButtonPrimary:hover { color: #fff; filter: brightness(.96); }
.harnessxUpdatesButton:disabled { opacity: .5; cursor: not-allowed; }
.harnessxUpdatesGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1, #ececf1); border-left: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxUpdatesField { min-width: 0; padding: 14px 16px; border-right: 1px solid var(--dsw-alias-border-l1, #ececf1); border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxUpdatesField dt { margin: 0 0 5px; color: var(--dsw-alias-text-secondary, #686875); font-size: 12px; }
.harnessxUpdatesField dd { margin: 0; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.harnessxUpdatesRelease { margin-top: 24px; }
.harnessxUpdatesReleaseTitle { margin: 0 0 12px; font-size: 16px; line-height: 1.4; font-weight: 650; letter-spacing: 0; }
.harnessxUpdatesNotes { min-height: 100px; margin: 0; padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 6px; background: var(--dsw-alias-bg-subtle, #f7f7f8); font: 13px/1.65 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
.harnessxUpdatesError { margin: 16px 0 0; padding: 10px 12px; border-left: 3px solid #dc2626; background: rgb(254 242 242 / 75%); color: #b42318; font-size: 13px; line-height: 1.5; }
@media (max-width: 720px) {
  .harnessxUpdates { padding: 18px; }
  .harnessxUpdatesHeader { flex-direction: column; }
  .harnessxUpdatesActions { justify-content: flex-start; }
  .harnessxUpdatesGrid { grid-template-columns: minmax(0, 1fr); }
}
`

/** Register the HarnessX update page in the upstream settings panel. */
export function applyUpdates(ctx: ClientContext): void {
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'application-updates',
    order: 100,
    label: '应用更新',
  }, UpdateSettingsSection))
}

/** Settings-panel page for GitHub Release update discovery and installation. */
function UpdateSettingsSection(_props: PropsRuntime<'settings.section'>): ReactNode {
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>()
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'check' | 'download'>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'harnessx-desktop'
    style.dataset.pluginCss = 'harnessx-desktop/updates'
    style.textContent = UPDATE_STYLES
    document.head.appendChild(style)
    void requestSnapshot('/api/desktop/updates/status').then(setSnapshot).catch(cause => {
      setError(errorMessage(cause))
    }).finally(() => { setLoading(false) })
    return () => { style.remove() }
  }, [])

  const runAction = async (nextAction: 'check' | 'download'): Promise<void> => {
    setAction(nextAction)
    setError(undefined)
    try {
      const next = await requestSnapshot('/api/desktop/updates/' + nextAction, { method: 'POST' })
      setSnapshot(next)
    } catch (cause) {
      setError(errorMessage(cause))
      try {
        setSnapshot(await requestSnapshot('/api/desktop/updates/status'))
      } catch {
        // Keep the last usable snapshot when refreshing the failure state also fails.
      }
    } finally {
      setAction(undefined)
    }
  }

  const currentVersion = snapshot?.currentVersion ?? '—'
  const latestVersion = snapshot?.latestVersion ?? '尚未检查'
  const busy = action !== undefined || snapshot?.checking === true || snapshot?.downloadingVersion !== undefined
  const canDownload = snapshot?.status === 'update-available' && snapshot.canDownload

  return (
    <section className="harnessxUpdates">
      <header className="harnessxUpdatesHeader">
        <div>
          <h2 className="harnessxUpdatesTitle">DeepSeek HarnessX 应用更新</h2>
          <p className="harnessxUpdatesStatus">{loading ? '正在读取更新状态…' : statusLabel(snapshot)}</p>
        </div>
        <div className="harnessxUpdatesActions">
          {snapshot?.releaseUrl !== undefined && (
            <a className="harnessxUpdatesButton" href={snapshot.releaseUrl} target="_blank" rel="noreferrer">
              打开 Release
            </a>
          )}
          <button
            className="harnessxUpdatesButton"
            type="button"
            disabled={busy}
            onClick={() => { void runAction('check') }}
          >
            {action === 'check' ? '检查中…' : '检查更新'}
          </button>
          <button
            className="harnessxUpdatesButton harnessxUpdatesButtonPrimary"
            type="button"
            disabled={busy || !canDownload}
            onClick={() => { void runAction('download') }}
          >
            {action === 'download' || snapshot?.downloadingVersion !== undefined ? '处理中…' : '下载并安装'}
          </button>
        </div>
      </header>

      <dl className="harnessxUpdatesGrid">
        <div className="harnessxUpdatesField"><dt>当前版本</dt><dd>{currentVersion}</dd></div>
        <div className="harnessxUpdatesField"><dt>最新版本</dt><dd>{latestVersion}</dd></div>
        <div className="harnessxUpdatesField"><dt>CPU 架构</dt><dd>{snapshot?.arch ?? '—'}</dd></div>
        <div className="harnessxUpdatesField"><dt>发布时间</dt><dd>{formatDate(snapshot?.publishedAt)}</dd></div>
        <div className="harnessxUpdatesField"><dt>版本标题</dt><dd>{snapshot?.releaseName ?? '—'}</dd></div>
        <div className="harnessxUpdatesField"><dt>上次检查</dt><dd>{formatDate(snapshot?.lastCheckedAt)}</dd></div>
      </dl>

      <section className="harnessxUpdatesRelease">
        <h3 className="harnessxUpdatesReleaseTitle">版本说明</h3>
        <pre className="harnessxUpdatesNotes">{snapshot?.releaseNotes?.trim() || '暂无版本说明。'}</pre>
      </section>

      {(error ?? snapshot?.error) !== undefined && (
        <p className="harnessxUpdatesError">{error ?? snapshot?.error}</p>
      )}
    </section>
  )
}

function statusLabel(snapshot: UpdateSnapshot | undefined): string {
  if (snapshot === undefined) return '尚未读取更新状态。'
  if (snapshot.downloadingVersion !== undefined) return '正在处理 DeepSeek HarnessX ' + snapshot.downloadingVersion + '。'
  if (snapshot.checking) return '正在检查 GitHub Releases。'
  if (snapshot.status === 'update-available') return '发现新版本，可以下载并安装。'
  if (snapshot.status === 'up-to-date') return '当前已经是最新版本。'
  if (snapshot.status === 'error') return '上次检查失败。'
  return '点击“检查更新”获取最新版本。'
}

function formatDate(value: string | undefined): string {
  if (value === undefined) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

async function requestSnapshot(url: string, init?: RequestInit): Promise<UpdateSnapshot> {
  const response = await fetch(url, init)
  const value = await response.json() as UpdateSnapshot & { error?: string }
  if (!response.ok) throw new Error(value.error ?? '更新请求失败。')
  return value
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
