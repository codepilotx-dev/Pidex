import { afterEach, beforeEach, expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { mkdtemp, readdir, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import {
  CUA_ARTIFACT,
  prepareCuaRuntime,
  hasCachedCuaRuntime,
  resolveCpxCuaExecutable,
  type CuaFetcher,
} from '../src/computer/CuaRuntimeArtifact'

const bytes = new TextEncoder().encode('fixture executable bytes')
const releasedDigest = CUA_ARTIFACT.sha256
let root: string
beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'pidex-cua-download-'))
  // Keep the production pinning path while supplying a small fixture release.
  Object.assign(CUA_ARTIFACT, { sha256: createHash('sha256').update(bytes).digest('hex') })
})
afterEach(async () => {
  Object.assign(CUA_ARTIFACT, { sha256: releasedDigest })
  await rm(root, { recursive: true, force: true })
})
const signal = () => new AbortController().signal
const ignore = async () => {}

test('下载固定 Release、验证摘要并原子缓存，之后离线复用', async () => {
  let requests = 0
  const statuses: Array<number | undefined> = []
  const fetcher: CuaFetcher = async (url, init, onProgress) => {
    requests++
    expect(url).toBe(
      `https://github.com/Pidex-Dev/cua/releases/download/${CUA_ARTIFACT.tag}/cpx-cua.exe`,
    )
    expect(init.redirect).toBe('manual')
    onProgress?.(CUA_ARTIFACT.size / 2)
    return new Response(bytes)
  }
  const executable = await prepareCuaRuntime(
    root,
    signal(),
    async (progress) => {
      statuses.push(progress)
    },
    fetcher,
  )
  expect(new Uint8Array(await readFile(executable))).toEqual(bytes)
  expect(await readdir(dirname(executable))).toEqual(['cpx-cua.exe'])
  expect(
    await prepareCuaRuntime(root, signal(), ignore, async () => {
      throw new Error('offline')
    }),
  ).toBe(executable)
  expect(requests).toBe(1)
  expect(statuses).toEqual([0, 50, 100])
  expect(await hasCachedCuaRuntime(root)).toBe(true)
})

test('允许 GitHub CDN 重定向，拒绝其他下载来源', async () => {
  let requests = 0
  const fetcher: CuaFetcher = async () =>
    ++requests === 1
      ? new Response(null, {
          status: 302,
          headers: {
            location:
              'https://release-assets.githubusercontent.com/github-production-release-asset/test',
          },
        })
      : new Response(bytes)
  await prepareCuaRuntime(root, signal(), ignore, fetcher)
  expect(requests).toBe(2)
  await rm(resolveCpxCuaExecutable(root))
  requests = 0
  await expect(
    prepareCuaRuntime(root, signal(), ignore, async () => {
      requests++
      return new Response(null, {
        status: 302,
        headers: { location: 'https://example.com/other.exe' },
      })
    }),
  ).rejects.toMatchObject({ code: 'download_failed' })
  expect(requests).toBe(1)
})

test('错误摘要不安装，损坏缓存只在正确下载后替换', async () => {
  await expect(
    prepareCuaRuntime(root, signal(), ignore, async () => new Response('corrupt')),
  ).rejects.toMatchObject({ code: 'integrity_failed' })
  const executable = resolveCpxCuaExecutable(root)
  expect(await readdir(dirname(executable))).toEqual([])
  await writeFile(executable, 'corrupt cache')
  await expect(
    prepareCuaRuntime(root, signal(), ignore, async () => new Response(null, { status: 404 })),
  ).rejects.toMatchObject({ code: 'download_failed' })
  expect(await readFile(executable, 'utf8')).toBe('corrupt cache')
  await prepareCuaRuntime(root, signal(), ignore, async () => new Response(bytes))
  expect(new Uint8Array(await readFile(executable))).toEqual(bytes)
})

test('取消流式下载不留下可执行文件，之后可以重试', async () => {
  const abort = new AbortController()
  let opened = false
  const fetcher: CuaFetcher = async (_url, init) =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(bytes.slice(0, 3))
          opened = true
          init.signal!.addEventListener(
            'abort',
            () => controller.error(new DOMException('aborted', 'AbortError')),
            { once: true },
          )
        },
      }),
    )
  const preparing = prepareCuaRuntime(root, abort.signal, ignore, fetcher)
  while (!opened) await Bun.sleep(1)
  abort.abort()
  await expect(preparing).rejects.toMatchObject({ name: 'AbortError' })
  const directory = dirname(resolveCpxCuaExecutable(root))
  await mkdir(directory, { recursive: true })
  expect(await readdir(directory)).toEqual([])
  await prepareCuaRuntime(root, signal(), ignore, async () => new Response(bytes))
})
