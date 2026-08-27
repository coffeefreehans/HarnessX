/** Standalone "Dashboard" settings section, owned entirely by the desktop client.
 *
 * Registers as its own `settings.section` page beside Notifications and shows
 * token usage aggregated by the host from durable session logs: totals,
 * today/last-7-day sums, a 14-day daily bar chart, and a per-model roll-up.
 * Data comes from the authorized `/api/desktop/workbench/usage` route; the
 * host memoizes per-file parsing, so refreshing is cheap.
 */

import { useCallback, useEffect, useState } from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { DESKTOP_NAV_ICONS, registerDesktopSettingsNavSection } from './desktop-section.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.dashboard': DashboardKey
  }
}

export type DashboardKey =
  | 'nav'
  | 'title'
  | 'desc'
  | 'refresh'
  | 'loading'
  | 'loadFailed'
  | 'sessions'
  | 'userMessages'
  | 'assistantMessages'
  | 'inputTokens'
  | 'outputTokens'
  | 'cacheRead'
  | 'cacheWrite'
  | 'reasoning'
  | 'totalTokens'
  | 'today'
  | 'last7'
  | 'allTime'
  | 'dailyChart'
  | 'byModel'
  | 'modelColumn'
  | 'messagesColumn'
  | 'empty'

const zh: Record<DashboardKey, string> = {
  nav: '仪表盘',
  title: '使用仪表盘',
  desc: '统计本地会话日志中的 token 用量，数据来自本机，不含云端记录。',
  refresh: '刷新',
  loading: '统计中…',
  loadFailed: '统计读取失败，请稍后重试。',
  sessions: '会话数',
  userMessages: '用户消息',
  assistantMessages: '模型回复',
  inputTokens: '输入 tokens',
  outputTokens: '输出 tokens',
  cacheRead: '缓存读取',
  cacheWrite: '缓存写入',
  reasoning: '推理 tokens',
  totalTokens: '总 tokens',
  today: '今日',
  last7: '近 7 天',
  allTime: '累计',
  dailyChart: '近 14 天用量',
  byModel: '按模型统计',
  modelColumn: '模型',
  messagesColumn: '回复数',
  empty: '暂无用量数据；发起一些对话后再来看。',
}

const en: Record<DashboardKey, string> = {
  nav: 'Dashboard',
  title: 'Usage Dashboard',
  desc: 'Token usage aggregated from local session logs; on-device data only.',
  refresh: 'Refresh',
  loading: 'Crunching logs…',
  loadFailed: 'Failed to read usage; try again later.',
  sessions: 'Sessions',
  userMessages: 'User messages',
  assistantMessages: 'Model replies',
  inputTokens: 'Input tokens',
  outputTokens: 'Output tokens',
  cacheRead: 'Cache read',
  cacheWrite: 'Cache write',
  reasoning: 'Reasoning tokens',
  totalTokens: 'Total tokens',
  today: 'Today',
  last7: 'Last 7 days',
  allTime: 'All time',
  dailyChart: 'Last 14 days',
  byModel: 'By model',
  modelColumn: 'Model',
  messagesColumn: 'Replies',
  empty: 'No usage yet; start a conversation and come back.',
}

const NS = 'settings.dashboard'

interface UsageReport {
  generatedAt: number
  sessions: number
  userMessages: number
  assistantMessages: number
  totals: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    reasoningTokens: number
  }
  byModel: Array<{ provider: string; model: string; messages: number; inputTokens: number; outputTokens: number; totalTokens: number }>
  daily: Array<{ day: string; inputTokens: number; outputTokens: number; totalTokens: number }>
  today: { day: string; inputTokens: number; outputTokens: number; totalTokens: number } | undefined
  last7: { day: string; inputTokens: number; outputTokens: number; totalTokens: number }
}

const DASHBOARD_CSS = `
.dshDashboardSection { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 24px; max-width: 760px; }
.dshDashboardHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dshDashboardTitle { font-size: 16px; font-weight: 600; line-height: 24px; color: var(--dsw-alias-label-primary); }
.dshDashboardDesc { margin-top: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshDashboardRefresh { flex: none; padding: 5px 12px; font-size: 12px; border-radius: 6px; border: 1px solid var(--dsw-alias-border-l2); background: transparent; color: var(--dsw-alias-label-primary); cursor: pointer; font: inherit; }
.dshDashboardRefresh:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover); }
.dshDashboardRefresh:disabled { opacity: .5; cursor: default; }
.dshDashboardNotice { font-size: 12px; color: var(--dsw-alias-label-tertiary); }
.dshDashboardCards { display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 8px; }
.dshDashboardCard { padding: 10px 12px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.03)); }
.dshDashboardCardLabel { font-size: 11px; color: var(--dsw-alias-label-tertiary); }
.dshDashboardCardValue { margin-top: 3px; font-size: 17px; font-weight: 600; color: var(--dsw-alias-label-primary); font-variant-numeric: tabular-nums; }
.dshDashboardSub { display: flex; gap: 8px; }
.dshDashboardSub .dshDashboardCard { flex: 1 1 0; }
.dshDashboardBlock { display: flex; flex-direction: column; gap: 8px; }
.dshDashboardBlockTitle { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dshDashboardChart { display: flex; align-items: flex-end; gap: 4px; height: 120px; padding: 8px 10px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.03)); }
.dshDashboardBarWrap { flex: 1 1 0; display: flex; flex-direction: column; align-items: center; gap: 4px; height: 100%; justify-content: flex-end; }
.dshDashboardBar { width: 100%; max-width: 26px; border-radius: 3px 3px 0 0; background: var(--dsw-alias-accent, #2563eb); min-height: 2px; }
.dshDashboardBarLabel { font-size: 9.5px; color: var(--dsw-alias-label-tertiary); white-space: nowrap; }
.dshDashboardTable { width: 100%; border-collapse: collapse; font-size: 12px; }
.dshDashboardTable th { text-align: left; padding: 6px 8px; color: var(--dsw-alias-label-tertiary); font-weight: 500; border-bottom: 1px solid var(--dsw-alias-border-l1); }
.dshDashboardTable td { padding: 6px 8px; color: var(--dsw-alias-label-primary); border-bottom: 1px solid var(--dsw-alias-border-l1); font-variant-numeric: tabular-nums; }
.dshDashboardTable tr:last-child td { border-bottom: none; }
`

let stylesInjected = false
function ensureDashboardStyles(): void {
  if (stylesInjected || typeof document === 'undefined') return
  const style = document.createElement('style')
  style.dataset.plugin = 'harnessx-desktop'
  style.dataset.pluginCss = 'harnessx-desktop/usage-dashboard'
  style.textContent = DASHBOARD_CSS
  document.head.appendChild(style)
  stylesInjected = true
}

function formatTokens(value: number): string {
  return value.toLocaleString()
}

function formatDayLabel(day: string): string {
  const suffix = day.slice(5)
  return suffix.length === 5 ? suffix : day
}

export function UsageDashboardSection(_props: PropsRuntime<'settings.section'> & PropsLocale<'settings.dashboard'>) {
  const { t } = _props
  const [report, setReport] = useState<UsageReport | undefined>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)

  const load = useCallback(async (quiet: boolean) => {
    if (!quiet) setLoading(true)
    try {
      const response = await fetch('/api/desktop/workbench/usage')
      if (!response.ok) throw new Error(`status ${String(response.status)}`)
      const value = await response.json() as UsageReport
      setReport(value)
      setFailed(false)
    } catch {
      setFailed(true)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    ensureDashboardStyles()
    void load(false)
  }, [load])

  const totals = report?.totals

  return (
    <div className="dshDashboardSection">
      <div className="dshDashboardHeader">
        <div>
          <div className="dshDashboardTitle">{t('title')}</div>
          <div className="dshDashboardDesc">{t('desc')}</div>
        </div>
        <button type="button" className="dshDashboardRefresh" disabled={loading}
          onClick={() => { void load(false) }}>
          {t('refresh')}
        </button>
      </div>

      {loading && <div className="dshDashboardNotice">{t('loading')}</div>}
      {!loading && failed && <div className="dshDashboardNotice">{t('loadFailed')}</div>}
      {!loading && !failed && report === undefined && <div className="dshDashboardNotice">{t('empty')}</div>}

      {!loading && !failed && report !== undefined && (report.sessions === 0 || report.assistantMessages === 0)
        ? <div className="dshDashboardNotice">{t('empty')}</div>
        : undefined}

      {!loading && !failed && report !== undefined && report.assistantMessages > 0 && (
        <>
          <div className="dshDashboardCards">
            <StatCard label={t('sessions')} value={String(report.sessions)} />
            <StatCard label={t('userMessages')} value={formatTokens(report.userMessages)} />
            <StatCard label={t('assistantMessages')} value={formatTokens(report.assistantMessages)} />
            <StatCard label={t('totalTokens')} value={formatTokens((totals?.inputTokens ?? 0) + (totals?.outputTokens ?? 0))} />
          </div>

          <div className="dshDashboardCards">
            <StatCard label={`${t('inputTokens')} · ${t('allTime')}`} value={formatTokens(totals?.inputTokens ?? 0)} />
            <StatCard label={`${t('outputTokens')} · ${t('allTime')}`} value={formatTokens(totals?.outputTokens ?? 0)} />
            <StatCard label={`${t('cacheRead')} · ${t('allTime')}`} value={formatTokens(totals?.cacheReadTokens ?? 0)} />
            <StatCard label={`${t('cacheWrite')} · ${t('allTime')}`} value={formatTokens(totals?.cacheWriteTokens ?? 0)} />
            <StatCard label={`${t('reasoning')} · ${t('allTime')}`} value={formatTokens(totals?.reasoningTokens ?? 0)} />
          </div>

          <div className="dshDashboardSub">
            <StatCard
              label={`${t('today')} · ${t('totalTokens')}`}
              value={formatTokens(report.today?.totalTokens ?? 0)}
            />
            <StatCard
              label={`${t('last7')} · ${t('totalTokens')}`}
              value={formatTokens(report.last7.totalTokens)}
            />
          </div>

          <div className="dshDashboardBlock">
            <div className="dshDashboardBlockTitle">{t('dailyChart')}</div>
            <div className="dshDashboardChart">
              {report.daily.map(day => {
                const peak = Math.max(1, ...report.daily.map(entry => entry.totalTokens))
                const height = Math.max(2, Math.round((day.totalTokens / peak) * 88))
                return (
                  <div key={day.day} className="dshDashboardBarWrap"
                    title={`${day.day}: ${formatTokens(day.totalTokens)}`}>
                    <div className="dshDashboardBar" style={{ height: `${String(height)}px` }} />
                    <div className="dshDashboardBarLabel">{formatDayLabel(day.day)}</div>
                  </div>
                )
              })}
            </div>
          </div>

          {report.byModel.length > 0 && (
            <div className="dshDashboardBlock">
              <div className="dshDashboardBlockTitle">{t('byModel')}</div>
              <table className="dshDashboardTable">
                <thead>
                  <tr>
                    <th>{t('modelColumn')}</th>
                    <th>{t('messagesColumn')}</th>
                    <th>{t('inputTokens')}</th>
                    <th>{t('outputTokens')}</th>
                    <th>{t('totalTokens')}</th>
                  </tr>
                </thead>
                <tbody>
                  {report.byModel.slice(0, 10).map(row => (
                    <tr key={`${row.provider}::${row.model}`}>
                      <td>{row.model}</td>
                      <td>{formatTokens(row.messages)}</td>
                      <td>{formatTokens(row.inputTokens)}</td>
                      <td>{formatTokens(row.outputTokens)}</td>
                      <td>{formatTokens(row.totalTokens)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function StatCard(props: { label: string; value: string }) {
  return (
    <div className="dshDashboardCard">
      <div className="dshDashboardCardLabel">{props.label}</div>
      <div className="dshDashboardCardValue">{props.value}</div>
    </div>
  )
}

/** Register the desktop-owned Dashboard section in the settings panel. */
export function applyUsageDashboard(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'dashboard: dictionaries')
  const t = ctx.locale.bind(NS)
  registerDesktopSettingsNavSection(() => t('nav'), DESKTOP_NAV_ICONS.chart)
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'dashboard',
    order: 70,
    label: () => t('nav'),
    locale: NS,
  }, UsageDashboardSection))
}
