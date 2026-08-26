/** Desktop workbench dock: right sidebar with rail icons, browser-style tabs, and panels.
 *
 * Desktop-owned advanced-shell presentation composed beside the unchanged
 * product surfaces. File/git/terminal panels reach the host exclusively
 * through the authorized `/api/desktop/workbench` routes, and the auxiliary
 * chat drives real sessions through the shared connection API client; no
 * kernel slot or service is replaced.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { MACOS_TITLEBAR_HEIGHT, WINDOWS_CAPTION_CONTROLS_WIDTH, WINDOWS_TITLEBAR_HEIGHT } from '../window-chrome.ts'
import { isDesktopPrefsHydrated, schedulePersistDesktopPrefs } from './desktop-prefs.ts'
import {
  WORKBENCH_WIDTH_MAX,
  WORKBENCH_WIDTH_MIN,
  WORKBENCH_PANEL_IDS,
  foldAuxHistory,
  type AuxConversation,
  type WorkbenchPanelId,
  type WorkbenchSnapshot,
  type WorkbenchState,
} from './workbench-state.ts'

/* ------------------------------------------------------------------ */
/* Localized strings                                                   */
/* ------------------------------------------------------------------ */

interface WorkbenchStrings {
  explorer: string
  terminal: string
  git: string
  browser: string
  close: string
  collapse: string
  toggle: string
  chat: string
  parentDirectory: string
  workspaceRoot: string
  refresh: string
  explorerOpen: string
  nameColumn: string
  sizeColumn: string
  previewUnavailable: string
  previewBinary: string
  previewTruncated: string
  terminalPlaceholder: string
  terminalRestart: string
  gitNotRepository: string
  gitStaged: string
  gitChanges: string
  gitHistory: string
  gitBranches: string
  newBranch: string
  createBranch: string
  deleteBranch: string
  push: string
  pull: string
  pushOk: string
  pullOk: string
  fetchLabel: string
  fetchOk: string
  stashSave: string
  stashRestore: string
  stashOk: string
  unstashOk: string
  discard: string
  discardAll: string
  stageAll: string
  confirmDiscard(count: number): string
  stage: string
  unstage: string
  commitPlaceholder: string
  commit: string
  diffSummary: (files: number, additions: number, deletions: number) => string
  browserPlaceholder: string
  browserHome: string
  browserBack: string
  browserForward: string
  browserReload: string
  dragResize: string
  auxNew: string
  auxSend: string
  auxPlaceholder: string
  auxEmpty: string
  auxThinking: string
  auxUnavailable: string
}

const STRINGS_ZH: WorkbenchStrings = {
  explorer: '项目',
  terminal: '终端',
  git: 'Git',
  browser: '浏览器',
  close: '关闭标签页',
  collapse: '收起侧边栏',
  toggle: '侧边栏',
  chat: '辅助对话',
  parentDirectory: '上一级目录',
  workspaceRoot: '回到工作区根目录',
  refresh: '刷新',
  explorerOpen: '打开工作区文件夹',
  nameColumn: '名称',
  sizeColumn: '大小',
  previewUnavailable: '无法读取该文件。',
  previewBinary: '二进制文件不支持预览。',
  previewTruncated: '(预览已截断)',
  terminalPlaceholder: '输入命令，回车执行…',
  terminalRestart: '重新开始会话',
  gitNotRepository: '当前工作区不是 Git 仓库。',
  gitStaged: '已暂存',
  gitChanges: '更改',
  gitHistory: '历史',
  gitBranches: '分支',
  newBranch: '新建分支…',
  createBranch: '创建',
  deleteBranch: '删除',
  push: '推送',
  pull: '拉取',
  pushOk: '已推送到远端。',
  pullOk: '已拉取最新代码。',
  fetchLabel: '获取',
  fetchOk: '已获取远端更新。',
  stashSave: '贮藏',
  stashRestore: '恢复',
  stashOk: '已贮藏当前更改。',
  unstashOk: '已恢复最近一次贮藏。',
  discard: '放弃',
  discardAll: '全部放弃',
  stageAll: '全部暂存',
  confirmDiscard: count => `确定放弃 ${String(count)} 个文件的未提交更改吗？此操作不可撤销。`,
  stage: '暂存',
  unstage: '取消暂存',
  commitPlaceholder: '提交说明…',
  commit: '提交',
  diffSummary: (files, additions, deletions) => `${String(files)} 个文件，+${String(additions)} −${String(deletions)}`,
  browserPlaceholder: '输入网址…',
  browserHome: '主页',
  browserBack: '后退',
  browserForward: '前进',
  browserReload: '刷新页面',
  dragResize: '拖动调整大小',
  auxNew: '新建辅助对话',
  auxSend: '发送',
  auxPlaceholder: '输入消息，回车发送，Shift+Enter 换行…',
  auxEmpty: '点击 + 新建一个辅助对话。',
  auxThinking: '思考中…',
  auxUnavailable: '会话服务尚未就绪，请稍后再试。',
}

const STRINGS_EN: WorkbenchStrings = {
  explorer: 'Explorer',
  terminal: 'Terminal',
  git: 'Git',
  browser: 'Browser',
  close: 'Close tab',
  collapse: 'Collapse sidebar',
  toggle: 'Sidebar',
  chat: 'Chat',
  parentDirectory: 'Parent directory',
  workspaceRoot: 'Workspace root',
  refresh: 'Refresh',
  explorerOpen: 'Open the workspace folder',
  nameColumn: 'Name',
  sizeColumn: 'Size',
  previewUnavailable: 'This file cannot be read.',
  previewBinary: 'Binary files have no preview.',
  previewTruncated: '(preview truncated)',
  terminalPlaceholder: 'Type a command and press Enter…',
  terminalRestart: 'Restart session',
  gitNotRepository: 'The current workspace is not a Git repository.',
  gitStaged: 'Staged',
  gitChanges: 'Changes',
  gitHistory: 'History',
  gitBranches: 'Branches',
  newBranch: 'New branch…',
  createBranch: 'Create',
  deleteBranch: 'Delete',
  push: 'Push',
  pull: 'Pull',
  pushOk: 'Pushed to the remote.',
  pullOk: 'Pulled the latest changes.',
  fetchLabel: 'Fetch',
  fetchOk: 'Fetched from the remote.',
  stashSave: 'Stash',
  stashRestore: 'Unstash',
  stashOk: 'Changes stashed.',
  unstashOk: 'Latest stash restored.',
  discard: 'Discard',
  discardAll: 'Discard all',
  stageAll: 'Stage all',
  confirmDiscard: count => `Discard uncommitted changes in ${String(count)} file(s)? This cannot be undone.`,
  stage: 'Stage',
  unstage: 'Unstage',
  commitPlaceholder: 'Commit message…',
  commit: 'Commit',
  diffSummary: (files, additions, deletions) => `${String(files)} files, +${String(additions)} −${String(deletions)}`,
  browserPlaceholder: 'Enter a URL…',
  browserHome: 'Home',
  browserBack: 'Back',
  browserForward: 'Forward',
  browserReload: 'Reload',
  dragResize: 'Drag to resize',
  auxNew: 'New auxiliary chat',
  auxSend: 'Send',
  auxPlaceholder: 'Type a message; Enter sends, Shift+Enter adds a line…',
  auxEmpty: 'Click + to start an auxiliary chat.',
  auxThinking: 'Thinking…',
  auxUnavailable: 'The session service is not ready yet.',
}

let strings: WorkbenchStrings | undefined

/** @returns strings picked once from the navigator language. */
function useStrings(): WorkbenchStrings {
  strings ??= navigator.language.toLowerCase().startsWith('zh') ? STRINGS_ZH : STRINGS_EN
  return strings
}

/* ------------------------------------------------------------------ */
/* Icons                                                               */
/* ------------------------------------------------------------------ */

function Icon(props: { children: ReactNode }): ReactNode {
  return (
    <svg
      viewBox="0 0 16 16"
      width="15"
      height="15"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.4"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {props.children}
    </svg>
  )
}

const FolderIcon = (
  <Icon>
    <path d="M2 4.5a1 1 0 0 1 1-1h3.2l1.6 1.8H13a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1Z" />
  </Icon>
)

const FolderOpenIcon = (
  <Icon>
    <path d="M13.5 6.7V6a1 1 0 0 0-1-1H7.8L6.2 3.2H3a1 1 0 0 0-1 1V12" />
    <path d="m2.4 12.9 1.6-3.8a1 1 0 0 1 .92-.6h8.9c.48 0 .81.47.66.92l-.94 2.88a1 1 0 0 1-.95.7H3.14a.8.8 0 0 1-.74-1.1z" />
  </Icon>
)

const TerminalIcon = (
  <Icon>
    <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.2" />
    <path d="m4.6 6.2 2.2 2-2.2 2M8.6 10.4h3" />
  </Icon>
)

const GitIcon = (
  <Icon>
    <circle cx="4.4" cy="3.8" r="1.7" />
    <circle cx="4.4" cy="12.2" r="1.7" />
    <circle cx="11.6" cy="6.4" r="1.7" />
    <path d="M4.4 5.5v5M11.6 8.1c0 2.2-2.4 2.4-4.4 2.9" />
  </Icon>
)

const GlobeIcon = (
  <Icon>
    <circle cx="8" cy="8" r="6" />
    <path d="M2 8h12M8 2c-3.4 3.6-3.4 8.4 0 12M8 2c3.4 3.6 3.4 8.4 0 12" />
  </Icon>
)

const SidebarIcon = (
  <Icon>
    <rect x="1.8" y="2.8" width="12.4" height="10.4" rx="1.2" />
    <path d="M9.7 2.8v10.4" />
  </Icon>
)

const ChatIcon = (
  <Icon>
    <path d="M2.6 3.2h10.8v7.2H7.2L4 13v-2.6H2.6z" />
    <path d="M5.4 6h5.2M5.4 8h3.4" />
  </Icon>
)

const ChevronRightIcon = (
  <Icon>
    <path d="m6 3.5 5 4.5-5 4.5" />
  </Icon>
)

const CloseIcon = (
  <Icon>
    <path d="m4 4 8 8M12 4l-8 8" />
  </Icon>
)

const ArrowUpIcon = (
  <Icon>
    <path d="M8 13V3M4 7l4-4 4 4" />
  </Icon>
)

const HomeIcon = (
  <Icon>
    <path d="m2.5 7.5 5.5-5 5.5 5M4 7v6.5h8V7" />
  </Icon>
)

const RefreshIcon = (
  <Icon>
    <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.8v2.4h-2.4" />
  </Icon>
)

const ArrowLeftIcon = (
  <Icon>
    <path d="M13 8H3M7 4 3 8l4 4" />
  </Icon>
)

const ArrowRightIcon = (
  <Icon>
    <path d="M3 8h10M9 4l4 4-4 4" />
  </Icon>
)

const PlusIcon = (
  <Icon>
    <path d="M8 3.2v9.6M3.2 8h9.6" />
  </Icon>
)

const SendIcon = (
  <Icon>
    <path d="M14 2 3 6.5l4.5 2L9.5 13z" />
    <path d="M14 2 7.5 8.5" />
  </Icon>
)

const PanelIcons: Record<WorkbenchPanelId, ReactNode> = {
  explorer: FolderIcon,
  terminal: TerminalIcon,
  git: GitIcon,
  browser: GlobeIcon,
  chat: ChatIcon,
}

/* ------------------------------------------------------------------ */
/* Host API helpers                                                    */
/* ------------------------------------------------------------------ */

async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init)
  const value = await response.json() as T & { error?: unknown }
  if (!response.ok) throw new Error(errorFromBody(value))
  return value
}

function errorFromBody(value: unknown): string {
  if (typeof value === 'object' && value !== null && 'error' in value) {
    const error = (value as { error: unknown }).error
    if (typeof error === 'string' && error.length > 0) return error
  }
  return 'request failed'
}

function postJson<T>(url: string, body: unknown): Promise<T> {
  return requestJson<T>(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

interface GitFileCount { additions: number; deletions: number }

type GitKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked'

interface WorkspaceGit {
  kinds: Map<string, GitKind>
  counts: Map<string, GitFileCount>
}

let workspaceCache: string | undefined

function classifyGitStatus(x: string, y: string): GitKind {
  if (x === '?' || y === '?') return 'untracked'
  if (x === 'A' || y === 'A') return 'added'
  if (x === 'D' || y === 'D') return 'deleted'
  if (x === 'R' || y === 'R') return 'renamed'
  return 'modified'
}

/** Load per-file change kinds and +/- line counts for the workspace root. */
async function fetchWorkspaceGit(workspace: string): Promise<WorkspaceGit | undefined> {
  try {
    const value = await requestJson<{ entries: StatusResponse['entries']; counts?: Record<string, GitFileCount> }>(
      `/api/desktop/workbench/git/status?path=${encodeURIComponent(workspace)}`,
    )
    const kinds = new Map<string, GitKind>()
    for (const entry of value.entries) kinds.set(entry.path, classifyGitStatus(entry.x, entry.y))
    const counts = new Map<string, GitFileCount>()
    for (const [path, count] of Object.entries(value.counts ?? {})) {
      counts.set(path, { additions: count.additions, deletions: count.deletions })
    }
    return { kinds, counts }
  } catch {
    return undefined
  }
}

/** Path of `name` inside `dir`, relative to `root` in POSIX form (git status paths). */
function relativePosix(root: string, dir: string, name: string): string {
  const normalize = (value: string): string => value.replace(/\\/g, '/')
  const base = normalize(root).replace(/\/+$/, '')
  const dirNormalized = normalize(dir)
  const relDir = dirNormalized === base ? '' : dirNormalized.slice(base.length).replace(/^\//, '').replace(/\/+$/, '')
  return relDir.length === 0 ? normalize(name) : `${relDir}/${normalize(name)}`
}

/** True when `child` equals or lives below directory `root` (separator-agnostic). */
function isWithin(child: string, root: string): boolean {
  const normalize = (value: string): string => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()
  const base = normalize(root)
  const target = normalize(child)
  return target === base || target.startsWith(`${base}/`)
}

interface FsEntry {
  name: string
  kind: 'directory' | 'file'
  size?: number | undefined
}

interface PreviewResponse {
  preview: { text: string; truncated: boolean; binary: boolean }
}

interface StatusResponse {
  branch?: string | undefined
  ahead?: number | undefined
  behind?: number | undefined
  entries: Array<{ x: string; y: string; path: string; origPath?: string | undefined }>
}

interface LogResponse {
  entries: Array<{ abbrev: string; subject: string; author: string; time: number }>
}

interface DiffResponse {
  total: { files: number; additions: number; deletions: number }
}

function wait(milliseconds: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds))
}

/* ------------------------------------------------------------------ */
/* Styles                                                              */
/* ------------------------------------------------------------------ */

const WORKBENCH_STYLES = `
.dshDesktopFrame[data-desktop-platform] .hxpWb { grid-column: 4; grid-row: 2; }
.hxpWb { position: relative; min-width: 0; min-height: 0; overflow: hidden; background: var(--dsw-alias-bg-base, #fff); border-left: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.08)); }
.hxpWbSlide { height: 100%; display: flex; flex-direction: column; transform: translateX(calc(100% + 1px)); opacity: 0; transition: transform var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease), opacity var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease); }
.hxpWb[data-open] .hxpWbSlide { transform: translateX(0); opacity: 1; }
.hxpWbRail { flex: none; display: flex; align-items: center; gap: 2px; padding: 4px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06)); }
.hxpWbSpring { flex: 1 1 auto; }
.hxpWbRailButton { display: inline-flex; align-items: center; gap: 5px; height: 28px; padding: 0 10px 0 8px; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #555); cursor: pointer; font-size: 12px; }
.hxpWbRailButton:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); color: var(--dsw-alias-label-primary, #222); }
.hxpWbRailButton[data-active] { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); color: var(--dsw-alias-label-primary, #222); }
.hxpWbRailLabel { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hxpWbBody { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
.hxpWbTabs { flex: none; display: flex; align-items: center; gap: 2px; padding: 4px 6px 0; overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }
.hxpWbTabs::-webkit-scrollbar { display: none; }
.hxpWbTab { display: inline-flex; align-items: center; flex: none; gap: 5px; height: 28px; padding: 0 5px 0 9px; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-secondary, #555); font-size: 12px; cursor: pointer; user-select: none; }
.hxpWbTab:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
.hxpWbTab[data-active] { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08)); color: var(--dsw-alias-label-primary, #222); font-weight: 600; }
.hxpWbTabText { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 110px; }
.hxpWbTabClose { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: none; border-radius: 4px; background: transparent; color: inherit; opacity: .55; cursor: pointer; }
.hxpWbTabClose:hover { opacity: 1; background: rgba(0,0,0,.08); }
.hxpWbDivider { position: relative; z-index: 5; flex: none; height: 5px; cursor: row-resize; touch-action: none; }
.hxpWbDivider:hover { background: rgba(127,127,127,.18); }
.hxpWbResize { position: absolute; top: 0; bottom: 0; left: -4px; width: 8px; cursor: col-resize; touch-action: none; z-index: 10; }
.hxpWbToggle { position: absolute; z-index: 60; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary, #888); cursor: pointer; }
.dshDesktopFrame[data-desktop-platform="win32"] .hxpWbToggle { top: calc((${WINDOWS_TITLEBAR_HEIGHT}px - 28px) / 2); right: calc(${WINDOWS_CAPTION_CONTROLS_WIDTH}px + 8px); }
.dshDesktopFrame[data-desktop-platform="darwin"] .hxpWbToggle { top: calc((${MACOS_TITLEBAR_HEIGHT}px - 28px) / 2); right: 12px; }
.hxpWbToggle:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); color: var(--dsw-alias-label-primary, #222); }
.hxpWbToggle[data-active] { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07)); color: var(--dsw-alias-label-primary, #222); }
.hxpWbPanel { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; font-size: 12.5px; color: var(--dsw-alias-label-primary, #222); }
.hxpWbToolbar { flex: none; display: flex; align-items: center; gap: 2px; padding: 4px 6px; }
.hxpWbToolButton { display: inline-flex; align-items: center; justify-content: center; width: 24px; height: 24px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary, #888); cursor: pointer; }
.hxpWbToolButton:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); color: var(--dsw-alias-label-primary, #222); }
.hxpWbToolButton:disabled { opacity: .35; cursor: default; }
.hxpWbToolText { width: auto; padding: 0 8px; font-size: 11.5px; }
.hxpWbBreadcrumb { flex: none; display: flex; align-items: center; flex-wrap: wrap; gap: 1px; padding: 2px 8px 6px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06)); }
.hxpWbCrumbRow { display: inline-flex; align-items: center; }
.hxpWbCrumbSep { margin: 0 3px; color: var(--dsw-alias-label-tertiary, #999); }
.hxpWbCrumb { padding: 1px 3px; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-primary, #222); font-size: 11.5px; cursor: pointer; }
.hxpWbCrumb:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
.hxpWbNotice { padding: 6px 8px; color: var(--dsw-alias-label-tertiary, #999); word-break: break-all; }
.hxpWbFileList { flex: 1 1 auto; min-height: 60px; overflow-y: auto; padding: 2px 4px; }
.hxpWbFileRow { display: flex; align-items: center; gap: 6px; width: 100%; padding: 3px 6px; border: none; border-radius: 6px; background: transparent; color: inherit; font-size: 12.5px; text-align: left; cursor: pointer; }
.hxpWbFileRow:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
.hxpWbFileIcon { display: inline-flex; color: var(--dsw-alias-label-tertiary, #999); }
.hxpWbFileName { flex: 1 1 auto; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hxpWbFileName[data-git="modified"] { color: #b58a2c; }
.hxpWbFileName[data-git="added"], .hxpWbFileName[data-git="untracked"] { color: #3f8f4a; }
.hxpWbFileName[data-git="deleted"] { color: #cc4b42; }
.hxpWbFileName[data-git="renamed"] { color: #4a7fb5; }
.hxpWbGitCounts { flex: none; font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; }
.hxpWbAdd { color: #3f8f4a; }
.hxpWbDel { color: #cc4b42; }
.hxpWbFileSize { flex: none; color: var(--dsw-alias-label-tertiary, #999); font-size: 11px; }
.hxpWbPreview { flex: none; display: flex; flex-direction: column; overflow: hidden; max-height: calc(100% - 150px); border-top: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.08)); }
.hxpWbPreviewTitle { padding: 5px 8px 2px; color: var(--dsw-alias-label-tertiary, #999); font-size: 11px; }
.hxpWbPreviewText { flex: 1 1 auto; min-height: 0; margin: 0; padding: 4px 8px 8px; overflow: auto; font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--dsw-alias-label-primary, #222); }
.hxpWbTerminal { --hxpWbMono: ui-monospace, Consolas, "Cascadia Mono", monospace; }
.hxpWbTermOutput { flex: 1 1 auto; min-height: 0; margin: 0; padding: 6px 8px; overflow-y: auto; background: transparent; font-family: var(--hxpWbMono); font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; color: var(--dsw-alias-label-primary, #222); }
.hxpWbTermForm { flex: none; display: flex; box-sizing: border-box; padding: 4px 6px 6px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06)); }
.hxpWbTermInput { flex: 1 1 auto; align-self: stretch; resize: none; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary, #222); font-family: var(--hxpWbMono); font-size: 12px; line-height: 1.5; outline: none; }
.hxpWbTermInput:focus { border-color: var(--dsw-alias-label-tertiary, #999); }
.hxpWbGit { gap: 0; }
.hxpWbGitLower { flex: none; display: flex; flex-direction: column; overflow: hidden; max-height: calc(100% - 170px); border-top: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.08)); }
.hxpWbBranch { padding: 0 4px; font-weight: 600; }
.hxpWbAhead { color: var(--dsw-alias-label-tertiary, #999); }
.hxpWbDiffLine { padding: 0 10px 4px; color: var(--dsw-alias-label-tertiary, #999); font-size: 11px; }
.hxpWbSectionTitle { display: flex; align-items: center; padding: 6px 10px 2px; color: var(--dsw-alias-label-tertiary, #999); font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; }
.hxpWbSectionActions { display: inline-flex; align-items: center; gap: 2px; margin-left: auto; }
.hxpWbLinkAction { padding: 1px 6px; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-secondary, #555); font-size: 10.5px; letter-spacing: normal; text-transform: none; cursor: pointer; }
.hxpWbLinkAction:hover:not(:disabled) { background: rgba(0,0,0,.06); color: var(--dsw-alias-label-primary, #222); }
.hxpWbLinkAction:disabled { opacity: .4; cursor: default; }
.hxpWbDanger { color: #b3493f; }
.hxpWbGitAction.hxpWbDanger:hover:not(:disabled) { background: rgba(204,75,66,.1); color: #cc4b42; }
.hxpWbGitRow { display: flex; align-items: center; gap: 6px; padding: 2px 8px; }
.hxpWbGitBadge { flex: none; min-width: 20px; padding: 0 3px; border-radius: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); font-family: ui-monospace, Consolas, monospace; font-size: 10.5px; text-align: center; }
.hxpWbGitAction { flex: none; padding: 1px 7px; border: none; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-tertiary, #888); font-size: 11px; cursor: pointer; }
.hxpWbGitAction:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.06)); color: var(--dsw-alias-label-primary, #222); }
.hxpWbGitAction:disabled { opacity: .4; cursor: default; }
.hxpWbCommitForm { display: flex; gap: 6px; padding: 6px 8px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06)); }
.hxpWbCommitMessage { flex: 1 1 auto; resize: none; padding: 5px 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary, #222); font-size: 12px; outline: none; }
.hxpWbCommitMessage:focus { border-color: var(--dsw-alias-label-tertiary, #999); }
.hxpWbCommitButton { align-self: stretch; padding: 0 12px; border: none; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08)); color: var(--dsw-alias-label-primary, #222); font-size: 12px; cursor: pointer; }
.hxpWbCommitButton:hover:not(:disabled) { filter: brightness(.96); }
.hxpWbCommitButton:disabled { opacity: .4; cursor: default; }
.hxpWbLogList { flex: 1 1 auto; min-height: 40px; overflow-y: auto; padding: 2px 4px 8px; }
.hxpWbBranchMenu { flex: none; margin: 0 6px 6px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 8px; overflow: hidden; max-height: 40%; display: flex; flex-direction: column; background: var(--dsw-alias-bg-base, #fff); }
.hxpWbBranchList { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 3px; }
.hxpWbBranchRow { display: flex; align-items: center; gap: 6px; width: 100%; padding: 3px 8px; border: none; border-radius: 5px; background: transparent; color: var(--dsw-alias-label-primary, #222); font-size: 12px; text-align: left; cursor: pointer; }
.hxpWbBranchRow:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
.hxpWbBranchRow[data-current] { font-weight: 600; }
.hxpWbBranchMark { margin-left: auto; color: #3f8f4a; font-size: 11px; }
.hxpWbBranchDelete { flex: none; display: inline-flex; align-items: center; justify-content: center; min-width: 16px; height: 16px; margin-left: auto; margin-right: 2px; padding: 0 2px; border: none; border-radius: 4px; background: transparent; color: var(--dsw-alias-label-tertiary, #999); font-size: 10px; cursor: pointer; }
.hxpWbBranchDelete:hover:not(:disabled) { background: rgba(204,75,66,.12); color: #cc4b42; }
.hxpWbBranchDelete:disabled { opacity: .4; cursor: default; }
.hxpWbBranchRow[data-current] .hxpWbBranchDelete { display: none; }
.hxpWbBranchForm { flex: none; display: flex; gap: 6px; padding: 6px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06)); }
.hxpWbBranchInput { flex: 1 1 auto; min-width: 0; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary, #222); font-size: 11.5px; outline: none; }
.hxpWbBranchCreate { flex: none; padding: 0 10px; border: none; border-radius: 6px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08)); color: var(--dsw-alias-label-primary, #222); font-size: 11.5px; cursor: pointer; }
.hxpWbBranchCreate:disabled { opacity: .4; cursor: default; }
.hxpWbLogRow { display: flex; align-items: baseline; gap: 6px; padding: 2px 6px; }
.hxpWbLogHash { color: var(--dsw-alias-label-tertiary, #999); font-size: 10.5px; }
.hxpWbLogSubject { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hxpWbBrowser { display: flex; }
.hxpWbUrlForm { flex: 1 1 auto; display: flex; }
.hxpWbUrlInput { flex: 1 1 auto; min-width: 0; padding: 3px 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary, #222); font-size: 11.5px; outline: none; }
.hxpWbPageTitle { padding: 0 10px 3px; color: var(--dsw-alias-label-tertiary, #999); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.hxpWbLoading { flex: none; height: 2px; overflow: hidden; }
.hxpWbLoading::before { content: ""; display: block; height: 100%; width: 40%; border-radius: 2px; background: var(--dsw-alias-label-tertiary, #999); animation: hxpWbLoadingSlide 1s linear infinite; }
@keyframes hxpWbLoadingSlide { from { transform: translateX(-100%); } to { transform: translateX(350%); } }
.hxpWbBrowserError { flex: none; margin: 4px 6px; padding: 5px 8px; border-radius: 6px; background: rgba(204,75,66,.08); color: #cc4b42; font-size: 11.5px; word-break: break-all; }
.hxpWbWebView { flex: 1 1 auto; min-height: 0; width: 100%; border: none; background: #fff; }
.hxpAuxAdd { display: inline-flex; align-items: center; justify-content: center; flex: none; width: 24px; height: 24px; margin-left: 2px; padding: 0; border: none; border-radius: 6px; background: transparent; color: var(--dsw-alias-label-tertiary, #888); cursor: pointer; }
.hxpAuxAdd:hover:not(:disabled) { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); color: var(--dsw-alias-label-primary, #222); }
.hxpAuxAdd:disabled { opacity: .4; cursor: default; }
.hxpAuxEmpty { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; padding: 16px; color: var(--dsw-alias-label-tertiary, #999); font-size: 12px; text-align: center; }
.hxpAuxMessages { flex: 1 1 auto; min-height: 0; overflow-y: auto; padding: 10px 10px 6px; display: flex; flex-direction: column; gap: 8px; }
.hxpAuxMsg { max-width: 88%; box-sizing: border-box; padding: 6px 10px; border-radius: 10px; white-space: pre-wrap; word-break: break-word; line-height: 1.55; font-size: 12.5px; }
.hxpAuxMsg[data-role="user"] { align-self: flex-end; border-bottom-right-radius: 4px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07)); color: var(--dsw-alias-label-primary, #222); }
.hxpAuxMsg[data-role="assistant"] { align-self: flex-start; border-bottom-left-radius: 4px; border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); color: var(--dsw-alias-label-primary, #222); }
.hxpAuxThinking { align-self: flex-start; padding: 0 2px; color: var(--dsw-alias-label-tertiary, #999); font-size: 11px; animation: hxpAuxPulse 1.2s ease-in-out infinite; }
@keyframes hxpAuxPulse { 0%, 100% { opacity: .45; } 50% { opacity: 1; } }
.hxpAuxForm { flex: none; display: flex; align-items: flex-end; gap: 6px; padding: 6px 8px 8px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06)); }
.hxpAuxInput { flex: 1 1 auto; resize: none; height: 34px; padding: 7px 9px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 8px; background: transparent; color: var(--dsw-alias-label-primary, #222); font-family: inherit; font-size: 12.5px; line-height: 1.4; outline: none; overflow-y: auto; }
.hxpAuxInput:focus { border-color: var(--dsw-alias-label-tertiary, #999); }
.hxpAuxSend { flex: none; display: inline-flex; align-items: center; justify-content: center; width: 32px; height: 32px; padding: 0; border: none; border-radius: 8px; background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.08)); color: var(--dsw-alias-label-primary, #222); cursor: pointer; }
.hxpAuxSend:hover:not(:disabled) { filter: brightness(.96); }
.hxpAuxSend:disabled { opacity: .35; cursor: default; }
`

/** Install the workbench stylesheet once per mount. @returns the style disposer. */
export function installWorkbenchStyles(): () => void {
  const existing = document.head.querySelector('style[data-plugin-css="harnessx-desktop/workbench"]')
  if (existing !== null) return () => undefined
  const style = document.createElement('style')
  style.dataset.plugin = 'harnessx-desktop'
  style.dataset.pluginCss = 'harnessx-desktop/workbench'
  style.textContent = WORKBENCH_STYLES
  document.head.appendChild(style)
  return () => { style.remove() }
}

function basename(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index >= 0 ? path.slice(index + 1) : path
}

function formatBytes(size: number | undefined): string {
  if (size === undefined) return ''
  if (size < 1024) return `${String(size)} B`
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`
  return `${(size / (1024 * 1024)).toFixed(1)} MB`
}

/** Split an absolute path into clickable segments joined by its separator. */
function pathSegments(path: string): Array<{ label: string; path: string }> {
  const separator = path.includes('\\') ? '\\' : '/'
  const parts = path.split(separator).filter(part => part.length > 0)
  const segments: Array<{ label: string; path: string }> = []
  let accumulated = ''
  const windowsDrive = parts[0]?.includes(':') ?? false
  for (const part of parts) {
    accumulated = accumulated.length === 0
      ? (windowsDrive ? part : `/${part}`)
      : `${accumulated}${separator}${part}`
    segments.push({ label: part, path: accumulated })
  }
  return segments
}

/* ------------------------------------------------------------------ */
/* Dock                                                                */
/* ------------------------------------------------------------------ */

/**
 * Right-hand workbench dock rendered as the fourth frame column.
 * @param props - shared workbench store.
 * @returns the dock element.
 */
/** Square caption-bar button that anchors the dock; the sole entry point while collapsed. */
export function WorkbenchToggleButton(props: { state: WorkbenchState }): ReactNode {
  const state = props.state
  const t = useStrings()
  const subscribe = useCallback((listener: () => void) => state.subscribe(listener), [state])
  const read = useCallback(() => state.getSnapshot(), [state])
  const snapshot = useSyncExternalStore(subscribe, read)
  useEffect(() => installWorkbenchStyles(), [])
  return (
    <button
      type="button"
      className="hxpWbToggle"
      data-active={snapshot.open || undefined}
      title={t.toggle}
      aria-label={t.toggle}
      aria-pressed={snapshot.open}
      onClick={() => { state.toggle() }}
    >
      {SidebarIcon}
    </button>
  )
}

export function WorkbenchDock(props: { state: WorkbenchState }): ReactNode {
  const state = props.state
  const t = useStrings()
  const subscribeLayout = useCallback((listener: () => void) => state.subscribe(listener), [state])
  const readLayout = useCallback(() => state.getSnapshot(), [state])
  const snapshot = useSyncExternalStore(subscribeLayout, readLayout)

  useEffect(() => installWorkbenchStyles(), [])

  // Switching to a session in another workspace gets a clean slate: the dock
  // tucks itself away and reopens rooted at the new workspace.
  const { workspace } = useWorkspace()
  const previousWorkspace = useRef(workspace)
  useEffect(() => {
    const previous = previousWorkspace.current
    previousWorkspace.current = workspace
    if (previous !== undefined && workspace !== undefined && previous !== workspace) state.collapse()
  }, [workspace, state])

  useEffect(() => {
    // Persist only after hydration so a slow prefs fetch cannot be clobbered
    // by freshly-mounted defaults.
    if (!isDesktopPrefsHydrated()) return
    schedulePersistDesktopPrefs()
  }, [snapshot])

  return (
    <aside className="hxpWb" data-open={snapshot.open || undefined}>
      <div className="hxpWbSlide">
        <div className="hxpWbRail">
          {WORKBENCH_PANEL_IDS.map(id => (
            <button
              key={id}
              type="button"
              className="hxpWbRailButton"
              data-active={(snapshot.open && snapshot.active === id) || undefined}
              title={t[id]}
              aria-label={t[id]}
              onClick={() => { state.openPanel(id) }}
            >
              {PanelIcons[id]}
              <span className="hxpWbRailLabel">{t[id]}</span>
            </button>
          ))}
          <div className="hxpWbSpring" />
          <button
            type="button"
            className="hxpWbRailButton"
            title={t.collapse}
            aria-label={t.collapse}
            onClick={() => { state.toggle() }}
          >
            {ChevronRightIcon}
          </button>
        </div>
        {snapshot.tabs.length > 0 && <TabStrip snapshot={snapshot} state={state} />}
        {snapshot.tabs.length > 0 && snapshot.active !== null && (
          // Re-mount the active panel on workspace change so every panel
          // re-roots at the new workspace instead of keeping stale state.
          <div className="hxpWbBody" key={workspace ?? ''}>{renderPanel(snapshot.active, snapshot.browserHome, workspace, state)}</div>
        )}
        <ResizeGrip snapshot={snapshot} state={state} />
      </div>
    </aside>
  )
}

/** Browser-style tab strip: every open panel is a tab; clicking activates it. */
function TabStrip(props: { snapshot: WorkbenchSnapshot; state: WorkbenchState }): ReactNode {
  const { snapshot, state } = props
  const t = useStrings()
  return (
    <div className="hxpWbTabs" role="tablist">
      {snapshot.tabs.map(id => (
        <div
          key={id}
          className="hxpWbTab"
          role="tab"
          tabIndex={0}
          aria-selected={snapshot.active === id}
          data-active={snapshot.active === id || undefined}
          onClick={() => { state.setActive(id) }}
          onKeyDown={event => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault()
              state.setActive(id)
            }
          }}
        >
          <span className="hxpWbTabIcon">{PanelIcons[id]}</span>
          <span className="hxpWbTabText">{t[id]}</span>
          <button
            type="button"
            className="hxpWbTabClose"
            title={t.close}
            aria-label={`${t.close}: ${t[id]}`}
            onClick={event => {
              event.stopPropagation()
              state.closeTab(id)
            }}
          >
            {CloseIcon}
          </button>
        </div>
      ))}
    </div>
  )
}

/** Horizontal drag handle; reports movement deltas while the pointer is captured. */
function HDivider(props: { label: string; onResize: (deltaY: number) => void }): ReactNode {
  const origin = useRef(0)
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    origin.current = event.clientY
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const delta = event.clientY - origin.current
    if (delta === 0) return
    origin.current = event.clientY
    props.onResize(delta)
  }, [props])
  return (
    <div
      className="hxpWbDivider"
      role="separator"
      aria-orientation="horizontal"
      title={props.label}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
    />
  )
}

function renderPanel(active: WorkbenchPanelId, browserHome: string | undefined, workspace: string | undefined, state: WorkbenchState): ReactNode {
  if (active === 'explorer') return <ExplorerPanel state={state} />
  if (active === 'terminal') return <TerminalPanel state={state} />
  if (active === 'git') return <GitPanel state={state} />
  if (active === 'chat') return <AuxChatPanel />
  return <BrowserPanel home={browserHome} workspace={workspace} />
}

function ResizeGrip(props: { snapshot: WorkbenchSnapshot; state: WorkbenchState }): ReactNode {
  const origin = useRef(0)
  const base = useRef(0)
  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    origin.current = event.clientX
    base.current = props.snapshot.width
    event.currentTarget.setPointerCapture(event.pointerId)
  }, [props.snapshot.width])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    const delta = origin.current - event.clientX
    const next = Math.min(WORKBENCH_WIDTH_MAX, Math.max(WORKBENCH_WIDTH_MIN, base.current + delta))
    props.state.setWidth(next)
  }, [props])
  return <div className="hxpWbResize" onPointerDown={onPointerDown} onPointerMove={onPointerMove} />
}

/* ------------------------------------------------------------------ */
/* Explorer panel                                                      */
/* ------------------------------------------------------------------ */

let explorerCwd: string | undefined

const EXPLORER_PREVIEW_DEFAULT = 200

function ExplorerPanel(props: { state: WorkbenchState }): ReactNode {
  const { state } = props
  const t = useStrings()
  const { workspace } = useWorkspace()
  const [cwd, setCwd] = useState(explorerCwd)
  const [entries, setEntries] = useState<FsEntry[] | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [git, setGit] = useState<WorkspaceGit | undefined>()
  const [previewPath, setPreviewPath] = useState<string | undefined>()
  const [preview, setPreview] = useState<PreviewResponse['preview'] | undefined>()
  const subscribeLayout = useCallback((listener: () => void) => state.subscribe(listener), [state])
  const readLayout = useCallback(() => state.getSnapshot(), [state])
  const layout = useSyncExternalStore(subscribeLayout, readLayout)
  const previewHeight = layout.sizes.explorer ?? EXPLORER_PREVIEW_DEFAULT
  const previewHeightRef = useRef(previewHeight)
  previewHeightRef.current = previewHeight

  const load = useCallback(async (dir: string | undefined) => {
    if (dir === undefined) {
      try {
        const meta = await requestJson<{ home: string }>('/api/desktop/workbench/meta')
        explorerCwd = meta.home
        setCwd(meta.home)
        return
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause))
        return
      }
    }
    try {
      const value = await requestJson<{ entries: FsEntry[] }>(`/api/desktop/workbench/fs?path=${encodeURIComponent(dir)}`)
      explorerCwd = dir
      setError(undefined)
      setEntries(value.entries)
    } catch (cause) {
      setEntries([])
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }, [])

  useEffect(() => { void load(cwd) }, [cwd, load])

  useEffect(() => {
    if (workspace === undefined) return
    // Default to the workspace root; a directory from another project snaps back.
    if (explorerCwd === undefined || !isWithin(explorerCwd, workspace)) {
      explorerCwd = workspace
      setCwd(workspace)
    }
    let cancelled = false
    void fetchWorkspaceGit(workspace).then(value => {
      if (!cancelled) setGit(value)
    })
    return () => { cancelled = true }
  }, [workspace])

  const openFile = useCallback(async (file: string) => {
    setPreviewPath(file)
    setPreview(undefined)
    try {
      const value = await requestJson<PreviewResponse>(`/api/desktop/workbench/file?path=${encodeURIComponent(file)}`)
      setPreview(value.preview)
    } catch (cause) {
      setPreview({ text: cause instanceof Error ? cause.message : String(cause), truncated: false, binary: false })
    }
  }, [])

  const segments = cwd !== undefined ? pathSegments(cwd) : []

  return (
    <div className="hxpWbPanel hxpWbExplorer">
      <div className="hxpWbToolbar">
        <button type="button" className="hxpWbToolButton" title={t.parentDirectory} aria-label={t.parentDirectory}
          disabled={cwd === undefined} onClick={() => { if (cwd !== undefined) setCwd(dirnameOf(cwd)) }}>
          {ArrowUpIcon}
        </button>
        <button type="button" className="hxpWbToolButton" title={t.workspaceRoot} aria-label={t.workspaceRoot}
          disabled={workspace === undefined} onClick={() => { if (workspace !== undefined) setCwd(workspace) }}>
          {HomeIcon}
        </button>
        <button type="button" className="hxpWbToolButton" title={t.refresh} aria-label={t.refresh}
          disabled={cwd === undefined} onClick={() => { if (cwd !== undefined) void load(cwd) }}>
          {RefreshIcon}
        </button>
        <button type="button" className="hxpWbToolButton" title={t.explorerOpen} aria-label={t.explorerOpen}
          disabled={workspace === undefined}
          onClick={() => {
            if (workspace === undefined) return
            workbenchApi?.host.openPath({ path: workspace }).catch(() => undefined)
          }}>
          {FolderOpenIcon}
        </button>
      </div>
      <div className="hxpWbBreadcrumb">
        {segments.map((segment, index) => (
          <span key={segment.path} className="hxpWbCrumbRow">
            {index > 0 && <span className="hxpWbCrumbSep">/</span>}
            <button type="button" className="hxpWbCrumb" onClick={() => { setCwd(segment.path) }}>{segment.label}</button>
          </span>
        ))}
      </div>
      {error !== undefined && <div className="hxpWbNotice">{error}</div>}
      <div className="hxpWbFileList">
        {entries?.map(entry => {
          const decorated = cwd !== undefined && workspace !== undefined && isWithin(cwd, workspace)
          const relPath = decorated ? relativePosix(workspace, cwd, entry.name) : undefined
          const kind = relPath !== undefined ? git?.kinds.get(relPath) : undefined
          const count = relPath !== undefined ? git?.counts.get(relPath) : undefined
          return (
            <button
              key={entry.name}
              type="button"
              className="hxpWbFileRow"
              data-kind={entry.kind}
              title={kind !== undefined ? `${kind}: ${relPath ?? entry.name}` : undefined}
              onClick={() => {
                if (cwd === undefined) return
                const child = `${cwd}${cwd.endsWith('\\') || cwd.endsWith('/') ? '' : (cwd.includes('\\') ? '\\' : '/')}${entry.name}`
                if (entry.kind === 'directory') setCwd(child)
                else void openFile(child)
              }}
            >
              <span className="hxpWbFileIcon">{entry.kind === 'directory' ? FolderIcon : undefined}</span>
              <span className="hxpWbFileName" data-git={kind}>{entry.name}</span>
              {count !== undefined && (count.additions > 0 || count.deletions > 0)
                ? (
                  <span className="hxpWbGitCounts">
                    {count.additions > 0 && <span className="hxpWbAdd">+{String(count.additions)}</span>}
                    {count.additions > 0 && count.deletions > 0 ? ' ' : undefined}
                    {count.deletions > 0 && <span className="hxpWbDel">−{String(count.deletions)}</span>}
                  </span>
                )
                : entry.kind === 'file'
                  ? <span className="hxpWbFileSize">{formatBytes(entry.size)}</span>
                  : undefined}
            </button>
          )
        })}
      </div>
      {previewPath !== undefined && (
        <>
          <HDivider
            label={t.dragResize}
            onResize={delta => { state.setPaneSize('explorer', previewHeightRef.current + delta) }}
          />
          <div className="hxpWbPreview" style={{ height: `${String(previewHeight)}px` }}>
            <div className="hxpWbPreviewTitle">{basename(previewPath)}</div>
            {preview === undefined
              ? undefined
              : preview.binary
                ? <div className="hxpWbNotice">{t.previewBinary}</div>
                : (
                  <pre className="hxpWbPreviewText">
                    {preview.text}
                    {preview.truncated && `\n${t.previewTruncated}`}
                  </pre>
                )}
          </div>
        </>
      )}
    </div>
  )
}

function dirnameOf(path: string): string {
  const separator = path.includes('\\') ? '\\' : '/'
  const trimmed = path.replace(/[\\/]+$/, '')
  const index = trimmed.lastIndexOf(separator)
  if (index <= 0) return trimmed
  return trimmed.slice(0, index)
}

/* ------------------------------------------------------------------ */
/* Terminal panel                                                      */
/* ------------------------------------------------------------------ */

interface TerminalCache {
  id: string | undefined
  exited: boolean
  transcript: string
  /** Working directory the cached session was started in. */
  cwd: string | undefined
}

const terminalCache: TerminalCache = { id: undefined, exited: false, transcript: '', cwd: undefined }

/**
 * Drop every dock panel's stale view state so they all re-root at `workspace`
 * when the user switches workspaces. Called synchronously on a workspace
 * change, before the panels re-render, so a remount reads fresh caches.
 * @param workspace - the workspace the dock should follow.
 */
function resetWorkbenchCaches(workspace: string): void {
  explorerCwd = workspace
  branchesCache = undefined
  browserUrl = undefined
  if (terminalCache.id !== undefined && !terminalCache.exited) {
    // Retire the shell bound to the previous workspace.
    void postJson('/api/desktop/workbench/term/kill', { id: terminalCache.id }).catch(() => undefined)
  }
  terminalCache.id = undefined
  terminalCache.exited = false
  terminalCache.transcript = ''
  terminalCache.cwd = undefined
}

/** Session the main window currently shows; the workspace follows it. */
let activeSessionId: string | undefined

/** Working directory of the current session, straight from the session store. */
let activeSessionCwd: string | undefined

const activeCwdListeners = new Set<() => void>()

/** Note which session the main window is showing so dock panels follow it. @param sessionId - current session id. */
export function noteWorkbenchSession(sessionId: string | undefined): void {
  activeSessionId = sessionId
}

/**
 * Publish the current session's working directory. This client-side value is
 * the primary workspace source — it flips the instant the user switches
 * conversations, with no host round-trip.
 * @param cwd - the current session's directory, when known.
 */
export function noteWorkbenchSessionCwd(cwd: string | undefined): void {
  if (cwd === activeSessionCwd) return
  activeSessionCwd = cwd
  // Re-root every dock panel at the new session directory.
  if (cwd !== undefined) resetWorkbenchCaches(cwd)
  for (const listener of [...activeCwdListeners]) listener()
}

/**
 * Hook resolving the workspace root the dock should follow: the current
 * session's own directory when the store knows it, else a polled host route
 * (registry row owning the session, first row as the last fallback).
 */
function useWorkspace(): { workspace: string | undefined; ready: boolean } {
  const [hostWorkspace, setHostWorkspace] = useState(workspaceCache)
  const [ready, setReady] = useState(false)
  const subscribeCwd = useCallback((listener: () => void) => {
    activeCwdListeners.add(listener)
    return () => { activeCwdListeners.delete(listener) }
  }, [])
  const sessionCwd = useSyncExternalStore(subscribeCwd, () => activeSessionCwd)
  useEffect(() => {
    let cancelled = false
    const tick = async (): Promise<void> => {
      try {
        const suffix = activeSessionId !== undefined ? `?sessionId=${encodeURIComponent(activeSessionId)}` : ''
        const value = await requestJson<{ path?: string | undefined }>(`/api/desktop/workbench/workspace${suffix}`)
        if (cancelled) return
        const next = typeof value.path === 'string' && value.path.length > 0 ? value.path : undefined
        workspaceCache = next
        // When the client store has no cwd, the host route is the workspace
        // source; re-root the panels if it resolved somewhere new.
        if (next !== hostWorkspace && activeSessionCwd === undefined && next !== undefined) {
          resetWorkbenchCaches(next)
        }
        setHostWorkspace(next)
      } catch {
        // Keep the previous value; the route may be briefly unavailable.
      }
      if (!cancelled) setReady(true)
    }
    void tick()
    const timer = setInterval(() => { void tick() }, 3000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])
  return { workspace: sessionCwd ?? hostWorkspace, ready }
}

const TERMINAL_INPUT_DEFAULT = 46

function TerminalPanel(props: { state: WorkbenchState }): ReactNode {
  const { state } = props
  const t = useStrings()
  const { workspace, ready } = useWorkspace()
  const [transcript, setTranscript] = useState(terminalCache.transcript)
  const [input, setInput] = useState('')
  const [exited, setExited] = useState(terminalCache.exited)
  const [epoch, setEpoch] = useState(0)
  const latestRef = useRef(0)
  const preRef = useRef<HTMLPreElement>(null)
  const subscribeLayout = useCallback((listener: () => void) => state.subscribe(listener), [state])
  const readLayout = useCallback(() => state.getSnapshot(), [state])
  const layout = useSyncExternalStore(subscribeLayout, readLayout)
  const inputHeight = layout.sizes.terminal ?? TERMINAL_INPUT_DEFAULT
  const inputHeightRef = useRef(inputHeight)
  inputHeightRef.current = inputHeight

  useEffect(() => {
    let cancelled = false
    if (!ready) return () => { cancelled = true }
    const run = async (): Promise<void> => {
      if (terminalCache.id !== undefined && !terminalCache.exited && terminalCache.cwd !== workspace) {
        // The host switched workspaces; retire the shell bound to the old one.
        void postJson('/api/desktop/workbench/term/kill', { id: terminalCache.id }).catch(() => undefined)
        terminalCache.id = undefined
      }
      if (terminalCache.id === undefined || terminalCache.exited) {
        try {
          const session = await postJson<{ id: string }>('/api/desktop/workbench/term/start', {
            ...(workspace !== undefined ? { cwd: workspace } : {}),
          })
          if (cancelled) return
          terminalCache.id = session.id
          terminalCache.exited = false
          terminalCache.transcript = ''
          terminalCache.cwd = workspace
          latestRef.current = 0
          setTranscript('')
        } catch {
          return
        }
      }
      while (!cancelled) {
        const id = terminalCache.id
        if (id === undefined || terminalCache.exited) return
        try {
          const output = await requestJson<{ chunks: Array<{ seq: number; text: string }>; latest: number; exited: boolean }>(
            `/api/desktop/workbench/term/output?id=${encodeURIComponent(id)}&after=${String(latestRef.current)}`,
          )
          if (cancelled) return
          if (output.chunks.length > 0) {
            const appended = output.chunks.map(chunk => chunk.text).join('')
            terminalCache.transcript += appended
            latestRef.current = output.latest
            setTranscript(terminalCache.transcript)
          }
          if (output.exited) {
            terminalCache.exited = true
            setExited(true)
            return
          }
        } catch {
          // Transient route failures retry on the next tick.
        }
        await wait(400)
      }
    }
    void run()
    return () => { cancelled = true }
  }, [workspace, ready, epoch])

  useEffect(() => {
    const element = preRef.current
    if (element !== null) element.scrollTop = element.scrollHeight
  }, [transcript])

  const send = useCallback((line: string) => {
    const id = terminalCache.id
    if (id === undefined || terminalCache.exited) return
    void postJson('/api/desktop/workbench/term/write', { id, data: line }).catch(() => undefined)
  }, [])

  const restart = useCallback(() => {
    const stale = terminalCache.id
    if (stale !== undefined) void postJson('/api/desktop/workbench/term/kill', { id: stale }).catch(() => undefined)
    terminalCache.id = undefined
    terminalCache.exited = false
    terminalCache.transcript = ''
    terminalCache.cwd = undefined
    latestRef.current = 0
    setTranscript('')
    setExited(false)
    setEpoch(epoch + 1)
  }, [epoch])

  const submitCurrent = (): void => {
    if (input.trim().length === 0) return
    send(input)
    setInput('')
  }

  return (
    <div className="hxpWbPanel hxpWbTerminal">
      <div className="hxpWbToolbar">
        <button type="button" className="hxpWbToolButton" title={t.terminalRestart} aria-label={t.terminalRestart} onClick={restart}>
          {RefreshIcon}
        </button>
        {exited && <span className="hxpWbNotice">exit</span>}
      </div>
      <pre ref={preRef} className="hxpWbTermOutput">{transcript}</pre>
      <HDivider
        label={t.dragResize}
        onResize={delta => { state.setPaneSize('terminal', inputHeightRef.current + delta) }}
      />
      <form
        className="hxpWbTermForm"
        style={{ height: `${String(inputHeight)}px` }}
        onSubmit={event => {
          event.preventDefault()
          submitCurrent()
        }}
      >
        <textarea
          className="hxpWbTermInput"
          value={input}
          placeholder={t.terminalPlaceholder}
          onChange={event => { setInput(event.target.value) }}
          onKeyDown={event => {
            // Enter runs the command; Shift+Enter inserts a newline.
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault()
              submitCurrent()
            }
          }}
          spellCheck={false}
        />
      </form>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Git panel                                                           */
/* ------------------------------------------------------------------ */

interface GitBranchEntry { name: string; current: boolean }

let branchesCache: GitBranchEntry[] | undefined

const GIT_LOWER_DEFAULT = 260

function GitPanel(props: { state: WorkbenchState }): ReactNode {
  const { state } = props
  const t = useStrings()
  const { workspace, ready } = useWorkspace()
  const [status, setStatus] = useState<StatusResponse | undefined>()
  const [log, setLog] = useState<LogResponse['entries']>([])
  const [diff, setDiff] = useState<DiffResponse['total'] | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [message, setMessage] = useState('')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | undefined>()
  const [branches, setBranches] = useState<GitBranchEntry[] | undefined>(branchesCache)
  const [showBranches, setShowBranches] = useState(false)
  const [newBranch, setNewBranch] = useState('')
  const [stashes, setStashes] = useState(0)
  const subscribeLayout = useCallback((listener: () => void) => state.subscribe(listener), [state])
  const readLayout = useCallback(() => state.getSnapshot(), [state])
  const layout = useSyncExternalStore(subscribeLayout, readLayout)
  const lowerHeight = layout.sizes.git ?? GIT_LOWER_DEFAULT
  const lowerHeightRef = useRef(lowerHeight)
  lowerHeightRef.current = lowerHeight

  const reload = useCallback(async () => {
    if (!ready) return
    if (workspace === undefined) {
      setStatus({ entries: [] })
      setError(undefined)
      return
    }
    const query = `path=${encodeURIComponent(workspace)}`
    const [statusResult, logResult, diffResult] = await Promise.allSettled([
      requestJson<StatusResponse>(`/api/desktop/workbench/git/status?${query}`),
      requestJson<LogResponse>(`/api/desktop/workbench/git/log?${query}`),
      requestJson<DiffResponse>(`/api/desktop/workbench/git/diff?${query}`),
    ])
    if (statusResult.status === 'rejected') {
      setError(statusResult.reason instanceof Error ? statusResult.reason.message : String(statusResult.reason))
      setStatus(undefined)
      return
    }
    setError(undefined)
    setStatus(statusResult.value)
    setLog(logResult.status === 'fulfilled' ? logResult.value.entries : [])
    setDiff(diffResult.status === 'fulfilled' ? diffResult.value.total : undefined)
  }, [workspace, ready])

  useEffect(() => { void reload() }, [reload])

  const mutate = useCallback(async (action: 'stage' | 'unstage', paths: string[]) => {
    if (workspace === undefined) return
    setBusy(true)
    setNotice(undefined)
    try {
      await postJson(`/api/desktop/workbench/git/${action}`, { cwd: workspace, paths })
      await reload()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [workspace, reload])

  const commit = useCallback(async () => {
    if (workspace === undefined || message.trim().length === 0) return
    setBusy(true)
    setNotice(undefined)
    try {
      await postJson('/api/desktop/workbench/git/commit', { cwd: workspace, message: message.trim() })
      setMessage('')
      await reload()
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [workspace, message, reload])

  const loadBranches = useCallback(async () => {
    if (workspace === undefined) return
    try {
      const value = await requestJson<{ branches: GitBranchEntry[] }>(
        `/api/desktop/workbench/git/branches?path=${encodeURIComponent(workspace)}`,
      )
      branchesCache = value.branches
      setBranches(value.branches)
    } catch {
      // Keep whatever list we already have.
    }
  }, [workspace])

  const loadStashes = useCallback(async () => {
    if (workspace === undefined) return
    try {
      const value = await requestJson<{ entries: unknown[] }>(
        `/api/desktop/workbench/git/stash/list?path=${encodeURIComponent(workspace)}`,
      )
      setStashes(value.entries.length)
    } catch {
      // Stash visibility is best-effort.
    }
  }, [workspace])

  useEffect(() => { void loadStashes() }, [loadStashes])

  /** Run a git network/checkout mutation, surface the outcome as a notice, refresh. */
  const runAction = useCallback(async (okNotice: string | undefined, run: () => Promise<void>) => {
    if (workspace === undefined) return
    setBusy(true)
    setNotice(undefined)
    try {
      await run()
      await reload()
      await loadStashes()
      if (okNotice !== undefined) setNotice(okNotice)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [workspace, reload, loadStashes])

  /** Discard worktree edits of tracked files after an explicit confirmation. */
  const discardPaths = useCallback((paths: string[]) => {
    if (workspace === undefined || paths.length === 0) return
    if (!window.confirm(t.confirmDiscard(paths.length))) return
    void runAction(undefined, () => postJson('/api/desktop/workbench/git/discard', { cwd: workspace, paths }))
  }, [workspace, t, runAction])

  const switchBranch = useCallback((name: string, create: boolean) => {
    void runAction(undefined, async () => {
      await postJson('/api/desktop/workbench/git/checkout', create
        ? { cwd: workspace, branch: name, create: true }
        : { cwd: workspace, branch: name })
      setShowBranches(false)
      setNewBranch('')
    })
  }, [runAction, workspace])

  if (status === undefined) {
    return (
      <div className="hxpWbPanel">
        {error !== undefined
          ? <div className="hxpWbNotice">{error.includes('not a') ? t.gitNotRepository : error}</div>
          : <div className="hxpWbNotice">…</div>}
      </div>
    )
  }

  const staged = status.entries.filter(entry => entry.x !== ' ' && entry.x !== '?')
  // Any worktree-side change (including untracked "??" rows) counts here.
  const changed = status.entries.filter(entry => entry.y !== ' ')
  // Untracked files cannot be restored via checkout, so discard only touches these.
  const discardable = changed.filter(entry => entry.x !== '?').map(entry => entry.path)

  return (
    <div className="hxpWbPanel hxpWbGit">
      <div className="hxpWbToolbar">
        <button
          type="button"
          className="hxpWbToolButton hxpWbToolText hxpWbBranch"
          title={t.gitBranches}
          disabled={busy || workspace === undefined}
          onClick={() => {
            const next = !showBranches
            setShowBranches(next)
            if (next) void loadBranches()
          }}
        >
          {status.branch ?? t.gitBranches} ▾
        </button>
        {(status.ahead !== undefined || status.behind !== undefined)
          && <span className="hxpWbAhead">↑{String(status.ahead ?? 0)} ↓{String(status.behind ?? 0)}</span>}
        <div className="hxpWbSpring" />
        <button type="button" className="hxpWbToolButton hxpWbToolText" disabled={busy || workspace === undefined}
          title={t.fetchOk}
          onClick={() => { void runAction(t.fetchOk, () => postJson('/api/desktop/workbench/git/fetch', { cwd: workspace })) }}>
          {t.fetchLabel}
        </button>
        <button type="button" className="hxpWbToolButton hxpWbToolText" disabled={busy || workspace === undefined}
          onClick={() => { void runAction(t.pullOk, () => postJson('/api/desktop/workbench/git/pull', { cwd: workspace })) }}>
          {t.pull}
        </button>
        <button type="button" className="hxpWbToolButton hxpWbToolText" disabled={busy || workspace === undefined}
          onClick={() => { void runAction(t.pushOk, () => postJson('/api/desktop/workbench/git/push', { cwd: workspace })) }}>
          {t.push}
        </button>
        <button type="button" className="hxpWbToolButton hxpWbToolText" disabled={busy || workspace === undefined || changed.length === 0}
          title={t.stashSave}
          onClick={() => { void runAction(t.stashOk, () => postJson('/api/desktop/workbench/git/stash', { cwd: workspace })) }}>
          {t.stashSave}
        </button>
        <button type="button" className="hxpWbToolButton hxpWbToolText" disabled={busy || workspace === undefined || stashes === 0}
          title={t.unstashOk}
          onClick={() => { void runAction(t.unstashOk, () => postJson('/api/desktop/workbench/git/stash/pop', { cwd: workspace })) }}>
          {t.stashRestore}
        </button>
        <button type="button" className="hxpWbToolButton" title={t.refresh} aria-label={t.refresh} onClick={() => { void reload() }}>
          {RefreshIcon}
        </button>
      </div>
      {notice !== undefined && <div className="hxpWbNotice">{notice}</div>}
      {showBranches && (
        <div className="hxpWbBranchMenu">
          <div className="hxpWbBranchList">
            {(branches ?? []).map(branch => (
              <div key={branch.name} className="hxpWbBranchRow" role="button" tabIndex={0}
                data-current={branch.current || undefined}
                onClick={() => { if (!busy && !branch.current) switchBranch(branch.name, false) }}
                onKeyDown={event => {
                  if ((event.key === 'Enter' || event.key === ' ') && !busy && !branch.current) {
                    event.preventDefault()
                    switchBranch(branch.name, false)
                  }
                }}>
                <span className="hxpWbRailLabel">{branch.name}</span>
                {branch.current && <span className="hxpWbBranchMark">✓</span>}
                {!branch.current && (
                  <button type="button" className="hxpWbBranchDelete" title={`${t.deleteBranch}: ${branch.name}`}
                    aria-label={`${t.deleteBranch}: ${branch.name}`}
                    disabled={busy}
                    onClick={event => {
                      event.stopPropagation()
                      void runAction(undefined, async () => {
                        await postJson('/api/desktop/workbench/git/branch/delete', { cwd: workspace, branch: branch.name })
                        await loadBranches()
                      })
                    }}>
                    ✕
                  </button>
                )}
              </div>
            ))}
          </div>
          <form
            className="hxpWbBranchForm"
            onSubmit={event => {
              event.preventDefault()
              const name = newBranch.trim()
              if (name.length > 0) switchBranch(name, true)
            }}
          >
            <input className="hxpWbBranchInput" value={newBranch} placeholder={t.newBranch}
              spellCheck={false} onChange={event => { setNewBranch(event.target.value) }} />
            <button type="submit" className="hxpWbBranchCreate" disabled={busy || newBranch.trim().length === 0}>
              {t.createBranch}
            </button>
          </form>
        </div>
      )}
      {diff !== undefined && diff.files > 0 && (
        <div className="hxpWbDiffLine">{t.diffSummary(diff.files, diff.additions, diff.deletions)}</div>
      )}
      <SectionTitle label={t.gitStaged} count={staged.length} />
      <div className="hxpWbFileList">
        {staged.map(entry => (
          <GitRow key={`s-${entry.path}`} entry={entry} action="unstage" actionLabel={t.unstage}
            disabled={busy} onAction={() => { void mutate('unstage', [entry.path]) }} />
        ))}
      </div>
      <SectionTitle label={t.gitChanges} count={changed.length}>
        <button type="button" className="hxpWbLinkAction" disabled={busy}
          onClick={() => { void mutate('stage', changed.map(entry => entry.path)) }}>
          {t.stageAll}
        </button>
        {discardable.length > 0 && (
          <button type="button" className="hxpWbLinkAction hxpWbDanger" disabled={busy}
            onClick={() => { discardPaths(discardable) }}>
            {t.discardAll}
          </button>
        )}
      </SectionTitle>
      <div className="hxpWbFileList">
        {changed.map(entry => (
          <GitRow key={`w-${entry.path}`} entry={entry} action="stage" actionLabel={t.stage}
            disabled={busy} onAction={() => { void mutate('stage', [entry.path]) }}
            discardLabel={t.discard} confirmText={t.confirmDiscard(1)}
            onDiscard={entry.x !== '?' ? () => { discardPaths([entry.path]) } : undefined} />
        ))}
      </div>
      <HDivider
        label={t.dragResize}
        onResize={delta => { state.setPaneSize('git', lowerHeightRef.current + delta) }}
      />
      <div className="hxpWbGitLower" style={{ height: `${String(lowerHeight)}px` }}>
        <form
          className="hxpWbCommitForm"
          onSubmit={event => {
            event.preventDefault()
            void commit()
          }}
        >
          <textarea
            className="hxpWbCommitMessage"
            value={message}
            placeholder={t.commitPlaceholder}
            rows={2}
            onChange={event => { setMessage(event.target.value) }}
          />
          <button type="submit" className="hxpWbCommitButton" disabled={busy || message.trim().length === 0 || staged.length === 0}>
            {t.commit}
          </button>
        </form>
        <SectionTitle label={t.gitHistory} count={log.length} />
        <div className="hxpWbLogList">
          {log.map(entry => (
            <div key={entry.abbrev} className="hxpWbLogRow" title={`${entry.author} · ${new Date(entry.time * 1000).toLocaleString()}`}>
              <code className="hxpWbLogHash">{entry.abbrev}</code>
              <span className="hxpWbLogSubject">{entry.subject}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function SectionTitle(props: { label: string; count: number; children?: ReactNode }): ReactNode {
  if (props.count === 0) return undefined
  return (
    <div className="hxpWbSectionTitle">
      {props.label} ({String(props.count)})
      {props.children !== undefined && <span className="hxpWbSectionActions">{props.children}</span>}
    </div>
  )
}

function GitRow(props: {
  entry: StatusResponse['entries'][number]
  action: 'stage' | 'unstage'
  actionLabel: string
  disabled: boolean
  onAction: () => void
  discardLabel?: string
  confirmText?: string
  onDiscard?: (() => void) | undefined
}): ReactNode {
  const { entry } = props
  const badge = entry.x === '?' && entry.y === '?' ? '??' : `${entry.x}${entry.y}`.trim()
  return (
    <div className="hxpWbGitRow" title={entry.path}>
      <span className="hxpWbGitBadge" data-badge={badge}>{badge}</span>
      <span className="hxpWbFileName">{basename(entry.path)}</span>
      {entry.origPath !== undefined && <span className="hxpWbFileSize">← {basename(entry.origPath)}</span>}
      <button type="button" className="hxpWbGitAction" disabled={props.disabled} onClick={props.onAction}>
        {props.actionLabel}
      </button>
      {props.onDiscard !== undefined && props.discardLabel !== undefined && (
        <button type="button" className="hxpWbGitAction hxpWbDanger" title={props.confirmText ?? ''} disabled={props.disabled}
          onClick={() => {
            if (window.confirm(props.confirmText ?? '')) props.onDiscard?.()
          }}>
          {props.discardLabel}
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Browser panel                                                       */
/* ------------------------------------------------------------------ */

const DEFAULT_BROWSER_HOME = 'https://www.bing.com'

interface WebviewElement extends HTMLElement {
  goBack(): void
  goForward(): void
  reload(): void
  canGoBack(): boolean
  canGoForward(): boolean
}

let browserUrl: string | undefined

function BrowserPanel(props: { home: string | undefined; workspace: string | undefined }): ReactNode {
  const { home, workspace } = props
  const t = useStrings()
  const [url, setUrl] = useState(browserUrl ?? home ?? DEFAULT_BROWSER_HOME)
  const [input, setInput] = useState(browserUrl ?? home ?? DEFAULT_BROWSER_HOME)
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState<string | undefined>()
  const viewRef = useRef<WebviewElement>(null)

  // Re-root the browser at its home page whenever the workspace switches.
  useEffect(() => {
    const target = home ?? DEFAULT_BROWSER_HOME
    setUrl(target)
    setInput(target)
    setTitle('')
    setFailed(undefined)
    browserUrl = undefined
  }, [workspace, home])

  const navigate = useCallback((raw: string) => {
    const trimmed = raw.trim()
    if (trimmed.length === 0) return
    const target = /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
      ? trimmed
      : (trimmed.includes('.') && !trimmed.includes(' ')
          ? `https://${trimmed}`
          : `https://www.bing.com/search?q=${encodeURIComponent(trimmed)}`)
    browserUrl = target
    setFailed(undefined)
    setUrl(target)
    setInput(target)
  }, [])

  useEffect(() => {
    const element = viewRef.current
    if (element === null) return
    const onTitle = (event: Event): void => {
      const custom = event as CustomEvent<string>
      setTitle(typeof custom.detail === 'string' ? custom.detail : '')
    }
    const onStart = (): void => { setLoading(true) }
    const onStop = (): void => { setLoading(false) }
    const onFail = (event: Event): void => {
      const custom = event as CustomEvent<{ errorCode: number; errorDescription?: string; isMainFrame?: boolean }>
      if (custom.detail?.isMainFrame === false) return
      // -3 is an aborted/superseded navigation, not a real failure.
      if (custom.detail !== null && custom.detail.errorCode === -3) return
      setLoading(false)
      setFailed(custom.detail?.errorDescription || 'load failed')
    }
    element.addEventListener('page-title-updated', onTitle)
    element.addEventListener('did-start-loading', onStart)
    element.addEventListener('did-stop-loading', onStop)
    element.addEventListener('did-fail-load', onFail)
    return () => {
      element.removeEventListener('page-title-updated', onTitle)
      element.removeEventListener('did-start-loading', onStart)
      element.removeEventListener('did-stop-loading', onStop)
      element.removeEventListener('did-fail-load', onFail)
    }
  }, [url])

  return (
    <div className="hxpWbPanel hxpWbBrowser">
      <div className="hxpWbToolbar">
        <button type="button" className="hxpWbToolButton" title={t.browserBack} aria-label={t.browserBack}
          onClick={() => { viewRef.current?.goBack() }}>
          {ArrowLeftIcon}
        </button>
        <button type="button" className="hxpWbToolButton" title={t.browserForward} aria-label={t.browserForward}
          onClick={() => { viewRef.current?.goForward() }}>
          {ArrowRightIcon}
        </button>
        <button type="button" className="hxpWbToolButton" title={t.browserReload} aria-label={t.browserReload}
          onClick={() => { viewRef.current?.reload() }}>
          {RefreshIcon}
        </button>
        <button type="button" className="hxpWbToolButton" title={t.browserHome} aria-label={t.browserHome}
          onClick={() => { navigate(home ?? DEFAULT_BROWSER_HOME) }}>
          {HomeIcon}
        </button>
        <form
          className="hxpWbUrlForm"
          onSubmit={event => {
            event.preventDefault()
            navigate(input)
          }}
        >
          <input className="hxpWbUrlInput" value={input} placeholder={t.browserPlaceholder}
            spellCheck={false}
            onChange={event => { setInput(event.target.value) }} />
        </form>
      </div>
      {title.length > 0 && <div className="hxpWbPageTitle">{title}</div>}
      {loading && <div className="hxpWbLoading" />}
      {failed !== undefined && <div className="hxpWbBrowserError">{failed}</div>}
      <webview
        ref={viewRef}
        className="hxpWbWebView"
        src={url}
        partition="persist:harnessx-workbench"
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Auxiliary chat panel                                                */
/* ------------------------------------------------------------------ */

/** Wire face the auxiliary chat needs from the shared connection API client. */
export interface WorkbenchWireApi {
  sessions: {
    create(payload: { cwd?: string }): Promise<{ result: { sessionId: string } }>
    prompt(payload: {
      sessionId: string
      mode: 'queue' | 'steer'
      content: Array<{ type: 'text'; text: string }>
      clientTimeZone?: string
    }): Promise<{ result: unknown }>
    history(payload: { sessionId: string }): Promise<{
      result: { events: Array<Record<string, unknown>>; hasMore: boolean }
    }>
  }
  host: {
    openPath(payload: { path: string }): Promise<{ result: { opened: true } }>
  }
}

let workbenchApi: WorkbenchWireApi | undefined

/** Capture the shared API client so the dock can drive real sessions. @param api - connection API face. */
export function setWorkbenchApiClient(api: WorkbenchWireApi | undefined): void {
  workbenchApi = api
}

class AuxChatStore {
  private readonly listeners = new Set<() => void>()
  private version = 0
  private nextIndex = 1
  private creating = false

  readonly conversations: AuxConversation[] = []
  activeIndex = -1
  createError: string | undefined

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  getSnapshot = (): number => this.version

  get active(): AuxConversation | undefined {
    return this.conversations[this.activeIndex]
  }

  private emit(): void {
    this.version += 1
    for (const listener of [...this.listeners]) listener()
  }

  busy(conversation: AuxConversation): boolean {
    return conversation.pendingText !== undefined
      || conversation.streamingText !== undefined
      || conversation.awaitingReply
  }

  /** Open a fresh upstream session and switch to it. */
  async create(cwd: string | undefined): Promise<void> {
    if (workbenchApi === undefined || this.creating) return
    this.creating = true
    try {
      const response = await workbenchApi.sessions.create(cwd === undefined ? {} : { cwd })
      const conversation: AuxConversation = {
        sessionId: response.result.sessionId,
        index: this.nextIndex,
        messages: [],
        pendingText: undefined,
        streamingText: undefined,
        awaitingReply: false,
        error: undefined,
      }
      this.nextIndex += 1
      this.createError = undefined
      this.conversations.push(conversation)
      this.activeIndex = this.conversations.length - 1
      this.emit()
    } catch (cause) {
      this.createError = cause instanceof Error ? cause.message : String(cause)
      this.emit()
    } finally {
      this.creating = false
    }
  }

  setActive(index: number): void {
    if (index < 0 || index >= this.conversations.length || index === this.activeIndex) return
    this.activeIndex = index
    this.emit()
  }

  close(index: number): void {
    const victim = this.conversations[index]
    if (victim === undefined) return
    this.conversations.splice(index, 1)
    if (this.conversations.length === 0) {
      this.activeIndex = -1
    } else if (this.activeIndex > index) {
      this.activeIndex -= 1
    } else if (this.activeIndex >= this.conversations.length) {
      this.activeIndex = this.conversations.length - 1
    }
    this.emit()
  }

  /** Queue one user message on the active conversation's upstream session. */
  async send(text: string): Promise<void> {
    const conversation = this.active
    if (workbenchApi === undefined || conversation === undefined) return
    conversation.error = undefined
    conversation.pendingText = text
    this.emit()
    try {
      await workbenchApi.sessions.prompt({
        sessionId: conversation.sessionId,
        mode: 'queue',
        content: [{ type: 'text', text }],
        clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      })
      await this.refresh(conversation.sessionId)
    } catch (cause) {
      conversation.pendingText = undefined
      conversation.error = cause instanceof Error ? cause.message : String(cause)
      this.emit()
    }
  }

  /**
   * Pull the authoritative tail page for one conversation (the active one by
   * default). Transient poll failures stay silent; the next tick retries.
   */
  async refresh(sessionId?: string): Promise<void> {
    if (workbenchApi === undefined) return
    const target = sessionId === undefined
      ? this.active
      : this.conversations.find(entry => entry.sessionId === sessionId)
    if (target === undefined) return
    try {
      const response = await workbenchApi.sessions.history({ sessionId: target.sessionId })
      const folded = foldAuxHistory(response.result.events ?? [])
      // Drop the optimistic echo once history shows the real user message.
      if (target.pendingText !== undefined
        && folded.messages.some(entry => entry.role === 'user' && entry.text === target.pendingText)) {
        target.pendingText = undefined
      }
      target.messages = folded.messages
      target.streamingText = folded.streamingText
      target.awaitingReply = folded.awaitingReply
    } catch {
      return
    }
    this.emit()
  }
}

const auxChatStore = new AuxChatStore()

/**
 * Real auxiliary conversations: each tab is one live upstream session created
 * through the shared API client; sending queues a prompt and a poll loop folds
 * the history tail page into bubbles while the panel is open.
 */
function AuxChatPanel(): ReactNode {
  const t = useStrings()
  const store = auxChatStore
  const { workspace } = useWorkspace()
  const subscribe = useCallback((listener: () => void) => store.subscribe(listener), [store])
  const readVersion = useCallback(() => store.getSnapshot(), [store])
  useSyncExternalStore(subscribe, readVersion)
  const conversation = store.active
  const activeSessionId = conversation?.sessionId
  const [draft, setDraft] = useState('')
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickToBottom = useRef(true)

  const submit = useCallback(() => {
    const text = draft.trim()
    if (text.length === 0 || workbenchApi === undefined) return
    setDraft('')
    stickToBottom.current = true
    void store.send(text)
  }, [draft, store])

  useEffect(() => { void store.refresh() }, [store, activeSessionId])

  useEffect(() => {
    const timer = window.setInterval(() => { void store.refresh() }, 1000)
    return () => { window.clearInterval(timer) }
  }, [store])

  useEffect(() => {
    const node = scrollRef.current
    if (node !== null && stickToBottom.current) node.scrollTop = node.scrollHeight
  })

  const busy = conversation !== undefined && store.busy(conversation)
  const serviceReady = workbenchApi !== undefined

  return (
    <div className="hxpWbPanel hxpWbChat">
      <div className="hxpWbTabs" role="tablist">
        {store.conversations.map((entry, index) => (
          <div
            key={entry.sessionId}
            className="hxpWbTab"
            role="tab"
            tabIndex={0}
            aria-selected={index === store.activeIndex}
            data-active={index === store.activeIndex || undefined}
            onClick={() => { store.setActive(index) }}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                store.setActive(index)
              }
            }}
          >
            <span className="hxpWbTabText">{`${t.chat} ${String(entry.index)}`}</span>
            <button
              type="button"
              className="hxpWbTabClose"
              title={t.close}
              aria-label={`${t.close}: ${t.chat} ${String(entry.index)}`}
              onClick={event => {
                event.stopPropagation()
                store.close(index)
              }}
            >
              {CloseIcon}
            </button>
          </div>
        ))}
        <button
          type="button"
          className="hxpAuxAdd"
          title={t.auxNew}
          aria-label={t.auxNew}
          disabled={!serviceReady}
          onClick={() => { void store.create(workspace) }}
        >
          {PlusIcon}
        </button>
      </div>
      {!serviceReady && <div className="hxpWbNotice">{t.auxUnavailable}</div>}
      {serviceReady && conversation === undefined && (
        <div className="hxpAuxEmpty">
          {store.createError !== undefined && <div className="hxpWbBrowserError">{store.createError}</div>}
          <p>{t.auxEmpty}</p>
        </div>
      )}
      {serviceReady && conversation !== undefined && (
        <>
          <div
            ref={scrollRef}
            className="hxpAuxMessages"
            onScroll={() => {
              const node = scrollRef.current
              if (node === null) return
              stickToBottom.current = node.scrollHeight - node.scrollTop - node.clientHeight < 64
            }}
          >
            {conversation.messages.map(message => (
              <div key={message.id} className="hxpAuxMsg" data-role={message.role}>{message.text}</div>
            ))}
            {conversation.pendingText !== undefined && (
              <div className="hxpAuxMsg" data-role="user">{conversation.pendingText}</div>
            )}
            {conversation.streamingText !== undefined && (
              <div className="hxpAuxMsg" data-role="assistant">{conversation.streamingText}</div>
            )}
            {busy && <div className="hxpAuxThinking">{t.auxThinking}</div>}
            {conversation.error !== undefined && <div className="hxpWbBrowserError">{conversation.error}</div>}
          </div>
          <form
            className="hxpAuxForm"
            onSubmit={event => {
              event.preventDefault()
              submit()
            }}
          >
            <textarea
              className="hxpAuxInput"
              value={draft}
              placeholder={t.auxPlaceholder}
              rows={1}
              onChange={event => { setDraft(event.target.value) }}
              onKeyDown={event => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault()
                  submit()
                }
              }}
            />
            <button type="submit" className="hxpAuxSend" title={t.auxSend} aria-label={t.auxSend} disabled={!draft.trim()}>
              {SendIcon}
            </button>
          </form>
        </>
      )}
    </div>
  )
}
