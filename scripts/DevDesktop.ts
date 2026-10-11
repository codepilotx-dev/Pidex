import { existsSync } from 'node:fs'
import { mkdir, realpath } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  agentDataDir,
  allocateLoopbackPort,
  configuredRendererPort,
  createWorktreeInstance,
  localNoProxy,
  readDevAgentRuntime,
  readLegacyDevAgentRuntime,
  terminateProcessTree,
  verifyDevAgent,
} from './DevRuntime'

const root = fileURLToPath(new URL('..', import.meta.url))
const unavailable = '未发现可用的开发 Agent。请先在另一个终端运行：bun run dev:agent'
const legacyUnavailable = '检测到旧版开发 Agent。请停止后重新运行：bun run dev:agent'
const rendererUnavailable = 'Renderer 开发服务启动失败。请检查 PIDEX_DEV_RENDERER_PORT 或端口占用。'
type Child = ReturnType<typeof Bun.spawn>
const children: Child[] = []

function spawn(command: string[], env: Record<string, string | undefined> = {}) {
  const noProxy = localNoProxy(process.env.NO_PROXY ?? process.env.no_proxy)
  const child = Bun.spawn(command, {
    cwd: root,
    env: { ...process.env, NO_PROXY: noProxy, no_proxy: noProxy, ...env },
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  children.push(child)
  return child
}

/** Development start builds the native runtime only when the artifact is missing. */
async function ensureCuaRuntime() {
  if (existsSync(resolve(root, 'apps/desktop/native/cpx-cua/dist/cpx-cua.exe'))) return
  console.log('未发现 CPX-CUA 原生运行时，先执行构建…')
  const build = spawn(['bun', 'run', 'build:cua'])
  if ((await build.exited) !== 0) throw new Error('CPX-CUA 原生运行时构建失败')
}

async function waitForRenderer(child: Child, rendererOrigin: string) {
  const deadline = Date.now() + 20_000
  while (Date.now() < deadline) {
    const exited = await Promise.race([
      child.exited.then(() => true),
      Bun.sleep(150).then(() => false),
    ])
    if (exited) throw new Error('renderer exited')
    try {
      const response = await fetch(rendererOrigin, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      /* keep waiting */
    }
  }
  throw new Error('renderer timeout')
}

async function startRenderer(agentOrigin: string, authToken: string) {
  const configured = configuredRendererPort()
  const attempts = configured ? 1 : 3
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    let port: number
    try {
      port = await allocateLoopbackPort(configured)
    } catch {
      if (configured || attempt === attempts - 1) throw new Error('renderer port unavailable')
      continue
    }
    const rendererOrigin = `http://127.0.0.1:${port}`
    const renderer = spawn([process.execPath, 'run', '--cwd', 'apps/desktop/renderer', 'dev'], {
      PIDEX_RENDERER_PORT: String(port),
      PIDEX_AGENT_URL: agentOrigin,
      PIDEX_AUTH_TOKEN: authToken,
    })
    try {
      await waitForRenderer(renderer, rendererOrigin)
      return { renderer, rendererOrigin, port }
    } catch {
      terminateProcessTree(renderer)
      if (configured || attempt === attempts - 1) throw new Error('renderer unavailable')
    }
  }
  throw new Error('renderer unavailable')
}

let stopping = false
function stopOwnedChildren() {
  if (stopping) return
  stopping = true
  for (const child of children.toReversed()) terminateProcessTree(child)
}
process.on('SIGINT', stopOwnedChildren)
process.on('SIGTERM', stopOwnedChildren)
process.on('exit', stopOwnedChildren)

try {
  let runtime
  try {
    runtime = await readDevAgentRuntime()
  } catch {
    try {
      const legacy = await readLegacyDevAgentRuntime()
      if (await verifyDevAgent(legacy)) throw new Error('LEGACY_AGENT_RUNNING')
    } catch (error) {
      if (error instanceof Error && error.message === 'LEGACY_AGENT_RUNNING') throw error
    }
    throw new Error('AGENT_UNAVAILABLE')
  }
  if (!(await verifyDevAgent(runtime))) throw new Error('AGENT_UNAVAILABLE')

  const instance = createWorktreeInstance(await realpath(root))
  await mkdir(instance.userDataDir, { recursive: true, mode: 0o700 })
  await mkdir(instance.logDir, { recursive: true, mode: 0o700 })
  const { renderer, rendererOrigin, port } = await startRenderer(runtime.origin, runtime.authToken)
  console.log(`Renderer 已就绪（端口 ${port}，worktree ${instance.shortId}）。`)
  await ensureCuaRuntime()
  const electron = spawn([process.execPath, 'run', '--cwd', 'apps/desktop/electron', 'dev'], {
    PIDEX_AGENT_URL: runtime.origin,
    PIDEX_RENDERER_DEV_URL: rendererOrigin,
    PIDEX_AGENT_MANAGED: '1',
    PIDEX_AUTH_TOKEN: runtime.authToken,
    PIDEX_BUN_PATH: process.execPath,
    PIDEX_DATA_DIR: agentDataDir,
    PIDEX_USER_DATA_DIR: instance.userDataDir,
    PIDEX_LOG_DIR: instance.logDir,
    PIDEX_CONSOLE_LOG: process.env.PIDEX_CONSOLE_LOG ?? 'info',
    PIDEX_LOG_DETAIL: 'development',
  })
  const outcome = await Promise.race([
    electron.exited.then((code) => ({ source: 'Electron', code })),
    renderer.exited.then((code) => ({ source: 'Renderer', code })),
  ])
  if (outcome.source !== 'Electron' || outcome.code !== 0)
    console.error(`${outcome.source} 开发进程已退出（code=${outcome.code}）`)
  stopOwnedChildren()
  process.exit(outcome.source === 'Electron' ? outcome.code : outcome.code || 1)
} catch (error) {
  const code = error instanceof Error ? error.message : ''
  console.error(
    code === 'LEGACY_AGENT_RUNNING'
      ? legacyUnavailable
      : code.includes('renderer')
        ? rendererUnavailable
        : unavailable,
  )
  stopOwnedChildren()
  process.exit(1)
}
