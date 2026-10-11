import { Database } from 'bun:sqlite'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import {
  createCleanupHandler,
  errorMessage,
  repositoryRoot,
  runBun,
  startAgentProcess,
  waitForAgentReady,
  waitForHttpReady,
} from './IntegrationTestRunner.js'

const rpcOnly = process.argv.includes('--rpc')
const live = process.argv.includes('--live')
const activeChildren = new Set<ChildProcess>()
let isolatedRoot = ''
let succeeded = false

const cleanup = createCleanupHandler(activeChildren, () => ({ isolatedRoot, succeeded }))

process.once('SIGINT', () => {
  void cleanup().finally(() => process.exit(130))
})
process.once('SIGTERM', () => {
  void cleanup().finally(() => process.exit(143))
})

try {
  if (rpcOnly) {
    await runBun(['apps/agent/scripts/PiRpcSmoke.ts'], activeChildren)
    succeeded = true
  } else {
    if (!live) {
      process.stdout.write('[plan-test] 先执行确定性 RPC/事件检查\n')
      await runBun(['apps/agent/scripts/PiRpcSmoke.ts'], activeChildren)
    }

    isolatedRoot = await mkdtemp(join(tmpdir(), 'pidex-plan-flow-'))
    const agentDataDir = join(isolatedRoot, 'agent')
    const documentsDir = join(isolatedRoot, 'documents')
    await Promise.all([
      mkdir(agentDataDir, { recursive: true }),
      mkdir(documentsDir, { recursive: true }),
    ])
    if (live) {
      await prepareLiveProfile(agentDataDir)
      process.stdout.write('[plan-test] 已创建正式 profile 的在线快照；正式数据不会被修改\n')
    }

    process.stdout.write('[plan-test] 构建 Renderer\n')
    await runBun(['run', 'build:renderer'], activeChildren)
    process.stdout.write('[plan-test] 构建 Electron\n')
    await runBun(['run', 'build:desktop'], activeChildren)

    const token = crypto.randomUUID()
    const agent = startAgentProcess('apps/agent/scripts/PlanSmokeServer.ts', activeChildren, {
      ...process.env,
      PIDEX_AUTH_TOKEN: token,
      PIDEX_DATA_DIR: agentDataDir,
      PIDEX_DOCUMENTS_DIR: documentsDir,
      PIDEX_LOG_DIR: join(isolatedRoot, 'agent-logs'),
      PIDEX_DESKTOP_MANAGED: '1',
      PIDEX_PORT: '0',
      PIDEX_PLAN_SMOKE_LIVE: live ? '1' : '0',
      ...(live ? {} : { OPENAI_API_KEY: 'pidex-plan-smoke-not-a-real-key' }),
      PIDEX_STATIC_DIR: join(repositoryRoot, 'dist', 'renderer'),
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
    })
    const origin = await waitForAgentReady(
      agent,
      'plan-smoke-ready',
      activeChildren,
      'Plan smoke Agent',
    )
    await waitForHttpReady(origin, agent, 'Plan smoke Agent')

    process.stdout.write(
      live
        ? '[plan-test] 启动真实模型 Electron 流程（会联网并产生模型费用）\n'
        : '[plan-test] 启动 faux Electron 全流程\n',
    )
    await runBun(['run', '--cwd', 'apps/desktop/electron', 'test:plan'], activeChildren, {
      ...process.env,
      PIDEX_AGENT_URL: origin,
      PIDEX_AUTH_TOKEN: token,
      PIDEX_DATA_DIR: agentDataDir,
      PIDEX_PLAN_SMOKE_ROOT: isolatedRoot,
      PIDEX_PLAN_SMOKE_LIVE: live ? '1' : '0',
      PIDEX_PLAYWRIGHT_OUTPUT_DIR: join(isolatedRoot, 'playwright'),
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
    })
    succeeded = true
    process.stdout.write('[plan-test] Plan 桌面全流程通过\n')
  }
} catch (cause) {
  process.stderr.write(`[plan-test] ${errorMessage(cause)}\n`)
  if (isolatedRoot) {
    process.stderr.write(
      `[plan-test] 已保留失败现场（trace、screenshot、脱敏日志）：${isolatedRoot}\n`,
    )
  }
  process.exitCode = 1
} finally {
  await cleanup()
}

async function prepareLiveProfile(targetDataDir: string): Promise<void> {
  const sourceDataDir = resolve(
    process.env.PIDEX_PLAN_LIVE_SOURCE_DIR?.trim() || join(homedir(), '.pidex'),
  )
  const sourceProfile = join(sourceDataDir, 'profile.sqlite')
  const sourceConfig = join(sourceDataDir, 'config.json')
  if (!existsSync(sourceProfile) || !existsSync(sourceConfig)) {
    throw new Error(`真实模型测试需要 ${sourceDataDir} 中的 profile.sqlite 和 config.json`)
  }

  const database = new Database(sourceProfile, {
    readonly: true,
    strict: true,
  })
  try {
    await writeFile(join(targetDataDir, 'profile.sqlite'), database.serialize())
  } finally {
    database.close()
  }
  await writeFile(join(targetDataDir, 'config.json'), await readFile(sourceConfig))
}
