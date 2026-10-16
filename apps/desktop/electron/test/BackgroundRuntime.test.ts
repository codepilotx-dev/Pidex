import { expect, test } from 'bun:test'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { LocalBackgroundRuntime } from '../src/sidecar/BackgroundRuntime'

const encryption = {
  encryptString: (text: string) => Buffer.from([...text].reverse().join('')),
  decryptString: (bytes: Buffer) => [...bytes.toString()].reverse().join(''),
}

test('父进程退出后后台继续执行，重开复用同一实例并可显式停止', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-background-'))
  const runtime = new LocalBackgroundRuntime(directory, encryption)
  let owner: ReturnType<typeof Bun.spawn> | undefined
  let pid: number | undefined
  try {
    owner = Bun.spawn([process.execPath, join(import.meta.dir, 'fixtures/BackgroundOwner.ts'), directory,
      process.execPath, join(import.meta.dir, 'fixtures/BackgroundAgent.ts')], { stdout: 'pipe', stderr: 'pipe' })
    const exited = await Promise.race([owner.exited, Bun.sleep(15_000).then(() => 'timeout')])
    if (exited !== 0) throw new Error(`启动器未正常退出：${exited}`)
    const connection = JSON.parse(await new Response(owner.stdout).text()) as { origin: string }
    const token = await runtime.initialize()
    const record = JSON.parse(await readFile(join(directory, 'desktop-agent.json'), 'utf8'))
    pid = record.pid
    expect(record.encryptedToken).not.toBe(token)
    const command = { executable: process.execPath, args: [join(import.meta.dir, 'fixtures/BackgroundAgent.ts')], cwd: import.meta.dir }
    const reused = await runtime.connect(command, process.env)
    expect(reused.origin).toBe(connection.origin)
    const before = await tick(directory)
    await Bun.sleep(150)
    expect(await tick(directory)).toBeGreaterThan(before)
    expect(JSON.parse(await readFile(join(directory, 'desktop-agent.json'), 'utf8')).pid).toBe(pid)
    await runtime.shutdown()
    expect(JSON.parse(await readFile(join(directory, 'desktop-agent.json'), 'utf8')).pid).toBeNull()
    pid = undefined
  } finally {
    owner?.kill()
    if (!pid) {
      const record = await readFile(join(directory, 'desktop-agent.json'), 'utf8').catch(() => null)
      if (record) pid = JSON.parse(record).pid ?? undefined
    }
    if (pid) { try { process.kill(pid) } catch { /* Already stopped. */ } }
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)

test('不支持的运行信息保留原文件，不启动或覆盖后端', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'pidex-background-invalid-'))
  const file = join(directory, 'desktop-agent.json')
  const contents = '{"version":999,"unknown":"preserve"}'
  try {
    await writeFile(file, contents, 'utf8')
    await expect(new LocalBackgroundRuntime(directory, encryption).initialize()).rejects.toThrow('保留原文件')
    expect(await readFile(file, 'utf8')).toBe(contents)
  } finally { await rm(directory, { recursive: true, force: true }) }
})

async function tick(directory: string) {
  for (let attempt = 0; attempt < 50; attempt++) {
    const value = Number(await readFile(join(directory, 'ticks'), 'utf8').catch(() => ''))
    if (value > 0) return value
    await Bun.sleep(10)
  }
  throw new Error('后台任务没有进展')
}
