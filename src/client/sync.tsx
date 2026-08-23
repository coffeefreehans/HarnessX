/** Browser-side HarnessX Google Drive sync settings page (v3 UI). */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { DesktopSectionHeader } from './desktop-section.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.sync': SyncKey
  }
}

export type SyncKey =
  | 'nav'
  | 'title'
  | 'loading'
  | 'connect'
  | 'disconnect'
  | 'syncNow'
  | 'syncing'
  | 'lastSync'
  | 'never'
  | 'account'
  | 'notAuthenticated'
  | 'autoSync'
  | 'interval'
  | 'minutes'
  | 'categories'
  | 'sessions'
  | 'plugins'
  | 'settings'
  | 'customClientId'
  | 'customClientSecret'
  | 'autoSaveHint'
  | 'statusOk'
  | 'statusError'
  | 'summary'
  | 'uploadOverwrite'
  | 'downloadOverwrite'
  | 'conflictList'
  | 'noConflicts'
  | 'pendingInstalls'
  | 'noPendingInstalls'
  | 'installAction'
  | 'installing'
  | 'installDone'
  | 'installFailed'
  | 'sessionStats'
  | 'sessionLocal'
  | 'sessionRemote'
  | 'uploadedCount'
  | 'downloadedCount'
  | 'resetCloud'
  | 'resetConfirm'
  | 'resetting'
  | 'errorDetails'

const zh: Record<SyncKey, string> = {
  nav: '云同步',
  title: '云同步',
  loading: '加载同步状态…',
  connect: '连接 Google 账号',
  disconnect: '断开',
  syncNow: '立即同步',
  syncing: '同步中…',
  lastSync: '上次同步',
  never: '从未',
  account: '账号',
  notAuthenticated: '未认证',
  autoSync: '自动同步',
  interval: '间隔',
  minutes: '分钟',
  categories: '同步内容',
  sessions: '会话',
  plugins: '插件记录',
  settings: '设置',
  customClientId: '自定义 Client ID',
  customClientSecret: '自定义 Client Secret',
  autoSaveHint: '修改后自动保存',
  statusOk: '已就绪',
  statusError: '出错',
  summary: '结果',
  uploadOverwrite: '本机覆盖线上',
  downloadOverwrite: '线上覆盖本机',
  conflictList: '设置冲突',
  noConflicts: '没有冲突',
  pendingInstalls: '插件未安装列表',
  noPendingInstalls: '线上插件本机均已安装',
  installAction: '安装',
  installing: '安装中…',
  installDone: '已装好',
  installFailed: '失败，点击重试',
  sessionStats: '会话',
  sessionLocal: '本机',
  sessionRemote: '云端',
  uploadedCount: '上次上传',
  downloadedCount: '上次下载',
  resetCloud: '重置云端数据',
  resetConfirm: '将删除 Google Drive 中全部同步数据，并以本机数据重新上传。确定继续？',
  resetting: '重置中…',
  errorDetails: '错误详情',
}

const en: Record<SyncKey, string> = {
  nav: 'Cloud Sync',
  title: 'Cloud Sync',
  loading: 'Loading sync status…',
  connect: 'Connect Google Account',
  disconnect: 'Disconnect',
  syncNow: 'Sync Now',
  syncing: 'Syncing…',
  lastSync: 'Last sync',
  never: 'Never',
  account: 'Account',
  notAuthenticated: 'Not authenticated',
  autoSync: 'Auto sync',
  interval: 'Every',
  minutes: 'minutes',
  categories: 'Sync content',
  sessions: 'Sessions',
  plugins: 'Plugin records',
  settings: 'Settings',
  customClientId: 'Custom Client ID',
  customClientSecret: 'Custom Client Secret',
  autoSaveHint: 'Saves automatically',
  statusOk: 'Ready',
  statusError: 'Error',
  summary: 'Result',
  uploadOverwrite: 'Local wins',
  downloadOverwrite: 'Cloud wins',
  conflictList: 'Settings conflicts',
  noConflicts: 'No conflicts',
  pendingInstalls: 'Uninstalled plugins',
  noPendingInstalls: 'All remote plugins installed',
  installAction: 'Install',
  installing: 'Installing…',
  installDone: 'Installed',
  installFailed: 'Failed — retry',
  sessionStats: 'Sessions',
  sessionLocal: 'Local',
  sessionRemote: 'Cloud',
  uploadedCount: 'Uploaded',
  downloadedCount: 'Downloaded',
  resetCloud: 'Reset cloud data',
  resetConfirm: 'This deletes ALL synced data in Google Drive and re-uploads from this machine. Continue?',
  resetting: 'Resetting…',
  errorDetails: 'Error details',
}

const NS = 'settings.sync'

export interface SyncConflict {
  key: string
  category: string
  localMtimeMs: number
  remoteMtimeMs: number
  driveFileId: string
}

export interface SyncPendingInstall {
  name: string
  installSpec: string
  version?: string
}

interface SyncConfig {
  autoSync: boolean
  intervalMinutes: number
  categories: string[]
  customClientId: string
  customClientSecret: string
}

interface SyncStatus {
  configured: boolean
  authenticated: boolean
  accountEmail?: string
  lastSyncTime?: number
  lastSyncResult?: {
    uploaded: string[]
    downloaded: string[]
    conflicts: SyncConflict[]
    pendingInstalls: SyncPendingInstall[]
    errors: Array<{ path: string; error: string }>
    sessionCounts: { local: number; remote: number }
  }
  syncing: boolean
  config?: Partial<SyncConfig>
  error?: string
}

type InstallState = 'idle' | 'installing' | 'done' | 'failed'

const DEFAULT_CONFIG: SyncConfig = {
  autoSync: false,
  intervalMinutes: 30,
  categories: ['sessions', 'plugins', 'settings'],
  customClientId: '',
  customClientSecret: '',
}

const SYNC_STYLES = `
.harnessxSync { display: flex; flex-direction: column; gap: 18px; width: 100%; min-height: 100%; box-sizing: border-box; max-width: 780px; padding: 28px; color: var(--dsw-alias-text, #17171c); background: var(--dsw-alias-bg-base, #fff); font-size: 14px; }
.harnessxSync *, .harnessxSync *::before, .harnessxSync *::after { box-sizing: border-box; }

.harnessxSyncHero { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 22px 24px; border: 1px solid rgb(37 99 235 / 14%); border-radius: 16px; background: linear-gradient(135deg, rgb(37 99 235 / 7%), rgb(37 99 235 / 2%)); }
.harnessxSyncHeroLeft { display: flex; flex-direction: column; gap: 6px; min-width: 0; }
.harnessxSyncHeroTitle { display: flex; align-items: center; gap: 10px; margin: 0; font-size: 18px; font-weight: 700; letter-spacing: 0; }
.harnessxSyncDot { width: 9px; height: 9px; border-radius: 50%; flex-shrink: 0; }
.harnessxSyncDotOk { background: #16a34a; box-shadow: 0 0 0 4px rgb(22 163 74 / 16%); }
.harnessxSyncDotErr { background: #dc2626; box-shadow: 0 0 0 4px rgb(220 38 38 / 16%); }
.harnessxSyncDotOff { background: #9ca3af; box-shadow: 0 0 0 4px rgb(156 163 175 / 18%); }
.harnessxSyncHeroMeta { display: flex; flex-wrap: wrap; gap: 6px 16px; color: var(--dsw-alias-text-secondary, #686875); font-size: 12.5px; }
.harnessxSyncHeroActions { display: flex; flex-shrink: 0; gap: 8px; }

.harnessxSyncBtn { display: inline-flex; align-items: center; justify-content: center; gap: 6px; min-height: 36px; padding: 8px 16px; border: 1px solid var(--dsw-alias-border-l2, #d7d7df); border-radius: 10px; background: #fff; color: inherit; font-size: 13px; font-weight: 500; cursor: pointer; transition: border-color .15s, background .15s, color .15s, transform .05s; }
.harnessxSyncBtn:hover { border-color: var(--dsw-alias-accent, #2563eb); color: var(--dsw-alias-accent, #2563eb); }
.harnessxSyncBtn:active { transform: scale(.98); }
.harnessxSyncBtn:disabled { opacity: .45; cursor: not-allowed; transform: none; }
.harnessxSyncBtnPrimary { border: none; background: var(--dsw-alias-accent, #2563eb); color: #fff; box-shadow: 0 1px 2px rgb(37 99 235 / 30%); }
.harnessxSyncBtnPrimary:hover { color: #fff; filter: brightness(1.05); }
.harnessxSyncBtnDanger { border-color: rgb(220 38 38 / 35%); color: #dc2626; background: #fff; }
.harnessxSyncBtnDanger:hover { background: rgb(254 242 242); border-color: #dc2626; color: #b42318; }

.harnessxSyncStats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; }
.harnessxSyncStat { padding: 14px 16px; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 12px; background: var(--dsw-alias-bg-base, #fff); }
.harnessxSyncStatValue { font-size: 22px; font-weight: 700; line-height: 1.2; font-variant-numeric: tabular-nums; }
.harnessxSyncStatLabel { margin-top: 3px; color: var(--dsw-alias-text-secondary, #686875); font-size: 12px; }

.harnessxSyncCard { padding: 4px 20px 20px; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 14px; }
.harnessxSyncCardHead { display: flex; align-items: baseline; justify-content: space-between; gap: 10px; padding: 15px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); margin-bottom: 14px; }
.harnessxSyncCardTitle { margin: 0; font-size: 14.5px; font-weight: 650; }
.harnessxSyncCardCount { color: var(--dsw-alias-text-secondary, #686875); font-size: 12.5px; }

.harnessxSyncRow { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 11px 0; }
.harnessxSyncRow + .harnessxSyncRow { border-top: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxSyncRowLabel { font-size: 13.5px; font-weight: 500; }
.harnessxSyncRowHint { margin-top: 2px; color: var(--dsw-alias-text-secondary, #686875); font-size: 12px; }
.harnessxSyncRowControl { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }

.harnessxSyncSwitch { position: relative; display: inline-block; width: 40px; height: 22px; flex-shrink: 0; }
.harnessxSyncSwitch input { position: absolute; inset: 0; margin: 0; opacity: 0; cursor: pointer; z-index: 1; }
.harnessxSyncSwitch span { position: absolute; inset: 0; border-radius: 999px; background: #d7d7df; transition: background .18s; pointer-events: none; }
.harnessxSyncSwitch span::after { content: ''; position: absolute; top: 3px; left: 3px; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 2px rgb(0 0 0 / 25%); transition: transform .18s; }
.harnessxSyncSwitch input:checked + span { background: var(--dsw-alias-accent, #2563eb); }
.harnessxSyncSwitch input:checked + span::after { transform: translateX(18px); }

.harnessxSyncNum, .harnessxSyncText { padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l2, #d7d7df); border-radius: 8px; background: #fff; color: inherit; font-size: 13px; transition: border-color .15s, box-shadow .15s; }
.harnessxSyncNum { width: 76px; text-align: center; }
.harnessxSyncText { width: 100%; max-width: 340px; }
.harnessxSyncNum:focus, .harnessxSyncText:focus { outline: none; border-color: var(--dsw-alias-accent, #2563eb); box-shadow: 0 0 0 3px rgb(37 99 235 / 15%); }

.harnessxSyncItem { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 12px 14px; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 12px; }
.harnessxSyncItem + .harnessxSyncItem { margin-top: 10px; }
.harnessxSyncItemWarn { border-color: rgb(217 119 6 / 35%); background: rgb(254 243 199 / 25%); }
.harnessxSyncItemMain { min-width: 0; display: flex; flex-direction: column; gap: 3px; }
.harnessxSyncItemName { font-size: 13.5px; font-weight: 550; overflow-wrap: anywhere; }
.harnessxSyncItemMeta { color: var(--dsw-alias-text-secondary, #686875); font-size: 12px; overflow-wrap: anywhere; }
.harnessxSyncItemActions { display: flex; gap: 8px; flex-shrink: 0; }
.harnessxSyncEmpty { padding: 18px; border: 1px dashed var(--dsw-alias-border-l2, #d7d7df); border-radius: 12px; color: var(--dsw-alias-text-secondary, #686875); font-size: 13px; text-align: center; }

.harnessxSyncAlert { padding: 12px 14px; border-radius: 12px; font-size: 13px; line-height: 1.55; }
.harnessxSyncAlertOk { background: rgb(240 253 244); border: 1px solid rgb(22 163 74 / 30%); color: #15803d; }
.harnessxSyncAlertErr { background: rgb(254 242 242); border: 1px solid rgb(220 38 38 / 30%); color: #b42318; }
.harnessxSyncErrList { margin: 8px 0 0; padding-left: 18px; }
.harnessxSyncErrList li { overflow-wrap: anywhere; }

.harnessxSyncDanger { display: flex; align-items: center; justify-content: space-between; gap: 14px; padding: 14px 16px; border: 1px solid rgb(220 38 38 / 25%); border-radius: 12px; background: rgb(254 242 242 / 45%); }
.harnessxSyncDangerText { font-size: 13px; color: #b42318; font-weight: 500; }

@media (max-width: 720px) {
  .harnessxSync { padding: 18px; }
  .harnessxSyncHero { flex-direction: column; align-items: stretch; }
  .harnessxSyncHeroActions { justify-content: stretch; }
  .harnessxSyncHeroActions .harnessxSyncBtn { flex: 1; }
  .harnessxSyncStats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .harnessxSyncItem { flex-direction: column; align-items: stretch; }
}
`

export function applySync(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'sync: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'cloud-sync',
    order: 110,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
  }, SyncSettingsSection))
}

function SyncSettingsSection(props: PropsRuntime<'settings.section'> & PropsLocale<'settings.sync'>): ReactNode {
  const { t } = props
  const [status, setStatus] = useState<SyncStatus>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [action, setAction] = useState<string>()
  const [summary, setSummary] = useState<string>()
  const [summaryHasErrors, setSummaryHasErrors] = useState(false)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
  const [pendingInstalls, setPendingInstalls] = useState<SyncPendingInstall[]>([])
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({})
  const [config, setConfig] = useState<SyncConfig>(DEFAULT_CONFIG)
  const savedConfig = useRef(JSON.stringify(DEFAULT_CONFIG))
  const mounted = useRef(true)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])

  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'harnessx-desktop'
    style.dataset.pluginCss = 'harnessx-desktop/sync'
    style.textContent = SYNC_STYLES
    document.head.appendChild(style)
    void fetchStatus().then(applyStatus).catch(cause => setError(errorMessage(cause)))
      .finally(() => setLoading(false))
    return () => { style.remove() }
  }, [])

  // Auto-save: every config change posts after a short debounce, no save button.
  useEffect(() => {
    if (loading) return
    const next = JSON.stringify(config)
    if (next === savedConfig.current) return
    const timer = setTimeout(() => {
      savedConfig.current = next
      void fetch('/api/desktop/sync/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: next,
      }).catch(cause => { if (mounted.current) setError(errorMessage(cause)) })
    }, 500)
    return () => { clearTimeout(timer) }
  }, [config, loading])

  const patchConfig = (patch: Partial<SyncConfig>) => {
    setConfig(previous => ({ ...previous, ...patch }))
  }

  const fetchStatus = async (): Promise<SyncStatus> => {
    const res = await fetch('/api/desktop/sync/status')
    if (!res.ok) throw new Error('Failed to fetch status')
    return res.json()
  }

  const applyStatus = (s: SyncStatus) => {
    setStatus(s)
    if (s.config) {
      const next: SyncConfig = {
        autoSync: s.config.autoSync ?? DEFAULT_CONFIG.autoSync,
        intervalMinutes: s.config.intervalMinutes ?? DEFAULT_CONFIG.intervalMinutes,
        categories: s.config.categories?.length ? s.config.categories : DEFAULT_CONFIG.categories,
        customClientId: s.config.customClientId || '',
        customClientSecret: s.config.customClientSecret || '',
      }
      setConfig(next)
      savedConfig.current = JSON.stringify(next)
    }
    if (s.lastSyncResult) {
      setConflicts(s.lastSyncResult.conflicts)
      setPendingInstalls(s.lastSyncResult.pendingInstalls)
    }
  }

  const pollUntilAuthenticated = async (timeoutMs = 60000): Promise<void> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 1500))
      try {
        const s = await fetchStatus()
        applyStatus(s)
        if (s.authenticated) return
        if (s.error) {
          setError(s.error)
          return
        }
      } catch {
        // keep polling
      }
    }
    setError('Authorization timed out. Please try again.')
  }

  const doAction = async (endpoint: string, method = 'POST', body?: unknown) => {
    setAction(endpoint)
    setError(undefined)
    try {
      const res = await fetch(`/api/desktop/sync/${endpoint}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Request failed')
      }
      if (endpoint === 'auth/start') {
        void pollUntilAuthenticated().finally(() => setAction(undefined))
      } else if (endpoint === 'trigger' || endpoint === 'reset') {
        const data = await res.json().catch(() => ({})) as { result?: NonNullable<SyncStatus['lastSyncResult']> }
        const r = data.result
        if (r) {
          setSummary(formatSyncSummary(r, t))
          setSummaryHasErrors(r.errors.length > 0)
          setConflicts(r.conflicts)
          setPendingInstalls(r.pendingInstalls)
          setInstallStates({})
        }
        applyStatus(await fetchStatus())
      } else if (endpoint === 'conflict/resolve') {
        const data = await res.json().catch(() => ({})) as { resolved?: string }
        if (data.resolved) {
          setConflicts(previous => previous.filter(item => item.key !== data.resolved))
        }
      } else {
        applyStatus(await fetchStatus())
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      if (endpoint !== 'auth/start') setAction(undefined)
    }
  }

  /** Install a remote plugin through the real market pipeline and poll its job. */
  const installViaMarket = async (plugin: SyncPendingInstall) => {
    setInstallStates(previous => ({ ...previous, [plugin.name]: 'installing' }))
    setError(undefined)
    try {
      const res = await fetch('/api/desktop/market/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ install: plugin.installSpec, label: plugin.name }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Install request failed')
      }
      const data = await res.json().catch(() => ({})) as { jobId?: string }
      if (!data.jobId) throw new Error('Install job was not created')
      for (;;) {
        await new Promise(r => setTimeout(r, 1500))
        const jobRes = await fetch(`/api/desktop/market/jobs/${data.jobId}`)
        if (!jobRes.ok) throw new Error('Failed to query install job')
        const job = await jobRes.json().catch(() => ({})) as { job?: { status?: string; detail?: string } }
        const state = job.job?.status
        if (state === 'success') break
        if (state === 'failed' || state === 'cancelled') throw new Error(job.job?.detail || 'Install failed')
        if (!mounted.current) return
      }
      if (!mounted.current) return
      setInstallStates(previous => ({ ...previous, [plugin.name]: 'done' }))
    } catch (cause) {
      if (!mounted.current) return
      setInstallStates(previous => ({ ...previous, [plugin.name]: 'failed' }))
      setError(errorMessage(cause))
    }
  }

  const resetCloud = () => {
    if (!window.confirm(t('resetConfirm'))) return
    void doAction('reset')
  }

  const busy = action !== undefined || status?.syncing === true
  const authenticated = status?.authenticated === true
  const lastResult = status?.lastSyncResult
  const errors = lastResult?.errors ?? []
  const dotClass = status?.syncing ? 'harnessxSyncDotOk' : status?.error || errors.length ? 'harnessxSyncDotErr' : authenticated ? 'harnessxSyncDotOk' : 'harnessxSyncDotOff'

  return (
    <section className="harnessxSync">
      <DesktopSectionHeader />
      <div className="harnessxSyncHero">
        <div className="harnessxSyncHeroLeft">
          <h2 className="harnessxSyncHeroTitle">
            <span className={`harnessxSyncDot ${dotClass}`} />
            {loading ? t('loading') : statusLabel(status, t)}
          </h2>
          <div className="harnessxSyncHeroMeta">
            <span>{t('account')}：{authenticated ? (status?.accountEmail || '—') : t('notAuthenticated')}</span>
            <span>{t('lastSync')}：{status?.lastSyncTime ? new Date(status.lastSyncTime).toLocaleString() : t('never')}</span>
          </div>
        </div>
        <div className="harnessxSyncHeroActions">
          {authenticated ? (
            <>
              <button className="harnessxSyncBtn harnessxSyncBtnPrimary" type="button" disabled={busy} onClick={() => { void doAction('trigger') }}>
                {busy && action !== 'reset' ? t('syncing') : t('syncNow')}
              </button>
              <button className="harnessxSyncBtn" type="button" disabled={busy} onClick={() => { void doAction('auth/logout') }}>
                {t('disconnect')}
              </button>
            </>
          ) : (
            <button className="harnessxSyncBtn harnessxSyncBtnPrimary" type="button" disabled={busy} onClick={() => { void doAction('auth/start') }}>
              {t('connect')}
            </button>
          )}
        </div>
      </div>

      {summary !== undefined && (
        <div className={`harnessxSyncAlert ${summaryHasErrors ? 'harnessxSyncAlertErr' : 'harnessxSyncAlertOk'}`}>{summary}</div>
      )}

      {lastResult && (
        <div className="harnessxSyncStats">
          <div className="harnessxSyncStat"><div className="harnessxSyncStatValue">{lastResult.sessionCounts?.local ?? 0}</div><div className="harnessxSyncStatLabel">{t('sessionLocal')}</div></div>
          <div className="harnessxSyncStat"><div className="harnessxSyncStatValue">{lastResult.sessionCounts?.remote ?? 0}</div><div className="harnessxSyncStatLabel">{t('sessionRemote')}</div></div>
          <div className="harnessxSyncStat"><div className="harnessxSyncStatValue">{lastResult.uploaded.length}</div><div className="harnessxSyncStatLabel">{t('uploadedCount')}</div></div>
          <div className="harnessxSyncStat"><div className="harnessxSyncStatValue">{lastResult.downloaded.length}</div><div className="harnessxSyncStatLabel">{t('downloadedCount')}</div></div>
        </div>
      )}

      <div className="harnessxSyncCard">
        <div className="harnessxSyncCardHead">
          <h3 className="harnessxSyncCardTitle">{t('conflictList')}</h3>
          <span className="harnessxSyncCardCount">{conflicts.length}</span>
        </div>
        {conflicts.length === 0 ? (
          <p className="harnessxSyncEmpty">{t('noConflicts')}</p>
        ) : conflicts.map(conflict => (
          <div key={conflict.key} className={`harnessxSyncItem harnessxSyncItemWarn`}>
            <div className="harnessxSyncItemMain">
              <span className="harnessxSyncItemName">{conflict.key}</span>
              <span className="harnessxSyncItemMeta">
                {t('sessionLocal')} {conflict.localMtimeMs ? new Date(conflict.localMtimeMs).toLocaleString() : '—'} · {t('sessionRemote')} {new Date(conflict.remoteMtimeMs).toLocaleString()}
              </span>
            </div>
            <div className="harnessxSyncItemActions">
              <button className="harnessxSyncBtn" type="button" disabled={busy} onClick={() => { void doAction('conflict/resolve', 'POST', { conflict, direction: 'upload' }) }}>{t('uploadOverwrite')}</button>
              <button className="harnessxSyncBtn harnessxSyncBtnPrimary" type="button" disabled={busy} onClick={() => { void doAction('conflict/resolve', 'POST', { conflict, direction: 'download' }) }}>{t('downloadOverwrite')}</button>
            </div>
          </div>
        ))}
      </div>

      {config.categories.includes('plugins') && (
        <div className="harnessxSyncCard">
          <div className="harnessxSyncCardHead">
            <h3 className="harnessxSyncCardTitle">{t('pendingInstalls')}</h3>
            <span className="harnessxSyncCardCount">{pendingInstalls.length}</span>
          </div>
          {pendingInstalls.length === 0 ? (
            <p className="harnessxSyncEmpty">{t('noPendingInstalls')}</p>
          ) : pendingInstalls.map(plugin => {
            const state = installStates[plugin.name] ?? 'idle'
            return (
              <div key={plugin.name} className="harnessxSyncItem">
                <div className="harnessxSyncItemMain">
                  <span className="harnessxSyncItemName">{plugin.name}{plugin.version ? ` · v${plugin.version}` : ''}</span>
                  <span className="harnessxSyncItemMeta">{plugin.installSpec}</span>
                </div>
                <div className="harnessxSyncItemActions">
                  {state === 'done' ? (
                    <span className="harnessxSyncItemMeta">{t('installDone')}</span>
                  ) : state === 'failed' ? (
                    <button className="harnessxSyncBtn harnessxSyncBtnDanger" type="button" onClick={() => { void installViaMarket(plugin) }}>{t('installFailed')}</button>
                  ) : (
                    <button className="harnessxSyncBtn harnessxSyncBtnPrimary" type="button" disabled={state === 'installing'} onClick={() => { void installViaMarket(plugin) }}>
                      {state === 'installing' ? t('installing') : t('installAction')}
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div className="harnessxSyncCard">
        <div className="harnessxSyncCardHead">
          <h3 className="harnessxSyncCardTitle">{t('categories')}</h3>
          <span className="harnessxSyncCardCount">{t('autoSaveHint')}</span>
        </div>
        <div className="harnessxSyncRow">
          <div>
            <div className="harnessxSyncRowLabel">{t('sessions')}</div>
            <div className="harnessxSyncRowHint">sessions/</div>
          </div>
          <label className="harnessxSyncSwitch">
            <input type="checkbox" checked={config.categories.includes('sessions')} onChange={e => patchConfig({ categories: toggleCategory(config.categories, 'sessions', e.target.checked) })} />
            <span />
          </label>
        </div>
        <div className="harnessxSyncRow">
          <div>
            <div className="harnessxSyncRowLabel">{t('settings')}</div>
            <div className="harnessxSyncRowHint">settings.yaml</div>
          </div>
          <label className="harnessxSyncSwitch">
            <input type="checkbox" checked={config.categories.includes('settings')} onChange={e => patchConfig({ categories: toggleCategory(config.categories, 'settings', e.target.checked) })} />
            <span />
          </label>
        </div>
        <div className="harnessxSyncRow">
          <div>
            <div className="harnessxSyncRowLabel">{t('plugins')}</div>
            <div className="harnessxSyncRowHint">registry.json</div>
          </div>
          <label className="harnessxSyncSwitch">
            <input type="checkbox" checked={config.categories.includes('plugins')} onChange={e => patchConfig({ categories: toggleCategory(config.categories, 'plugins', e.target.checked) })} />
            <span />
          </label>
        </div>
        <div className="harnessxSyncRow">
          <div className="harnessxSyncRowLabel">{t('autoSync')}</div>
          <div className="harnessxSyncRowControl">
            {config.autoSync && <input className="harnessxSyncNum" type="number" min={1} value={config.intervalMinutes} onChange={e => patchConfig({ intervalMinutes: Number(e.target.value) || 5 })} />}
            {config.autoSync && <span className="harnessxSyncRowHint">{t('minutes')}</span>}
            <label className="harnessxSyncSwitch">
              <input type="checkbox" checked={config.autoSync} onChange={e => patchConfig({ autoSync: e.target.checked })} />
              <span />
            </label>
          </div>
        </div>
        <div className="harnessxSyncRow">
          <div>
            <div className="harnessxSyncRowLabel">{t('customClientId')}</div>
            <div className="harnessxSyncRowHint">{t('customClientSecret')}</div>
          </div>
          <div className="harnessxSyncRowControl" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <input className="harnessxSyncText" type="text" value={config.customClientId} placeholder="Client ID" onChange={e => patchConfig({ customClientId: e.target.value })} />
            <input className="harnessxSyncText" type="password" value={config.customClientSecret} placeholder="Client Secret" onChange={e => patchConfig({ customClientSecret: e.target.value })} />
          </div>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="harnessxSyncAlert harnessxSyncAlertErr">
          {t('errorDetails')}:
          <ul className="harnessxSyncErrList">
            {errors.slice(0, 10).map((item, index) => (
              <li key={`${item.path}-${index}`}>{item.path}: {item.error}</li>
            ))}
          </ul>
        </div>
      )}
      {(error ?? status?.error) !== undefined && (
        <div className="harnessxSyncAlert harnessxSyncAlertErr">{error ?? status?.error}</div>
      )}

      {authenticated && (
        <div className="harnessxSyncDanger">
          <span className="harnessxSyncDangerText">{t('resetCloud')}</span>
          <button className="harnessxSyncBtn harnessxSyncBtnDanger" type="button" disabled={busy} onClick={resetCloud}>
            {action === 'reset' ? t('resetting') : t('resetCloud')}
          </button>
        </div>
      )}
    </section>
  )
}

function toggleCategory(categories: string[], name: string, on: boolean): string[] {
  return on ? [...new Set([...categories, name])] : categories.filter(c => c !== name)
}

function formatSyncSummary(result: NonNullable<SyncStatus['lastSyncResult']>, t: (key: SyncKey) => string): string {
  const parts: string[] = []
  if (result.uploaded.length) parts.push(`${t('uploadedCount')} ${result.uploaded.length}`)
  if (result.downloaded.length) parts.push(`${t('downloadedCount')} ${result.downloaded.length}`)
  if (result.conflicts.length) parts.push(`${t('conflictList')} ${result.conflicts.length}`)
  if (result.pendingInstalls.length) parts.push(`${t('pendingInstalls')} ${result.pendingInstalls.length}`)
  if (result.errors.length) parts.push(`${t('errorDetails')} ${result.errors.length}`)
  return parts.length ? parts.join(' · ') : `${t('summary')}：无变更`
}

function statusLabel(status: SyncStatus | undefined, t: (key: SyncKey) => string): string {
  if (!status) return t('loading')
  if (status.syncing) return t('syncing')
  if (status.error) return t('statusError')
  return authenticatedLabel(status, t)
}

function authenticatedLabel(status: SyncStatus, t: (key: SyncKey) => string): string {
  return status.authenticated ? t('statusOk') : t('notAuthenticated')
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
