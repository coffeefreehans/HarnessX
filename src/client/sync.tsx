/** Browser-side HarnessX Google Drive sync settings page. */

import { useEffect, useState, type ReactNode } from 'react'
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
  sessions: '会话',
  plugins: '插件与市场源',
  settings: '设置',
  customClientId: '自定义 Client ID',
  customClientSecret: '自定义 Client Secret',
  saveConfig: '保存配置',
  statusOk: '就绪',
  statusError: '错误',
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
  sessions: 'Sessions',
  plugins: 'Plugins & Market',
  settings: 'Settings',
  customClientId: 'Custom Client ID',
  customClientSecret: 'Custom Client Secret',
  saveConfig: 'Save Config',
  statusOk: 'Ready',
  statusError: 'Error',
}

const NS = 'settings.sync'

interface SyncStatus {
  configured: boolean
  authenticated: boolean
  accountEmail?: string
  lastSyncTime?: number
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
.harnessxSyncButton:disabled { opacity: .5; cursor: not-allowed; }
.harnessxSyncGrid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 0; margin-top: 20px; border-top: 1px solid var(--dsw-alias-border-l1, #ececf1); border-left: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxSyncField { min-width: 0; padding: 14px 16px; border-right: 1px solid var(--dsw-alias-border-l1, #ececf1); border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.harnessxSyncField dt { margin: 0 0 5px; color: var(--dsw-alias-text-secondary, #686875); font-size: 12px; }
.harnessxSyncField dd { margin: 0; font-size: 14px; line-height: 1.5; overflow-wrap: anywhere; }
.harnessxSyncConfig { margin-top: 24px; display: flex; flex-direction: column; gap: 16px; }
.harnessxSyncConfigRow { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 16px; }
.harnessxSyncConfigRow label { font-size: 13px; }
.harnessxSyncConfigRow input[type="checkbox"] { width: 16px; height: 16px; }
.harnessxSyncConfigRow input[type="number"] { width: 80px; padding: 4px 6px; }
.harnessxSyncConfigRow input[type="text"] { flex: 1; min-width: 200px; padding: 4px 6px; }
.harnessxSyncError { margin: 16px 0 0; padding: 10px 12px; border-left: 3px solid #dc2626; background: rgb(254 242 242 / 75%); color: #b42318; font-size: 13px; line-height: 1.5; }
@media (max-width: 720px) {
  .harnessxSync { padding: 18px; }
  .harnessxSyncHeader { flex-direction: column; }
  .harnessxSyncActions { justify-content: flex-start; }
  .harnessxSyncGrid { grid-template-columns: minmax(0, 1fr); }
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
  const [action, setAction] = useState<'sync' | 'auth' | 'logout' | 'config'>()
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

  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'harnessx-desktop'
    style.dataset.pluginCss = 'harnessx-desktop/sync'
    style.textContent = SYNC_STYLES
    document.head.appendChild(style)
    void fetchStatus().then(s => {
      setStatus(s)
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
    }).catch(cause => setError(errorMessage(cause)))
      .finally(() => setLoading(false))
    return () => { style.remove() }
  }, [])

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
    setAction(endpoint as any)
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
      } else {
        const newStatus = await fetchStatus()
        setStatus(newStatus)
        if (newStatus.config) {
          setConfig({
            enabled: newStatus.config.enabled ?? false,
            autoSync: newStatus.config.autoSync ?? false,
            intervalMinutes: newStatus.config.intervalMinutes ?? 30,
            categories: newStatus.config.categories?.length ? newStatus.config.categories : ['sessions', 'plugins', 'settings'],
            customClientId: newStatus.config.customClientId || '',
            customClientSecret: newStatus.config.customClientSecret || '',
          })
        }
      }
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      if (endpoint !== 'auth/start') setAction(undefined)
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

  const busy = action !== undefined || status?.syncing === true
  const authenticated = status?.authenticated === true
  const accountEmail = status?.accountEmail

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
                className="harnessxSyncButton"
                type="button"
                disabled={busy}
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

      {(error ?? status?.error) !== undefined && (
        <p className="harnessxSyncError">{error ?? status?.error}</p>
      )}
    </section>
  )
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