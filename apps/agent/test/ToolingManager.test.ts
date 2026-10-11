import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, readdir, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { TOOLING_CATALOG, ToolingManager, type ToolingStatus } from '../src/tool/ToolingManager'

const roots: string[] = []
const originalGitBash = process.env.PIDEX_GIT_BASH_PATH
const originalRipgrep = process.env.PIDEX_RIPGREP_PATH
const originalNodejs = process.env.PIDEX_NODEJS_PATH
const originalPython = process.env.PIDEX_PYTHON_PATH

const temporaryRoot = async () => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-tooling-'))
  roots.push(root)
  return root
}

afterEach(async () => {
  process.env.PIDEX_GIT_BASH_PATH = originalGitBash
  process.env.PIDEX_RIPGREP_PATH = originalRipgrep
  process.env.PIDEX_NODEJS_PATH = originalNodejs
  process.env.PIDEX_PYTHON_PATH = originalPython
  await removeFixturePaths(roots.splice(0))
})

describe('ToolingManager', () => {
  test('catalog 固定版本、国内镜像优先、官方源兜底并保留归档摘要', () => {
    expect(TOOLING_CATALOG['git-bash'].version).toBe('2.55.0.3')
    expect(TOOLING_CATALOG.ripgrep.version).toBe('15.2.0')
    expect(TOOLING_CATALOG.nodejs).toMatchObject({
      version: '24.18.0',
      archiveSha256: '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821',
    })
    expect(TOOLING_CATALOG.python).toMatchObject({
      version: '3.14.6',
      archiveSha256: '14b3e9a710a3fcf0bd9b55ab6b60412bd91227563f813fc49040cabc0209e0bd',
    })
    for (const entry of Object.values(TOOLING_CATALOG)) {
      expect(new URL(entry.url).protocol).toBe('https:')
      expect(entry.mirrors?.length).toBeGreaterThan(0)
      for (const mirror of entry.mirrors ?? []) expect(new URL(mirror).protocol).toBe('https:')
      expect(entry.archiveSha256).toMatch(/^[a-f\d]{64}$/)
    }
  })

  test('国内镜像失败后自动尝试官方源且仍校验同一摘要', async () => {
    const root = await temporaryRoot()
    process.env.PIDEX_RIPGREP_PATH = join(root, 'missing-rg.exe')
    const requested: string[] = []
    const manager = new ToolingManager({
      root,
      fetch: (async (input: string | URL | Request) => {
        const url = String(input)
        requested.push(url)
        if (url === TOOLING_CATALOG.ripgrep.url) {
          return new Response('official but invalid in unit test', { status: 200 })
        }
        return new Response(null, { status: 503 })
      }) as unknown as typeof fetch,
    })

    await expect(manager.install('ripgrep', { force: true })).rejects.toThrow('SHA-256')
    expect(requested).toEqual([
      ...(TOOLING_CATALOG.ripgrep.mirrors ?? []),
      TOOLING_CATALOG.ripgrep.url,
    ])
  })

  test('ZIP 安全校验通过子进程环境传递路径', async () => {
    if (process.platform !== 'win32') return
    const root = await temporaryRoot()
    const archive = join(root, 'empty.zip')
    const destination = join(root, 'extract')
    await writeFile(archive, Buffer.from('504b0506000000000000000000000000000000000000', 'hex'))
    await mkdir(destination)

    const manager = new ToolingManager({ root })
    await expect(
      (manager as any).extract(TOOLING_CATALOG.ripgrep, archive, destination),
    ).resolves.toBeUndefined()
  })

  test('默认使用托管版并将独立来源偏好持久化到 tooling home', async () => {
    const root = await temporaryRoot()
    process.env.PIDEX_GIT_BASH_PATH = join(root, 'missing-bash.exe')
    process.env.PIDEX_RIPGREP_PATH = join(root, 'missing-rg.exe')
    process.env.PIDEX_NODEJS_PATH = join(root, 'missing-node.exe')
    process.env.PIDEX_PYTHON_PATH = join(root, 'missing-python.exe')
    const manager = new ToolingManager({ root })

    const initial = await manager.listStatuses()
    expect(initial.map((status) => [status.id, status.preference])).toEqual([
      ['nodejs', 'managed'],
      ['python', 'managed'],
      ['git-bash', 'managed'],
      ['ripgrep', 'managed'],
    ])
    await Promise.all([
      manager.setPreference('nodejs', 'system'),
      manager.setPreference('python', 'system'),
      manager.setPreference('git-bash', 'system'),
    ])

    const reloaded = new ToolingManager({ root })
    expect((await reloaded.getStatus('nodejs')).preference).toBe('system')
    expect((await reloaded.getStatus('python')).preference).toBe('system')
    expect((await reloaded.getStatus('git-bash')).preference).toBe('system')
    expect((await reloaded.getStatus('ripgrep')).preference).toBe('managed')
    const saved = JSON.parse(await readFile(join(root, 'v2', 'settings.json'), 'utf8'))
    expect(saved.preferences).toEqual({
      nodejs: 'system',
      python: 'system',
      'git-bash': 'system',
      ripgrep: 'managed',
    })
  })

  test('状态列表复用启动扫描缓存，显式刷新合并并发探测', async () => {
    const root = await temporaryRoot()
    const manager = new ToolingManager({ root })
    const probeTarget = manager as unknown as {
      probeStatus(id: ToolingStatus['id']): Promise<ToolingStatus>
    }
    let probeCount = 0
    let generation = 0
    let releaseProbe: (() => void) | undefined
    let probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve
    })
    probeTarget.probeStatus = async (id) => {
      probeCount += 1
      await probeGate
      return {
        id,
        preference: 'managed',
        phase: 'ready',
        activeSource: 'managed',
        pinnedVersion: `test-${generation}`,
        managed: { installed: true, version: `test-${generation}` },
        system: { available: false, version: null, path: null },
      }
    }

    const startupRefresh = manager.refreshStatuses()
    const initialList = manager.listStatuses()
    await Promise.resolve()
    releaseProbe?.()
    const [refreshed, listed] = await Promise.all([startupRefresh, initialList])

    expect(probeCount).toBe(4)
    expect(listed).toEqual(refreshed)
    expect(await manager.listStatuses()).toEqual(refreshed)
    expect(probeCount).toBe(4)

    generation = 1
    probeGate = new Promise<void>((resolve) => {
      releaseProbe = resolve
    })
    const firstManualRefresh = manager.refreshStatuses()
    const secondManualRefresh = manager.refreshStatuses()
    await Promise.resolve()
    releaseProbe?.()
    const [firstResult, secondResult] = await Promise.all([firstManualRefresh, secondManualRefresh])

    expect(probeCount).toBe(8)
    expect(secondResult).toEqual(firstResult)
    expect(firstResult.every((status) => status.pinnedVersion === 'test-1')).toBe(true)
  })

  test('刷新失败时保留上一次完整状态缓存', async () => {
    const root = await temporaryRoot()
    const manager = new ToolingManager({ root })
    const probeTarget = manager as unknown as {
      probeStatus(id: ToolingStatus['id']): Promise<ToolingStatus>
    }
    probeTarget.probeStatus = async (id) => ({
      id,
      preference: 'managed',
      phase: 'idle',
      activeSource: null,
      pinnedVersion: 'cached',
      managed: { installed: false, version: null },
      system: { available: false, version: null, path: null },
    })
    const cached = await manager.refreshStatuses()

    probeTarget.probeStatus = async (id) => {
      if (id === 'python') throw new Error('probe failed')
      return cached.find((status) => status.id === id)!
    }

    await expect(manager.refreshStatuses()).rejects.toThrow('probe failed')
    expect(await manager.listStatuses()).toEqual(cached)
  })

  test('v1 偏好与旧统一依赖开关会迁移到四项 v2 设置', async () => {
    const root = await temporaryRoot()
    await mkdir(join(root, 'v1'), { recursive: true })
    await writeFile(
      join(root, 'v1', 'settings.json'),
      JSON.stringify({
        version: 1,
        installPidexDependencies: false,
        preferences: { 'git-bash': 'system', ripgrep: 'managed' },
      }),
      'utf8',
    )
    const manager = new ToolingManager({ root })
    const statuses = await manager.listStatuses()
    expect(Object.fromEntries(statuses.map((status) => [status.id, status.preference]))).toEqual({
      nodejs: 'system',
      python: 'system',
      'git-bash': 'system',
      ripgrep: 'managed',
    })
  })

  test('显式旧依赖偏好仅迁移 Node.js 与 Python', async () => {
    const root = await temporaryRoot()
    const manager = new ToolingManager({ root, legacyInstallPidexDependencies: false })
    const statuses = await manager.listStatuses()
    expect(Object.fromEntries(statuses.map((status) => [status.id, status.preference]))).toEqual({
      nodejs: 'system',
      python: 'system',
      'git-bash': 'managed',
      ripgrep: 'managed',
    })
  })

  test('四项偏好并发更新时按顺序原子持久化且互不覆盖', async () => {
    const root = await temporaryRoot()
    const manager = new ToolingManager({ root })
    await Promise.all([
      manager.setPreference('nodejs', 'system'),
      manager.setPreference('python', 'system'),
      manager.setPreference('git-bash', 'system'),
    ])

    const reloaded = new ToolingManager({ root })
    const statuses = await reloaded.listStatuses()
    expect(Object.fromEntries(statuses.map((status) => [status.id, status.preference]))).toEqual({
      nodejs: 'system',
      python: 'system',
      'git-bash': 'system',
      ripgrep: 'managed',
    })
  })

  test('resolveEnvironment 对缺失依赖保留逐项结果且不注入 PATH', async () => {
    const root = await temporaryRoot()
    process.env.PIDEX_NODEJS_PATH = join(root, 'missing-node.exe')
    process.env.PIDEX_PYTHON_PATH = join(root, 'missing-python.exe')
    const manager = new ToolingManager({ root })
    await manager.setPreference('nodejs', 'system')
    await manager.setPreference('python', 'system')

    const environment = await manager.resolveEnvironment(['nodejs', 'python', 'nodejs'])
    expect(environment.pathEntries).toEqual([])
    expect([...environment.resolutions.keys()]).toEqual(['nodejs', 'python'])
    expect(environment.resolutions.get('nodejs')?.available).toBe(false)
    expect(environment.resolutions.get('python')?.available).toBe(false)
  })

  test('并发安装共用下载且摘要失败不会留下 staging 半成品', async () => {
    const root = await temporaryRoot()
    process.env.PIDEX_RIPGREP_PATH = join(root, 'missing-rg.exe')
    let requests = 0
    const manager = new ToolingManager({
      root,
      fetch: (async () => {
        requests += 1
        return new Response('tampered archive', {
          status: 200,
          headers: { 'content-length': '16' },
        })
      }) as unknown as typeof fetch,
    })

    const results = await Promise.allSettled([
      manager.install('ripgrep', { force: true }),
      manager.install('ripgrep', { force: true }),
    ])
    expect(requests).toBe((TOOLING_CATALOG.ripgrep.mirrors?.length ?? 0) + 1)
    expect(results.every((result) => result.status === 'rejected')).toBe(true)
    expect((await manager.getStatus('ripgrep')).error?.code).toBe('TOOLING_CHECKSUM_MISMATCH')
    expect(await readdir(join(root, '.staging'))).toEqual([])
  })
})
