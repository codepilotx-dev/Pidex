import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname, join } from 'node:path'

export const CUA_ARTIFACT = {
  repository: 'Pidex-Dev/cua',
  tag: 'pidex-cua-v0.1.0',
  size: 18527744,
  sha256: '9613e3dbd0810df3d1b4fbcc84a85a505ca9db6bba695b2efbc6045860a9b0c1',
} as const

export class CuaArtifactError extends Error {
  constructor(readonly code: 'download_failed' | 'integrity_failed' | 'unsupported_platform') {
    super(code)
  }
}

export const resolveCpxCuaExecutable = (userDataDirectory: string): string =>
  join(userDataDirectory, 'runtimes', 'cua', CUA_ARTIFACT.tag, CUA_ARTIFACT.sha256, 'cpx-cua.exe')

export type CuaFetcher = (
  url: string,
  init: RequestInit,
  onProgress?: (receivedBytes: number) => void,
) => Promise<Response>

export async function hasCachedCuaRuntime(
  userDataDirectory: string,
  signal?: AbortSignal,
): Promise<boolean> {
  const cached = await readFile(resolveCpxCuaExecutable(userDataDirectory), { signal }).catch(
    (error) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    },
  )
  signal?.throwIfAborted()
  return Boolean(
    cached && createHash('sha256').update(cached).digest('hex') === CUA_ARTIFACT.sha256,
  )
}

/** Only this pinned release and GitHub's asset CDN may supply executable bytes. */
async function downloadCua(
  fetcher: CuaFetcher,
  signal: AbortSignal,
  onProgress: (receivedBytes: number) => void,
): Promise<Response> {
  const origin = `https://github.com/${CUA_ARTIFACT.repository}/releases/download/${CUA_ARTIFACT.tag}/cpx-cua.exe`
  let url = new URL(origin)
  for (let redirects = 0; redirects <= 5; redirects++) {
    if (
      url.protocol !== 'https:' ||
      url.username ||
      url.password ||
      url.port ||
      (url.href !== origin &&
        !['release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(
          url.hostname,
        ))
    )
      throw new CuaArtifactError('download_failed')
    const response = await fetcher(
      url.href,
      { signal, redirect: 'manual', credentials: 'omit' },
      onProgress,
    )
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location')
      await response.body?.cancel()
      if (!location) throw new CuaArtifactError('download_failed')
      url = new URL(location, url)
      continue
    }
    if (!response.ok || !response.body) {
      await response.body?.cancel()
      throw new CuaArtifactError('download_failed')
    }
    return response
  }
  throw new CuaArtifactError('download_failed')
}

export async function prepareCuaRuntime(
  userDataDirectory: string,
  signal: AbortSignal,
  onDownloading: (progress?: number) => Promise<void>,
  fetcher: CuaFetcher = fetch,
): Promise<string> {
  signal.throwIfAborted()
  if (process.platform !== 'win32' || process.arch !== 'x64')
    throw new CuaArtifactError('unsupported_platform')
  const executable = resolveCpxCuaExecutable(userDataDirectory)
  const temporary = `${executable}.${randomUUID()}.download`
  try {
    if (await hasCachedCuaRuntime(userDataDirectory, signal)) return executable
    await onDownloading(0)
    let lastProgress = 0
    let reporting = Promise.resolve()
    const reportProgress = (receivedBytes: number) => {
      const progress = Math.min(99, Math.floor((receivedBytes / CUA_ARTIFACT.size) * 100))
      if (progress < lastProgress + 5 && progress !== 99) return
      if (progress <= lastProgress) return
      lastProgress = progress
      reporting = reporting.then(async () => {
        signal.throwIfAborted()
        await onDownloading(progress)
      })
      // The queue is awaited before completing preparation, including on failure.
      void reporting.catch(() => undefined)
    }
    const downloadSignal = AbortSignal.any([signal, AbortSignal.timeout(120_000)])
    downloadSignal.throwIfAborted()
    const response = await downloadCua(fetcher, downloadSignal, reportProgress).catch(
      async (error) => {
        await reporting
        throw error
      },
    )
    await reporting
    await mkdir(dirname(executable), { recursive: true })
    const file = await open(temporary, 'wx')
    const reader = response.body!.getReader()
    const hash = createHash('sha256')
    let receivedBytes = 0
    try {
      while (true) {
        const { done, value } = await reader.read()
        downloadSignal.throwIfAborted()
        if (done) break
        receivedBytes += value.length
        reportProgress(receivedBytes)
        hash.update(value)
        await file.writeFile(value)
      }
    } finally {
      await reader.cancel().catch(() => undefined)
      reader.releaseLock()
      await file.close()
    }
    await reporting
    if (hash.digest('hex') !== CUA_ARTIFACT.sha256) throw new CuaArtifactError('integrity_failed')
    downloadSignal.throwIfAborted()
    await rename(temporary, executable)
    await onDownloading(100)
    return executable
  } catch (error) {
    signal.throwIfAborted()
    if (error instanceof CuaArtifactError) throw error
    throw new CuaArtifactError('download_failed')
  } finally {
    await rm(temporary, { force: true }).catch(() => undefined)
  }
}
