/** Browser-side HarnessX update settings page. */

import { useEffect, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { DESKTOP_NAV_ICONS, registerDesktopSettingsNavSection } from './desktop-section.tsx'


declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.updates': UpdatesKey
  }
}

export type UpdatesKey =
  | 'nav'
  | 'title'
  | 'loading'
  | 'openRelease'
  | 'checkUpdates'
  | 'checking'
  | 'downloadAndInstall'
  | 'processing'
  | 'currentVersion'
  | 'latestVersion'
  | 'notChecked'
  | 'arch'
  | 'publishedAt'
  | 'releaseTitle'
  | 'lastChecked'
  | 'releaseNotes'
  | 'noReleaseNotes'
  | 'statusNotLoaded'
  | 'statusProcessing'
  | 'statusChecking'
  | 'statusAvailable'
  | 'statusUpToDate'
  | 'statusError'
  | 'statusIdle'
  | 'requestFailed'
  | 'feedback'
  | 'feedbackEmail'
  | 'feedbackSubject'
  | 'feedbackMessage'
  | 'feedbackSend'
  | 'feedbackSending'
  | 'feedbackCancel'
  | 'feedbackSent'
  | 'feedbackFailed'
  | 'feedbackRequired'

const zh: Record<UpdatesKey, string> = {
  nav: '应用更新',
  title: 'DeepSeek HarnessX 应用更新',
  loading: '正在读取更新状态…',
  openRelease: '打开 Release',
  checkUpdates: '检查更新',
  checking: '检查中…',
  downloadAndInstall: '下载并安装',
  processing: '处理中…',
  currentVersion: '当前版本',
  latestVersion: '最新版本',
  notChecked: '尚未检查',
  arch: 'CPU 架构',
  publishedAt: '发布时间',
  releaseTitle: '版本标题',
  lastChecked: '上次检查',
  releaseNotes: '版本说明',
  noReleaseNotes: '暂无版本说明。',
  statusNotLoaded: '尚未读取更新状态。',
  statusProcessing: '正在处理 DeepSeek HarnessX {version}。',
  statusChecking: '正在检查 GitHub Releases。',
  statusAvailable: '发现新版本，可以下载并安装。',
  statusUpToDate: '当前已经是最新版本。',
  statusError: '上次检查失败。',
  statusIdle: '点击“检查更新”获取最新版本。',
  requestFailed: '更新请求失败。',
  feedback: '反馈',
  feedbackEmail: '你的邮箱',
  feedbackSubject: '标题',
  feedbackMessage: '内容',
  feedbackSend: '发送',
  feedbackSending: '发送中…',
  feedbackCancel: '取消',
  feedbackSent: '已发送，感谢你的反馈！',
  feedbackFailed: '反馈发送失败，请稍后重试。',
  feedbackRequired: '请填写有效的邮箱、标题和内容。',
}

const en: Record<UpdatesKey, string> = {
  nav: 'Updates',
  title: 'DeepSeek HarnessX Updates',
  loading: 'Loading update status…',
  openRelease: 'Open Release',
  checkUpdates: 'Check for Updates',
  checking: 'Checking…',
  downloadAndInstall: 'Download and Install',
  processing: 'Processing…',
  currentVersion: 'Current Version',
  latestVersion: 'Latest Version',
  notChecked: 'Not checked yet',
  arch: 'Architecture',
  publishedAt: 'Published At',
  releaseTitle: 'Release Title',
  lastChecked: 'Last Checked',
  releaseNotes: 'Release Notes',
  noReleaseNotes: 'No release notes available.',
  statusNotLoaded: 'Update status not loaded.',
  statusProcessing: 'Processing DeepSeek HarnessX {version}.',
  statusChecking: 'Checking GitHub Releases.',
  statusAvailable: 'A new version is available for download and installation.',
  statusUpToDate: 'You are on the latest version.',
  statusError: 'Last check failed.',
  statusIdle: 'Click "Check for Updates" to fetch the latest version.',
  requestFailed: 'The update request failed.',
  feedback: 'Feedback',
  feedbackEmail: 'Your Email',
  feedbackSubject: 'Subject',
  feedbackMessage: 'Message',
  feedbackSend: 'Send',
  feedbackSending: 'Sending…',
  feedbackCancel: 'Cancel',
  feedbackSent: 'Sent — thank you for your feedback!',
  feedbackFailed: 'Sending failed. Please try again later.',
  feedbackRequired: 'Please provide a valid email, subject, and message.',
}

const NS = 'settings.updates'

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
.harnessxUpdatesToolbar { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.harnessxUpdatesButton { display: inline-flex; align-items: center; justify-content: center; min-height: 36px; padding: 8px 13px; border: 1px solid var(--dsw-alias-border-l2, #d7d7df); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font-size: 13px; text-decoration: none; }
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
.harnessxFeedbackOverlay { position: fixed; inset: 0; z-index: 1000; display: flex; align-items: center; justify-content: center; padding: 24px; background: rgb(0 0 0 / 40%); }
.harnessxFeedbackCard { width: min(460px, 100%); max-height: calc(100vh - 48px); overflow-y: auto; box-sizing: border-box; padding: 20px 22px; border-radius: 10px; background: var(--dsw-alias-bg-base, #fff); box-shadow: 0 12px 40px rgb(0 0 0 / 22%); }
.harnessxFeedbackTitle { margin: 0 0 14px; font-size: 16px; line-height: 1.4; font-weight: 650; }
.harnessxFeedbackForm { display: flex; flex-direction: column; gap: 12px; }
.harnessxFeedbackField { display: flex; flex-direction: column; gap: 5px; color: var(--dsw-alias-text-secondary, #686875); font-size: 12px; }
.harnessxFeedbackField input, .harnessxFeedbackField textarea { box-sizing: border-box; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l2, #d7d7df); border-radius: 6px; background: transparent; color: var(--dsw-alias-text, #17171c); font-family: inherit; font-size: 13px; line-height: 1.5; }
.harnessxFeedbackField textarea { resize: vertical; min-height: 110px; }
.harnessxFeedbackField input:focus, .harnessxFeedbackField textarea:focus { outline: none; border-color: var(--dsw-alias-accent, #2563eb); }
.harnessxFeedbackError { margin: 0; color: #b42318; font-size: 12.5px; line-height: 1.5; }
.harnessxFeedbackSent { margin: 4px 0 2px; color: #1a7f37; font-size: 13px; line-height: 1.5; }
.harnessxFeedbackActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 2px; }
@media (max-width: 720px) {
  .harnessxUpdates { padding: 18px; }
  .harnessxUpdatesHeader { flex-direction: column; }
  .harnessxUpdatesGrid { grid-template-columns: minmax(0, 1fr); }
}
`

/** Register the HarnessX update page in the upstream settings panel. */
export function applyUpdates(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'updates: dictionaries')
  registerDesktopSettingsNavSection(() => ctx.locale.bind(NS)('nav'), DESKTOP_NAV_ICONS.refresh)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'application-updates',
    order: 100,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
  }, UpdateSettingsSection))
}

/** Settings-panel page for GitHub Release update discovery and installation. */
function UpdateSettingsSection(props: PropsRuntime<'settings.section'> & PropsLocale<'settings.updates'>): ReactNode {
  const { t } = props
  const [snapshot, setSnapshot] = useState<UpdateSnapshot>()
  const [loading, setLoading] = useState(true)
  const [action, setAction] = useState<'check' | 'download'>()
  const [error, setError] = useState<string>()
  const [feedbackOpen, setFeedbackOpen] = useState(false)

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
  const latestVersion = snapshot?.latestVersion ?? t('notChecked')
  const busy = action !== undefined || snapshot?.checking === true || snapshot?.downloadingVersion !== undefined
  const canDownload = snapshot?.status === 'update-available' && snapshot.canDownload

  return (
    <section className="harnessxUpdates">
      <header className="harnessxUpdatesHeader">
        <div>
          <h2 className="harnessxUpdatesTitle">{t('title')}</h2>
          <p className="harnessxUpdatesStatus">{loading ? t('loading') : statusLabel(snapshot, t)}</p>
        </div>
      </header>

      <div className="harnessxUpdatesToolbar">
        <button
          className="harnessxUpdatesButton"
          type="button"
          disabled={busy}
          onClick={() => { void runAction('check') }}
        >
          {action === 'check' ? t('checking') : t('checkUpdates')}
        </button>
        <button
          className="harnessxUpdatesButton harnessxUpdatesButtonPrimary"
          type="button"
          disabled={busy || !canDownload}
          onClick={() => { void runAction('download') }}
        >
          {action === 'download' || snapshot?.downloadingVersion !== undefined ? t('processing') : t('downloadAndInstall')}
        </button>
        {snapshot?.releaseUrl !== undefined && (
          <a className="harnessxUpdatesButton" href={snapshot.releaseUrl} target="_blank" rel="noreferrer">
            {t('openRelease')}
          </a>
        )}
        <button
          className="harnessxUpdatesButton"
          type="button"
          onClick={() => { setFeedbackOpen(true) }}
        >
          {t('feedback')}
        </button>
      </div>

      {feedbackOpen && <FeedbackDialog t={t} onClose={() => { setFeedbackOpen(false) }} />}

      <dl className="harnessxUpdatesGrid">
        <div className="harnessxUpdatesField"><dt>{t('currentVersion')}</dt><dd>{currentVersion}</dd></div>
        <div className="harnessxUpdatesField"><dt>{t('latestVersion')}</dt><dd>{latestVersion}</dd></div>
        <div className="harnessxUpdatesField"><dt>{t('arch')}</dt><dd>{snapshot?.arch ?? '—'}</dd></div>
        <div className="harnessxUpdatesField"><dt>{t('publishedAt')}</dt><dd>{formatDate(snapshot?.publishedAt)}</dd></div>
        <div className="harnessxUpdatesField"><dt>{t('releaseTitle')}</dt><dd>{snapshot?.releaseName ?? '—'}</dd></div>
        <div className="harnessxUpdatesField"><dt>{t('lastChecked')}</dt><dd>{formatDate(snapshot?.lastCheckedAt)}</dd></div>
      </dl>

      <section className="harnessxUpdatesRelease">
        <h3 className="harnessxUpdatesReleaseTitle">{t('releaseNotes')}</h3>
        <pre className="harnessxUpdatesNotes">{snapshot?.releaseNotes?.trim() || t('noReleaseNotes')}</pre>
      </section>

      {(error ?? snapshot?.error) !== undefined && (
        <p className="harnessxUpdatesError">{error ?? snapshot?.error}</p>
      )}
    </section>
  )
}

/** Modal form that relays user feedback through the Host without exposing the destination. */
function FeedbackDialog(props: {
  t: (key: UpdatesKey, params?: Record<string, string | number>) => string
  onClose: () => void
}): ReactNode {
  const { t } = props
  const [email, setEmail] = useState('')
  const [subject, setSubject] = useState('')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string>()

  const submit = async (): Promise<void> => {
    if (sending) return
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()) || subject.trim().length === 0 || message.trim().length === 0) {
      setError(t('feedbackRequired'))
      return
    }
    setSending(true)
    setError(undefined)
    try {
      const response = await fetch('/api/desktop/updates/feedback', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), subject: subject.trim(), message: message.trim() }),
      })
      const value = await response.json() as { error?: string }
      if (!response.ok) throw new Error(value.error ?? t('feedbackFailed'))
      setSent(true)
      window.setTimeout(props.onClose, 1800)
    } catch (cause) {
      setError(cause instanceof Error && cause.message.length > 0 ? cause.message : t('feedbackFailed'))
    } finally {
      setSending(false)
    }
  }

  return createPortal(
    <div
      className="harnessxFeedbackOverlay"
      onClick={event => { if (event.target === event.currentTarget && !sending) props.onClose() }}
    >
      <div className="harnessxFeedbackCard" role="dialog" aria-modal="true" aria-label={t('feedback')}>
        <h3 className="harnessxFeedbackTitle">{t('feedback')}</h3>
        {sent ? (
          <p className="harnessxFeedbackSent">{t('feedbackSent')}</p>
        ) : (
          <form className="harnessxFeedbackForm" noValidate onSubmit={event => { event.preventDefault(); void submit() }}>
            <label className="harnessxFeedbackField">
              <span>{t('feedbackEmail')}</span>
              <input type="email" value={email} onChange={event => { setEmail(event.target.value) }} />
            </label>
            <label className="harnessxFeedbackField">
              <span>{t('feedbackSubject')}</span>
              <input value={subject} onChange={event => { setSubject(event.target.value) }} />
            </label>
            <label className="harnessxFeedbackField">
              <span>{t('feedbackMessage')}</span>
              <textarea rows={6} value={message} onChange={event => { setMessage(event.target.value) }} />
            </label>
            {error !== undefined && <p className="harnessxFeedbackError">{error}</p>}
            <div className="harnessxFeedbackActions">
              <button
                className="harnessxUpdatesButton"
                type="button"
                disabled={sending}
                onClick={props.onClose}
              >
                {t('feedbackCancel')}
              </button>
              <button
                className="harnessxUpdatesButton harnessxUpdatesButtonPrimary"
                type="submit"
                disabled={sending}
              >
                {sending ? t('feedbackSending') : t('feedbackSend')}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>,
    document.body,
  )
}

function statusLabel(snapshot: UpdateSnapshot | undefined, t: (key: UpdatesKey, params?: Record<string, string | number>) => string): string {
  if (snapshot === undefined) return t('statusNotLoaded')
  if (snapshot.downloadingVersion !== undefined) return t('statusProcessing', { version: snapshot.downloadingVersion })
  if (snapshot.checking) return t('statusChecking')
  if (snapshot.status === 'update-available') return t('statusAvailable')
  if (snapshot.status === 'up-to-date') return t('statusUpToDate')
  if (snapshot.status === 'error') return t('statusError')
  return t('statusIdle')
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
