import { existsSync } from 'node:fs'
import { mkdir, mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ChildProcess } from 'node:child_process'
import {
  createCleanupHandler,
  errorMessage,
  runBun,
  startAgentProcess,
  startChildProcess,
  waitForAgentReady,
  waitForHttpReady,
} from './IntegrationTestRunner.js'

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
  isolatedRoot = await mkdtemp(join(tmpdir(), 'pidex-review-concurrency-'))
  const agentDataDir = join(isolatedRoot, 'agent')
  await mkdir(agentDataDir, { recursive: true })

  process.stdout.write('[review-concurrency] 构建 Electron\n')
  await runBun(['run', 'build:desktop'], activeChildren)

  const rendererOrigin = 'http://127.0.0.1:47176'
  process.stdout.write('[review-concurrency] 启动 Renderer dev server\n')
  const renderer = startChildProcess(
    [
      'run',
      '--cwd',
      'apps/desktop/renderer',
      'dev:performance',
      '--',
      '--host',
      '127.0.0.1',
      '--port',
      '47176',
      '--strictPort',
      '--force',
    ],
    activeChildren,
    {
      ...process.env,
      NODE_ENV: 'production',
    },
  )
  await waitForHttpReady(rendererOrigin, renderer, 'Renderer dev server')

  const token = crypto.randomUUID()
  const agent = startAgentProcess('apps/agent/scripts/ReviewConcurrencyServer.ts', activeChildren, {
    ...process.env,
    PIDEX_AUTH_TOKEN: token,
    PIDEX_DATA_DIR: agentDataDir,
    PIDEX_DOCUMENTS_DIR: join(isolatedRoot, 'documents'),
    PIDEX_LOG_DIR: join(isolatedRoot, 'agent-logs'),
    PIDEX_DESKTOP_MANAGED: '1',
    PIDEX_PORT: '0',
    PIDEX_RENDERER_DEV_URL: rendererOrigin,
    NO_PROXY: '127.0.0.1,localhost,::1',
    no_proxy: '127.0.0.1,localhost,::1',
  })
  const origin = await waitForAgentReady(
    agent,
    'review-concurrency-ready',
    activeChildren,
    'Review concurrency Agent',
  )
  await waitForHttpReady(origin, agent, 'Review concurrency Agent')

  process.stdout.write('[review-concurrency] 启动真实 Agent/Electron 并发 Review 验收\n')
  await runBun(
    ['run', '--cwd', 'apps/desktop/electron', 'test:review-concurrency'],
    activeChildren,
    {
      ...process.env,
      PIDEX_AGENT_URL: origin,
      PIDEX_AUTH_TOKEN: token,
      PIDEX_DATA_DIR: agentDataDir,
      PIDEX_REVIEW_CONCURRENCY_ROOT: isolatedRoot,
      PIDEX_PLAYWRIGHT_OUTPUT_DIR: join(isolatedRoot, 'playwright'),
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
    },
  )
  succeeded = true
  process.stdout.write('[review-concurrency] 全链路验收通过\n')
} catch (cause) {
  process.stderr.write(`[review-concurrency] ${errorMessage(cause)}\n`)
  if (isolatedRoot) {
    process.stderr.write(`[review-concurrency] 已保留失败现场：${isolatedRoot}\n`)
  }
  process.exitCode = 1
} finally {
  await cleanup()
}

if (process.platform === 'win32' && !existsSync(process.execPath)) {
  throw new Error('Review concurrency 测试未找到 Bun 可执行文件')
}
