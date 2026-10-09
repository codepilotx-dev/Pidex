import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import {
  isSidecarConnectStage,
  isSidecarFailureCode,
} from '../apps/desktop/electron/src/sidecar/FailureDiagnostics'
import { createIsolatedProcessEnvironment } from './ProcessEnvironment'
import { assertWindowsX64PE } from './WindowsPe'

const root = resolve(import.meta.dir, '..')
// 一轮 Sidecar 启动最多包含 60 秒 ready 消息等待与 20 秒健康检查。
// 为持久 runner 保留至少两轮完整恢复窗口，并给 Electron 冷启动留出余量。
const DESKTOP_READY_TIMEOUT_MS = 180_000
// The packaged terminal smoke contains several independently bounded phases.
// Leave room for three cold phases while retaining a strict process deadline.
const PACKAGED_TERMINAL_SMOKE_TIMEOUT_MS = 90_000
const applicationArgument = process.argv.find((argument) => argument.startsWith('--application='))
const application = applicationArgument
  ? resolve(applicationArgument.slice('--application='.length))
  : resolve(root, 'release/win-unpacked/Pidex Desktop.exe')
const resources = join(dirname(application), 'resources')
const agent = join(resources, 'agent/pidex-agent.exe')
if (!existsSync(application) || !existsSync(agent))
  throw new Error('x64 冒烟所需的桌面程序或 Agent 不存在')
await assertWindowsX64PE(application)
await assertWindowsX64PE(agent)

const isolatedRoot = await mkdtemp(join(tmpdir(), 'pidex-win-smoke-'))
const logDirectory = join(isolatedRoot, 'logs')
const token = crypto.randomUUID().replaceAll('-', '')
try {
  await assertPackagedTerminal(application, isolatedRoot)
} catch (cause) {
  await rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined)
  throw cause
}
const child = Bun.spawn([application, `--user-data-dir=${join(isolatedRoot, 'profile')}`], {
  cwd: dirname(application),
  env: createIsolatedProcessEnvironment(process.env, {
    APPDATA: join(isolatedRoot, 'appdata'),
    LOCALAPPDATA: join(isolatedRoot, 'localappdata'),
    PIDEX_AGENT_URL: undefined,
    PIDEX_AUTH_TOKEN: token,
    PIDEX_DATA_DIR: join(isolatedRoot, 'agent-home'),
    PIDEX_LOG_DIR: logDirectory,
    PIDEX_USER_DATA_DIR: join(isolatedRoot, 'profile'),
  }),
  stdin: 'ignore',
  stdout: 'ignore',
  stderr: 'ignore',
  windowsHide: true,
})

try {
  const ready = await Promise.race([
    waitForDesktopReady(join(logDirectory, 'desktop.jsonl'), DESKTOP_READY_TIMEOUT_MS),
    child.exited.then((exitCode) => {
      throw new Error(`桌面程序在 desktop.ready 前退出：${exitCode}`)
    }),
  ])
  const response = await fetch(`${ready.origin}/api/ready`, {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(2_000),
  })
  if (!response.ok || ((await response.json()) as { ok?: boolean }).ok !== true) {
    throw new Error(`Agent /api/ready 冒烟失败：HTTP ${response.status}`)
  }
  console.log(`[Pidex] desktop.ready and /api/ready smoke passed: ${ready.origin}`)
} finally {
  child.kill()
  if (process.platform === 'win32' && child.pid) {
    const cleanup = Bun.spawn(['taskkill.exe', '/PID', String(child.pid), '/T', '/F'], {
      stdout: 'ignore',
      stderr: 'ignore',
    })
    await cleanup.exited
  }
  await rm(isolatedRoot, { recursive: true, force: true }).catch(() => undefined)
}

async function assertPackagedTerminal(
  applicationPath: string,
  isolatedRoot: string,
): Promise<void> {
  const resultPath = join(isolatedRoot, 'terminal-smoke-result.json')
  const child = Bun.spawn(
    [
      applicationPath,
      `--user-data-dir=${join(isolatedRoot, 'terminal-profile')}`,
      '--pidex-packaged-terminal-smoke',
    ],
    {
      cwd: dirname(applicationPath),
      env: createIsolatedProcessEnvironment(process.env, {
        APPDATA: join(isolatedRoot, 'terminal-appdata'),
        LOCALAPPDATA: join(isolatedRoot, 'terminal-localappdata'),
        PIDEX_USER_DATA_DIR: join(isolatedRoot, 'terminal-user-data'),
        PIDEX_PACKAGED_TERMINAL_SMOKE_RESULT: resultPath,
      }),
      stdin: 'ignore',
      stdout: 'ignore',
      stderr: 'ignore',
      windowsHide: true,
    },
  )
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    const exitCode = await Promise.race([
      child.exited,
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                `打包 ConPTY 冒烟在 ${PACKAGED_TERMINAL_SMOKE_TIMEOUT_MS / 1_000} 秒内未完成`,
              ),
            ),
          PACKAGED_TERMINAL_SMOKE_TIMEOUT_MS,
        )
      }),
    ])
    if (exitCode !== 0) throw new Error(`打包 Electron ConPTY 冒烟退出码异常：${exitCode}`)
    const result = JSON.parse(await readFile(resultPath, 'utf8')) as Record<string, unknown>
    if (
      result.ok !== true ||
      result.nodePtyLoaded !== true ||
      result.conptyOutput !== true ||
      result.exitCode !== 23 ||
      result.processTreeCleaned !== true
    ) {
      throw new Error('打包 Electron ConPTY 冒烟结果无效')
    }
    console.log(
      '[Pidex] packaged node-pty/ConPTY output, exit and process cleanup smoke passed',
    )
  } finally {
    if (timer) clearTimeout(timer)
    child.kill()
    if (process.platform === 'win32' && child.pid) {
      const cleanup = Bun.spawn(['taskkill.exe', '/PID', String(child.pid), '/T', '/F'], {
        stdout: 'ignore',
        stderr: 'ignore',
        windowsHide: true,
      })
      await cleanup.exited
    }
  }
}

async function waitForDesktopReady(
  logPath: string,
  timeoutMs: number,
): Promise<{ origin: string }> {
  const deadline = Date.now() + timeoutMs
  let recentEvents: string[] = []
  let recentFailureKinds: string[] = []
  while (Date.now() < deadline) {
    const text = await readFile(logPath, 'utf8').catch(() => '')
    if (/ENOENT/i.test(text)) throw new Error('桌面启动日志出现 ENOENT')
    const records = text.split(/\r?\n/).flatMap((line) => {
      try {
        return line
          ? [
              JSON.parse(line) as {
                event?: string
                details?: {
                  origin?: string
                  message?: unknown
                  stage?: unknown
                  failureCode?: unknown
                }
              },
            ]
          : []
      } catch {
        return []
      }
    })
    recentEvents = records
      .flatMap((record) => (typeof record.event === 'string' ? [record.event] : []))
      .slice(-12)
    const failure = records.find((record) => record.event === 'desktop.startup-failed')
    recentFailureKinds = records
      .filter((record) => record.event === 'sidecar.connect-failed')
      .map((record) =>
        classifySidecarFailure(
          record.details?.stage,
          record.details?.failureCode,
          record.details?.message,
        ),
      )
      .slice(-6)
    if (failure) throw new Error('桌面启动记录 desktop.startup-failed')
    const ready = records.find(
      (record) => record.event === 'desktop.ready' && typeof record.details?.origin === 'string',
    )
    if (ready?.details?.origin) return { origin: ready.details.origin }
    await Bun.sleep(100)
  }
  const eventTrail = recentEvents.length > 0 ? recentEvents.join(' -> ') : '无'
  const failureTrail = recentFailureKinds.length > 0 ? recentFailureKinds.join(' -> ') : '无'
  throw new Error(
    `桌面程序 ${timeoutMs / 1_000} 秒内未记录 desktop.ready（最近事件：${eventTrail}；Sidecar 失败类型：${failureTrail}）`,
  )
}

function classifySidecarFailure(stage: unknown, failureCode: unknown, message: unknown): string {
  if (isSidecarConnectStage(stage)) {
    const code = isSidecarFailureCode(failureCode) ? failureCode : 'unknown'
    return `${stage}/${code}`
  }
  if (typeof message !== 'string') return 'unknown'
  if (message.includes('等待 Agent ready 消息超时')) return 'agent-ready-timeout'
  if (message.includes('Agent 在 ready 前退出')) return 'agent-exited-before-ready'
  if (message.includes('Agent 就绪检查超时')) return 'agent-health-timeout'
  return 'other'
}
