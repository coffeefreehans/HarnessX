/** Browser-side HarnessX Google Drive sync settings page (v3 rewrite). */

import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'

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
  | 'enabled'
  | 'autoSync'
  | 'interval'
  | 'minutes'
  | 'categories'
  | 'sessions'
  | 'plugins'
  | 'settings'
  | 'customClientId'
  | 'customClientSecret'
  | 'saveConfig'
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
  | 'resetCloud'
  | 'resetConfirm'
  | 'resetting'
  | 'errorDetails'

const zh: Record<SyncKey, string> = {
  nav: '云同步',
  title: 'Google Drive 云同步',
  loading: '加载同步状态…',
  connect: '连接 Google 账号',
  disconnect: '断开连接',
  syncNow: '立即同步',
  syncing: '同步中…',
  lastSync: '上次同步',
  never: '从未',
  account: '账号',
  notAuthenticated: '未认证',
  enabled: '启用同步',
  autoSync: '自动同步',
  interval: '同步间隔',
  minutes: '分钟',
  categories: '同步内容',
  sessions: '会话（双端并集，新者胜）',
  plugins: '插件（仅安装记录）',
  settings: '设置（冲突需手动选择）',
  customClientId: '自定义 Client ID',
  customClientSecret: '自定义 Client Secret',
  saveConfig: '保存配置',
  statusOk: '就绪',
  statusError: '错误',
  summary: '同步结果',
  uploadOverwrite: '上传覆盖线上',
  downloadOverwrite: '下载到本地',
  conflictList: '设置冲突',
  noConflicts: '无冲突',
  pendingInstalls: '线上已装但本机未装',
  noPendingInstalls: '所有线上插件本机均已安装',
  installAction: '安装',
  installing: '安装中…',
  installDone: '安装成功',
  installFailed: '安装失败',
  sessionStats: '会话统计',
  sessionLocal: '本机会话',
  sessionRemote: '云端会话',
  resetCloud: '重置云端数据',
  resetConfirm: '将删除 Google Drive 中全部同步数据，并以本机数据重新上传。确定继续？',
  resetting: '重置中…',
  errorDetails: '错误详情',
}

const en: Record<SyncKey, string> = {
  nav: 'Cloud Sync',
  title: 'Google Drive Cloud Sync',
  loading: 'Loading sync status…',
  connect: 'Connect Google Account',
  disconnect: 'Disconnect',
  syncNow: 'Sync Now',
  syncing: 'Syncing…',
  lastSync: 'Last Sync',
  never: 'Never',
  account: 'Account',
  notAuthenticated: 'Not authenticated',
  enabled: 'Enable Sync',
  autoSync: 'Auto Sync',
  interval: 'Interval',
  minutes: 'minutes',
  categories: 'Sync Categories',
  sessions: 'Sessions (union, newest wins)',
  plugins: 'Plugins (install records only)',
  settings: 'Settings (manual conflict choice)',
  customClientId: 'Custom Client ID',
  customClientSecret: 'Custom Client Secret',
  saveConfig: 'Save Config',
  statusOk: 'Ready',
  statusError: 'Error',
  summary: 'Sync result',
  uploadOverwrite: 'Upload overwrites cloud',
  downloadOverwrite: 'Download to local',
  conflictList: 'Settings conflicts',
  noConflicts: 'No conflicts',
  pendingInstalls: 'Installed remotely but not locally',
  noPendingInstalls: 'All remote plugins are installed locally',
  installAction: 'Install',
  installing: 'Installing…',
  installDone: 'Installed',
  installFailed: 'Install failed',
  sessionStats: 'Session stats',
  sessionLocal: 'Local sessions',
  sessionRemote: 'Remote sessions',
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
  config: {
    enabled: boolean
    autoSync: boolean
    intervalMinutes: number
    categories: string[]
    customClientId?: string
    customClientSecret?: string
  }
  error?: string
}

type InstallState = 'idle' | 'installing' | 'done' | 'failed'

const SYNC_STYLES = `
.harnessxSync { width: 100%; min-height: 100%; box-sizing: border-box; padding: 24px; color: var(--dsw-alias-text, #17171c); background: var(--dsw-alias-bg-base, #fff); }
.harnessxSyncHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding-bottom: 18px; border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxSyncTitle { margin: 0; font-size: 20px; line-height: 1.35; font-weight: 700; letter-spacing: 0; }
.harnessxSyncStatus { margin: 5px 0 0; color: var(--dsw-alias-text-secondary, #686875); font-size: 13px; line-height: 1.5; }
.harnessxSyncActions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 8px; }
.harnessxSyncButton { min-height: 36px; padding: 8px 13px; border: 1px solid var(--dsw-alias-border-l2, #d7d7df); border-radius: 6px; background: transparent; color: inherit; cursor: pointer; font-size: 13px; }
.harnessxSyncButton:hover { border-color: var(--dsw-alias-accent, #2563eb); color: var(--dsw-alias-accent, #2563eb); }
.harnessxSyncButtonPrimary { border-color: var(--dsw-alias-accent, #2563eb); background: var(--dsw-alias-accent, #2563eb); color: #fff; }
.harnessxSyncButtonPrimary:hover { color: #fff; filter: brightness(.96); }
.harnessxSyncButtonDanger { border-color: #dc2626; color: #dc2626; }
.harnessxSyncButtonDanger:hover { background: rgb(254 242 242); color: #b42318; }
.harnessxSyncButton:disabled { opacity: .5; cursor: not-allowed; }
.harnessxSyncGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1, #ececf1); border-left: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxSyncField { min-width: 0; padding: 14px 16px; border-right: 1px solid var(--dsw-alias-border-l1, #ececf1); border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxSyncField dt { margin: 0 0 5px; color: var(--dsw-alias-text-secondary, #686875); font-size: 12px; }
.harnessxSyncField dd { margin: 0; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.harnessxSyncStats { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 0; margin-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1, #ececf1); border-left: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxSyncConfig { margin-top: 24px; display: flex; flex-direction: column; gap: 16px; }
.harnessxSyncConfigRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.harnessxSyncConfigRow label { font-size: 13px; }
.harnessxSyncConfigRow input[type="checkbox"] { width: 16px; height: 16px; }
.harnessxSyncConfigRow input[type="number"] { width: 80px; padding: 4px 6px; }
.harnessxSyncConfigRow input[type="text"] { flex: 1; min-width: 200px; padding: 4px 6px; }
.harnessxSyncSection { margin-top: 28px; }
.harnessxSyncSectionTitle { margin: 0 0 10px; font-size: 15px; font-weight: 600; }
.harnessxSyncList { margin: 0; padding: 0; list-style: none; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 6px; overflow: hidden; }
.harnessxSyncListItem { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 10px 12px; font-size: 13px; border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxSyncListItem:last-child { border-bottom: none; }
.harnessxSyncListItemPath { min-width: 0; overflow-wrap: anywhere; }
.harnessxSyncListItemMeta { color: var(--dsw-alias-text-secondary, #686875); font-size: 12px; white-space: nowrap; }
.harnessxSyncListItemActions { display: flex; gap: 6px; flex-shrink: 0; }
.harnessxSyncEmpty { margin: 0; padding: 14px; color: var(--dsw-alias-text-secondary, #686875); font-size: 13px; text-align: center; border: 1px dashed var(--dsw-alias-border-l1, #ececf1); border-radius: 6px; }
.harnessxSyncError { margin: 16px 0 0; padding: 10px 12px; border-left: 3px solid #dc2626; background: rgb(254 242 242 / 75%); color: #b42318; font-size: 13px; line-height: 1.5; }
.harnessxSyncSuccess { margin: 16px 0 0; padding: 10px 12px; border-left: 3px solid #16a34a; background: rgb(240 253 244 / 75%); color: #15803d; font-size: 13px; line-height: 1.5; }
.harnessxSyncErrorList { margin: 8px 0 0; padding-left: 16px; }
.harnessxSyncErrorList li { overflow-wrap: anywhere; }
.harnessxSyncDangerZone { margin-top: 32px; padding: 14px 16px; border: 1px solid #fecaca; border-radius: 6px; background: rgb(254 242 242 / 40%); }
.harnessxSyncDangerTitle { margin: 0 0 8px; font-size: 13px; font-weight: 600; color: #b42318; }
@media (max-width: 720px) {
  .harnessxSync { padding: 18px; }
  .harnessxSyncHeader { flex-direction: column; }
  .harnessxSyncActions { justify-content: flex-start; }
  .harnessxSyncGrid, .harnessxSyncStats { grid-template-columns: minmax(0, 1fr); }
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
  const [syncSummary, setSyncSummary] = useState<string>()
  const [summaryHasErrors, setSummaryHasErrors] = useState(false)
  const [conflicts, setConflicts] = useState<SyncConflict[]>([])
  const [pendingInstalls, setPendingInstalls] = useState<SyncPendingInstall[]>([])
  const [installStates, setInstallStates] = useState<Record<string, InstallState>>({})
  const [config, setConfig] = useState<{
    enabled: boolean
    autoSync: boolean
    intervalMinutes: number
    categories: string[]
    customClientId: string
    customClientSecret: string
  }>({
    enabled: false,
    autoSync: false,
    intervalMinutes: 30,
    categories: ['sessions', 'plugins', 'settings'],
    customClientId: '',
    customClientSecret: '',
  })
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
    void fetchStatus().then(s => {
      setStatus(s)
      applyStatus(s)
    }).catch(cause => setError(errorMessage(cause)))
      .finally(() => setLoading(false))
    return () => { style.remove() }
  }, [])

  const applyStatus = (s: SyncStatus) => {
    if (s.config) {
      setConfig({
        enabled: s.config.enabled ?? false,
        autoSync: s.config.autoSync ?? false,
        intervalMinutes: s.config.intervalMinutes ?? 30,
        categories: s.config.categories?.length ? s.config.categories : ['sessions', 'plugins', 'settings'],
        customClientId: s.config.customClientId || '',
        customClientSecret: s.config.customClientSecret || '',
      })
    }
    if (s.lastSyncResult) {
      setConflicts(s.lastSyncResult.conflicts)
      setPendingInstalls(s.lastSyncResult.pendingInstalls)
    }
  }

  const fetchStatus = async (): Promise<SyncStatus> => {
    const res = await fetch('/api/desktop/sync/status')
    if (!res.ok) throw new Error('Failed to fetch status')
    return res.json()
  }

  const pollUntilAuthenticated = async (timeoutMs = 60000): Promise<void> => {
    const start = Date.now()
    while (Date.now() - start < timeoutMs) {
      await new Promise(r => setTimeout(r, 1500))
      try {
        const s = await fetchStatus()
        setStatus(s)
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

  const refreshStatus = async () => {
    const s = await fetchStatus()
    setStatus(s)
    applyStatus(s)
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
          setSyncSummary(formatSyncSummary(r, t))
          setSummaryHasErrors(r.errors.length > 0)
          setConflicts(r.conflicts)
          setPendingInstalls(r.pendingInstalls)
          setInstallStates({})
        }
        await refreshStatus()
      } else if (endpoint === 'conflict/resolve') {
        const data = await res.json().catch(() => ({})) as { resolved?: string }
        if (data.resolved) {
          setConflicts(previous => previous.filter(item => item.key !== data.resolved))
        }
      } else {
        await refreshStatus()
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

  const saveConfig = () => {
    void doAction('config', 'POST', {
      enabled: config.enabled,
      autoSync: config.autoSync,
      intervalMinutes: config.intervalMinutes,
      categories: config.categories,
      customClientId: config.customClientId || undefined,
      customClientSecret: config.customClientSecret || undefined,
    })
  }

  const resetCloud = () => {
    if (!window.confirm(t('resetConfirm'))) return
    void doAction('reset')
  }

  const busy = action !== undefined || status?.syncing === true
  const authenticated = status?.authenticated === true
  const accountEmail = status?.accountEmail
  const lastResult = status?.lastSyncResult
  const errors = lastResult?.errors ?? []

  return (
    <section className="harnessxSync">
      <header className="harnessxSyncHeader">
        <div>
          <h2 className="harnessxSyncTitle">{t('title')}</h2>
          <p className="harnessxSyncStatus">{loading ? t('loading') : statusLabel(status, t)}</p>
        </div>
        <div className="harnessxSyncActions">
          {authenticated ? (
            <>
              <button
                className="harnessxSyncButton harnessxSyncButtonPrimary"
                type="button"
                disabled={busy || !config.enabled}
                onClick={() => { void doAction('trigger') }}
              >
                {busy ? t('syncing') : t('syncNow')}
              </button>
              <button
                className="harnessxSyncButton"
                type="button"
                disabled={busy}
                onClick={() => { void doAction('auth/logout') }}
              >
                {t('disconnect')}
              </button>
            </>
          ) : (
            <button
              className="harnessxSyncButton harnessxSyncButtonPrimary"
              type="button"
              disabled={busy}
              onClick={() => { void doAction('auth/start') }}
            >
              {t('connect')}
            </button>
          )}
        </div>
      </header>

      <dl className="harnessxSyncGrid">
        <div className="harnessxSyncField"><dt>{t('account')}</dt><dd>{authenticated ? (accountEmail || '—') : t('notAuthenticated')}</dd></div>
        <div className="harnessxSyncField"><dt>{t('lastSync')}</dt><dd>{status?.lastSyncTime ? new Date(status.lastSyncTime).toLocaleString() : t('never')}</dd></div>
      </dl>

      {lastResult && (
        <dl className="harnessxSyncStats">
          <div className="harnessxSyncField"><dt>{t('sessionLocal')}</dt><dd>{lastResult.sessionCounts?.local ?? 0}</dd></div>
          <div className="harnessxSyncField"><dt>{t('sessionRemote')}</dt><dd>{lastResult.sessionCounts?.remote ?? 0}</dd></div>
          <div className="harnessxSyncField"><dt>{t('summary')}</dt><dd>{formatSyncSummary(lastResult, t)}</dd></div>
        </dl>
      )}

      {syncSummary !== undefined && (
        <p className={summaryHasErrors ? 'harnessxSyncError' : 'harnessxSyncSuccess'}>{syncSummary}</p>
      )}

      <div className="harnessxSyncSection">
        <h3 className="harnessxSyncSectionTitle">{t('conflictList')} ({conflicts.length})</h3>
        {conflicts.length === 0 ? (
          <p className="harnessxSyncEmpty">{t('noConflicts')}</p>
        ) : (
          <ul className="harnessxSyncList">
            {conflicts.map(conflict => (
              <li key={conflict.key} className="harnessxSyncListItem">
                <div className="harnessxSyncListItemPath">
                  {conflict.key}
                  <div className="harnessxSyncListItemMeta">
                    {t('sessionLocal')} {conflict.localMtimeMs ? new Date(conflict.localMtimeMs).toLocaleString() : '—'} · {t('sessionRemote')} {new Date(conflict.remoteMtimeMs).toLocaleString()}
                  </div>
                </div>
                <div className="harnessxSyncListItemActions">
                  <button className="harnessxSyncButton" type="button" disabled={busy} onClick={() => { void doAction('conflict/resolve', 'POST', { conflict, direction: 'upload' }) }}>
                    {t('uploadOverwrite')}
                  </button>
                  <button className="harnessxSyncButton" type="button" disabled={busy} onClick={() => { void doAction('conflict/resolve', 'POST', { conflict, direction: 'download' }) }}>
                    {t('downloadOverwrite')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {config.categories.includes('plugins') && (
        <div className="harnessxSyncSection">
          <h3 className="harnessxSyncSectionTitle">{t('pendingInstalls')} ({pendingInstalls.length})</h3>
          {pendingInstalls.length === 0 ? (
            <p className="harnessxSyncEmpty">{t('noPendingInstalls')}</p>
          ) : (
            <ul className="harnessxSyncList">
              {pendingInstalls.map(plugin => {
                const state = installStates[plugin.name] ?? 'idle'
                return (
                  <li key={plugin.name} className="harnessxSyncListItem">
                    <div className="harnessxSyncListItemPath">
                      {plugin.name}
                      {plugin.version && <span className="harnessxSyncListItemMeta"> v{plugin.version}</span>}
                      <div className="harnessxSyncListItemMeta">{plugin.installSpec}</div>
                    </div>
                    <div className="harnessxSyncListItemActions">
                      {state === 'done' ? (
                        <span className="harnessxSyncListItemMeta">{t('installDone')}</span>
                      ) : state === 'failed' ? (
                        <>
                          <span className="harnessxSyncListItemMeta">{t('installFailed')}</span>
                          <button className="harnessxSyncButton" type="button" onClick={() => { void installViaMarket(plugin) }}>{t('installAction')}</button>
                        </>
                      ) : (
                        <button className="harnessxSyncButton harnessxSyncButtonPrimary" type="button" disabled={state === 'installing'} onClick={() => { void installViaMarket(plugin) }}>
                          {state === 'installing' ? t('installing') : t('installAction')}
                        </button>
                      )}
                    </div>
                  </li>
                )
              })}
            </ul>
          )}
        </div>
      )}

      <div className="harnessxSyncConfig">
        <div className="harnessxSyncConfigRow">
          <label><input type="checkbox" checked={config.enabled} onChange={e => setConfig({ ...config, enabled: e.target.checked })} /> {t('enabled')}</label>
          <label><input type="checkbox" checked={config.autoSync} onChange={e => setConfig({ ...config, autoSync: e.target.checked })} /> {t('autoSync')}</label>
          <label>{t('interval')} <input type="number" value={config.intervalMinutes} onChange={e => setConfig({ ...config, intervalMinutes: Number(e.target.value) || 5 })} min={1} /> {t('minutes')}</label>
        </div>
        <div className="harnessxSyncConfigRow">
          <label><input type="checkbox" checked={config.categories.includes('sessions')} onChange={e => {
            const v = e.target.checked ? [...config.categories, 'sessions'] : config.categories.filter(c => c !== 'sessions')
            setConfig({ ...config, categories: v })
          }} /> {t('sessions')}</label>
          <label><input type="checkbox" checked={config.categories.includes('plugins')} onChange={e => {
            const v = e.target.checked ? [...config.categories, 'plugins'] : config.categories.filter(c => c !== 'plugins')
            setConfig({ ...config, categories: v })
          }} /> {t('plugins')}</label>
          <label><input type="checkbox" checked={config.categories.includes('settings')} onChange={e => {
            const v = e.target.checked ? [...config.categories, 'settings'] : config.categories.filter(c => c !== 'settings')
            setConfig({ ...config, categories: v })
          }} /> {t('settings')}</label>
        </div>
        <div className="harnessxSyncConfigRow">
          <label>{t('customClientId')} <input type="text" value={config.customClientId} onChange={e => setConfig({ ...config, customClientId: e.target.value })} placeholder="optional" /></label>
        </div>
        <div className="harnessxSyncConfigRow">
          <label>{t('customClientSecret')} <input type="text" value={config.customClientSecret} onChange={e => setConfig({ ...config, customClientSecret: e.target.value })} placeholder="optional" /></label>
        </div>
        <div className="harnessxSyncConfigRow">
          <button className="harnessxSyncButton harnessxSyncButtonPrimary" type="button" disabled={busy} onClick={saveConfig}>
            {action === 'config' ? t('syncing') : t('saveConfig')}
          </button>
        </div>
      </div>

      {errors.length > 0 && (
        <div className="harnessxSyncError">
          {t('errorDetails')}:
          <ul className="harnessxSyncErrorList">
            {errors.slice(0, 10).map((item, index) => (
              <li key={`${item.path}-${index}`}>{item.path}: {item.error}</li>
            ))}
          </ul>
        </div>
      )}
      {(error ?? status?.error) !== undefined && (
        <p className="harnessxSyncError">{error ?? status?.error}</p>
      )}

      {authenticated && (
        <div className="harnessxSyncDangerZone">
          <p className="harnessxSyncDangerTitle">{t('resetCloud')}</p>
          <button className="harnessxSyncButton harnessxSyncButtonDanger" type="button" disabled={busy} onClick={resetCloud}>
            {action === 'reset' ? t('resetting') : t('resetCloud')}
          </button>
        </div>
      )}
    </section>
  )
}

function formatSyncSummary(result: NonNullable<SyncStatus['lastSyncResult']>, t: (key: SyncKey) => string): string {
  const parts: string[] = []
  if (result.uploaded.length) parts.push(`↑ ${result.uploaded.length}`)
  if (result.downloaded.length) parts.push(`↓ ${result.downloaded.length}`)
  if (result.conflicts.length) parts.push(`⚠ ${result.conflicts.length}`)
  if (result.pendingInstalls.length) parts.push(`☰ ${result.pendingInstalls.length}`)
  if (result.errors.length) parts.push(`✕ ${result.errors.length}`)
  return parts.length ? parts.join(' · ') : `${t('summary')}：无变更`
}

function statusLabel(status: SyncStatus | undefined, t: (key: SyncKey) => string): string {
  if (!status) return t('loading')
  if (status.syncing) return t('syncing')
  if (status.error) return t('statusError')
  return t('statusOk')
}

function errorMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
