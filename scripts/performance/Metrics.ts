export type MetricSummary = {
  count: number
  max: number
  median: number
  min: number
  p95: number
  p99: number
}

export type PerformanceSample = {
  batch: number
  environment: Record<string, string | number | boolean | null>
  metrics: Record<string, number>
  sample: number
  scenario: string
  suite: 'electron' | 'renderer'
  timestamp: string
}

export type PerformanceBudget = {
  metric: string
  scenario: string
  min?: number
  max: number
}

export type BudgetResult = PerformanceBudget & {
  actual: number | null
  passed: boolean
}

export function percentile(values: readonly number[], percentileValue: number): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((left, right) => left - right)
  const bounded = Math.min(1, Math.max(0, percentileValue))
  const index = Math.ceil(bounded * sorted.length) - 1
  return sorted[Math.max(0, index)]!
}

export function summarize(values: readonly number[]): MetricSummary {
  if (values.length === 0) {
    return { count: 0, max: 0, median: 0, min: 0, p95: 0, p99: 0 }
  }
  return {
    count: values.length,
    max: Math.max(...values),
    median: percentile(values, 0.5),
    min: Math.min(...values),
    p95: percentile(values, 0.95),
    p99: percentile(values, 0.99),
  }
}

export function evaluateBudgets(
  samples: readonly PerformanceSample[],
  budgets: readonly PerformanceBudget[],
): BudgetResult[] {
  return budgets.map((budget) => {
    const values = samples
      .filter((sample) => sample.scenario === budget.scenario)
      .flatMap((sample) => {
        const value = sample.metrics[budget.metric]
        return Number.isFinite(value) ? [value] : []
      })
    const actual = values.length > 0 ? percentile(values, 0.95) : null
    const exactRangePassed =
      budget.min === undefined ||
      values.every((value) => value >= budget.min! && value <= budget.max)
    return {
      ...budget,
      actual,
      passed:
        actual !== null &&
        actual <= budget.max &&
        actual >= (budget.min ?? Number.NEGATIVE_INFINITY) &&
        exactRangePassed,
    }
  })
}

export function electronQuorumFailed(
  samples: readonly PerformanceSample[],
  budgets: readonly PerformanceBudget[],
): boolean {
  return budgets.some((budget) => {
    const relevant = samples.filter((sample) => sample.scenario === budget.scenario)
    const failed = relevant.filter((sample) => {
      const actual = sample.metrics[budget.metric]
      return (
        !Number.isFinite(actual) ||
        actual > budget.max ||
        actual < (budget.min ?? Number.NEGATIVE_INFINITY)
      )
    }).length
    return relevant.length < 3 || failed >= 2
  })
}

export function confirmationFailed(
  samples: readonly PerformanceSample[],
  budgets: readonly PerformanceBudget[],
): boolean {
  const batches = [...new Set(samples.map((sample) => sample.batch))].sort()
  if (batches.length < 2) return false
  return batches.slice(-2).every((batch) =>
    evaluateBudgets(
      samples.filter((sample) => sample.batch === batch),
      budgets,
    ).some((result) => !result.passed),
  )
}

export function redactEnvironment(
  environment: Record<string, string | number | boolean | null>,
): Record<string, string | number | boolean | null> {
  return Object.fromEntries(
    Object.entries(environment).map(([key, value]) => [
      key,
      typeof value === 'string'
        ? value
            .replace(/[A-Za-z]:\\[^ \r\n"]+/g, '<path>')
            .replace(/(?:sk|key|token)-[A-Za-z0-9_-]+/gi, '<secret>')
        : value,
    ]),
  )
}
