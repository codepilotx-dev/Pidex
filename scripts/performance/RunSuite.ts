import { mkdir, readFile, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

const repositoryRoot = resolve(import.meta.dirname, '../..')
const suiteArgument = process.argv.find((argument) => argument.startsWith('--suite='))
const suite = suiteArgument?.slice('--suite='.length) ?? 'renderer'
if (suite !== 'renderer' && suite !== 'electron') {
  throw new Error(`Unknown performance suite: ${suite}`)
}
const enforce = process.argv.includes('--enforce')
const rawDirectory = resolve(repositoryRoot, 'performance-results', 'raw', suite)
const bunExecutable = process.execPath

await rm(rawDirectory, { force: true, recursive: true })
await mkdir(rawDirectory, { recursive: true })

await runBatch(1)
let reportExitCode = await runReport(false)
if (reportExitCode !== 0) process.exit(reportExitCode)

if (enforce && suite === 'renderer' && (await currentReportHasFailures())) {
  await runBatch(2)
}
if (enforce) reportExitCode = await runReport(true)
process.exitCode = reportExitCode

async function runBatch(batch: number): Promise<void> {
  const workspace = suite === 'renderer' ? 'apps/desktop/renderer' : 'apps/desktop/electron'
  const script = suite === 'renderer' ? 'test:performance' : 'test:performance'
  const processResult = Bun.spawn([bunExecutable, 'run', '--cwd', workspace, script], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      PIDEX_PERF_BATCH: String(batch),
    },
    stderr: 'inherit',
    stdout: 'inherit',
  })
  const exitCode = await processResult.exited
  if (exitCode !== 0) {
    throw new Error(`${suite} performance batch ${batch} failed (${exitCode})`)
  }
  if (suite === 'renderer') {
    const selectorResult = Bun.spawn([bunExecutable, 'scripts/performance/SelectorBenchmark.ts'], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        PIDEX_PERF_BATCH: String(batch),
      },
      stderr: 'inherit',
      stdout: 'inherit',
    })
    const selectorExitCode = await selectorResult.exited
    if (selectorExitCode !== 0) {
      throw new Error(`selector performance batch ${batch} failed (${selectorExitCode})`)
    }
  }
}

async function runReport(enforceReport: boolean): Promise<number> {
  const processResult = Bun.spawn(
    [
      bunExecutable,
      'scripts/performance/Report.ts',
      `--suite=${suite}`,
      ...(enforceReport ? ['--enforce'] : []),
    ],
    {
      cwd: repositoryRoot,
      stderr: 'inherit',
      stdout: 'inherit',
    },
  )
  return processResult.exited
}

async function currentReportHasFailures(): Promise<boolean> {
  const reportPath = resolve(repositoryRoot, 'performance-results', suite, 'report.json')
  const report = JSON.parse(await readFile(reportPath, 'utf8')) as {
    budgets: Array<{ passed: boolean }>
  }
  return report.budgets.some((budget) => !budget.passed)
}
