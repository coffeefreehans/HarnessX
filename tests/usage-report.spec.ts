import { mkdir, mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import {
  aggregateUsageLog,
  collectUsageReport,
  createUsageCache,
  decodeZstdArtifact,
  usageDayKey,
} from '../src/usage-report.ts'

const HEADER_LINE = '{"format":"session-log","version":1}'

const USER_LINE = JSON.stringify({
  type: 'user/message',
  seq: 1,
  time: Date.UTC(2026, 7, 20, 8, 0, 0),
  data: { id: 'u1', role: 'user', content: [{ type: 'text', text: 'hi' }] },
})

const ASSISTANT_LINE = JSON.stringify({
  type: 'assistant/message',
  seq: 2,
  time: Date.UTC(2026, 7, 20, 8, 0, 30),
  data: {
    message: {
      id: 'a1',
      role: 'assistant',
      content: [],
      source: { kind: 'model', provider: 'nexscp', model: 'stealth-x' },
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 5, cacheWriteTokens: 3, reasoningTokens: 7 },
    },
  },
})

const PACKED_LINE = JSON.stringify({
  type: 'text-chunks',
  seq: 3,
  time: Date.UTC(2026, 7, 20, 8, 0, 31),
  data: { rows: [] },
})

describe('zstd artifact decoding', () => {
  it('decodes a single-frame artifact', () => {
    const raw = zstdCompressSync(Buffer.from('alpha\nbeta\n'))
    expect(decodeZstdArtifact(raw)).toBe('alpha\nbeta\n')
  })

  it('decodes concatenated frames and tolerates a torn tail', () => {
    const first = zstdCompressSync(Buffer.from('one\n'))
    const second = zstdCompressSync(Buffer.from('two\n'))
    expect(decodeZstdArtifact(Buffer.concat([first, second]))).toBe('one\ntwo\n')
    // A truncated trailing frame still yields every decodable frame.
    const torn = Buffer.concat([first, second.subarray(0, 6)])
    expect(decodeZstdArtifact(torn)).toBe('one\n')
  })
})

describe('usage log aggregation', () => {
  it('folds message events into totals, models, and day buckets', () => {
    const usage = aggregateUsageLog([HEADER_LINE, USER_LINE, ASSISTANT_LINE, PACKED_LINE, '', 'not json'].join('\n'))
    expect(usage.userMessages).toBe(1)
    expect(usage.assistantMessages).toBe(1)
    expect(usage.totals).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      cacheReadTokens: 5,
      cacheWriteTokens: 3,
      reasoningTokens: 7,
    })
    expect(usage.models.get('nexscp::stealth-x')).toEqual({
      provider: 'nexscp',
      model: 'stealth-x',
      messages: 1,
      inputTokens: 100,
      outputTokens: 20,
      totalTokens: 120,
    })
    expect(usage.days.get(usageDayKey(Date.UTC(2026, 7, 20, 8, 0, 30)))).toEqual({
      inputTokens: 100,
      outputTokens: 20,
      messages: 0,
    })
  })

  it('counts messages without usage defensively', () => {
    const bare = JSON.stringify({
      type: 'assistant/message',
      seq: 9,
      time: Date.UTC(2026, 7, 21, 9, 0, 0),
      data: { message: { id: 'a2', role: 'assistant', content: [], source: { kind: 'model', provider: 'p', model: 'm' } } },
    })
    const usage = aggregateUsageLog(bare)
    expect(usage.assistantMessages).toBe(1)
    expect(usage.totals.inputTokens).toBe(0)
    // No usage anywhere in the file: no per-model token row exists yet.
    expect(usage.models.get('p::m')).toBeUndefined()
  })

  it('attributes usage chunks to the following message and aborted tails to the last source', () => {
    const usageChunk = (seq: number, time: number, usage: Record<string, number>): string => JSON.stringify({
      type: 'assistant/chunk',
      seq,
      time,
      data: { turn: 1, step: seq, chunk: { type: 'usage', usage } },
    })
    const messageLine = (seq: number, provider: string, model: string): string => JSON.stringify({
      type: 'assistant/message',
      seq,
      time: Date.UTC(2026, 7, 20, 9, 0, 0),
      data: { message: { id: `a${String(seq)}`, role: 'assistant', content: [], source: { kind: 'model', provider, model } } },
    })
    const text = [
      HEADER_LINE,
      USER_LINE,
      // Chunk precedes its finalizing message; the message carries no usage.
      usageChunk(10, Date.UTC(2026, 7, 20, 8, 5, 0), { inputTokens: 1000, outputTokens: 50 }),
      messageLine(11, 'nexscp', 'stealth-x'),
      usageChunk(20, Date.UTC(2026, 7, 21, 8, 6, 0), { inputTokens: 2000, outputTokens: 60, reasoningTokens: 4 }),
      messageLine(21, 'other', 'other-model'),
      // Aborted trailing step: its chunk never gets a message.
      usageChunk(30, Date.UTC(2026, 7, 22, 8, 7, 0), { inputTokens: 3000, outputTokens: 70 }),
    ].join('\n')
    const usage = aggregateUsageLog(text)
    expect(usage.assistantMessages).toBe(2)
    expect(usage.userMessages).toBe(1)
    expect(usage.totals.inputTokens).toBe(6000)
    expect(usage.totals.outputTokens).toBe(180)
    expect(usage.totals.reasoningTokens).toBe(4)
    // Each model's tokens come from the chunk of its own step; reply counts
    // stay per finalized message.
    expect(usage.models.get('nexscp::stealth-x')).toMatchObject({ messages: 1, totalTokens: 1050 })
    expect(usage.models.get('other::other-model')).toMatchObject({ messages: 1, totalTokens: 2060 + 3070 })
    // Day buckets ride each chunk's own timestamp.
    expect(usage.days.size).toBe(3)
  })

  it('attributes chunk tokens by message source even when a legacy usage coexists', () => {
    const legacyMessage = JSON.stringify({
      type: 'assistant/message',
      seq: 11,
      time: Date.UTC(2026, 7, 20, 8, 5, 0),
      data: { message: { role: 'assistant', content: [], source: { kind: 'model', provider: 'old', model: 'legacy' }, usage: { inputTokens: 999 } } },
    })
    const chunk = JSON.stringify({
      type: 'assistant/chunk',
      seq: 10,
      time: Date.UTC(2026, 7, 20, 8, 4, 0),
      data: { chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 1 } } },
    })
    const usage = aggregateUsageLog([chunk, legacyMessage].join('\n'))
    // Chunk tokens win; the reply lands on the model that completed its step.
    expect(usage.totals.inputTokens).toBe(100)
    expect(usage.models.get('old::legacy')).toMatchObject({ messages: 1, totalTokens: 101 })
  })

  it('formats local day keys zero-padded', () => {
    expect(usageDayKey(new Date(2026, 6, 5, 12).getTime())).toBe('2026-07-05')
  })
})

describe('collectUsageReport over a session tree', () => {
  it('walks logs, aggregates, and reuses cache until a file changes', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'usage-home-'))
    const sessionDir = join(dshHome, 'sessions', 'proj', 'enc-id')
    await mkdir(sessionDir, { recursive: true })
    const logText = [HEADER_LINE, USER_LINE, ASSISTANT_LINE].join('\n') + '\n'
    await writeFile(join(sessionDir, 'session.jsonl.zstd'), zstdCompressSync(Buffer.from(logText)))

    const cache = createUsageCache()
    const report = await collectUsageReport(dshHome, cache)
    expect(report.sessions).toBe(1)
    expect(report.userMessages).toBe(1)
    expect(report.assistantMessages).toBe(1)
    expect(report.totals.inputTokens).toBe(100)
    expect(report.byModel[0]).toMatchObject({ provider: 'nexscp', model: 'stealth-x', totalTokens: 120 })
    expect(report.daily).toHaveLength(30)
    expect(report.daily[report.daily.length - 1]?.day).toBe(usageDayKey(Date.now()))
    expect(report.today?.totalTokens).toBe(0)
    expect(report.last7.totalTokens).toBe(0)

    // Per-model daily rows align with the global window so range filters can
    // slice them without reshaping.
    const stealthDaily = report.byModelDaily.find(row => row.model === 'stealth-x')
    expect(stealthDaily?.daily).toHaveLength(30)
    expect(stealthDaily?.daily.reduce((sum, entry) => sum + entry.totalTokens, 0)).toBe(120)
    // The reply lands on its completion day within the range slice.
    expect(stealthDaily?.daily.some(entry => entry.messages === 1)).toBe(true)

    // Unchanged files ride the cache; a rewritten log is re-read.
    const second = await collectUsageReport(dshHome, cache)
    expect(second.assistantMessages).toBe(1)
    await writeFile(join(sessionDir, 'session.jsonl.zstd'), zstdCompressSync(Buffer.from(`${logText}${ASSISTANT_LINE}\n`)))
    const third = await collectUsageReport(dshHome, cache)
    expect(third.assistantMessages).toBe(2)
    expect(third.totals.inputTokens).toBe(200)
  })

  it('reports empty when the sessions root is absent', async () => {
    const dshHome = await mkdtemp(join(tmpdir(), 'usage-empty-'))
    const report = await collectUsageReport(dshHome, createUsageCache())
    expect(report.sessions).toBe(0)
    expect(report.daily).toHaveLength(30)
    expect(report.byModelDaily).toEqual([])
  })
})
