/** Desktop workbench dock: right sidebar with rail icons, browser-style tabs, and panels.
 *
 * Desktop-owned advanced-shell presentation composed beside the unchanged
 * product surfaces. Panels reach the host exclusively through the authorized
 * `/api/desktop/workbench` routes; no kernel slot or service is replaced.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { MACOS_TITLEBAR_HEIGHT, WINDOWS_CAPTION_CONTROLS_WIDTH, WINDOWS_TITLEBAR_HEIGHT } from '../window-chrome.ts'
import { isDesktopPrefsHydrated, schedulePersistDesktopPrefs } from './desktop-prefs.ts'
import {
  WORKBENCH_WIDTH_MAX,
  WORKBENCH_WIDTH_MIN,
  WORKBENCH_PANEL_IDS,
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
  push: string
  pull: string
  pushOk: string
  pullOk: string
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
  push: '推送',
  pull: '拉取',
  pushOk: '已推送到远端。',
  pullOk: '已拉取最新代码。',
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
  push: 'Push',
  pull: 'Pull',
  pushOk: 'Pushed to the remote.',
  pullOk: 'Pulled the latest changes.',
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

const PanelIcons: Record<WorkbenchPanelId, ReactNode> = {
  explorer: FolderIcon,
  terminal: TerminalIcon,
  git: GitIcon,
  browser: GlobeIcon,
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

/** Resolve the read-only workspace root from the host (cached for the session). */
async function fetchWorkspace(): Promise<string | undefined> {
  if (workspaceCache !== undefined) return workspaceCache
  try {
    const value = await requestJson<{ path?: string | undefined }>('/api/desktop/workbench/workspace')
    if (typeof value.path === 'string' && value.path.length > 0) {
      workspaceCache = value.path
      return workspaceCache
    }
  } catch {
    // Fall through to the undefined case; panels degrade gracefully.
  }
  return undefined
}

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
.hxpWbTabs { flex: none; display: flex; gap: 4px; padding: 6px 6px 0; overflow-x: auto; scrollbar-width: none; }
.hxpWbTab { flex: none; display: inline-flex; align-items: center; gap: 5px; max-width: 140px; padding: 3px 4px 3px 8px; border-radius: 7px; background: transparent; color: var(--dsw-alias-label-tertiary, #888); cursor: pointer; user-select: none; white-space: nowrap; }
.hxpWbTab:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.05)); }
.hxpWbTab[data-active] { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,.07)); color: var(--dsw-alias-label-primary, #222); }
.hxpWbTabIcon { display: inline-flex; }
.hxpWbTabLabel { overflow: hidden; text-overflow: ellipsis; font-size: 12px; line-height: 18px; }
.hxpWbTabClose { display: inline-flex; align-items: center; justify-content: center; width: 16px; height: 16px; padding: 0; border: none; border-radius: 4px; background: transparent; color: inherit; opacity: .55; cursor: pointer; }
.hxpWbTabClose:hover { opacity: 1; background: rgba(0,0,0,.08); }
.hxpWbBody { flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden; }
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
.hxpWbPreview { flex: none; max-height: 45%; display: flex; flex-direction: column; border-top: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.08)); }
.hxpWbPreviewTitle { padding: 5px 8px 2px; color: var(--dsw-alias-label-tertiary, #999); font-size: 11px; }
.hxpWbPreviewText { flex: 1 1 auto; min-height: 0; margin: 0; padding: 4px 8px 8px; overflow: auto; font-family: ui-monospace, Consolas, monospace; font-size: 11.5px; line-height: 1.5; white-space: pre-wrap; word-break: break-all; color: var(--dsw-alias-label-primary, #222); }
.hxpWbTerminal { --hxpWbMono: ui-monospace, Consolas, "Cascadia Mono", monospace; }
.hxpWbTermOutput { flex: 1 1 auto; min-height: 0; margin: 0; padding: 6px 8px; overflow-y: auto; background: transparent; font-family: var(--hxpWbMono); font-size: 11.5px; line-height: 1.55; white-space: pre-wrap; word-break: break-all; color: var(--dsw-alias-label-primary, #222); }
.hxpWbTermForm { display: flex; padding: 4px 6px 6px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.06)); }
.hxpWbTermInput { flex: 1 1 auto; padding: 4px 8px; border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,.1)); border-radius: 6px; background: transparent; color: var(--dsw-alias-label-primary, #222); font-family: var(--hxpWbMono); font-size: 12px; outline: none; }
.hxpWbTermInput:focus { border-color: var(--dsw-alias-label-tertiary, #999); }
.hxpWbGit { gap: 0; }
.hxpWbBranch { padding: 0 4px; font-weight: 600; }
.hxpWbAhead { color: var(--dsw-alias-label-tertiary, #999); }
.hxpWbDiffLine { padding: 0 10px 4px; color: var(--dsw-alias-label-tertiary, #999); font-size: 11px; }
.hxpWbSectionTitle { padding: 6px 10px 2px; color: var(--dsw-alias-label-tertiary, #999); font-size: 10.5px; letter-spacing: .04em; text-transform: uppercase; }
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
            title={t.chat}
            aria-label={t.chat}
            onClick={() => { void openAssistantWindow() }}
          >
            {ChatIcon}
            <span className="hxpWbRailLabel">{t.chat}</span>
          </button>
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
        <div className="hxpWbBody">{renderPanel(snapshot.active, snapshot)}</div>
        <ResizeGrip snapshot={snapshot} state={state} />
      </div>
    </aside>
  )
}

function TabStrip(props: { snapshot: WorkbenchSnapshot; state: WorkbenchState }): ReactNode {
  const { snapshot, state } = props
  const t = useStrings()
  return (
    <div className="hxpWbTabs" role="tablist">
      {snapshot.tabs.map(id => (
        <div
          key={id}
          role="tab"
          aria-selected={snapshot.active === id}
          className="hxpWbTab"
          data-active={snapshot.active === id || undefined}
          onClick={() => { state.setActive(id) }}
        >
          <span className="hxpWbTabIcon">{PanelIcons[id]}</span>
          <span className="hxpWbTabLabel">{t[id]}</span>
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

function renderPanel(active: WorkbenchPanelId | null, snapshot: WorkbenchSnapshot): ReactNode {
  if (!snapshot.open || active === null) return undefined
  if (active === 'explorer') return <ExplorerPanel />
  if (active === 'terminal') return <TerminalPanel />
  if (active === 'git') return <GitPanel />
  return <BrowserPanel home={snapshot.browserHome} />
}

/** Ask the host to spawn an independent assistant chat window; failures are silent. */
async function openAssistantWindow(): Promise<void> {
  try {
    await postJson('/api/desktop/workbench/aux', {})
  } catch {
    // Hosts without window support reject; nothing actionable in-page.
  }
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

function ExplorerPanel(): ReactNode {
  const t = useStrings()
  const [workspace, setWorkspace] = useState(workspaceCache)
  const [cwd, setCwd] = useState(explorerCwd)
  const [entries, setEntries] = useState<FsEntry[] | undefined>()
  const [error, setError] = useState<string | undefined>()
  const [git, setGit] = useState<WorkspaceGit | undefined>()
  const [previewPath, setPreviewPath] = useState<string | undefined>()
  const [preview, setPreview] = useState<PreviewResponse['preview'] | undefined>()

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

  // The workspace root is host-owned and read-only; panels follow it.
  useEffect(() => {
    let cancelled = false
    void fetchWorkspace().then(root => {
      if (!cancelled && root !== undefined) setWorkspace(root)
    })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (workspace === undefined) return
    // Default to the workspace root; a remembered directory outside it snaps back.
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
          disabled={cwd === undefined} onClick={() => { void load(cwd) }}>
          {RefreshIcon}
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
        <div className="hxpWbPreview">
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
}

const terminalCache: TerminalCache = { id: undefined, exited: false, transcript: '' }

/** Hook resolving the host workspace root once per session. */
function useWorkspace(): { workspace: string | undefined; ready: boolean } {
  const [workspace, setWorkspace] = useState(workspaceCache)
  const [ready, setReady] = useState(workspaceCache !== undefined)
  useEffect(() => {
    let cancelled = false
    void fetchWorkspace().then(root => {
      if (cancelled) return
      setWorkspace(root)
      setReady(true)
    })
    return () => { cancelled = true }
  }, [])
  return { workspace, ready }
}

function TerminalPanel(): ReactNode {
  const t = useStrings()
  const { workspace, ready } = useWorkspace()
  const [transcript, setTranscript] = useState(terminalCache.transcript)
  const [input, setInput] = useState('')
  const [exited, setExited] = useState(terminalCache.exited)
  const [epoch, setEpoch] = useState(0)
  const latestRef = useRef(0)
  const preRef = useRef<HTMLPreElement>(null)

  useEffect(() => {
    let cancelled = false
    if (!ready) return () => { cancelled = true }
    const run = async (): Promise<void> => {
      if (terminalCache.id === undefined || terminalCache.exited) {
        try {
          const session = await postJson<{ id: string }>('/api/desktop/workbench/term/start', {
            ...(workspace !== undefined ? { cwd: workspace } : {}),
          })
          if (cancelled) return
          terminalCache.id = session.id
          terminalCache.exited = false
          terminalCache.transcript = ''
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
    latestRef.current = 0
    setTranscript('')
    setExited(false)
    setEpoch(epoch + 1)
  }, [epoch])

  return (
    <div className="hxpWbPanel hxpWbTerminal">
      <div className="hxpWbToolbar">
        <button type="button" className="hxpWbToolButton" title={t.terminalRestart} aria-label={t.terminalRestart} onClick={restart}>
          {RefreshIcon}
        </button>
        {exited && <span className="hxpWbNotice">exit</span>}
      </div>
      <pre ref={preRef} className="hxpWbTermOutput">{transcript}</pre>
      <form
        className="hxpWbTermForm"
        onSubmit={event => {
          event.preventDefault()
          if (input.trim().length === 0) return
          send(input)
          setInput('')
        }}
      >
        <input
          className="hxpWbTermInput"
          value={input}
          placeholder={t.terminalPlaceholder}
          onChange={event => { setInput(event.target.value) }}
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

function GitPanel(): ReactNode {
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

  /** Run a git network/checkout mutation, surface the outcome as a notice, refresh. */
  const runAction = useCallback(async (okNotice: string | undefined, run: () => Promise<void>) => {
    if (workspace === undefined) return
    setBusy(true)
    setNotice(undefined)
    try {
      await run()
      await reload()
      if (okNotice !== undefined) setNotice(okNotice)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setBusy(false)
    }
  }, [workspace, reload])

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
          onClick={() => { void runAction(t.pullOk, () => postJson('/api/desktop/workbench/git/pull', { cwd: workspace })) }}>
          {t.pull}
        </button>
        <button type="button" className="hxpWbToolButton hxpWbToolText" disabled={busy || workspace === undefined}
          onClick={() => { void runAction(t.pushOk, () => postJson('/api/desktop/workbench/git/push', { cwd: workspace })) }}>
          {t.push}
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
              <button key={branch.name} type="button" className="hxpWbBranchRow"
                data-current={branch.current || undefined}
                disabled={busy || branch.current}
                onClick={() => { switchBranch(branch.name, false) }}>
                <span className="hxpWbRailLabel">{branch.name}</span>
                {branch.current && <span className="hxpWbBranchMark">✓</span>}
              </button>
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
      <SectionTitle label={t.gitChanges} count={changed.length} />
      <div className="hxpWbFileList">
        {changed.map(entry => (
          <GitRow key={`w-${entry.path}`} entry={entry} action="stage" actionLabel={t.stage}
            disabled={busy} onAction={() => { void mutate('stage', [entry.path]) }} />
        ))}
      </div>
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
  )
}

function SectionTitle(props: { label: string; count: number }): ReactNode {
  if (props.count === 0) return undefined
  return <div className="hxpWbSectionTitle">{props.label} ({String(props.count)})</div>
}

function GitRow(props: {
  entry: StatusResponse['entries'][number]
  action: 'stage' | 'unstage'
  actionLabel: string
  disabled: boolean
  onAction: () => void
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

function BrowserPanel(props: { home: string | undefined }): ReactNode {
  const { home } = props
  const t = useStrings()
  const [url, setUrl] = useState(browserUrl ?? home ?? DEFAULT_BROWSER_HOME)
  const [input, setInput] = useState(browserUrl ?? home ?? DEFAULT_BROWSER_HOME)
  const [title, setTitle] = useState('')
  const [loading, setLoading] = useState(false)
  const [failed, setFailed] = useState<string | undefined>()
  const viewRef = useRef<WebviewElement>(null)

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
