import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { createReadStream } from 'node:fs'
import { mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import extractZip from 'extract-zip'
import { SPEECH_ARTIFACTS, SPEECH_EXECUTABLE, SPEECH_RUNTIME_VERSION } from './SpeechCatalog'

export class SpeechInstallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
  }
}

type Progress = { receivedBytes: number; totalBytes?: number }
type Artifact = (typeof SPEECH_ARTIFACTS)[keyof typeof SPEECH_ARTIFACTS]
type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
const ALLOWED_HOSTS = new Set([
  'github.com',
  'objects.githubusercontent.com',
  'release-assets.githubusercontent.com',
  'huggingface.co',
  'us.aws.cdn.hf.co',
])

const fileSha256 = async (path: string) => {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
const contained = (root: string, candidate: string) => {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}
export const assertSafeSpeechZipEntry = (
  destination: string,
  fileName: string,
  externalFileAttributes: number,
) => {
  const target = resolve(destination, fileName)
  const unixType = (externalFileAttributes >> 16) & 0xf000
  if (!contained(destination, target) || unixType === 0xa000) {
    throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音运行时 ZIP 包含不安全路径')
  }
}

export class SpeechInstaller {
  constructor(
    private readonly root: string,
    private readonly progress: (progress: Progress, installing: boolean) => void,
    private readonly fetchImpl: Fetch = fetch,
  ) {}

  installRoot() {
    return join(this.root, 'sensevoice-llamacpp', SPEECH_RUNTIME_VERSION)
  }
  runtimePath(variant: 'avx2' | 'generic') {
    return join(this.installRoot(), 'runtime', variant, SPEECH_EXECUTABLE)
  }
  modelPath() {
    return join(this.installRoot(), 'models', 'sensevoice-small-q8.gguf')
  }
  vadPath() {
    return join(this.installRoot(), 'models', 'fsmn-vad.gguf')
  }

  async installed() {
    try {
      const manifest = JSON.parse(
        await readFile(join(this.installRoot(), 'install.json'), 'utf8'),
      ) as {
        version?: unknown
        artifacts?: Record<
          string,
          { archiveSha256?: unknown; fileSha256?: unknown; path?: unknown }
        >
      }
      if (manifest.version !== 1) return false
      const expected = {
        avx2: {
          path: this.runtimePath('avx2'),
          archiveSha256: SPEECH_ARTIFACTS.avx2.sha256,
          fileSha256: SPEECH_ARTIFACTS.avx2.executableSha256,
        },
        generic: {
          path: this.runtimePath('generic'),
          archiveSha256: SPEECH_ARTIFACTS.generic.sha256,
          fileSha256: SPEECH_ARTIFACTS.generic.executableSha256,
        },
        model: {
          path: this.modelPath(),
          archiveSha256: SPEECH_ARTIFACTS.model.sha256,
          fileSha256: SPEECH_ARTIFACTS.model.sha256,
        },
        vad: {
          path: this.vadPath(),
          archiveSha256: SPEECH_ARTIFACTS.vad.sha256,
          fileSha256: SPEECH_ARTIFACTS.vad.sha256,
        },
      }
      for (const [name, artifact] of Object.entries(expected)) {
        if (!(await stat(artifact.path)).isFile()) return false
        const recorded = manifest.artifacts?.[name]
        const relativePath = relative(this.installRoot(), artifact.path).replaceAll('\\', '/')
        if (
          recorded?.archiveSha256 !== artifact.archiveSha256 ||
          recorded.fileSha256 !== artifact.fileSha256 ||
          recorded.path !== relativePath
        )
          return false
        if ((await fileSha256(artifact.path)) !== artifact.fileSha256) return false
      }
      return true
    } catch {
      return false
    }
  }

  async install(signal?: AbortSignal) {
    if (signal?.aborted) throw new SpeechInstallError('SPEECH_CANCELLED', '语音运行时安装已取消')
    const stagingBase = join(this.root, '.staging')
    const job = join(stagingBase, `speech-${randomUUID()}`)
    const extracted = join(job, 'install')
    await mkdir(extracted, { recursive: true })
    try {
      let receivedTotal = 0
      const expectedTotal = Object.values(SPEECH_ARTIFACTS).reduce(
        (total, artifact) => total + artifact.expectedBytes,
        0,
      )
      for (const [name, artifact] of Object.entries(SPEECH_ARTIFACTS) as Array<
        [keyof typeof SPEECH_ARTIFACTS, Artifact]
      >) {
        const partial = join(job, `${name}.partial`)
        const received = await this.download(artifact, partial, signal, (current) => {
          this.progress(
            { receivedBytes: receivedTotal + current, totalBytes: expectedTotal },
            false,
          )
        })
        receivedTotal += received
        this.progress({ receivedBytes: receivedTotal, totalBytes: expectedTotal }, true)
        if (artifact.kind === 'zip') {
          const destination = join(extracted, 'runtime', name)
          await mkdir(destination, { recursive: true })
          await this.validateZip(partial, destination, signal)
          const canonical = resolve(destination)
          await extractZip(partial, {
            dir: canonical,
            onEntry: (entry) => {
              assertSafeSpeechZipEntry(canonical, entry.fileName, entry.externalFileAttributes)
            },
          })
          const executable = join(destination, SPEECH_EXECUTABLE)
          const executableStat = await stat(executable).catch(() => null)
          if (!executableStat?.isFile())
            throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音运行时归档缺少可执行文件')
          if (
            executableStat.size !== artifact.executableBytes ||
            (await fileSha256(executable)) !== artifact.executableSha256
          ) {
            throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音运行时可执行文件校验失败')
          }
        } else {
          const destination = join(
            extracted,
            'models',
            name === 'model' ? 'sensevoice-small-q8.gguf' : 'fsmn-vad.gguf',
          )
          await mkdir(join(extracted, 'models'), { recursive: true })
          await rename(partial, destination)
        }
      }
      const artifacts = {
        avx2: {
          archiveSha256: SPEECH_ARTIFACTS.avx2.sha256,
          fileSha256: SPEECH_ARTIFACTS.avx2.executableSha256,
          path: `runtime/avx2/${SPEECH_EXECUTABLE}`,
        },
        generic: {
          archiveSha256: SPEECH_ARTIFACTS.generic.sha256,
          fileSha256: SPEECH_ARTIFACTS.generic.executableSha256,
          path: `runtime/generic/${SPEECH_EXECUTABLE}`,
        },
        model: {
          archiveSha256: SPEECH_ARTIFACTS.model.sha256,
          fileSha256: SPEECH_ARTIFACTS.model.sha256,
          path: 'models/sensevoice-small-q8.gguf',
        },
        vad: {
          archiveSha256: SPEECH_ARTIFACTS.vad.sha256,
          fileSha256: SPEECH_ARTIFACTS.vad.sha256,
          path: 'models/fsmn-vad.gguf',
        },
      }
      await writeFile(
        join(extracted, 'install.json'),
        `${JSON.stringify({ version: 1, runtimeVersion: SPEECH_RUNTIME_VERSION, artifacts, installedAt: new Date().toISOString() }, null, 2)}\n`,
        'utf8',
      )
      await this.activate(extracted)
    } finally {
      await rm(job, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async download(
    artifact: Artifact,
    destination: string,
    signal: AbortSignal | undefined,
    onProgress: (received: number, total?: number) => void,
  ) {
    const controller = new AbortController()
    const abort = () => controller.abort(signal?.reason)
    signal?.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => controller.abort(), 10 * 60_000)
    let inactivity = setTimeout(() => controller.abort(), 30_000)
    const resetInactivity = () => {
      clearTimeout(inactivity)
      inactivity = setTimeout(() => controller.abort(), 30_000)
    }
    try {
      let url = new URL(artifact.url)
      let response: Response | undefined
      for (let redirects = 0; redirects <= 5; redirects += 1) {
        if (url.protocol !== 'https:' || !ALLOWED_HOSTS.has(url.hostname.toLowerCase()))
          throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音组件下载来源不受信任')
        response = await this.fetchImpl(url, { signal: controller.signal, redirect: 'manual' })
        if (response.status < 300 || response.status >= 400) break
        const location = response.headers.get('location')
        if (!location || redirects === 5)
          throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音组件下载重定向无效')
        url = new URL(location, url)
      }
      if (!response?.ok || !response.body)
        throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音组件下载失败')
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > artifact.maximumBytes)
        throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音组件下载大小异常')
      const handle = await open(destination, 'wx')
      const reader = response.body.getReader()
      const hash = createHash('sha256')
      let received = 0
      try {
        while (true) {
          if (signal?.aborted)
            throw new SpeechInstallError('SPEECH_CANCELLED', '语音运行时安装已取消')
          const chunk = await reader.read()
          if (chunk.done) break
          resetInactivity()
          received += chunk.value.byteLength
          if (received > artifact.maximumBytes)
            throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音组件下载超过大小上限')
          hash.update(chunk.value)
          let offset = 0
          while (offset < chunk.value.byteLength) {
            const { bytesWritten } = await handle.write(
              chunk.value,
              offset,
              chunk.value.byteLength - offset,
            )
            if (bytesWritten <= 0)
              throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音组件下载写入中断')
            offset += bytesWritten
          }
          onProgress(received, Number.isFinite(declared) && declared > 0 ? declared : undefined)
        }
      } finally {
        await handle.close()
      }
      if (hash.digest('hex') !== artifact.sha256)
        throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音组件 SHA-256 校验失败')
      return received
    } catch (cause) {
      if (cause instanceof SpeechInstallError) throw cause
      throw new SpeechInstallError(
        signal?.aborted ? 'SPEECH_CANCELLED' : 'SPEECH_INSTALL_FAILED',
        signal?.aborted ? '语音运行时安装已取消' : '语音组件下载失败',
      )
    } finally {
      clearTimeout(timer)
      clearTimeout(inactivity)
      signal?.removeEventListener('abort', abort)
    }
  }

  private async activate(extracted: string) {
    const destination = this.installRoot()
    await mkdir(dirname(destination), { recursive: true })
    const old = join(this.root, '.trash', `speech-${randomUUID()}`)
    await mkdir(dirname(old), { recursive: true })
    let moved = false
    try {
      try {
        await rename(destination, old)
        moved = true
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code !== 'ENOENT') throw cause
      }
      await rename(extracted, destination)
      if (moved) await rm(old, { recursive: true, force: true })
    } catch (cause) {
      if (moved) await rename(old, destination).catch(() => undefined)
      throw cause
    }
  }

  private async validateZip(archive: string, destination: string, signal?: AbortSignal) {
    const script = [
      "$ErrorActionPreference='Stop'",
      'Add-Type -AssemblyName System.IO.Compression.FileSystem',
      '$zip=[IO.Compression.ZipFile]::OpenRead($env:PIDEX_ZIP_VALIDATION_ARCHIVE)',
      '$root=[IO.Path]::GetFullPath($env:PIDEX_ZIP_VALIDATION_DESTINATION + [IO.Path]::DirectorySeparatorChar)',
      'try { foreach($e in $zip.Entries) {',
      "  $name=$e.FullName.Replace('/', [IO.Path]::DirectorySeparatorChar)",
      '  $target=[IO.Path]::GetFullPath([IO.Path]::Combine($root,$name))',
      "  if(-not $target.StartsWith($root,[StringComparison]::OrdinalIgnoreCase)){throw 'archive path escape'}",
      '  $unixType=(($e.ExternalAttributes -shr 16) -band 0xF000)',
      "  if($unixType -eq 0xA000){throw 'archive symlink rejected'}",
      '} } finally { $zip.Dispose() }',
    ].join('; ')
    const shell = process.env.SystemRoot
      ? join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
      : 'powershell.exe'
    const child = spawn(
      shell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        script,
      ],
      {
        windowsHide: true,
        shell: false,
        stdio: 'ignore',
        env: {
          ...process.env,
          PIDEX_ZIP_VALIDATION_ARCHIVE: archive,
          PIDEX_ZIP_VALIDATION_DESTINATION: destination,
        },
      },
    )
    const stop = () => child.kill()
    signal?.addEventListener('abort', stop, { once: true })
    const timer = setTimeout(stop, 30_000)
    try {
      const code = await new Promise<number | null>((resolve, reject) => {
        child.once('error', reject)
        child.once('close', resolve)
      })
      if (signal?.aborted) throw new SpeechInstallError('SPEECH_CANCELLED', '语音运行时安装已取消')
      if (code !== 0)
        throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音运行时 ZIP 安全校验失败')
    } catch (cause) {
      if (cause instanceof SpeechInstallError) throw cause
      throw new SpeechInstallError('SPEECH_INSTALL_FAILED', '语音运行时 ZIP 安全校验失败')
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', stop)
    }
  }
}
