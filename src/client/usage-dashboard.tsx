/** Standalone "Dashboard" settings section, owned entirely by the desktop client.
 *
 * Registers as its own `settings.section` page beside Notifications and shows
 * token usage aggregated by the host from durable session logs. A 今日/近7日/
 * 近30日 range switch drives the summary cards, the daily bar chart (each bar
 * carries its value beneath), and the per-model table together; data comes
 * from the authorized `/api/desktop/workbench/usage` route whose host memoizes
 * per-file parsing, so refreshing is cheap.
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
  | 'last30'
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
  last7: '近 7 日',
  last30: '近 30 日',
  allTime: '累计',
  dailyChart: '每日用量',
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
  last30: 'Last 30 days',
  allTime: 'All time',
  dailyChart: 'Daily usage',
  byModel: 'By model',
  modelColumn: 'Model',
  messagesColumn: 'Replies',
  empty: 'No usage yet; start a conversation and come back.',
}

const NS = 'settings.dashboard'

interface UsageDayPoint {
  day: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
  messages?: number
}

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
  daily: UsageDayPoint[]
  today: UsageDayPoint | undefined
  last7: UsageDayPoint
  /** Per-model daily split aligned index-for-index with `daily`. */
  byModelDaily: Array<{ provider: string; model: string; daily: UsageDayPoint[] }>
}

type RangeKey = 'today' | 'last7' | 'last30'

const RANGE_WINDOWS: Record<RangeKey, number> = { today: 1, last7: 7, last30: 30 }

const DASHBOARD_CSS = `
.dshDashboardSection { display: flex; flex-direction: column; gap: 14px; padding: 4px 0 24px; max-width: 760px; }
.dshDashboardHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; }
.dshDashboardTitle { font-size: 16px; font-weight: 600; line-height: 24px; color: var(--dsw-alias-label-primary); }
.dshDashboardDesc { margin-top: 4px; font-size: 12px; line-height: 18px; color: var(--dsw-alias-label-tertiary); }
.dshDashboardControls { display: flex; align-items: center; gap: 10px; flex: none; }
.dshDashboardSegmented { display: inline-flex; padding: 2px; gap: 2px; border-radius: 8px; background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.05)); }
.dshDashboardPill { appearance: none; border: none; padding: 4px 10px; font-size: 11.5px; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #666); cursor: pointer; font: inherit; white-space: nowrap; }
.dshDashboardPill[data-active] { background: var(--dsw-alias-bg-base, #fff); color: var(--dsw-alias-label-primary); box-shadow: 0 1px 3px rgba(0,0,0,.14); }
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
.dshDashboardBlockHead { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.dshDashboardBlockTitle { font-size: 13px; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dshDashboardChart { display: flex; align-items: stretch; gap: 3px; height: 150px; padding: 10px 8px 6px; border-radius: 10px; background: var(--dsw-alias-bg-module-platform, rgba(0,0,0,0.03)); overflow-x: auto; }
.dshDashboardBarWrap { flex: 1 1 0; min-width: 26px; display: flex; flex-direction: column; align-items: center; justify-content: flex-end; gap: 2px; }
.dshDashboardBarArea { width: 100%; display: flex; align-items: flex-end; justify-content: center; flex: 1 1 auto; min-height: 0; }
.dshDashboardBar { width: 60%; max-width: 22px; border-radius: 3px 3px 0 0; background: var(--dsw-alias-accent, #2563eb); min-height: 2px; }
.dshDashboardBarValue { font-size: 9px; line-height: 12px; color: var(--dsw-alias-label-secondary, #666); white-space: nowrap; font-variant-numeric: tabular-nums; }
.dshDashboardBarLabel { font-size: 9px; line-height: 12px; color: var(--dsw-alias-label-tertiary, #999); white-space: nowrap; }
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

/** Compact notation for bar captions ("24.8万" / "248K"). */
const compactFormatter = new Intl.NumberFormat(undefined, { notation: 'compact', maximumFractionDigits: 1 })

function formatDayLabel(day: string): string {
  const suffix = day.slice(5)
  return suffix.length === 5 ? suffix : day
}

export function UsageDashboardSection(_props: PropsRuntime<'settings.section'> & PropsLocale<'settings.dashboard'>) {
  const { t } = _props
  const [report, setReport] = useState<UsageReport | undefined>()
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [range, setRange] = useState<RangeKey>('last7')

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

  const windowDays = RANGE_WINDOWS[range]
  const rangeLabel = range === 'today' ? t('today') : range === 'last7' ? t('last7') : t('last30')
  // The host returns an ascending zero-filled window; slicing it yields every
  // downstream view for the active range without re-fetching.
  const rangeDaily = report?.daily.slice(-windowDays) ?? []
  const rangeInput = rangeDaily.reduce((sum, entry) => sum + entry.inputTokens, 0)
  const rangeOutput = rangeDaily.reduce((sum, entry) => sum + entry.outputTokens, 0)
  const peak = Math.max(1, ...rangeDaily.map(entry => entry.totalTokens))
  const modelsRange = (report?.byModelDaily ?? [])
    .map(row => {
      const slice = row.daily.slice(-windowDays)
      const inputTokens = slice.reduce((sum, entry) => sum + entry.inputTokens, 0)
      const outputTokens = slice.reduce((sum, entry) => sum + entry.outputTokens, 0)
      return {
        provider: row.provider,
        model: row.model,
        messages: slice.reduce((sum, entry) => sum + (entry.messages ?? 0), 0),
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      }
    })
    .filter(row => row.totalTokens > 0 || row.messages > 0)
    .sort((left, right) => right.totalTokens - left.totalTokens)

  const totals = report?.totals

  return (
    <div className="dshDashboardSection">
      <div className="dshDashboardHeader">
        <div>
          <div className="dshDashboardTitle">{t('title')}</div>
          <div className="dshDashboardDesc">{t('desc')}</div>
        </div>
        <div className="dshDashboardControls">
          <div className="dshDashboardSegmented" role="tablist" aria-label={rangeLabel}>
            {(Object.keys(RANGE_WINDOWS) as RangeKey[]).map(key => (
              <button
                key={key}
                type="button"
                role="tab"
                aria-selected={range === key}
                className="dshDashboardPill"
                data-active={range === key || undefined}
                onClick={() => { setRange(key) }}
              >
                {key === 'today' ? t('today') : key === 'last7' ? t('last7') : t('last30')}
              </button>
            ))}
          </div>
          <button type="button" className="dshDashboardRefresh" disabled={loading}
            onClick={() => { void load(false) }}>
            {t('refresh')}
          </button>
        </div>
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
            <StatCard label={`${t('inputTokens')} · ${rangeLabel}`} value={formatTokens(rangeInput)} />
            <StatCard label={`${t('outputTokens')} · ${rangeLabel}`} value={formatTokens(rangeOutput)} />
            <StatCard label={`${t('totalTokens')} · ${rangeLabel}`} value={formatTokens(rangeInput + rangeOutput)} />
          </div>

          <div className="dshDashboardBlock">
            <div className="dshDashboardBlockHead">
              <div className="dshDashboardBlockTitle">{`${t('dailyChart')} · ${rangeLabel}`}</div>
            </div>
            <div className="dshDashboardChart">
              {rangeDaily.map(entry => (
                <div key={entry.day} className="dshDashboardBarWrap"
                  title={`${entry.day}: ${formatTokens(entry.totalTokens)}`}>
                  <div className="dshDashboardBarArea">
                    <div
                      className="dshDashboardBar"
                      style={{ height: `${String(Math.max(2, Math.round((entry.totalTokens / peak) * 84)))}px` }}
                    />
                  </div>
                  <div className="dshDashboardBarValue">{compactFormatter.format(entry.totalTokens)}</div>
                  <div className="dshDashboardBarLabel">{formatDayLabel(entry.day)}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="dshDashboardBlock">
            <div className="dshDashboardBlockTitle">{`${t('byModel')} · ${rangeLabel}`}</div>
            {modelsRange.length > 0
              ? (
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
                    {modelsRange.slice(0, 12).map(row => (
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
              )
              : <div className="dshDashboardNotice">{t('empty')}</div>}
          </div>

          <div className="dshDashboardCards">
            <StatCard label={t('sessions')} value={String(report.sessions)} />
            <StatCard label={t('userMessages')} value={formatTokens(report.userMessages)} />
            <StatCard label={t('assistantMessages')} value={formatTokens(report.assistantMessages)} />
            <StatCard label={`${t('cacheRead')} · ${t('allTime')}`} value={formatTokens(totals?.cacheReadTokens ?? 0)} />
            <StatCard label={`${t('cacheWrite')} · ${t('allTime')}`} value={formatTokens(totals?.cacheWriteTokens ?? 0)} />
            <StatCard label={`${t('reasoning')} · ${t('allTime')}`} value={formatTokens(totals?.reasoningTokens ?? 0)} />
            <StatCard label={`${t('totalTokens')} · ${t('allTime')}`} value={formatTokens((totals?.inputTokens ?? 0) + (totals?.outputTokens ?? 0))} />
          </div>
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
