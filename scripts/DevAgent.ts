import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  acquireDevAgentLock,
  agentDataDir,
  allocateLoopbackPort,
  cleanupDevAgentRuntime,
  localNoProxy,
  publishDevAgentRuntime,
  resolveDevAgentLaunchConnection,
  terminateProcessTree,
} from './DevRuntime'

const root = fileURLToPath(new URL('..', import.meta.url))
const instanceToken = crypto.randomUUID()

function configuredAgentPort() {
  const value = process.env.PIDEX_DEV_AGENT_PORT?.trim()
  if (!value) return undefined
  const port = Number(value)
  if (!Number.isInteger(port) || port < 1 || port > 65_535)
    throw new Error('invalid configured port')
  return port
}

function forwardStream(
  stream: ReadableStream<Uint8Array> | number | null,
  errorOutput: boolean,
  onLine?: (line: string) => void,
) {
  if (!stream || typeof stream === 'number') return Promise.resolve()
  return (async () => {
    const reader = stream.getReader()
    const decoder = new TextDecoder('utf-8')
    let pending = ''
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      pending += decoder.decode(value, { stream: true })
      const lines = pending.split(/\r?\n/)
      pending = lines.pop() ?? ''
      for (const line of lines) {
        onLine?.(line)
        if (errorOutput) console.error(line)
        else if (!line.includes('"type":"ready"')) console.log(line)
      }
    }
  })()
}

async function run() {
  const previousRuntime = await acquireDevAgentLock(instanceToken)
  const configuredPort = configuredAgentPort()
  const connection = resolveDevAgentLaunchConnection(previousRuntime, configuredPort, () =>
    crypto.randomUUID(),
  )
  let port: number
  try {
    port = await allocateLoopbackPort(connection.port)
  } catch {
    throw new Error(
      connection.reused ? 'AGENT_RECONNECT_PORT_UNAVAILABLE' : 'AGENT_PORT_UNAVAILABLE',
    )
  }
  if (previousRuntime && configuredPort !== undefined && !connection.reused) {
    console.warn('开发 Agent 端口配置已变更；正在运行的 Desktop 需要重启。')
  }
  const authToken = connection.authToken
  const origin = `http://127.0.0.1:${port}`
  const noProxy = localNoProxy(process.env.NO_PROXY ?? process.env.no_proxy)
  const agentLogDir = join(agentDataDir, 'logs')
  const agent = Bun.spawn([process.execPath, 'apps/agent/src/index.ts'], {
    cwd: root,
    env: {
      ...process.env,
      NO_PROXY: noProxy,
      no_proxy: noProxy,
      PORT: String(port),
      PIDEX_PORT: String(port),
      PIDEX_AUTH_TOKEN: authToken,
      PIDEX_DESKTOP_MANAGED: '1',
      PIDEX_SIDECAR_INSTANCE_TOKEN: instanceToken,
      PIDEX_DATA_DIR: agentDataDir,
      PIDEX_PETS_DIR: join(agentDataDir, 'pets'),
      PIDEX_TOOLING_HOME: join(agentDataDir, 'tooling'),
      PIDEX_BUILTIN_SKILLS_DIR: join(root, 'apps', 'agent', 'resources', 'skills'),
      PIDEX_BUILTIN_PLUGINS_DIR: join(root, 'apps', 'agent', 'resources', 'plugins'),
      PIDEX_LEGACY_DATA_DIR: join(root, '.pidex'),
      PIDEX_LOG_DIR: agentLogDir,
      PIDEX_CONSOLE_LOG: process.env.PIDEX_CONSOLE_LOG ?? 'info',
      PIDEX_LOG_DETAIL: 'development',
      PIDEX_RENDERER_DIST: fileURLToPath(new URL('../dist/renderer', import.meta.url)),
    },
    stdin: 'inherit',
    stdout: 'pipe',
    stderr: 'pipe',
  })

  let resolveReady!: () => void
  let rejectReady!: (error: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  const readyTimeout = setTimeout(() => rejectReady(new Error('agent timeout')), 20_000)
  void agent.exited.then((code) => rejectReady(new Error(`agent exited ${code}`)))
  void forwardStream(agent.stdout, false, (line) => {
    try {
      const value = JSON.parse(line) as {
        type?: unknown
        port?: unknown
        url?: unknown
        instanceToken?: unknown
      }
      if (value.type !== 'ready') return
      if (value.port !== port || value.url !== origin || value.instanceToken !== instanceToken) {
        rejectReady(new Error('ready identity mismatch'))
      } else resolveReady()
    } catch {
      /* normal Agent log line */
    }
  })
  void forwardStream(agent.stderr, true)

  let stopping = false
  const stop = () => {
    if (stopping) return
    stopping = true
    terminateProcessTree(agent)
  }
  process.on('SIGINT', stop)
  process.on('SIGTERM', stop)

  try {
    await ready
    clearTimeout(readyTimeout)
    const response = await fetch(`${origin}/api/ready`, {
      headers: { Authorization: `Bearer ${authToken}` },
      signal: AbortSignal.timeout(1_000),
    })
    const body = (await response.json()) as { instanceToken?: unknown }
    if (!response.ok || body.instanceToken !== instanceToken)
      throw new Error('health identity mismatch')
    await publishDevAgentRuntime({
      schemaVersion: 2,
      ownerPid: process.pid,
      agentPid: agent.pid,
      origin,
      authToken,
      instanceToken,
    })
    console.log('开发 Agent 已就绪。现在可在另一个终端运行：bun run dev:desktop')
    const code = await agent.exited
    if (!stopping && code !== 0) process.exitCode = code || 1
  } finally {
    clearTimeout(readyTimeout)
    stop()
    await cleanupDevAgentRuntime(instanceToken)
  }
}

try {
  await run()
} catch (error) {
  await cleanupDevAgentRuntime(instanceToken)
  const code = error instanceof Error ? error.message : ''
  console.error(
    code === 'AGENT_ALREADY_RUNNING'
      ? '开发 Agent 已在运行。'
      : code === 'LEGACY_AGENT_RUNNING'
        ? '检测到旧版开发 Agent。请停止后重新运行：bun run dev:agent'
        : code === 'AGENT_LOCKED'
          ? '另一个开发 Agent 正在启动或仍持有启动锁。'
          : code === 'AGENT_RECONNECT_PORT_UNAVAILABLE'
            ? '上次的开发 Agent 端口仍被占用。请释放该端口后重试，并保持 Desktop 运行。'
            : code === 'AGENT_PORT_UNAVAILABLE'
              ? '开发 Agent 端口不可用。'
              : '开发 Agent 启动失败。',
  )
  process.exit(1)
}
