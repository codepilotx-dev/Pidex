import { describe, expect, test } from 'bun:test'
import {
  confirmationFailed,
  electronQuorumFailed,
  evaluateBudgets,
  percentile,
  redactEnvironment,
  summarize,
  type PerformanceSample,
} from './Metrics.js'

const sample = (batch: number, value: number): PerformanceSample => ({
  batch,
  environment: {},
  metrics: { readyMs: value },
  sample: 1,
  scenario: 'cold-switch',
  suite: 'renderer',
  timestamp: '2026-07-30T00:00:00.000Z',
})

describe('performance metrics', () => {
  test('uses nearest-rank percentiles and stable summaries', () => {
    expect(percentile([5, 1, 3, 2, 4], 0.95)).toBe(5)
    expect(summarize([1, 2, 3, 4])).toEqual({
      count: 4,
      max: 4,
      median: 2,
      min: 1,
      p95: 4,
      p99: 4,
    })
  })

  test('requires two consecutive failing batches before enforcement', () => {
    const budget = [{ scenario: 'cold-switch', metric: 'readyMs', max: 400 }]
    expect(evaluateBudgets([sample(1, 450)], budget)[0]?.passed).toBeFalse()
    expect(confirmationFailed([sample(1, 450)], budget)).toBeFalse()
    expect(confirmationFailed([sample(1, 450), sample(2, 390)], budget)).toBeFalse()
    expect(confirmationFailed([sample(1, 450), sample(2, 410)], budget)).toBeTrue()
  })

  test('uses a two-of-three quorum for Electron samples', () => {
    const budget = [{ scenario: 'cold-switch', metric: 'readyMs', max: 800 }]
    expect(
      electronQuorumFailed([sample(1, 900), sample(1, 700), sample(1, 850)], budget),
    ).toBeTrue()
    expect(
      electronQuorumFailed([sample(1, 900), sample(1, 700), sample(1, 750)], budget),
    ).toBeFalse()
  })

  test('redacts Windows paths and credential-like values', () => {
    expect(
      redactEnvironment({
        command: 'C:\\Users\\fixture\\Pidex\\app.exe',
        token: 'sk-example-secret',
      }),
    ).toEqual({
      command: '<path>',
      token: '<secret>',
    })
  })
})
