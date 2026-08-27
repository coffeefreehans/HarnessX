/** Desktop usage dashboard: aggregate token usage from durable session logs.
 *
 * Sessions persist as JSONL event logs (one `assistant/message` event per
 * finalized model step) under `<dshHome>/sessions`, zstd-frame compressed.
 * The scanner walks that tree, decodes each log exactly like the persistence
 * backend does (frame-split, torn tail tolerated), and folds per-message
 * usage into totals, per-model rows, and daily buckets. Per-file results are
 * memoized by (size, mtime) so repeated dashboard opens only re-read logs
 * that changed.
 */

import { readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

/** Token counters carried by each finalized assistant message. */
export interface UsageTotals {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

/** Per-model usage roll-up. */
export interface UsageModelRow {
  provider: string
  model: string
  messages: number
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** One local-day usage bucket. */
export interface UsageDayRow {
  day: string
  inputTokens: number
  outputTokens: number
  totalTokens: number
}

/** Aggregated usage across every durable session log. */
export interface UsageReport {
  generatedAt: number
  /** Number of session logs visited (cold and warm alike). */
  sessions: number
  userMessages: number
  assistantMessages: number
  totals: UsageTotals
  byModel: UsageModelRow[]
  /** Last 14 local days, ascending, zero-filled. */
  daily: UsageDayRow[]
  today: UsageDayRow | undefined
  last7: UsageDayRow
}

/** Aggregation of one log file, cacheable by file revision. */
interface FileUsage {
  userMessages: number
  assistantMessages: number
  totals: UsageTotals
  models: Map<string, UsageModelRow>
  days: Map<string, { inputTokens: number; outputTokens: number }>
}

interface RawCounters {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  reasoningTokens: number
}

interface ParsedMessageRow {
  seq: number
  provider: string
  model: string
}

interface ParsedUsageChunk {
  seq: number
  time: number | undefined
  counters: RawCounters
}

/** Cache of parsed per-file usage keyed by absolute path. */
export type UsageCache = Map<string, { revision: string; usage: FileUsage }>

export function createUsageCache(): UsageCache {
  return new Map()
}

const DAILY_WINDOW_DAYS = 14
const MAX_LOG_BYTES = 256 * 1024 * 1024
const ZSTD_MAGIC = 0xfd2fb528
const LOG_FILENAMES = new Set(['session.jsonl.zstd', 'session.jsonl'])

function emptyTotals(): UsageTotals {
  return { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, reasoningTokens: 0 }
}

interface ZstdFrameRange {
  /** Inclusive frame start. */
  start: number
  /** Exclusive frame end. */
  end: number
}

/**
 * Locate complete frames by walking the zstd frame structure itself — frame
 * magic, header descriptor and its fields, then 3-byte block headers until
 * the last block, plus the trailing checksum. Concatenated logs are many
 * independent frames; bytes past EOF mark a torn tail. This mirrors how the
 * persistence backend reads its own artifacts.
 * @param buffer - complete artifact bytes currently present on disk.
 * @returns complete frame ranges in order.
 */
function scanZstdFrames(buffer: Buffer): ZstdFrameRange[] {
  const frames: ZstdFrameRange[] = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) break
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) break
    offset += 4
    if (offset >= buffer.length) break
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 0x20) !== 0
    const checksum = (descriptor & 0x04) !== 0
    const dictionaryFlag = descriptor & 0x03
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    const remainingHeaderBytes = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remainingHeaderBytes) break
    offset += remainingHeaderBytes
    for (;;) {
      if (buffer.length - offset < 3) {
        offset = buffer.length
        break
      }
      const blockHeader = Number(buffer.readUIntLE(offset, 3))
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 0x03
      const payloadBytes = blockType === 0x01 ? 1 : blockHeader >>> 3
      if (buffer.length - offset < payloadBytes) {
        offset = buffer.length
        break
      }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) break
      offset += 4
    }
    frames.push({ start, end: offset })
  }
  return frames
}

/**
 * Decode one zstd artifact: locate every complete appended frame structurally
 * and one-shot decode each range; a torn final frame is dropped, not fatal.
 * @param raw - the artifact bytes.
 * @returns the concatenated plaintext.
 */
export function decodeZstdArtifact(raw: Buffer): string {
  let text = ''
  for (const frame of scanZstdFrames(raw)) {
    try {
      text += zstdDecompressSync(raw.subarray(frame.start, frame.end)).toString('utf8')
    } catch {
      // A structurally valid but corrupt frame loses only itself.
    }
  }
  return text
}

/** Local calendar-day key (`YYYY-MM-DD`) for an epoch-ms timestamp. */
export function usageDayKey(timeMs: number): string {
  const date = new Date(timeMs)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${String(date.getFullYear())}-${month}-${day}`
}

function asFiniteNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

/**
 * Fold one decoded log's event lines into a per-file aggregation.
 *
 * Adapters record token usage as `assistant/chunk` events (chunk type
 * `"usage"`) that precede their finalizing message, and chunk envelopes carry
 * no model identity — so usage is attributed to the source of the next
 * assistant message in log order (the same step's completion), falling back to
 * the previous known source for aborted trailing steps. Legacy logs that put
 * `usage` directly on the message are honored only when the file has no usage
 * chunks at all. Header rows and packed storage rows carry nothing and skip.
 * @param text - the decoded JSONL plaintext.
 * @returns the file's aggregation.
 */
export function aggregateUsageLog(text: string): FileUsage {
  const usage = emptyFileUsage()
  const messages: ParsedMessageRow[] = []
  const chunks: ParsedUsageChunk[] = []
  // Legacy shape: usage stamped directly on each message. Kept separate so it
  // is only honored when the file has no chunk-based usage to prefer.
  const legacyTotals = emptyTotals()
  const legacyModels = new Map<string, UsageModelRow>()
  const legacyDays = new Map<string, { inputTokens: number; outputTokens: number }>()

  for (const line of text.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (typeof event !== 'object' || event === null) continue
    const record = event as { type?: unknown; seq?: unknown; time?: unknown; data?: unknown }
    const seq = typeof record.seq === 'number' && Number.isFinite(record.seq) ? record.seq : 0
    const time = typeof record.time === 'number' && Number.isFinite(record.time) ? record.time : undefined
    const data = typeof record.data === 'object' && record.data !== null
      ? record.data as Record<string, unknown>
      : undefined
    if (record.type === 'user/message') {
      usage.userMessages += 1
      continue
    }
    if (record.type === 'assistant/message') {
      const message = typeof data?.message === 'object' && data.message !== null
        ? data.message as { source?: unknown; usage?: unknown }
        : undefined
      if (message === undefined) continue
      const source = typeof message.source === 'object' && message.source !== null
        ? message.source as Record<string, unknown>
        : undefined
      messages.push({
        seq,
        provider: typeof source?.provider === 'string' && source.provider.length > 0 ? source.provider : 'unknown',
        model: typeof source?.model === 'string' && source.model.length > 0 ? source.model : 'unknown',
      })
      const rawUsage = typeof message.usage === 'object' && message.usage !== null
        ? message.usage as Record<string, unknown>
        : undefined
      if (rawUsage !== undefined) {
        const current = messages[messages.length - 1]
        if (current !== undefined) {
          addAttributed(legacyTotals, legacyModels, legacyDays, providerOf(current), modelOf(current), countersFrom(rawUsage), time)
          const key = `${current.provider}::${current.model}`
          const row = legacyModels.get(key)
          if (row !== undefined) row.messages += 1
        }
      }
      continue
    }
    if (record.type === 'assistant/chunk') {
      const chunk = typeof data?.chunk === 'object' && data.chunk !== null
        ? data.chunk as { type?: unknown; usage?: unknown }
        : undefined
      if (chunk?.type !== 'usage') continue
      const rawUsage = typeof chunk.usage === 'object' && chunk.usage !== null
        ? chunk.usage as Record<string, unknown>
        : undefined
      if (rawUsage === undefined) continue
      chunks.push({ seq, time, counters: countersFrom(rawUsage) })
    }
  }

  const assistantMessages = messages.length
  if (chunks.length === 0) {
    // No chunk-based usage anywhere: the legacy per-message numbers stand.
    usage.assistantMessages = assistantMessages
    usage.totals = legacyTotals
    usage.models = legacyModels
    usage.days = legacyDays
    return usage
  }

  // Attribute each usage chunk to the next assistant message in log order —
  // its own step's completion declares which model served those tokens — and
  // fall back to the last seen source for aborted trailing steps.
  const replyCounts = new Map<string, number>()
  for (const message of messages) {
    const key = `${message.provider}::${message.model}`
    replyCounts.set(key, (replyCounts.get(key) ?? 0) + 1)
  }
  let cursor = 0
  let lastProvider = 'unknown'
  let lastModel = 'unknown'
  for (const chunk of chunks) {
    while (cursor < messages.length) {
      const message = messages[cursor]
      if (message === undefined || message.seq >= chunk.seq) break
      lastProvider = message.provider
      lastModel = message.model
      cursor += 1
    }
    const nextMessage = cursor < messages.length ? messages[cursor] : undefined
    const provider = nextMessage !== undefined ? nextMessage.provider : lastProvider
    const model = nextMessage !== undefined ? nextMessage.model : lastModel
    addAttributed(usage.totals, usage.models, usage.days, provider, model, chunk.counters, chunk.time)
  }
  usage.assistantMessages = assistantMessages
  for (const [key, row] of usage.models) row.messages = replyCounts.get(key) ?? 0
  return usage
}

function providerOf(message: ParsedMessageRow): string {
  return message.provider
}

function modelOf(message: ParsedMessageRow): string {
  return message.model
}

function countersFrom(rawUsage: Record<string, unknown>): RawCounters {
  return {
    inputTokens: asFiniteNumber(rawUsage.inputTokens),
    outputTokens: asFiniteNumber(rawUsage.outputTokens),
    cacheReadTokens: asFiniteNumber(rawUsage.cacheReadTokens),
    cacheWriteTokens: asFiniteNumber(rawUsage.cacheWriteTokens),
    reasoningTokens: asFiniteNumber(rawUsage.reasoningTokens),
  }
}

function emptyFileUsage(): FileUsage {
  return {
    userMessages: 0,
    assistantMessages: 0,
    totals: emptyTotals(),
    models: new Map(),
    days: new Map(),
  }
}

function addAttributed(
  totals: UsageTotals,
  models: Map<string, UsageModelRow>,
  days: Map<string, { inputTokens: number; outputTokens: number }>,
  provider: string,
  model: string,
  counters: RawCounters,
  time: number | undefined,
): void {
  totals.inputTokens += counters.inputTokens
  totals.outputTokens += counters.outputTokens
  totals.cacheReadTokens += counters.cacheReadTokens
  totals.cacheWriteTokens += counters.cacheWriteTokens
  totals.reasoningTokens += counters.reasoningTokens
  const key = `${provider}::${model}`
  const row = models.get(key) ?? { provider, model, messages: 0, inputTokens: 0, outputTokens: 0, totalTokens: 0 }
  row.inputTokens += counters.inputTokens
  row.outputTokens += counters.outputTokens
  row.totalTokens += counters.inputTokens + counters.outputTokens
  models.set(key, row)
  if (time === undefined) return
  const day = usageDayKey(time)
  const bucket = days.get(day) ?? { inputTokens: 0, outputTokens: 0 }
  bucket.inputTokens += counters.inputTokens
  bucket.outputTokens += counters.outputTokens
  days.set(day, bucket)
}

/**
 * Merge one file's aggregation into a running cross-file accumulation.
 */
function mergeFileUsage(report: {
  userMessages: number
  assistantMessages: number
  totals: UsageTotals
  models: Map<string, UsageModelRow>
  days: Map<string, { inputTokens: number; outputTokens: number }>
}, file: FileUsage): void {
  report.userMessages += file.userMessages
  report.assistantMessages += file.assistantMessages
  report.totals.inputTokens += file.totals.inputTokens
  report.totals.outputTokens += file.totals.outputTokens
  report.totals.cacheReadTokens += file.totals.cacheReadTokens
  report.totals.cacheWriteTokens += file.totals.cacheWriteTokens
  report.totals.reasoningTokens += file.totals.reasoningTokens
  for (const [key, row] of file.models) {
    const existing = report.models.get(key)
    if (existing === undefined) {
      report.models.set(key, { ...row })
      continue
    }
    existing.messages += row.messages
    existing.inputTokens += row.inputTokens
    existing.outputTokens += row.outputTokens
    existing.totalTokens += row.totalTokens
  }
  for (const [day, bucket] of file.days) {
    const existing = report.days.get(day)
    if (existing === undefined) {
      report.days.set(day, { ...bucket })
      continue
    }
    existing.inputTokens += bucket.inputTokens
    existing.outputTokens += bucket.outputTokens
  }
}

/** Read and aggregate one log artifact; unreadable or oversized files are skipped. */
async function readLogUsage(path: string): Promise<FileUsage | undefined> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size > MAX_LOG_BYTES) return undefined
    if (path.endsWith('.zstd')) {
      const raw = await readFile(path)
      return aggregateUsageLog(decodeZstdArtifact(raw))
    }
    return aggregateUsageLog((await readFile(path)).toString('utf8'))
  } catch {
    return undefined
  }
}

/**
 * Walk the durable session tree and aggregate every log into one report.
 * @param dshHome - the DeepSeek Harness home directory.
 * @param cache - per-file memoization store; pass the same map across calls.
 * @returns the dashboard report.
 */
export async function collectUsageReport(dshHome: string, cache: UsageCache): Promise<UsageReport> {
  const root = join(dshHome, 'sessions')
  const merged = {
    userMessages: 0,
    assistantMessages: 0,
    totals: emptyTotals(),
    models: new Map<string, UsageModelRow>(),
    days: new Map<string, { inputTokens: number; outputTokens: number }>,
  }
  let sessions = 0
  let entries: Array<{ name: string; isFile: boolean; fullPath: string }>
  try {
    entries = (await readdir(root, { recursive: true, withFileTypes: true }))
      .filter(entry => entry.isFile() && LOG_FILENAMES.has(entry.name))
      .map(entry => ({ name: entry.name, isFile: entry.isFile(), fullPath: join(entry.parentPath, entry.name) }))
  } catch {
    entries = []
  }
  for (const entry of entries) {
    let revision = ''
    try {
      const info = await stat(entry.fullPath)
      revision = `${String(info.size)}:${String(Math.round(info.mtimeMs))}`
    } catch {
      continue
    }
    const cached = cache.get(entry.fullPath)
    let usage: FileUsage | undefined
    if (cached !== undefined && cached.revision === revision) {
      usage = cached.usage
    } else {
      usage = await readLogUsage(entry.fullPath)
      if (usage === undefined) continue
      cache.set(entry.fullPath, { revision, usage })
    }
    sessions += 1
    mergeFileUsage(merged, usage)
  }

  const daily: UsageDayRow[] = []
  const today = new Date()
  for (let offset = DAILY_WINDOW_DAYS - 1; offset >= 0; offset -= 1) {
    const date = new Date(today)
    date.setDate(date.getDate() - offset)
    const key = usageDayKey(date.getTime())
    const bucket = merged.days.get(key) ?? { inputTokens: 0, outputTokens: 0 }
    daily.push({
      day: key,
      inputTokens: bucket.inputTokens,
      outputTokens: bucket.outputTokens,
      totalTokens: bucket.inputTokens + bucket.outputTokens,
    })
  }
  const todayRow = daily[daily.length - 1]
  const last7 = daily.slice(-7).reduce((acc, row) => ({
    day: '',
    inputTokens: acc.inputTokens + row.inputTokens,
    outputTokens: acc.outputTokens + row.outputTokens,
    totalTokens: acc.totalTokens + row.totalTokens,
  }), { day: '', inputTokens: 0, outputTokens: 0, totalTokens: 0 })

  return {
    generatedAt: Date.now(),
    sessions,
    userMessages: merged.userMessages,
    assistantMessages: merged.assistantMessages,
    totals: merged.totals,
    byModel: [...merged.models.values()].sort((left, right) => right.totalTokens - left.totalTokens),
    daily,
    today: todayRow,
    last7,
  }
}
