import { describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  allocateLoopbackPort,
  allocateDevAgentPort,
  configuredRendererPort,
  createWorktreeInstance,
  parseDevAgentRuntime,
  parseDevDesktopArgs,
  parseLegacyDevAgentRuntime,
  resolveDevAgentLaunchConnection,
  verifyDevAgent,
} from './DevRuntime'

const validRuntime = {
  schemaVersion: 2 as const,
  ownerPid: 100,
  agentPid: 101,
  origin: 'http://127.0.0.1:43121',
  authToken: 'auth-token-123456789',
  instanceToken: 'instance-token-123456789',
}

const legacyRuntime = {
  ...validRuntime,
  schemaVersion: 1 as const,
  rendererDevUrl: 'http://127.0.0.1:7788' as const,
}

describe('开发 Agent runtime 描述', () => {
  test('接受不携带 Renderer 地址的 v2 回环 Agent 描述', () => {
    expect(parseDevAgentRuntime(JSON.stringify(validRuntime))).toEqual(validRuntime)
    expect(parseLegacyDevAgentRuntime(JSON.stringify(legacyRuntime))).toEqual(legacyRuntime)
  })

  test('健康检查同时校验 bearer token 和实例标识', async () => {
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        if (request.headers.get('authorization') !== `Bearer ${validRuntime.authToken}`)
          return new Response(null, { status: 401 })
        return Response.json({ ok: true, instanceToken: validRuntime.instanceToken })
      },
    })
    try {
      const runtime = { ...validRuntime, origin: `http://127.0.0.1:${server.port}` }
      expect(await verifyDevAgent(runtime)).toBe(true)
      expect(await verifyDevAgent({ ...runtime, instanceToken: 'another-instance-token' })).toBe(
        false,
      )
    } finally {
      await server.stop(true)
    }
  })

  test.each([
    { ...validRuntime, schemaVersion: 1 },
    { ...validRuntime, rendererDevUrl: 'http://127.0.0.1:7788' },
    { ...validRuntime, origin: 'https://127.0.0.1:43121' },
    { ...validRuntime, origin: 'http://localhost:43121' },
    { ...validRuntime, origin: 'http://127.0.0.1:43121/path' },
    { ...validRuntime, authToken: 'short' },
    { ...validRuntime, unexpected: 'secret' },
  ])('拒绝不受支持或扩展的 v2 描述 %#', (runtime) => {
    expect(() => parseDevAgentRuntime(JSON.stringify(runtime))).toThrow(
      'invalid runtime descriptor',
    )
  })

  test('首次启动生成新认证令牌并保留动态端口', () => {
    let tokenCount = 0
    expect(
      resolveDevAgentLaunchConnection(undefined, undefined, () => `new-auth-token-${++tokenCount}`),
    ).toEqual({ port: undefined, authToken: 'new-auth-token-1', reused: false })
  })

  test('普通重启复用历史端口和认证令牌', () => {
    let tokenCount = 0
    expect(
      resolveDevAgentLaunchConnection(
        validRuntime,
        undefined,
        () => `new-auth-token-${++tokenCount}`,
      ),
    ).toEqual({ port: 43121, authToken: validRuntime.authToken, reused: true })
    expect(tokenCount).toBe(0)
  })

  test('显式沿用历史端口时继续复用认证令牌', () => {
    let tokenCount = 0
    expect(
      resolveDevAgentLaunchConnection(validRuntime, 43121, () => `new-auth-token-${++tokenCount}`),
    ).toEqual({ port: 43121, authToken: validRuntime.authToken, reused: true })
    expect(tokenCount).toBe(0)
  })

  test('显式修改端口时轮换连接身份', () => {
    expect(
      resolveDevAgentLaunchConnection(validRuntime, 43122, () => 'replacement-auth-token'),
    ).toEqual({ port: 43122, authToken: 'replacement-auth-token', reused: false })
  })

  test('重启发布新实例后 cleanup 仅释放 lock 并保留连接描述', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'pidex-runtime-reconnect-'))
    const script = `
      const runtime = await import("./scripts/DevRuntime.ts")
      const previous = ${JSON.stringify(validRuntime)}
      await (await import("node:fs/promises")).mkdir(runtime.runtimeDir, { recursive: true })
      await Bun.write(runtime.runtimeFile, JSON.stringify(previous))
      const reused = await runtime.acquireDevAgentLock("next-instance-token-123456789")
      const next = {
        ...previous,
        ownerPid: process.pid,
        agentPid: process.pid + 1,
        authToken: reused?.authToken ?? "missing-reused-token",
        instanceToken: "next-instance-token-123456789",
      }
      await runtime.publishDevAgentRuntime(next)
      await runtime.cleanupDevAgentRuntime(next.instanceToken)
      console.log(JSON.stringify({
        reused,
        published: JSON.parse(await Bun.file(runtime.runtimeFile).text()),
        lockExists: await Bun.file(runtime.lockFile).exists(),
      }))
    `
    try {
      const child = Bun.spawn([process.execPath, '-e', script], {
        cwd: new URL('..', import.meta.url).pathname.slice(1),
        env: { ...process.env, PIDEX_DATA_DIR: dataDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(stderr).toBe('')
      expect(code).toBe(0)
      const result = JSON.parse(stdout) as {
        reused: typeof validRuntime | null
        published: typeof validRuntime
        lockExists: boolean
      }
      expect(result.reused).toEqual(validRuntime)
      expect(result.published).toEqual({
        ...validRuntime,
        ownerPid: expect.any(Number),
        agentPid: expect.any(Number),
        instanceToken: 'next-instance-token-123456789',
      })
      expect(result.published.ownerPid).not.toBe(validRuntime.ownerPid)
      expect(result.published.agentPid).not.toBe(validRuntime.agentPid)
      expect(result.lockExists).toBe(false)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test.skipIf(process.platform !== 'win32')(
    'Windows PID 复用释放旧锁，仍保护真实存活的启动器',
    async () => {
      const dataDir = await mkdtemp(join(tmpdir(), 'pidex-runtime-reused-pid-'))
      const script = `
      const runtime = await import("./scripts/DevRuntime.ts")
      const { mkdir, utimes } = await import("node:fs/promises")
      await mkdir(runtime.runtimeDir, { recursive: true })
      const heldToken = "held-instance-token-123456789"
      const nextToken = "next-instance-token-123456789"
      const lock = { schemaVersion: 1, ownerPid: process.pid, instanceToken: heldToken }
      await Bun.write(runtime.lockFile, JSON.stringify(lock))
      await utimes(runtime.lockFile, new Date(0), new Date(0))
      await runtime.acquireDevAgentLock(nextToken)
      await runtime.cleanupDevAgentRuntime(nextToken)
      await Bun.write(runtime.lockFile, JSON.stringify(lock))
      try {
        await runtime.acquireDevAgentLock(nextToken)
        throw new Error("live owner was not protected")
      } catch (error) {
        if (error.message !== "AGENT_LOCKED") throw error
      } finally { await runtime.cleanupDevAgentRuntime(heldToken) }
      console.log("recovered stale lock; protected live owner")
    `
      try {
        const child = Bun.spawn([process.execPath, '-e', script], {
          cwd: new URL('..', import.meta.url).pathname.slice(1),
          env: { ...process.env, PIDEX_DATA_DIR: dataDir },
          stdout: 'pipe',
          stderr: 'pipe',
        })
        const [code, stdout, stderr] = await Promise.all([
          child.exited,
          new Response(child.stdout).text(),
          new Response(child.stderr).text(),
        ])
        expect(code).toBe(0)
        expect(stderr).toBe('')
        expect(stdout.trim()).toBe('recovered stale lock; protected live owner')
      } finally {
        await rm(dataDir, { recursive: true, force: true })
      }
    },
    15_000,
  )

  test('显式指定的历史端口被占用时安全失败并保留原连接描述', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'pidex-runtime-port-busy-'))
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch: () => Response.json({ ok: true, instanceToken: 'foreign-instance-token' }),
    })
    const descriptor = {
      ...validRuntime,
      origin: `http://127.0.0.1:${server.port}`,
    }
    try {
      const runtimeDirectory = join(dataDir, 'runtime')
      const descriptorPath = join(runtimeDirectory, 'dev-agent-v2.json')
      await mkdir(runtimeDirectory, { recursive: true })
      await writeFile(descriptorPath, JSON.stringify(descriptor), 'utf8')
      const child = Bun.spawn([process.execPath, 'run', 'scripts/DevAgent.ts'], {
        cwd: new URL('..', import.meta.url).pathname.slice(1),
        env: { ...process.env, PIDEX_DATA_DIR: dataDir, PIDEX_DEV_AGENT_PORT: String(server.port) },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr.trim()).toBe(
        '上次的开发 Agent 端口仍被占用。请释放该端口后重试，并保持 Desktop 运行。',
      )
      expect(await readFile(descriptorPath, 'utf8')).toBe(JSON.stringify(descriptor))
    } finally {
      await server.stop(true)
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})

describe('worktree Desktop 实例', () => {
  test('旧 Agent 和启动器已退出时允许避开占用端口，存活实例或显式端口仍拒绝', async () => {
    const retired = Bun.spawn([process.execPath, '-e', 'process.exit(0)'], { stdout: 'ignore', stderr: 'ignore' })
    await retired.exited
    const server = Bun.serve({ hostname: '127.0.0.1', port: 0, fetch: () => new Response('occupied') })
    const previous = { ...validRuntime, ownerPid: retired.pid, agentPid: retired.pid, origin: `http://127.0.0.1:${server.port}` }
    const connection = resolveDevAgentLaunchConnection(previous, undefined, () => 'unused-token')
    try {
      const port = await allocateDevAgentPort(connection, previous, undefined)
      expect(port).toBeGreaterThan(0)
      expect(port).not.toBe(server.port)
      expect(connection.authToken).toBe(previous.authToken)
      await expect(allocateDevAgentPort(connection, { ...previous, agentPid: process.pid }, undefined)).rejects.toThrow('AGENT_RECONNECT_PORT_UNAVAILABLE')
      await expect(allocateDevAgentPort(connection, { ...previous, ownerPid: process.pid }, undefined)).rejects.toThrow('AGENT_RECONNECT_PORT_UNAVAILABLE')
      await expect(allocateDevAgentPort(connection, previous, server.port)).rejects.toThrow('AGENT_RECONNECT_PORT_UNAVAILABLE')
    } finally { await server.stop(true) }
  })
  test('规范路径生成稳定且相互隔离的实例目录', () => {
    const first = createWorktreeInstance('C:/project/main', 'C:/data')
    const repeated = createWorktreeInstance('C:/project/main/', 'C:/data')
    const second = createWorktreeInstance('C:/project/feature', 'C:/data')
    expect(first).toEqual(repeated)
    expect(first.id).toHaveLength(64)
    expect(first.id).not.toBe(second.id)
    expect(first.userDataDir).toContain(join('runtime', 'dev-desktops', first.id, 'user-data'))
    expect(first.logDir).toContain(join('runtime', 'dev-desktops', first.id, 'logs'))
  })

  test('动态分配回环端口并拒绝占用的显式端口', async () => {
    const port = await allocateLoopbackPort()
    expect(port).toBeGreaterThan(0)
    const server = Bun.serve({ hostname: '127.0.0.1', port, fetch: () => new Response('ok') })
    try {
      await expect(allocateLoopbackPort(port)).rejects.toThrow()
    } finally {
      await server.stop(true)
    }
  })

  test('显式 Renderer 端口使用严格数值范围', () => {
    expect(configuredRendererPort('43122')).toBe(43122)
    expect(configuredRendererPort()).toBeUndefined()
    expect(() => configuredRendererPort('0')).toThrow('invalid configured renderer port')
    expect(() => configuredRendererPort('not-a-port')).toThrow('invalid configured renderer port')
    expect(() => configuredRendererPort('65536')).toThrow('invalid configured renderer port')
  })
})

describe('独立开发启动命令', () => {
  test('Agent 与 Desktop launcher 的进程所有权和 origin 相互独立', async () => {
    const agent = await readFile(new URL('./DevAgent.ts', import.meta.url), 'utf8')
    const desktop = await readFile(new URL('./DevDesktop.ts', import.meta.url), 'utf8')
    expect(agent).toContain('PIDEX_SIDECAR_INSTANCE_TOKEN: instanceToken')
    expect(agent).not.toContain('PIDEX_RENDERER_DEV_URL')
    expect(desktop).toMatch(/PIDEX_AGENT_MANAGED:\s*['"]1['"]/)
    expect(desktop).toContain('PIDEX_RENDERER_DEV_URL: rendererOrigin')
    expect(desktop).toContain('PIDEX_USER_DATA_DIR: instance.userDataDir')
    expect(desktop).not.toContain('/api/shutdown')
    expect(desktop).not.toContain('apps/agent/src/index.ts')
  })

  test('开发启动只接受文档化的 --no-build', () => {
    expect(parseDevDesktopArgs()).toEqual({ noBuild: false })
    expect(parseDevDesktopArgs(['--no-build'])).toEqual({ noBuild: true })
    expect(() => parseDevDesktopArgs(['--no-build', '--fast'])).toThrow(
      'invalid dev desktop argument',
    )
  })

  test('原生运行时构建复用当前 Bun 可执行文件，不依赖 PATH 中的裸名', async () => {
    const desktop = await readFile(new URL('./DevDesktop.ts', import.meta.url), 'utf8')
    expect(desktop).toContain("[process.execPath, 'run', 'build:cua']")
    expect(desktop).not.toContain("spawn(['bun'")
  })

  test('未知启动参数立即失败并保留可用参数提示', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'pidex-unknown-argument-'))
    try {
      const child = Bun.spawn([process.execPath, 'run', 'scripts/DevDesktop.ts', '--fast'], {
        cwd: new URL('..', import.meta.url).pathname.slice(1),
        env: { ...process.env, PIDEX_DATA_DIR: dataDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr.trim()).toBe('开发启动参数不受支持。当前仅支持：--no-build')
      expect(stderr).not.toContain(dataDir)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('没有 Agent 时 Desktop 只输出安全启动提示', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'pidex-missing-runtime-'))
    try {
      const child = Bun.spawn([process.execPath, 'run', 'scripts/DevDesktop.ts'], {
        cwd: new URL('..', import.meta.url).pathname.slice(1),
        env: { ...process.env, PIDEX_DATA_DIR: dataDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [code, stdout, stderr] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ])
      expect(code).toBe(1)
      expect(stdout).toBe('')
      expect(stderr.trim()).toBe('未发现可用的开发 Agent。请先在另一个终端运行：bun run dev:agent')
      expect(stderr).not.toContain(dataDir)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  test('健康 v1 Agent 要求重启且不被 Desktop 覆盖', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'pidex-legacy-runtime-'))
    const server = Bun.serve({
      hostname: '127.0.0.1',
      port: 0,
      fetch(request) {
        if (request.headers.get('authorization') !== `Bearer ${legacyRuntime.authToken}`)
          return new Response(null, { status: 401 })
        return Response.json({ instanceToken: legacyRuntime.instanceToken })
      },
    })
    const descriptor = {
      ...legacyRuntime,
      ownerPid: process.pid,
      agentPid: process.pid,
      origin: `http://127.0.0.1:${server.port}`,
    }
    try {
      const runtimeDirectory = join(dataDir, 'runtime')
      await mkdir(runtimeDirectory, { recursive: true })
      const descriptorPath = join(runtimeDirectory, 'dev-agent-v1.json')
      await writeFile(descriptorPath, JSON.stringify(descriptor), 'utf8')
      const child = Bun.spawn([process.execPath, 'run', 'scripts/DevDesktop.ts'], {
        cwd: new URL('..', import.meta.url).pathname.slice(1),
        env: { ...process.env, PIDEX_DATA_DIR: dataDir },
        stdout: 'pipe',
        stderr: 'pipe',
      })
      const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
      expect(code).toBe(1)
      expect(stderr.trim()).toBe('检测到旧版开发 Agent。请停止后重新运行：bun run dev:agent')
      expect(await readFile(descriptorPath, 'utf8')).toBe(JSON.stringify(descriptor))
    } finally {
      await server.stop(true)
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
