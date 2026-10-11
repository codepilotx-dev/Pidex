import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { electronBudgets, rendererBudgets } from './Budgets.js'
import {
  confirmationFailed,
  electronQuorumFailed,
  evaluateBudgets,
  redactEnvironment,
  summarize,
  type PerformanceSample,
} from './Metrics.js'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const suiteArgument = process.argv.find((argument) => argument.startsWith('--suite='))
const suite = (suiteArgument?.slice('--suite='.length) ?? 'renderer') as 'electron' | 'renderer'
const enforce = process.argv.includes('--enforce')
const rawDirectory = resolve(repositoryRoot, 'performance-results', 'raw', suite)
const outputDirectory = resolve(repositoryRoot, 'performance-results', suite)
const budgets = suite === 'renderer' ? rendererBudgets : electronBudgets

const samples = await readSamples(rawDirectory)
if (samples.length === 0) {
  throw new Error(`没有找到 ${suite} 性能样本：${rawDirectory}`)
}

const budgetResults = evaluateBudgets(samples, budgets)
const scenarios = Object.fromEntries(
  [...new Set(samples.map((sample) => sample.scenario))].sort().map((scenario) => {
    const scenarioSamples = samples.filter((sample) => sample.scenario === scenario)
    const metricNames = [
      ...new Set(scenarioSamples.flatMap((sample) => Object.keys(sample.metrics))),
    ].sort()
    return [
      scenario,
      {
        environment: redactEnvironment(scenarioSamples.at(-1)!.environment),
        metrics: Object.fromEntries(
          metricNames.map((metric) => [
            metric,
            summarize(
              scenarioSamples.flatMap((sample) => {
                const value = sample.metrics[metric]
                return Number.isFinite(value) ? [value] : []
              }),
            ),
          ]),
        ),
        samples: scenarioSamples.length,
      },
    ]
  }),
)
const report = {
  suite,
  generatedAt: new Date().toISOString(),
  confirmationBatches: [...new Set(samples.map((sample) => sample.batch))].sort(),
  confirmationFailed: confirmationFailed(samples, budgets),
  quorumFailed: suite === 'electron' ? electronQuorumFailed(samples, budgets) : false,
  budgets: budgetResults,
  scenarios,
}

await mkdir(outputDirectory, { recursive: true })
await writeFile(
  resolve(outputDirectory, 'report.json'),
  `${JSON.stringify(report, null, 2)}\n`,
  'utf8',
)
await writeFile(resolve(outputDirectory, 'report.md'), renderMarkdown(report), 'utf8')

const failed = budgetResults.filter((result) => !result.passed)
console.log(
  `${suite}: ${budgetResults.length - failed.length}/${budgetResults.length} budgets passed`,
)
for (const result of failed) {
  console.error(
    `FAIL ${result.scenario}.${result.metric}: ${result.actual ?? 'missing'} > ${result.max}`,
  )
}
if (enforce && (suite === 'electron' ? report.quorumFailed : report.confirmationFailed)) {
  process.exitCode = 1
}

async function readSamples(directory: string): Promise<PerformanceSample[]> {
  const names = await readdir(directory).catch(() => [])
  const values = await Promise.all(
    names
      .filter((name) => name.endsWith('.json'))
      .map(
        async (name) =>
          JSON.parse(await readFile(resolve(directory, name), 'utf8')) as
            PerformanceSample | PerformanceSample[],
      ),
  )
  return values.flat().sort((left, right) => left.timestamp.localeCompare(right.timestamp))
}

function renderMarkdown(reportValue: typeof report): string {
  const lines = [
    `# ${reportValue.suite} performance report`,
    '',
    `Generated: ${reportValue.generatedAt}`,
    '',
    '| Scenario | Metric | p95 | Budget | Status |',
    '| --- | --- | ---: | ---: | --- |',
  ]
  for (const budget of reportValue.budgets) {
    lines.push(
      `| ${budget.scenario} | ${budget.metric} | ${format(budget.actual)} | ${budget.min === undefined ? `≤ ${budget.max}` : `${budget.min}–${budget.max}`} | ${budget.passed ? 'PASS' : 'FAIL'} |`,
    )
  }
  lines.push('')
  return `${lines.join('\n')}\n`
}

function format(value: number | null): string {
  return value === null ? 'missing' : Number(value.toFixed(2)).toString()
}
