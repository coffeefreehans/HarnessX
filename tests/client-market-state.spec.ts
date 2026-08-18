import { describe, expect, it } from 'vitest'
import {
  createLatestRequestGate,
  findNewestPluginJob,
  marketJobDuration,
  marketJobHeadline,
  newestMarketJobs,
  pluginInstallAction,
} from '../src/client/market-state.ts'

describe('plugin market client state', () => {
  it('uses the newest matching job for one plugin', () => {
    const olderJob = {
      id: 'older',
      status: 'success' as const,
      label: 'Status Rotator',
      target: 'github:01Virex/dsh-status-rotator',
    }
    const newerJob = {
      id: 'newer',
      status: 'running' as const,
      label: 'Status Rotator',
      target: 'github:01Virex/dsh-status-rotator',
    }

    expect(findNewestPluginJob(
      'github:01Virex/dsh-status-rotator',
      'Status Rotator',
      [olderJob, newerJob],
    )).toBe(newerJob)
  })

  it('shows preparation immediately before an install job exists', () => {
    expect(pluginInstallAction(false, undefined, true)).toEqual({
      label: '准备中…',
      disabled: true,
    })
  })

  it('waits for the installed list before showing a successful job as installed', () => {
    expect(pluginInstallAction(false, 'success', false)).toEqual({
      label: '确认中…',
      disabled: true,
    })
  })

  it('rejects an older installed-list response after a newer request starts', () => {
    const gate = createLatestRequestGate()
    const olderRequest = gate.begin()
    const newerRequest = gate.begin()

    expect(gate.isLatest(olderRequest)).toBe(false)
    expect(gate.isLatest(newerRequest)).toBe(true)
  })

  it('shows the newest market task first without mutating task state', () => {
    const jobs = [{ id: 'older' }, { id: 'newer' }]

    expect(newestMarketJobs(jobs).map(job => job.id)).toEqual(['newer', 'older'])
    expect(jobs.map(job => job.id)).toEqual(['older', 'newer'])
  })

  it('states the operation and result in the task headline', () => {
    expect(marketJobHeadline('install', 'success')).toBe('安装成功')
    expect(marketJobHeadline('uninstall', 'failed')).toBe('卸载失败')
  })

  it('formats elapsed task time from start to completion', () => {
    expect(marketJobDuration(
      '2026-08-18T02:00:00.000Z',
      '2026-08-18T02:01:05.000Z',
    )).toBe('1 分 5 秒')
  })
})
