/** Browser-side plugin market overlay for HarnessX. */

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: pulls the settings.section slot declaration into this program.
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import { DesktopSectionHeader } from './desktop-section.tsx'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'settings.market': MarketKey
  }
}

export type MarketKey =
  | 'nav'
  | 'title'
  | 'discover'
  | 'sources'
  | 'installed'
  | 'jobs'
  | 'navAria'
  | 'searchPlaceholder'
  | 'search'
  | 'loading'
  | 'loadingMore'
  | 'loadFailed'
  | 'empty'
  | 'allSources'
  | 'sourceFilter'
  | 'install'
  | 'installing'
  | 'installedTag'
  | 'uninstall'
  | 'uninstalling'
  | 'version'
  | 'author'
  | 'stars'
  | 'official'
  | 'viewDocs'
  | 'viewRepo'
  | 'viewHomepage'
  | 'close'
  | 'cancel'
  | 'save'
  | 'edit'
  | 'delete'
  | 'addSource'
  | 'sourceName'
  | 'sourceUrl'
  | 'sourceKind'
  | 'sourceEnabled'
  | 'noInstalled'
  | 'noJobs'
  | 'jobLog'
  | 'queuedNotice'
  | 'processedSuccess'
  | 'processFailed'
  | 'cancelledNotice'
  | 'processingNotice'
  | 'enqueuedNotice'
  | 'pluginCount'
  | 'noPluginsFound'
  | 'backToPlugins'
  | 'description'
  | 'noDescription'
  | 'metadata'
  | 'installSource'
  | 'repository'
  | 'homepage'
  | 'license'
  | 'updatedAt'
  | 'tags'
  | 'sourceId'
  | 'sourceDisplayName'
  | 'sourceType'
  | 'sourceUrlOrPath'
  | 'sourceGithub'
  | 'sourceLocal'
  | 'enableThisSource'
  | 'saveSource'
  | 'installedNotice'
  | 'refresh'
  | 'declared'
  | 'jobAction'
  | 'jobStatus'
  | 'createdAt'
  | 'startedAt'
  | 'completedAt'
  | 'duration'
  | 'exitInfo'
  | 'target'
  | 'installPlugin'
  | 'uninstallPlugin'
  | 'cmdLog'
  | 'noLogs'

const zh: Record<MarketKey, string> = {
  nav: '插件市场',
  title: 'DeepSeek HarnessX 插件市场',
  discover: '发现',
  sources: '插件源',
  installed: '已安装',
  jobs: '任务',
  navAria: '插件市场导航',
  searchPlaceholder: '搜索插件名称、描述或作者…',
  search: '搜索',
  loading: '加载中…',
  loadingMore: '正在加载更多…',
  loadFailed: '加载失败',
  empty: '没有找到匹配的插件',
  allSources: '全部插件源',
  sourceFilter: '插件源',
  install: '安装',
  installing: '准备中…',
  installedTag: '已安装',
  uninstall: '卸载',
  uninstalling: '卸载中…',
  version: '版本',
  author: '作者',
  stars: '星标',
  official: '官方推荐',
  viewDocs: '文档',
  viewRepo: '源码仓库',
  viewHomepage: '项目主页',
  close: '关闭',
  cancel: '取消',
  save: '保存',
  edit: '编辑',
  delete: '删除',
  addSource: '添加插件源',
  sourceName: '源名称',
  sourceUrl: '源地址',
  sourceKind: '源类型',
  sourceEnabled: '已启用',
  noInstalled: '暂未安装第三方插件',
  noJobs: '暂无任务记录',
  jobLog: '查看完整输出日志',
  queuedNotice: '插件操作正在排队，可切换到“任务”查看状态。',
  processedSuccess: '{label} 已处理完成。',
  processFailed: '{label} 处理失败：{detail}',
  cancelledNotice: '{label} 已取消。',
  processingNotice: '{label} 正在处理，可切换到“任务”查看日志。',
  enqueuedNotice: '{label} 已加入任务。',
  pluginCount: '共 {total} 个插件；当前显示 {count} 个。',
  noPluginsFound: '没有找到插件。换一个关键词，或检查插件源。',
  backToPlugins: '← 返回插件列表',
  description: '简介',
  noDescription: '暂无简介。',
  metadata: '元数据',
  installSource: '安装源',
  repository: '仓库',
  homepage: '主页',
  license: '许可证',
  updatedAt: '更新时间',
  tags: '标签',
  sourceId: '源标识',
  sourceDisplayName: '显示名称',
  sourceType: '类型',
  sourceUrlOrPath: 'URL 或本地路径',
  sourceGithub: 'GitHub 仓库',
  sourceLocal: '本地目录',
  enableThisSource: '启用此源',
  saveSource: '保存源',
  installedNotice: '已安装的第三方插件。卸载后需要重启应用才会完全生效。',
  refresh: '刷新',
  declared: '声明',
  jobAction: '操作',
  jobStatus: '状态',
  createdAt: '创建时间',
  startedAt: '开始时间',
  completedAt: '完成时间',
  duration: '耗时',
  exitInfo: '退出信息',
  target: '目标',
  installPlugin: '安装插件',
  uninstallPlugin: '卸载插件',
  cmdLog: 'CMD / 执行日志',
  noLogs: '暂无日志。',
}

const en: Record<MarketKey, string> = {
  nav: 'Marketplace',
  title: 'DeepSeek HarnessX Marketplace',
  discover: 'Discover',
  sources: 'Sources',
  installed: 'Installed',
  jobs: 'Tasks',
  navAria: 'Marketplace navigation',
  searchPlaceholder: 'Search plugins by name, description, or author…',
  search: 'Search',
  loading: 'Loading…',
  loadingMore: 'Loading more…',
  loadFailed: 'Failed to load',
  empty: 'No matching plugins found',
  allSources: 'All Sources',
  sourceFilter: 'Sources',
  install: 'Install',
  installing: 'Preparing…',
  installedTag: 'Installed',
  uninstall: 'Uninstall',
  uninstalling: 'Uninstalling…',
  version: 'Version',
  author: 'Author',
  stars: 'Stars',
  official: 'Official',
  viewDocs: 'Docs',
  viewRepo: 'Repository',
  viewHomepage: 'Homepage',
  close: 'Close',
  cancel: 'Cancel',
  save: 'Save',
  edit: 'Edit',
  delete: 'Delete',
  addSource: 'Add Source',
  sourceName: 'Source Name',
  sourceUrl: 'Source URL',
  sourceKind: 'Source Type',
  sourceEnabled: 'Enabled',
  noInstalled: 'No third-party plugins installed',
  noJobs: 'No task history',
  jobLog: 'View full output log',
  queuedNotice: 'Plugin task is queued. Switch to "Tasks" to check status.',
  processedSuccess: '{label} completed successfully.',
  processFailed: '{label} failed: {detail}',
  cancelledNotice: '{label} was cancelled.',
  processingNotice: '{label} is processing. Switch to "Tasks" to view log.',
  enqueuedNotice: '{label} has been added to tasks.',
  pluginCount: 'Total {total} plugins; currently displaying {count}.',
  noPluginsFound: 'No plugins found. Try another keyword or check plugin sources.',
  backToPlugins: '← Back to plugin list',
  description: 'Description',
  noDescription: 'No description available.',
  metadata: 'Metadata',
  installSource: 'Install Source',
  repository: 'Repository',
  homepage: 'Homepage',
  license: 'License',
  updatedAt: 'Updated At',
  tags: 'Tags',
  sourceId: 'Source ID',
  sourceDisplayName: 'Display Name',
  sourceType: 'Type',
  sourceUrlOrPath: 'URL or Local Path',
  sourceGithub: 'GitHub Repository',
  sourceLocal: 'Local Directory',
  enableThisSource: 'Enable this source',
  saveSource: 'Save Source',
  installedNotice: 'Installed third-party plugins. Uninstalling requires application restart to take full effect.',
  refresh: 'Refresh',
  declared: 'Declared',
  jobAction: 'Action',
  jobStatus: 'Status',
  createdAt: 'Created At',
  startedAt: 'Started At',
  completedAt: 'Completed At',
  duration: 'Duration',
  exitInfo: 'Exit Info',
  target: 'Target',
  installPlugin: 'Install Plugin',
  uninstallPlugin: 'Uninstall Plugin',
  cmdLog: 'CMD / Execution Logs',
  noLogs: 'No logs available.',
}

const NS = 'settings.market'
import type {} from './contracts.ts'
import {
  createLatestRequestGate,
  findNewestPluginJob,
  marketJobDuration,
  marketJobHeadline,
  newestMarketJobs,
  pluginInstallAction,
  type ClientMarketJobAction,
  type ClientMarketJobStatus,
} from './market-state.ts'

/** Source kinds accepted by the market Host API. */
type PluginSourceKind = 'npm' | 'manifest' | 'github' | 'local'

/** One source as returned by the market Host API. */
interface PluginSource {
  /** Stable source identifier. */
  id: string
  /** Human-readable source label. */
  name: string
  /** Source adapter. */
  kind: PluginSourceKind
  /** Registry URL, manifest URL, GitHub repository URL, or local path. */
  url: string
  /** Whether catalog requests include this source. */
  enabled: boolean
}

/** One catalog entry returned by the market Host API. */
interface MarketPlugin {
  /** Plugin identifier reported by its source. */
  id: string
  /** Plugin display name. */
  name: string
  /** Short plugin description. */
  description: string | undefined
  /** Latest version reported by the source. */
  version: string | undefined
  /** Author or publisher label. */
  author: string | undefined
  /** Plugin homepage URL. */
  homepage: string | undefined
  /** Plugin repository URL. */
  repository: string | undefined
  /** Package specification passed to `dsh plugin add`. */
  install: string
  /** Search and display tags. */
  tags: string[] | undefined
  /** Popularity signal reported by the source. */
  stars: number | undefined
  /** Source-specific category or marketplace section. */
  category: string | undefined
  /** License identifier reported by the source. */
  license: string | undefined
  /** Last update timestamp reported by the source. */
  updatedAt: string | undefined
  /** Owning source identifier. */
  sourceId: string
  /** Owning source display name. */
  sourceName: string
  /** Owning source kind. */
  sourceKind: PluginSourceKind
}

/** One source resolution error returned by the catalog endpoint. */
interface MarketSourceError {
  /** Failed source identifier. */
  sourceId: string
  /** Failed source display name. */
  sourceName: string
  /** Human-readable error message. */
  message: string
}

/** Catalog response shape. */
interface CatalogResponse {
  /** Successfully resolved and paged plugins. */
  plugins: MarketPlugin[]
  /** Per-source failures. */
  errors: MarketSourceError[]
  /** Total matching plugins before this page slice. */
  total: number
  /** Page offset echoed from the request. */
  offset: number
  /** Page size echoed from the request. */
  limit: number
}

/** One plugin installed in the active desktop profile. */
interface InstalledPlugin {
  /** Package or bundle name stored by the profile. */
  name: string
  /** Resolved installed version when available. */
  version: string | undefined
  /** Declared dependency range when available. */
  requested: string | undefined
}

/** Install job status returned by the market Host API. */
type JobStatus = ClientMarketJobStatus

/** One install job snapshot. */
interface MarketJob {
  /** Opaque job identifier. */
  id: string
  /** Package operation performed by the task. */
  action: ClientMarketJobAction
  /** Current lifecycle state. */
  status: JobStatus
  /** User-facing operation title, normally the plugin display name. */
  label: string
  /** Package specification or installed package name targeted by the job. */
  target: string
  /** Process exit code, or `null` while running or after signal termination. */
  exitCode: number | null
  /** Terminating signal, or `null` after a normal exit. */
  signal: NodeJS.Signals | null
  /** ISO timestamp when the task entered the queue. */
  createdAt: string
  /** ISO timestamp when execution began, or `undefined` while queued. */
  startedAt: string | undefined
  /** ISO timestamp when execution ended, or `undefined` while active. */
  completedAt: string | undefined
  /** Combined stdout/stderr tail. */
  output: string[]
}

/** Form state for adding or updating one plugin source. */
interface SourceFormState {
  /** Source identifier. */
  id: string
  /** Source display name. */
  name: string
  /** Source adapter. */
  kind: PluginSourceKind
  /** Source URL or local path. */
  url: string
  /** Whether the new source starts enabled. */
  enabled: boolean
}

/** Active tree node discriminator. */
type ActiveNode =
  | 'discover'
  | 'sources'
  | 'installed'
  | 'jobs'

const EMPTY_SOURCE_FORM: SourceFormState = {
  id: '',
  name: '',
  kind: 'manifest',
  url: '',
  enabled: true,
}

const MARKET_STYLES = `
.dshMarketSection { height: 100%; min-height: 0; display: flex; flex-direction: column; overflow: hidden; font-family: var(--ds-font-family, system-ui, sans-serif); color: var(--dsw-alias-text, #17171c); background: var(--dsw-alias-bg-base, #ffffff); }
.dshMarketHeader { display: flex; align-items: center; gap: 16px; padding: 16px 20px; border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); background: var(--dsw-alias-bg-base, #ffffff); }
.dshMarketTitle { margin: 0; flex: 1; font-size: 18px; font-weight: 700; letter-spacing: -0.01em; }

.dshMarketTabs { flex: none; display: flex; gap: 6px; padding: 10px 20px 0; border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); background: var(--dsw-alias-bg-base, #ffffff); }
.dshMarketTab { display: inline-flex; align-items: center; gap: 7px; padding: 9px 12px; border: 1px solid transparent; border-bottom: none; border-radius: 10px 10px 0 0; background: transparent; color: var(--dsw-alias-text-secondary, #6e6e7a); cursor: pointer; font-size: 13px; }
.dshMarketTab:hover { background: var(--dsw-alias-bg-subtle, #fafafb); color: var(--dsw-alias-text, #17171c); }
.dshMarketTab[aria-current="true"] { border-color: var(--dsw-alias-border-l1, #ececf1); background: var(--dsw-alias-bg-subtle, #fafafb); color: var(--dsw-alias-text, #17171c); font-weight: 650; }
.dshMarketTabCount { min-width: 18px; padding: 1px 6px; border-radius: 999px; background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-text-secondary, #6e6e7a); font-size: 11px; text-align: center; }
.dshMarketBody { min-height: 0; flex: 1; display: grid; grid-template-columns: auto minmax(0, 1fr); overflow: hidden; }
.dshMarketTree { width: 176px; box-sizing: border-box; overflow-x: hidden; overflow-y: auto; padding: 12px 8px 20px; border-right: 1px solid var(--dsw-alias-border-l1, #ececf1); background: var(--dsw-alias-bg-subtle, #fafafb); }
.dshMarketTreeCollapsed { width: 48px; padding: 12px 6px 20px; }
.dshMarketTreeToggle { display: grid; place-items: center; width: 32px; height: 32px; margin: 0 0 8px; padding: 0; border: 1px solid transparent; border-radius: 9px; background: transparent; color: var(--dsw-alias-text-secondary, #6e6e7a); cursor: pointer; font-size: 16px; }
.dshMarketTreeToggle:hover { border-color: var(--dsw-alias-border-l2, #d9d9e3); background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-text, #17171c); }
.dshMarketTreeIconButton { display: grid; place-items: center; width: 34px; height: 34px; margin: 0 0 6px; padding: 0; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--dsw-alias-text-secondary, #6e6e7a); cursor: pointer; font-size: 16px; }
.dshMarketTreeIconButton:hover, .dshMarketTreeIconButton[aria-current="true"] { border-color: var(--dsw-alias-border-l2, #d9d9e3); background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-text, #17171c); }
.dshMarketTreeGroup { margin: 0 0 6px; }
.dshMarketTreeButton { display: flex; align-items: center; gap: 8px; width: 100%; box-sizing: border-box; padding: 9px 10px; border: 1px solid transparent; border-radius: 10px; background: transparent; color: var(--dsw-alias-text-secondary, #6e6e7a); text-align: left; cursor: pointer; font-size: 13px; }
.dshMarketTreeButton:hover { background: var(--dsw-alias-bg-base, #ffffff); }
.dshMarketTreeButton[aria-current="true"] { border-color: var(--dsw-alias-border-l2, #d9d9e3); background: var(--dsw-alias-bg-base, #ffffff); color: var(--dsw-alias-text, #17171c); box-shadow: 0 6px 18px rgb(0 0 0 / 6%); }
.dshMarketTreeLabel { min-width: 0; flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 13px; }
.dshMarketTreeMeta { margin-left: auto; font-size: 11px; color: var(--dsw-alias-text-secondary, #6e6e7a); white-space: nowrap; }
.dshMarketTreeChevron { width: 12px; text-align: center; color: var(--dsw-alias-text-secondary, #6e6e7a); }
.dshMarketTreeChildren { margin: 3px 0 10px 14px; padding-left: 9px; border-left: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.dshMarketContent { min-width: 0; min-height: 0; flex: 1; overflow: auto; padding: 12px 16px 20px; background: var(--dsw-alias-bg-base, #ffffff); }
.dshMarketRow { display: flex; gap: 12px; align-items: center; }
.dshMarketStack { display: grid; gap: 20px; width: 100%; }
.dshMarketCatalog { display: grid; gap: 10px; width: 100%; }
.dshMarketToolbar { display: flex; flex-wrap: wrap; gap: 10px; align-items: end; }
.dshMarketToolbar .dshMarketSourceFilter { flex: 0 0 220px; max-width: 220px; }
.dshMarketToolbar .dshMarketRow { flex: 1; min-width: 260px; }
.dshMarketList { display: grid; gap: 6px; width: 100%; }
.dshMarketSourceFilter { display: grid; gap: 7px; max-width: 320px; }
.dshMarketInput { min-width: 0; flex: 1; box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2, #d9d9e3); border-radius: 11px; background: var(--dsw-alias-bg-base, #ffffff); color: inherit; font-size: 14px; }
.dshMarketSelect { box-sizing: border-box; padding: 10px 12px; border: 1px solid var(--dsw-alias-border-l2, #d9d9e3); border-radius: 11px; background: var(--dsw-alias-bg-base, #ffffff); color: inherit; font-size: 14px; }
.dshMarketButtonPrimary { padding: 10px 16px; border: 1px solid transparent; border-radius: 10px; background: var(--dsw-alias-accent, #2563eb); color: #ffffff; cursor: pointer; font-size: 13px; font-weight: 600; }
.dshMarketButtonPrimary:disabled { opacity: 0.55; cursor: not-allowed; }
.dshMarketButtonGhost { padding: 9px 12px; border: 1px solid var(--dsw-alias-border-l2, #d9d9e3); border-radius: 10px; background: transparent; color: inherit; cursor: pointer; font-size: 13px; }
.dshMarketButtonGhost:hover { border-color: var(--dsw-alias-accent, #2563eb); color: var(--dsw-alias-accent, #2563eb); }
.dshMarketError { margin: 0; padding: 12px 14px; border: 1px solid rgb(220 38 38 / 28%); border-radius: 12px; background: rgb(254 226 226 / 65%); color: #b42318; font-size: 13px; line-height: 1.6; }
.dshMarketNotice { margin: 0 0 8px; padding: 10px 12px; border-radius: 10px; background: var(--dsw-alias-bg-subtle, #f4f4f5); color: var(--dsw-alias-text-secondary, #6e6e7a); font-size: 13px; line-height: 1.5; }
.dshMarketSourceStatusRow { display: flex; flex-wrap: wrap; gap: 6px; margin: 0 0 10px; }
.dshMarketSourceChip { display: inline-flex; align-items: center; gap: 6px; padding: 3px 10px; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 999px; background: var(--dsw-alias-bg-subtle, #f4f4f5); color: var(--dsw-alias-text-secondary, #6e6e7a); font-size: 12px; }
.dshMarketSourceChipError { border-color: rgb(220 38 38 / 30%); background: rgb(254 242 242 / 75%); color: #b42318; }
.dshMarketSourceDot { width: 6px; height: 6px; border-radius: 50%; background: #9ca3af; flex-shrink: 0; }
.dshMarketSourceDotLoading { background: var(--dsw-alias-accent, #2563eb); animation: dshMarketPulse 1s ease-in-out infinite; }
.dshMarketSourceDotDone { background: #16a34a; }
.dshMarketSourceDotError { background: #dc2626; }
@keyframes dshMarketPulse { 0%, 100% { opacity: 1; } 50% { opacity: .3; } }
.dshMarketNoticeInfo { border: 1px solid var(--dsw-alias-border-l1, #ececf1); background: var(--dsw-alias-bg-subtle, #f4f4f5); color: var(--dsw-alias-text, #17171c); }
.dshMarketNoticeSuccess { border: 1px solid rgb(22 163 74 / 24%); background: rgb(240 253 244 / 70%); color: #15803d; }
.dshMarketNoticeError { border: 1px solid rgb(220 38 38 / 22%); background: rgb(254 242 242 / 75%); color: #b42318; }
.dshMarketCard { display: flex; flex-direction: row; align-items: center; gap: 12px; padding: 8px 10px; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 10px; background: var(--dsw-alias-bg-base, #ffffff); }
.dshMarketCardClickable { cursor: pointer; transition: border-color 120ms ease, box-shadow 120ms ease; }
.dshMarketCardClickable:hover { border-color: var(--dsw-alias-accent, #2563eb); box-shadow: 0 6px 20px rgb(37 99 235 / 10%); }
.dshMarketDetail { display: flex; flex-direction: column; gap: 14px; }
.dshMarketBack { align-self: flex-start; padding: 7px 10px; border: 1px solid var(--dsw-alias-border-l2, #d9d9e3); border-radius: 10px; background: transparent; color: inherit; cursor: pointer; font-size: 13px; }
.dshMarketDetailHeader { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 4px 0 12px; border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.dshMarketDetailTitle { margin: 0 0 6px; font-size: 22px; font-weight: 750; line-height: 1.3; overflow-wrap: anywhere; }
.dshMarketDetailSection { display: grid; gap: 8px; }
.dshMarketDetailLabel { margin: 0; font-size: 13px; font-weight: 650; color: var(--dsw-alias-text-secondary, #6e6e7a); }
.dshMarketDetailText { margin: 0; font-size: 14px; line-height: 1.7; white-space: pre-wrap; overflow-wrap: anywhere; }
.dshMarketDetailMeta { display: grid; gap: 8px; margin: 0; }
.dshMarketDetailMeta div { display: grid; grid-template-columns: 88px minmax(0, 1fr); gap: 10px; }
.dshMarketDetailMeta dt { color: var(--dsw-alias-text-secondary, #6e6e7a); }
.dshMarketDetailMeta dd { margin: 0; min-width: 0; overflow-wrap: anywhere; }
.dshMarketDetailMeta a { color: var(--dsw-alias-accent, #2563eb); text-decoration: none; }
.dshMarketDetailMeta a:hover { text-decoration: underline; }
.dshMarketCardBody { min-width: 0; flex: 1; display: flex; flex-direction: column; gap: 2px; }
.dshMarketCardTitleRow { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; }
.dshMarketCardTitle { margin: 0; font-size: 14px; font-weight: 700; line-height: 1.35; overflow-wrap: anywhere; }
.dshMarketSourceBadge { padding: 2px 7px; border-radius: 999px; background: var(--dsw-alias-bg-subtle, #f4f4f5); color: var(--dsw-alias-text-secondary, #6e6e7a); font-size: 11px; white-space: nowrap; }
.dshMarketCardMeta { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin: 0; color: var(--dsw-alias-text-secondary, #6e6e7a); font-size: 12px; line-height: 1.4; }
.dshMarketCardDesc { display: -webkit-box; -webkit-line-clamp: 1; -webkit-box-orient: vertical; overflow: hidden; margin: 2px 0 0; color: var(--dsw-alias-text, #17171c); font-size: 12.5px; line-height: 1.4; overflow-wrap: anywhere; }
.dshMarketTagRow { display: flex; flex-wrap: wrap; gap: 6px; margin: 6px 0 0; }
.dshMarketTag { padding: 2px 8px; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 999px; background: var(--dsw-alias-bg-subtle, #f4f4f5); color: var(--dsw-alias-text-secondary, #6e6e7a); font-size: 11px; line-height: 1.4; }
.dshMarketLinkRow { display: flex; flex-wrap: wrap; gap: 10px; margin: 6px 0 0; font-size: 12px; }
.dshMarketCardFooter { flex: none; display: flex; justify-content: flex-end; margin: 0; padding: 0; border: none; }
.dshMarketCardFooter .dshMarketButtonPrimary { padding: 7px 12px; border-radius: 9px; font-size: 12px; }
.dshMarketCardFooter .dshMarketButtonGhost { padding: 7px 12px; border-radius: 9px; font-size: 12px; }
.dshMarketEmpty { margin: 12px 0; padding: 18px; border: 1px dashed var(--dsw-alias-border-l2, #d9d9e3); border-radius: 12px; color: var(--dsw-alias-text-secondary, #6e6e7a); text-align: center; font-size: 13px; line-height: 1.5; }
.dshMarketJobs { display: grid; gap: 14px; }
.dshMarketJob { overflow: hidden; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 8px; background: var(--dsw-alias-bg-base, #ffffff); }
.dshMarketJobHead { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; padding: 16px; border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.dshMarketJobTitle { min-width: 0; display: grid; gap: 5px; }
.dshMarketJobHeadline { margin: 0; font-size: 17px; line-height: 1.35; }
.dshMarketJobPlugin { margin: 0; color: var(--dsw-alias-text-secondary, #6e6e7a); font-size: 13px; overflow-wrap: anywhere; }
.dshMarketJobStatus { align-self: start; padding: 3px 9px; border-radius: 999px; background: var(--dsw-alias-bg-subtle, #f4f4f5); color: var(--dsw-alias-text-secondary, #6e6e7a); font-size: 12px; white-space: nowrap; }
.dshMarketJob[data-status="success"] .dshMarketJobStatus { background: rgb(240 253 244); color: #15803d; }
.dshMarketJob[data-status="failed"] .dshMarketJobStatus { background: rgb(254 242 242); color: #b42318; }
.dshMarketJob[data-status="running"] .dshMarketJobStatus, .dshMarketJob[data-status="queued"] .dshMarketJobStatus { background: rgb(239 246 255); color: #1d4ed8; }
.dshMarketJobFacts { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); margin: 0; }
.dshMarketJobFact { min-width: 0; padding: 13px 16px; border-right: 1px solid var(--dsw-alias-border-l1, #ececf1); border-bottom: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.dshMarketJobFact:nth-child(even) { border-right: none; }
.dshMarketJobFact dt { margin: 0 0 5px; color: var(--dsw-alias-text-secondary, #6e6e7a); font-size: 12px; }
.dshMarketJobFact dd { margin: 0; font-size: 13px; line-height: 1.45; overflow-wrap: anywhere; }
.dshMarketJobError { margin: 14px 16px 0; padding: 10px 12px; border: 1px solid rgb(220 38 38 / 22%); border-radius: 6px; background: rgb(254 242 242); color: #b42318; font-size: 13px; line-height: 1.5; overflow-wrap: anywhere; }
.dshMarketJobLog { padding: 12px 16px 16px; }
.dshMarketJobLog summary { width: fit-content; color: var(--dsw-alias-accent, #2563eb); cursor: pointer; font-size: 13px; }
.dshMarketJobOutput { max-height: 260px; overflow: auto; margin: 12px 0 0; padding: 12px; border-radius: 6px; background: #0d1117; color: #c9d1d9; font: 12px/1.6 ui-monospace, SFMono-Regular, Consolas, monospace; white-space: pre-wrap; overflow-wrap: anywhere; }
@media (max-width: 700px) {
  .dshMarketJobFacts { grid-template-columns: minmax(0, 1fr); }
  .dshMarketJobFact, .dshMarketJobFact:nth-child(even) { border-right: none; }
  .dshMarketJobHead { align-items: stretch; flex-direction: column; }
}
.dshMarketSourceEditor { display: grid; gap: 14px; padding: 18px 20px; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 16px; background: var(--dsw-alias-bg-subtle, #fafafb); }
.dshMarketSource { display: flex; flex-direction: column; gap: 12px; padding: 16px 18px; border: 1px solid var(--dsw-alias-border-l1, #ececf1); border-radius: 14px; background: var(--dsw-alias-bg-base, #ffffff); }
.dshMarketSourceBody { min-width: 0; }
.dshMarketSourceName { display: block; margin-bottom: 8px; font-size: 15px; font-weight: 650; overflow-wrap: anywhere; }
.dshMarketSourceFooter { display: flex; flex-wrap: wrap; gap: 10px; padding-top: 12px; border-top: 1px solid var(--dsw-alias-border-l1, #ececf1); }
.dshMarketField { display: grid; gap: 7px; margin-bottom: 0; }
.dshMarketFieldLabel { color: var(--dsw-alias-text-secondary, #6e6e7a); font-size: 13px; font-weight: 600; }
`

/** Register the market page in the upstream settings panel. */
export function applyMarket(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'market: dictionaries')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'plugin-market',
    order: 90,
    label: () => ctx.locale.bind(NS)('nav'),
    locale: NS,
  }, MarketSettingsSection))
}

/** Settings-panel page with a tree on the left and market content on the right. */
function MarketSettingsSection(props: PropsRuntime<'settings.section'> & PropsLocale<'settings.market'>): ReactNode {
  const { t } = props
  const [active, setActive] = useState<ActiveNode>('discover')
  const [sources, setSources] = useState<PluginSource[]>([])
  const [installed, setInstalled] = useState<InstalledPlugin[]>([])
  const [jobs, setJobs] = useState<MarketJob[]>([])
  const [discoverSourceId, setDiscoverSourceId] = useState<string | undefined>()
  const [notice, setNotice] = useState<{ tone: 'info' | 'success' | 'error'; text: string } | undefined>()
  const [refresh, setRefresh] = useState(0)
  const installedRequestGateRef = useRef(createLatestRequestGate())

  useEffect(() => {
    const style = document.createElement('style')
    style.dataset.plugin = 'harnessx-desktop'
    style.dataset.pluginCss = 'harnessx-desktop/market'
    style.textContent = MARKET_STYLES
    document.head.appendChild(style)
    return () => { style.remove() }
  }, [])

  const reloadSources = async (): Promise<void> => {
    const value = await requestJson<{ sources?: unknown }>('/api/desktop/market/sources')
    if (Array.isArray(value.sources)) setSources(value.sources as PluginSource[])
  }

  const reloadInstalled = async (): Promise<void> => {
    const requestId = installedRequestGateRef.current.begin()
    const value = await requestJson<{ plugins?: unknown }>('/api/desktop/market/installed')
    if (installedRequestGateRef.current.isLatest(requestId) && Array.isArray(value.plugins)) {
      setInstalled(value.plugins as InstalledPlugin[])
    }
  }

  const reloadJobs = async (): Promise<void> => {
    const value = await requestJson<{ jobs?: unknown }>('/api/desktop/market/jobs')
    if (Array.isArray(value.jobs)) setJobs(value.jobs as MarketJob[])
  }

  const watchJob = async (jobId: string): Promise<void> => {
    while (true) {
      const job = await requestJson<MarketJob>(`/api/desktop/market/jobs/${jobId}`)
      setJobs(current => [...current.filter(item => item.id !== job.id), job])
      if (job.status === 'queued') {
        setNotice({ tone: 'info', text: t('queuedNotice') })
        await wait(800)
        continue
      }
      if (job.status !== 'running') {
        await reloadInstalled().catch(() => undefined)
        if (job.status === 'success') {
          setNotice({ tone: 'success', text: t('processedSuccess', { label: job.label }) })
        } else if (job.status === 'failed') {
          const detail = job.output.at(-1)
          setNotice({ tone: 'error', text: t('processFailed', { label: job.label, detail: detail ?? 'failed' }) })
        } else {
          setNotice({ tone: 'info', text: t('cancelledNotice', { label: job.label }) })
        }
        return
      }
      setNotice({ tone: 'info', text: t('processingNotice', { label: job.label }) })
      await wait(800)
    }
  }

  const startJob = (job: MarketJob): void => {
    setJobs(current => [...current.filter(item => item.id !== job.id), job])
    setNotice({ tone: 'info', text: t('enqueuedNotice', { label: job.label }) })
    void watchJob(job.id)
  }

  const cancelJob = async (jobId: string): Promise<void> => {
    const job = await requestJson<MarketJob>(`/api/desktop/market/jobs/${jobId}/cancel`, { method: 'POST' })
    setJobs(current => [...current.filter(item => item.id !== job.id), job])
  }

  useEffect(() => {
    void reloadSources().catch(() => undefined)
    void reloadInstalled().catch(() => undefined)
    void reloadJobs().catch(() => undefined)
    const timer = setInterval(() => {
      void reloadJobs().catch(() => undefined)
      void reloadInstalled().catch(() => undefined)
    }, 3000)
    return () => { clearInterval(timer) }
  }, [refresh])

  const installedNames = useMemo(() => new Set(installed.map(plugin => plugin.name)), [installed])

  const selectNode = (node: ActiveNode): void => {
    setActive(node)
  }

  const renderContent = (): ReactNode => {
    if (active === 'discover') {
      return (
        <CatalogPanel
          key="discover"
          t={t}
          sourceId={discoverSourceId}
          sources={sources}
          onSourceChange={setDiscoverSourceId}
          installedNames={installedNames}
          jobs={jobs}
          onJobStarted={startJob}
        />
      )
    }
    if (active === 'sources') {
      return <SourcesPanel key="sources" t={t} sources={sources} onChanged={() => { setRefresh(value => value + 1) }} />
    }
    if (active === 'installed') {
      return (
        <InstalledPanel
          key="installed"
          t={t}
          installed={installed}
          onJobStarted={startJob}
          onChanged={() => { setRefresh(value => value + 1) }}
        />
      )
    }
    if (active === 'jobs') {
      return <JobsPanel key="jobs" t={t} jobs={jobs} onCancel={cancelJob} />
    }
    return null
  }

  return (
    <div className="dshMarketSection">
      <DesktopSectionHeader />
      <header className="dshMarketHeader">
        <h2 className="dshMarketTitle">{t('title')}</h2>
      </header>
      <nav className="dshMarketTabs" aria-label={t('navAria')}>
        <TabButton label={t('discover')} count={undefined} current={active === 'discover'} onClick={() => { selectNode('discover') }} />
        <TabButton label={t('sources')} count={sources.length} current={active === 'sources'} onClick={() => { selectNode('sources') }} />
        <TabButton label={t('installed')} count={installed.length} current={active === 'installed'} onClick={() => { selectNode('installed') }} />
        <TabButton label={t('jobs')} count={jobs.length} current={active === 'jobs'} onClick={() => { selectNode('jobs') }} />
      </nav>
      <main className="dshMarketContent">
        {notice !== undefined && (
          <div className={`dshMarketNotice dshMarketNotice${notice.tone === 'info' ? 'Info' : notice.tone === 'success' ? 'Success' : 'Error'}`} role="status">
            {notice.text}
          </div>
        )}
        {renderContent()}
      </main>
    </div>
  )
}

/** Catalog search and installation panel. */
function CatalogPanel(props: {
  t: (key: MarketKey, params?: Record<string, string | number>) => string
  sourceId: string | undefined
  sources: PluginSource[]
  onSourceChange: (sourceId: string | undefined) => void
  installedNames: Set<string>
  jobs: MarketJob[]
  onJobStarted: (job: MarketJob) => void
}): ReactNode {
  const { t } = props
  const [query, setQuery] = useState('')
  const [items, setItems] = useState<MarketPlugin[]>([])
  const [sourceProgress, setSourceProgress] = useState<Record<string, 'loading' | 'done' | 'error'>>({})
  const [loadedBySource, setLoadedBySource] = useState<Record<string, number>>({})
  const [totalBySource, setTotalBySource] = useState<Record<string, number>>({})
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [sourceErrors, setSourceErrors] = useState<MarketSourceError[]>([])
  const [selectedPlugin, setSelectedPlugin] = useState<MarketPlugin | undefined>()
  const [preparingInstalls, setPreparingInstalls] = useState<Set<string>>(() => new Set())
  const preparingInstallsRef = useRef(new Set<string>())
  const requestGeneration = useRef(0)

  const targetSources = useMemo(() => (
    props.sourceId !== undefined
      ? props.sources.filter(source => source.id === props.sourceId)
      : props.sources.filter(source => source.enabled)
  ), [props.sourceId, props.sources])

  /** Fetch one page of one source and merge it into the list as soon as it lands. */
  const fetchSourcePage = async (sourceId: string, search: string, offset: number, generation: number, append: boolean): Promise<void> => {
    try {
      const params = new URLSearchParams({
        query: search,
        limit: '120',
        offset: String(offset),
        sourceId,
      })
      const result = await requestJson<CatalogResponse>(`/api/desktop/market/catalog?${params}`)
      if (generation !== requestGeneration.current) return
      setSourceProgress(current => ({ ...current, [sourceId]: 'done' }))
      setLoadedBySource(current => ({ ...current, [sourceId]: (current[sourceId] ?? 0) + result.plugins.length }))
      setTotalBySource(current => ({ ...current, [sourceId]: result.total }))
      setItems(current => {
        if (!append) return result.plugins
        const seen = new Set(current.map(plugin => plugin.install))
        return [...current, ...result.plugins.filter(plugin => !seen.has(plugin.install))]
      })
    } catch (cause) {
      if (generation !== requestGeneration.current) return
      const message = cause instanceof Error ? cause.message : String(cause)
      setSourceProgress(current => ({ ...current, [sourceId]: 'error' }))
      setSourceErrors(current => [...current, { sourceId, sourceName: sourceId, message }])
    }
  }

  /** Load every target source in parallel; each renders independently as it arrives. */
  const loadAll = async (search: string): Promise<void> => {
    requestGeneration.current += 1
    const generation = requestGeneration.current
    setItems([])
    setSourceErrors([])
    setError(undefined)
    setLoadedBySource({})
    setTotalBySource({})
    setSourceProgress(Object.fromEntries(targetSources.map(source => [source.id, 'loading' as const])))
    await Promise.all(targetSources.map(source => fetchSourcePage(source.id, search, 0, generation, false)))
  }

  /** Pull the next page from every source that still has more results. */
  const loadMore = async (): Promise<void> => {
    const search = query
    requestGeneration.current += 1
    const generation = requestGeneration.current
    setLoadingMore(true)
    setError(undefined)
    const pending = targetSources.filter(source =>
      sourceProgress[source.id] === 'done' && (loadedBySource[source.id] ?? 0) < (totalBySource[source.id] ?? 0))
    await Promise.all(pending.map(source =>
      fetchSourcePage(source.id, search, loadedBySource[source.id] ?? 0, generation, true)))
    setLoadingMore(false)
  }

  useEffect(() => {
    void loadAll('')
  }, [props.sourceId])

  const runInstall = async (plugin: MarketPlugin): Promise<void> => {
    if (preparingInstallsRef.current.has(plugin.install)) return
    preparingInstallsRef.current.add(plugin.install)
    setPreparingInstalls(new Set(preparingInstallsRef.current))
    setError(undefined)
    try {
      const value = await requestJson<{ jobId?: unknown; job?: unknown }>('/api/desktop/market/install', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ install: plugin.install, label: plugin.name }),
      })
      const job = value.job as MarketJob | undefined
      if (job === undefined || typeof job.id !== 'string') throw new Error('install response has no job')
      props.onJobStarted(job)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      preparingInstallsRef.current.delete(plugin.install)
      setPreparingInstalls(new Set(preparingInstallsRef.current))
    }
  }

  const sortedItems = useMemo(() => (
    [...items].sort((left, right) => {
      const leftInstalled = isPluginInstalled(left, props.installedNames)
      const rightInstalled = isPluginInstalled(right, props.installedNames)
      if (leftInstalled !== rightInstalled) return leftInstalled ? -1 : 1
      const stars = (right.stars ?? 0) - (left.stars ?? 0)
      if (stars !== 0) return stars
      return left.name.localeCompare(right.name)
    })
  ), [items, props.installedNames])

  const anyLoading = targetSources.some(source => sourceProgress[source.id] === 'loading')
  const totalKnown = Object.values(totalBySource).reduce((sum, value) => sum + value, 0)
  const hasMore = targetSources.some(source =>
    sourceProgress[source.id] === 'done' && (loadedBySource[source.id] ?? 0) < (totalBySource[source.id] ?? 0))
  const sourceNameById = new Map(props.sources.map(source => [source.id, source.name]))

  const listRef = useRef<HTMLDivElement | null>(null)
  const savedScrollTop = useRef(0)

  /** Scrollable content pane hosting the catalog (kept stable across detail views). */
  const scrollContainer = (): HTMLElement | null => {
    const node = listRef.current
    if (node === null) return null
    return node.closest('.dshMarketContent') as HTMLElement | null
  }

  const openDetail = (plugin: MarketPlugin): void => {
    const container = scrollContainer()
    if (container !== null) savedScrollTop.current = container.scrollTop
    setSelectedPlugin(plugin)
  }

  const closeDetail = (): void => {
    setSelectedPlugin(undefined)
    // Restore the browsing position once the list has remounted.
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const container = scrollContainer()
        if (container !== null) container.scrollTop = savedScrollTop.current
      })
    })
  }

  if (selectedPlugin !== undefined) {
    const job = pluginJob(selectedPlugin, props.jobs)
    return (
      <PluginDetail
        t={t}
        plugin={selectedPlugin}
        installed={isPluginInstalled(selectedPlugin, props.installedNames)}
        status={job?.status}
        preparing={preparingInstalls.has(selectedPlugin.install)}
        onBack={closeDetail}
        onInstall={() => { void runInstall(selectedPlugin) }}
      />
    )
  }

  return (
    <div className="dshMarketCatalog" ref={listRef}>
      <div className="dshMarketToolbar">
        <label className="dshMarketSourceFilter">
          <span className="dshMarketFieldLabel">{t('sourceFilter')}</span>
          <select
            className="dshMarketSelect"
            value={props.sourceId ?? ''}
            onChange={(event) => { props.onSourceChange(event.target.value === '' ? undefined : event.target.value) }}
          >
            <option value="">{t('allSources')}</option>
            {props.sources.map(source => (
              <option key={source.id} value={source.id}>{source.name}</option>
            ))}
          </select>
        </label>
        <form className="dshMarketRow" onSubmit={(event) => {
          event.preventDefault()
          void loadAll(query)
        }}>
          <input
            className="dshMarketInput"
            value={query}
            onChange={(event) => { setQuery(event.target.value) }}
            placeholder={t('searchPlaceholder')}
          />
          <button className="dshMarketButtonPrimary" type="submit" disabled={anyLoading}>
            {anyLoading ? t('loading') : t('search')}
          </button>
        </form>
      </div>
      {error && <p className="dshMarketError">{error}</p>}
      {sourceErrors.length > 0 && (
        <div className="dshMarketError">
          {sourceErrors.map(sourceError => (
            <div key={sourceError.sourceId}>{sourceNameById.get(sourceError.sourceId) ?? sourceError.sourceName}: {sourceError.message}</div>
          ))}
        </div>
      )}
      {targetSources.length > 0 && (
        <div className="dshMarketSourceStatusRow">
          {targetSources.map(source => {
            const state = sourceProgress[source.id]
            return (
              <span
                key={source.id}
                className={`dshMarketSourceChip ${state === 'error' ? 'dshMarketSourceChipError' : ''}`}
                title={state === 'error' ? sourceErrors.find(item => item.sourceId === source.id)?.message : undefined}
              >
                <span className={`dshMarketSourceDot ${state === 'loading' ? 'dshMarketSourceDotLoading' : state === 'error' ? 'dshMarketSourceDotError' : 'dshMarketSourceDotDone'}`} />
                {source.name}
              </span>
            )
          })}
        </div>
      )}
      <p className="dshMarketNotice">{t('pluginCount', { total: totalKnown, count: items.length })}</p>
      {items.length === 0 && !anyLoading && <p className="dshMarketEmpty">{t('noPluginsFound')}</p>}
      <div className="dshMarketList">
        {sortedItems.map(plugin => {
          const job = pluginJob(plugin, props.jobs)
          return (
            <PluginCard
              key={`${plugin.sourceId}:${plugin.id}`}
              t={t}
              plugin={plugin}
              installed={isPluginInstalled(plugin, props.installedNames)}
              status={job?.status}
              preparing={preparingInstalls.has(plugin.install)}
              onOpen={() => { openDetail(plugin) }}
              onInstall={() => { void runInstall(plugin) }}
            />
          )
        })}
      </div>
      {hasMore && (
        <button
          className="dshMarketButtonGhost"
          type="button"
          disabled={loadingMore}
          onClick={() => { void loadMore() }}
        >
          {t('loadingMore')}
        </button>
      )}
    </div>
  )
}

/** One catalog card with install action. */
function PluginCard(props: {
  t: (key: MarketKey, params?: Record<string, string | number>) => string
  plugin: MarketPlugin
  installed: boolean
  status: JobStatus | undefined
  preparing: boolean
  onOpen: () => void
  onInstall: () => void
}): ReactNode {
  const { plugin, t } = props
  const isZh = t('install') === '安装'
  const action = pluginInstallAction(props.installed, props.status, props.preparing, isZh)
  return (
    <article
      className="dshMarketCard dshMarketCardClickable"
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          props.onOpen()
        }
      }}
    >
      <div className="dshMarketCardBody">
        <div className="dshMarketCardTitleRow">
          <h3 className="dshMarketCardTitle">{plugin.name}</h3>
          <span className="dshMarketSourceBadge">{plugin.sourceName}</span>
        </div>
        <div className="dshMarketCardMeta">
          {plugin.version && <span>v{plugin.version}</span>}
          {plugin.author && <span>{plugin.author}</span>}
          {plugin.stars !== undefined && <span>★ {formatCount(plugin.stars)}</span>}
          {plugin.license && <span>{plugin.license}</span>}
          {plugin.updatedAt && <span>{t('updatedAt')} {plugin.updatedAt}</span>}
        </div>
        {plugin.description && <p className="dshMarketCardDesc">{plugin.description}</p>}
      </div>
      <div className="dshMarketCardFooter">
        <button
          className="dshMarketButtonPrimary"
          type="button"
          disabled={action.disabled}
          onClick={(event) => {
            event.stopPropagation()
            props.onInstall()
          }}
        >
          {action.label}
        </button>
      </div>
    </article>
  )
}

/** Full-screen detail view inside the market content area. */
function PluginDetail(props: {
  t: (key: MarketKey, params?: Record<string, string | number>) => string
  plugin: MarketPlugin
  installed: boolean
  status: JobStatus | undefined
  preparing: boolean
  onBack: () => void
  onInstall: () => void
}): ReactNode {
  const { plugin, t } = props
  const isZh = t('install') === '安装'
  const action = pluginInstallAction(props.installed, props.status, props.preparing, isZh)
  return (
    <div className="dshMarketDetail">
      <button className="dshMarketBack" type="button" onClick={props.onBack}>{t('backToPlugins')}</button>
      <header className="dshMarketDetailHeader">
        <div>
          <h3 className="dshMarketDetailTitle">{plugin.name}</h3>
          <div className="dshMarketCardMeta">
            {plugin.version && <span>v{plugin.version}</span>}
            {plugin.author && <span>{plugin.author}</span>}
            {plugin.sourceName && <span>{plugin.sourceName}</span>}
          </div>
        </div>
        <button
          className="dshMarketButtonPrimary"
          type="button"
          disabled={action.disabled}
          onClick={props.onInstall}
        >
          {action.label}
        </button>
      </header>
      <section className="dshMarketDetailSection">
        <h4 className="dshMarketDetailLabel">{t('description')}</h4>
        <p className="dshMarketDetailText">{plugin.description || t('noDescription')}</p>
      </section>
      <section className="dshMarketDetailSection">
        <h4 className="dshMarketDetailLabel">{t('metadata')}</h4>
        <dl className="dshMarketDetailMeta">
          <div><dt>{t('installSource')}</dt><dd>{plugin.install}</dd></div>
          {plugin.repository && <div><dt>{t('repository')}</dt><dd><a href={plugin.repository} target="_blank" rel="noreferrer">{plugin.repository}</a></dd></div>}
          {plugin.homepage && <div><dt>{t('homepage')}</dt><dd><a href={plugin.homepage} target="_blank" rel="noreferrer">{plugin.homepage}</a></dd></div>}
          {plugin.license && <div><dt>{t('license')}</dt><dd>{plugin.license}</dd></div>}
          {plugin.updatedAt && <div><dt>{t('updatedAt')}</dt><dd>{plugin.updatedAt}</dd></div>}
          {plugin.stars !== undefined && <div><dt>{t('stars')}</dt><dd>★ {formatCount(plugin.stars)}</dd></div>}
        </dl>
      </section>
      {plugin.tags !== undefined && plugin.tags.length > 0 && (
        <section className="dshMarketDetailSection">
          <h4 className="dshMarketDetailLabel">{t('tags')}</h4>
          <div className="dshMarketTagRow">
            {plugin.tags.map(tag => <span className="dshMarketTag" key={tag}>{tag}</span>)}
          </div>
        </section>
      )}
    </div>
  )
}

/** Source list and editor panel. */
function SourcesPanel(props: {
  t: (key: MarketKey, params?: Record<string, string | number>) => string
  sources: PluginSource[]
  onChanged: () => void
}): ReactNode {
  const { t } = props
  const [form, setForm] = useState<SourceFormState>(EMPTY_SOURCE_FORM)
  const [error, setError] = useState<string | undefined>()

  const saveSource = async (): Promise<void> => {
    setError(undefined)
    try {
      await requestJson('/api/desktop/market/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      })
      setForm(EMPTY_SOURCE_FORM)
      props.onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const updateSource = async (source: PluginSource, enabled: boolean): Promise<void> => {
    setError(undefined)
    try {
      await requestJson('/api/desktop/market/sources', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ...source, enabled }),
      })
      props.onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  const deleteSource = async (id: string): Promise<void> => {
    setError(undefined)
    try {
      await requestJson(`/api/desktop/market/sources?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
      props.onChanged()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  return (
    <div className="dshMarketStack">
      <div className="dshMarketSourceEditor">
        <div className="dshMarketField">
          <label className="dshMarketFieldLabel">{t('sourceId')}</label>
          <input className="dshMarketInput" value={form.id} onChange={(event) => { setForm({ ...form, id: event.target.value }) }} placeholder="例如 my-source" />
        </div>
        <div className="dshMarketField">
          <label className="dshMarketFieldLabel">{t('sourceDisplayName')}</label>
          <input className="dshMarketInput" value={form.name} onChange={(event) => { setForm({ ...form, name: event.target.value }) }} placeholder="例如 My Marketplace" />
        </div>
        <div className="dshMarketField">
          <label className="dshMarketFieldLabel">{t('sourceType')}</label>
          <select className="dshMarketSelect" value={form.kind} onChange={(event) => { setForm({ ...form, kind: event.target.value as PluginSourceKind }) }}>
            <option value="manifest">Manifest URL</option>
            <option value="github">{t('sourceGithub')}</option>
            <option value="local">{t('sourceLocal')}</option>
            <option value="npm">npm registry</option>
          </select>
        </div>
        <div className="dshMarketField">
          <label className="dshMarketFieldLabel">{t('sourceUrlOrPath')}</label>
          <input className="dshMarketInput" value={form.url} onChange={(event) => { setForm({ ...form, url: event.target.value }) }} placeholder={urlPlaceholder(form.kind)} />
        </div>
        <label className="dshMarketCardMeta">
          <input type="checkbox" checked={form.enabled} onChange={(event) => { setForm({ ...form, enabled: event.target.checked }) }} />
          {t('enableThisSource')}
        </label>
        <div className="dshMarketCardFooter">
          <button className="dshMarketButtonPrimary" type="button" onClick={() => { void saveSource() }}>{t('saveSource')}</button>
        </div>
      </div>
      {error && <p className="dshMarketError">{error}</p>}
      <div className="dshMarketStack">
        {props.sources.map(source => (
          <div className="dshMarketSource" key={source.id}>
            <div className="dshMarketSourceBody">
              <strong className="dshMarketSourceName">{source.name}</strong>
              <div className="dshMarketCardMeta">
                <span>{source.kind}</span>
                <span>{source.enabled ? t('sourceEnabled') : t('delete')}</span>
                <span>{source.url}</span>
              </div>
            </div>
            <div className="dshMarketSourceFooter">
              <button className="dshMarketButtonGhost" type="button" onClick={() => {
                setForm({ id: source.id, name: source.name, kind: source.kind, url: source.url, enabled: source.enabled })
              }}>{t('edit')}</button>
              <button className="dshMarketButtonGhost" type="button" onClick={() => { void updateSource(source, !source.enabled) }}>
                {source.enabled ? t('cancel') : t('sourceEnabled')}
              </button>
              <button className="dshMarketButtonGhost" type="button" onClick={() => { void deleteSource(source.id) }}>{t('delete')}</button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Installed plugin management panel. */
function InstalledPanel(props: {
  t: (key: MarketKey, params?: Record<string, string | number>) => string
  installed: InstalledPlugin[]
  onJobStarted: (job: MarketJob) => void
  onChanged: () => void
}): ReactNode {
  const { t } = props
  const [removing, setRemoving] = useState<string | undefined>()
  const [error, setError] = useState<string | undefined>()

  const runUninstall = async (name: string): Promise<void> => {
    setRemoving(name)
    setError(undefined)
    try {
      const value = await requestJson<{ jobId?: unknown; job?: unknown }>('/api/desktop/market/uninstall', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name }),
      })
      const job = value.job as MarketJob | undefined
      if (job === undefined || typeof job.id !== 'string') throw new Error('uninstall response has no job')
      props.onJobStarted(job)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRemoving(undefined)
    }
  }

  return (
    <div className="dshMarketStack">
      <div className="dshMarketRow">
        <p className="dshMarketNotice">{t('installedNotice')}</p>
        <button className="dshMarketButtonGhost" type="button" onClick={props.onChanged}>{t('refresh')}</button>
      </div>
      {error && <p className="dshMarketError">{error}</p>}
      {props.installed.length === 0 && <p className="dshMarketEmpty">{t('noInstalled')}</p>}
      {props.installed.map(plugin => (
        <div className="dshMarketCard" key={plugin.name}>
          <div className="dshMarketCardBody">
            <div className="dshMarketCardTitleRow">
              <h3 className="dshMarketCardTitle">{plugin.name}</h3>
            </div>
            <div className="dshMarketCardMeta">
              {plugin.version && <span>v{plugin.version}</span>}
              {plugin.requested && <span>{t('declared')} {plugin.requested}</span>}
            </div>
          </div>
          <div className="dshMarketCardFooter">
            <button className="dshMarketButtonGhost" type="button" disabled={removing === plugin.name} onClick={() => { void runUninstall(plugin.name) }}>
              {removing === plugin.name ? t('uninstalling') : t('uninstall')}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

/** Install/remove job log panel. */
function JobsPanel(props: {
  t: (key: MarketKey, params?: Record<string, string | number>) => string
  jobs: MarketJob[]
  onCancel: (jobId: string) => Promise<void>
}): ReactNode {
  const { t } = props
  return (
    <div className="dshMarketJobs">
      {props.jobs.length === 0 && <p className="dshMarketEmpty">{t('noJobs')}</p>}
      {newestMarketJobs(props.jobs).map(job => (
        <MarketJobCard t={t} job={job} key={job.id} onCancel={props.onCancel} />
      ))}
    </div>
  )
}

/** One task result using the same summary-and-facts layout as desktop updates. */
interface MarketJobCardProps {
  t: (key: MarketKey, params?: Record<string, string | number>) => string
  /** Task snapshot rendered by the card. */
  job: MarketJob
  /** Cancel one queued or running task. */
  onCancel: (jobId: string) => Promise<void>
}

function MarketJobCard(props: MarketJobCardProps): ReactNode {
  const { job, t } = props
  const isZh = t('install') === '安装'
  const [logsOpen, setLogsOpen] = useState(job.status === 'failed')
  useEffect(() => {
    if (job.status === 'failed') setLogsOpen(true)
  }, [job.status])
  const errorLine = job.status === 'failed'
    ? job.output.findLast(line => line.trim().length > 0)
    : undefined
  return (
    <section className="dshMarketJob" data-status={job.status}>
      <header className="dshMarketJobHead">
        <div className="dshMarketJobTitle">
          <h3 className="dshMarketJobHeadline">{marketJobHeadline(job.action, job.status, isZh)}</h3>
          <p className="dshMarketJobPlugin">{job.label || job.target || job.id}</p>
        </div>
        {(job.status === 'queued' || job.status === 'running')
          ? <button className="dshMarketButtonGhost" type="button" onClick={() => { void props.onCancel(job.id) }}>{t('cancel')}</button>
          : <span className="dshMarketJobStatus">{jobStatusLabel(job.status, isZh)}</span>}
      </header>
      <dl className="dshMarketJobFacts">
        <JobFact label={t('jobAction')} value={job.action === 'install' ? t('installPlugin') : t('uninstallPlugin')} />
        <JobFact label={t('jobStatus')} value={marketJobHeadline(job.action, job.status, isZh)} />
        <JobFact label={t('createdAt')} value={formatJobTime(job.createdAt)} />
        <JobFact label={t('startedAt')} value={formatJobTime(job.startedAt)} />
        <JobFact label={t('completedAt')} value={formatJobTime(job.completedAt)} />
        <JobFact label={t('duration')} value={marketJobDuration(job.startedAt, job.completedAt, Date.now(), isZh)} />
        <JobFact label={t('exitInfo')} value={jobExitLabel(job, isZh)} />
        <JobFact label={t('target')} value={job.target || '—'} />
      </dl>
      {errorLine !== undefined && <p className="dshMarketJobError">{errorLine}</p>}
      <details
        className="dshMarketJobLog"
        open={logsOpen}
        onToggle={(event) => { setLogsOpen(event.currentTarget.open) }}
      >
        <summary>{t('cmdLog')}</summary>
        <pre className="dshMarketJobOutput">{job.output.length === 0 ? t('noLogs') : job.output.join('\n')}</pre>
      </details>
    </section>
  )
}

/** One label-value cell in the task fact grid. */
interface JobFactProps {
  /** Short fact name. */
  label: string
  /** Formatted fact value. */
  value: string
}

function JobFact(props: JobFactProps): ReactNode {
  return (
    <div className="dshMarketJobFact">
      <dt>{props.label}</dt>
      <dd>{props.value}</dd>
    </div>
  )
}

/** Top-level market tab. */
function TabButton(props: {
  label: string
  count: number | undefined
  current: boolean
  onClick: () => void
}): ReactNode {
  return (
    <button className="dshMarketTab" type="button" aria-current={props.current || undefined} onClick={props.onClick}>
      <span>{props.label}</span>
      {props.count !== undefined && <span className="dshMarketTabCount">{props.count}</span>}
    </button>
  )
}

function isPluginInstalled(plugin: MarketPlugin, installedNames: Set<string>): boolean {
  if (installedNames.has(plugin.name)) return true
  const spec = plugin.install.replace(/^github:/u, '').split('#')[0]
  if (spec === undefined) return false
  const repoName = spec.split('/').at(-1)
  return repoName !== undefined && installedNames.has(repoName)
}

/** Find the newest install job matching one catalog plugin. */
function pluginJob(plugin: MarketPlugin, jobs: MarketJob[]): MarketJob | undefined {
  return findNewestPluginJob(plugin.install, plugin.name, jobs)
}

function formatCount(value: number): string {
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`
  return String(value)
}

function jobStatusLabel(status: JobStatus, isZh = true): string {
  if (isZh) {
    switch (status) {
      case 'queued': return '排队中'
      case 'running': return '运行中'
      case 'success': return '成功'
      case 'failed': return '失败'
      case 'cancelled': return '已取消'
    }
  }
  switch (status) {
    case 'queued': return 'Queued'
    case 'running': return 'Running'
    case 'success': return 'Success'
    case 'failed': return 'Failed'
    case 'cancelled': return 'Cancelled'
  }
}

/** Format one task timestamp in the user's local timezone. */
function formatJobTime(value: string | undefined): string {
  if (value === undefined) return '—'
  const date = new Date(value)
  if (!Number.isFinite(date.getTime())) return '—'
  return date.toLocaleString(undefined, { hour12: false })
}

/** Describe process completion without exposing a raw command line. */
function jobExitLabel(job: MarketJob, isZh = true): string {
  if (isZh) {
    if (job.exitCode !== null) return `退出码 ${job.exitCode}`
    if (job.signal !== null) return `信号 ${job.signal}`
    if (job.status === 'queued') return '尚未启动'
    if (job.status === 'running') return '运行中'
    return '—'
  }
  if (job.exitCode !== null) return `Exit code ${job.exitCode}`
  if (job.signal !== null) return `Signal ${job.signal}`
  if (job.status === 'queued') return 'Not started'
  if (job.status === 'running') return 'Running'
  return '—'
}

function urlPlaceholder(kind: PluginSourceKind): string {
  switch (kind) {
    case 'npm': return 'https://registry.npmjs.org'
    case 'github': return 'https://github.com/owner/repo'
    case 'local': return 'C:\\path\\to\\plugin-manifest-directory'
    case 'manifest': return 'https://example.com/dsh-market.json'
  }
}

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const value = await response.json() as T & { error?: unknown }
  if (!response.ok) throw new Error(errorFromBody(value))
  return value
}

function errorFromBody(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'error' in value) {
    const error = (value as { error: unknown }).error
    if (typeof error === 'string') return error
  }
  return 'request failed'
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}
