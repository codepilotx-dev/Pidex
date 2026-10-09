import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { access, mkdir, open, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import extractZip from 'extract-zip'
import { resolveAgentStorageLayout } from '../config/Config'

export type ToolingID = 'nodejs' | 'python' | 'git-bash' | 'ripgrep'
/** @deprecated Use ToolingID. Kept for compatibility with existing Agent internals. */
export type ManagedToolID = ToolingID
export type ToolingPreference = 'managed' | 'system'
export type ToolingSource = 'managed' | 'system'
export type ToolingPhase =
  'idle' | 'detecting' | 'downloading' | 'installing' | 'ready' | 'error' | 'cleanup-pending'

export interface ToolingStatus {
  id: ManagedToolID
  preference: ToolingPreference
  phase: ToolingPhase
  activeSource: ToolingSource | null
  pinnedVersion: string
  managed: { installed: boolean; version: string | null }
  system: { available: boolean; version: string | null; path: string | null }
  progress?: { receivedBytes: number; totalBytes?: number }
  error?: { code: string; message: string }
}

export type ToolingResolution =
  | { available: true; path: string; source: ToolingSource; version: string }
  | { available: false; code: string; reason: string }

export interface ToolingEnvironment {
  pathEntries: readonly string[]
  resolutions: ReadonlyMap<ManagedToolID, ToolingResolution>
}

type ToolCatalogEntry = {
  id: ManagedToolID
  version: string
  mirrors?: readonly string[]
  url: string
  archiveSha256: string
  archive: 'portable-git' | 'python-installer' | 'zip'
  executable: string
  maxBytes: number
  totalTimeoutMs: number
  inactivityTimeoutMs: number
}

export const TOOLING_CATALOG: Readonly<Record<ManagedToolID, ToolCatalogEntry>> = {
  nodejs: {
    id: 'nodejs',
    version: '24.18.0',
    mirrors: ['https://npmmirror.com/mirrors/node/v24.18.0/node-v24.18.0-win-x64.zip'],
    url: 'https://nodejs.org/dist/v24.18.0/node-v24.18.0-win-x64.zip',
    archiveSha256: '0ae68406b42d7725661da979b1403ec9926da205c6770827f33aac9d8f26e821',
    archive: 'zip',
    executable: 'node-v24.18.0-win-x64/node.exe',
    maxBytes: 64 * 1024 * 1024,
    totalTimeoutMs: 3 * 60_000,
    inactivityTimeoutMs: 30_000,
  },
  python: {
    id: 'python',
    version: '3.14.6',
    mirrors: ['https://mirrors.aliyun.com/python-release/windows/python-3.14.6-amd64.exe'],
    url: 'https://www.python.org/ftp/python/3.14.6/python-3.14.6-amd64.exe',
    archiveSha256: '14b3e9a710a3fcf0bd9b55ab6b60412bd91227563f813fc49040cabc0209e0bd',
    archive: 'python-installer',
    executable: 'python.exe',
    maxBytes: 64 * 1024 * 1024,
    totalTimeoutMs: 5 * 60_000,
    inactivityTimeoutMs: 30_000,
  },
  'git-bash': {
    id: 'git-bash',
    version: '2.55.0.3',
    mirrors: [
      'https://registry.npmmirror.com/-/binary/git-for-windows/v2.55.0.windows.3/PortableGit-2.55.0.3-64-bit.7z.exe',
    ],
    url: 'https://github.com/git-for-windows/git/releases/download/v2.55.0.windows.3/PortableGit-2.55.0.3-64-bit.7z.exe',
    archiveSha256: 'ab00566336b5472120f9a52d34f2e79c5406535792acb0548001ffd0bd090e5d',
    archive: 'portable-git',
    executable: 'bin/bash.exe',
    maxBytes: 150 * 1024 * 1024,
    totalTimeoutMs: 5 * 60_000,
    inactivityTimeoutMs: 30_000,
  },
  ripgrep: {
    id: 'ripgrep',
    version: '15.2.0',
    mirrors: [
      'https://gh-proxy.com/https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip',
      'https://ghfast.top/https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip',
    ],
    url: 'https://github.com/BurntSushi/ripgrep/releases/download/15.2.0/ripgrep-15.2.0-x86_64-pc-windows-msvc.zip',
    archiveSha256: '71b2fef860abe467217a538ff31de02f5258807c0129f771846f87bd029aafc5',
    archive: 'zip',
    executable: 'ripgrep-15.2.0-x86_64-pc-windows-msvc/rg.exe',
    maxBytes: 20 * 1024 * 1024,
    totalTimeoutMs: 2 * 60_000,
    inactivityTimeoutMs: 30_000,
  },
}

type ToolingSettings = { version: 2; preferences: Record<ManagedToolID, ToolingPreference> }
type InstallManifest = {
  version: 1
  id: ManagedToolID
  toolVersion: string
  archiveSha256: string
  executable: string
  executableSha256: string
  installedAt: string
}
type Listener = (status: ToolingStatus) => void

export class ToolingError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'ToolingError'
  }
}

export interface ToolingManagerOptions {
  root?: string
  fetch?: typeof fetch
  legacyInstallPidexDependencies?: boolean
  preferences?: Partial<Record<ManagedToolID, ToolingPreference>>
  persistPreferences?: boolean
}

const TOOL_IDS = ['nodejs', 'python', 'git-bash', 'ripgrep'] as const
const DEFAULT_SETTINGS: ToolingSettings = {
  version: 2,
  preferences: { nodejs: 'managed', python: 'managed', 'git-bash': 'managed', ripgrep: 'managed' },
}
const ALLOWED_DOWNLOAD_HOSTS = new Set([
  'cdn.npmmirror.com',
  'gh-proxy.com',
  'ghfast.top',
  'github.com',
  'release-assets.githubusercontent.com',
  'objects.githubusercontent.com',
  'github-releases.githubusercontent.com',
  'mirrors.aliyun.com',
  'nodejs.org',
  'npmmirror.com',
  'registry.npmmirror.com',
  'www.python.org',
])

const fileExists = async (path: string) => {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

const fileSha256 = async (path: string) =>
  createHash('sha256')
    .update(await readFile(path))
    .digest('hex')

const contained = (root: string, path: string) => {
  const child = relative(root, path)
  return child !== '' && !child.startsWith('..') && !isAbsolute(child)
}

const sanitizeError = (cause: unknown) =>
  cause instanceof ToolingError
    ? cause
    : new ToolingError(
        'TOOLING_INSTALL_FAILED',
        cause instanceof Error ? cause.message : '托管工具安装失败',
      )

export class ToolingManager {
  readonly root: string
  private readonly fetchImpl: typeof fetch
  private readonly legacyInstallPidexDependencies: boolean | undefined
  private readonly configuredPreferences:
    Partial<Record<ManagedToolID, ToolingPreference>> | undefined
  private readonly persistPreferences: boolean
  private readonly phases = new Map<
    ManagedToolID,
    Pick<ToolingStatus, 'phase' | 'progress' | 'error'>
  >()
  private readonly installs = new Map<ManagedToolID, Promise<ToolingResolution>>()
  private readonly listeners = new Set<Listener>()
  private readonly pendingEmits = new Map<ManagedToolID, ReturnType<typeof setTimeout>>()
  private readonly statusCache = new Map<ManagedToolID, ToolingStatus>()
  private settings: ToolingSettings = structuredClone(DEFAULT_SETTINGS)
  private initialization: Promise<void> | undefined
  private refreshTask: Promise<ToolingStatus[]> | undefined
  private settingsSave: Promise<void> = Promise.resolve()

  constructor(options: ToolingManagerOptions = {}) {
    this.root = resolve(options.root ?? resolveAgentStorageLayout().toolingRoot)
    this.fetchImpl = options.fetch ?? fetch
    this.legacyInstallPidexDependencies = options.legacyInstallPidexDependencies
    this.configuredPreferences = options.preferences
    this.persistPreferences = options.persistPreferences !== false
  }

  subscribe(listener: Listener) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async listStatuses(): Promise<ToolingStatus[]> {
    await this.initialize()
    if (!TOOL_IDS.every((id) => this.statusCache.has(id))) {
      await this.refreshStatuses()
    }
    return TOOL_IDS.map((id) => this.statusCache.get(id)!)
  }

  async refreshStatuses(): Promise<ToolingStatus[]> {
    await this.initialize()
    if (this.refreshTask) return this.refreshTask
    const task = Promise.all(TOOL_IDS.map((id) => this.probeStatus(id)))
      .then((statuses) => {
        for (const status of statuses) this.statusCache.set(status.id, status)
        for (const status of statuses) this.emit(status)
        return statuses
      })
      .finally(() => {
        if (this.refreshTask === task) this.refreshTask = undefined
      })
    this.refreshTask = task
    return task
  }

  async getStatus(id: ManagedToolID): Promise<ToolingStatus> {
    await this.initialize()
    const status = await this.probeStatus(id)
    this.statusCache.set(id, status)
    return status
  }

  private async probeStatus(id: ManagedToolID): Promise<ToolingStatus> {
    const [managed, system] = await Promise.all([this.findManaged(id), this.findSystem(id)])
    const preference = this.settings.preferences[id]
    const transient = this.phases.get(id)
    const active = preference === 'managed' ? (managed ?? system) : system
    const status: ToolingStatus = {
      id,
      preference,
      phase: transient?.phase ?? (active ? 'ready' : 'idle'),
      activeSource: active?.source ?? null,
      pinnedVersion: TOOLING_CATALOG[id].version,
      managed: { installed: managed !== null, version: managed?.version ?? null },
      system: {
        available: system !== null,
        version: system?.version ?? null,
        path: system?.path ?? null,
      },
      ...(transient?.progress ? { progress: transient.progress } : {}),
      ...(transient?.error ? { error: transient.error } : {}),
    }
    return status
  }

  async setPreference(id: ManagedToolID, preference: ToolingPreference): Promise<ToolingStatus> {
    await this.initialize()
    this.settings.preferences[id] = preference
    if (this.persistPreferences) await this.saveSettings()
    if (preference === 'system') await this.removeManaged(id)
    const status = await this.getStatus(id)
    this.emit(status)
    return status
  }

  async resolve(
    id: ManagedToolID,
    options: { signal?: AbortSignal } = {},
  ): Promise<ToolingResolution> {
    await this.initialize()
    if (options.signal?.aborted)
      return { available: false, code: 'TOOLING_ABORTED', reason: '工具解析已取消' }
    if (this.settings.preferences[id] === 'system') {
      const system = await this.findSystem(id)
      return (
        system ?? {
          available: false,
          code: 'TOOLING_UNAVAILABLE',
          reason: `${id} 已选择本机版，但未检测到可用安装`,
        }
      )
    }
    const managed = await this.findManaged(id)
    if (managed) return managed
    const installed = await this.installResolution(
      id,
      options.signal ? { signal: options.signal } : {},
    )
    if (installed.available) return installed
    const system = await this.findSystem(id)
    return system ?? installed
  }

  async resolveEnvironment(
    required: readonly ManagedToolID[],
    options: { signal?: AbortSignal } = {},
  ): Promise<ToolingEnvironment> {
    const ids = [...new Set(required)]
    const resolved = await Promise.all(
      ids.map(async (id) => [id, await this.resolve(id, options)] as const),
    )
    const resolutions = new Map<ManagedToolID, ToolingResolution>(resolved)
    const pathEntries: string[] = []
    for (const [id, resolution] of resolved) {
      if (!resolution.available) continue
      for (const path of this.environmentPaths(id, resolution.path)) {
        if (!pathEntries.some((entry) => entry.toLowerCase() === path.toLowerCase()))
          pathEntries.push(path)
      }
    }
    return { pathEntries, resolutions }
  }

  async install(
    id: ManagedToolID,
    options: { force?: boolean; signal?: AbortSignal } = {},
  ): Promise<ToolingStatus> {
    await this.initialize()
    const resolution = await this.installResolution(id, options)
    if (!resolution.available) throw new ToolingError(resolution.code, resolution.reason)
    return this.getStatus(id)
  }

  private async installResolution(
    id: ManagedToolID,
    options: { force?: boolean; signal?: AbortSignal },
  ): Promise<ToolingResolution> {
    if (!options.force) {
      const current = await this.findManaged(id)
      if (current) return current
    }
    const existing = this.installs.get(id)
    if (existing) return existing
    const task = this.performInstall(id, options.signal).finally(() => this.installs.delete(id))
    this.installs.set(id, task)
    return task
  }

  private async performInstall(
    id: ManagedToolID,
    signal?: AbortSignal,
  ): Promise<ToolingResolution> {
    const entry = TOOLING_CATALOG[id]
    if (process.platform !== 'win32' || process.arch !== 'x64') {
      return {
        available: false,
        code: 'TOOLING_PLATFORM_UNSUPPORTED',
        reason: `${id} 托管版仅支持 Windows x64`,
      }
    }
    const jobRoot = join(this.root, '.staging', `${id}-${randomUUID()}`)
    const partialPath = join(
      jobRoot,
      entry.archive === 'zip' ? 'download.zip.partial' : 'download.exe.partial',
    )
    const extracted = join(jobRoot, 'extracted')
    try {
      await mkdir(extracted, { recursive: true })
      this.setPhase(id, { phase: 'downloading', progress: { receivedBytes: 0 } })
      await this.download(entry, partialPath, signal)
      const archivePath = entry.archive === 'zip' ? partialPath : join(jobRoot, 'download.exe')
      if (archivePath !== partialPath) await rename(partialPath, archivePath)
      this.setPhase(id, { phase: 'installing' })
      await this.extract(entry, archivePath, extracted, signal)
      const executable = resolve(extracted, entry.executable)
      if (!contained(extracted, executable))
        throw new ToolingError('TOOLING_ARCHIVE_UNSAFE', '归档中的 executable 路径越界')
      const version = await this.validateExecutable(id, executable)
      if (!version) throw new ToolingError('TOOLING_VALIDATION_FAILED', `${id} 安装后版本校验失败`)
      const manifest: InstallManifest = {
        version: 1,
        id,
        toolVersion: entry.version,
        archiveSha256: entry.archiveSha256,
        executable: entry.executable,
        executableSha256: await fileSha256(executable),
        installedAt: new Date().toISOString(),
      }
      await writeFile(
        join(extracted, 'install.json'),
        `${JSON.stringify(manifest, null, 2)}\n`,
        'utf8',
      )
      await this.activateInstall(id, entry.version, extracted)
      this.phases.set(id, { phase: 'ready' })
      this.emit(await this.getStatus(id))
      return {
        available: true,
        path: join(this.installDir(id), entry.executable),
        source: 'managed',
        version,
      }
    } catch (cause) {
      const error = sanitizeError(cause)
      this.setPhase(id, { phase: 'error', error: { code: error.code, message: error.message } })
      return { available: false, code: error.code, reason: error.message }
    } finally {
      await rm(jobRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  private async download(
    entry: ToolCatalogEntry,
    destination: string,
    externalSignal?: AbortSignal,
  ) {
    const sources = [...(entry.mirrors ?? []), entry.url]
    let lastError: unknown
    for (const [index, source] of sources.entries()) {
      if (externalSignal?.aborted) throw new ToolingError('TOOLING_ABORTED', '工具下载已取消')
      await rm(destination, { force: true }).catch(() => undefined)
      try {
        await this.downloadFromSource(
          entry,
          source,
          destination,
          index < sources.length - 1,
          externalSignal,
        )
        return
      } catch (cause) {
        lastError = cause
        if (
          externalSignal?.aborted ||
          (cause instanceof ToolingError && cause.code === 'TOOLING_ABORTED')
        )
          throw cause
      }
    }
    throw lastError ?? new ToolingError('TOOLING_DOWNLOAD_FAILED', '所有工具下载来源均不可用')
  }

  private async downloadFromSource(
    entry: ToolCatalogEntry,
    source: string,
    destination: string,
    mirror: boolean,
    externalSignal?: AbortSignal,
  ) {
    const controller = new AbortController()
    const abort = () => controller.abort(externalSignal?.reason)
    externalSignal?.addEventListener('abort', abort, { once: true })
    const totalTimeoutMs = mirror ? Math.min(entry.totalTimeoutMs, 90_000) : entry.totalTimeoutMs
    const inactivityTimeoutMs = mirror
      ? Math.min(entry.inactivityTimeoutMs, 15_000)
      : entry.inactivityTimeoutMs
    const totalTimer = setTimeout(
      () => controller.abort(new Error('download timeout')),
      totalTimeoutMs,
    )
    let inactivityTimer = setTimeout(
      () => controller.abort(new Error('download inactivity timeout')),
      inactivityTimeoutMs,
    )
    const resetInactivity = () => {
      clearTimeout(inactivityTimer)
      inactivityTimer = setTimeout(
        () => controller.abort(new Error('download inactivity timeout')),
        inactivityTimeoutMs,
      )
    }
    try {
      let url = new URL(source)
      let response: Response | undefined
      for (let redirects = 0; redirects <= 5; redirects += 1) {
        if (url.protocol !== 'https:' || !ALLOWED_DOWNLOAD_HOSTS.has(url.hostname.toLowerCase()))
          throw new ToolingError(
            'TOOLING_DOWNLOAD_ORIGIN_REJECTED',
            `不允许的下载来源：${url.hostname}`,
          )
        response = await this.fetchImpl(url, { redirect: 'manual', signal: controller.signal })
        if (response.status < 300 || response.status >= 400) break
        const location = response.headers.get('location')
        if (!location || redirects === 5)
          throw new ToolingError(
            'TOOLING_DOWNLOAD_REDIRECT_REJECTED',
            '工具下载重定向无效或次数过多',
          )
        url = new URL(location, url)
      }
      if (!response?.ok || !response.body)
        throw new ToolingError(
          'TOOLING_DOWNLOAD_FAILED',
          `工具下载失败（HTTP ${response?.status ?? 0}）`,
        )
      const declared = Number(response.headers.get('content-length'))
      if (Number.isFinite(declared) && declared > entry.maxBytes)
        throw new ToolingError('TOOLING_DOWNLOAD_TOO_LARGE', '工具归档超过大小上限')
      const output = await open(destination, 'wx')
      const hash = createHash('sha256')
      const reader = response.body.getReader()
      let received = 0
      try {
        while (true) {
          const chunk = await reader.read()
          if (chunk.done) break
          resetInactivity()
          received += chunk.value.byteLength
          if (received > entry.maxBytes)
            throw new ToolingError('TOOLING_DOWNLOAD_TOO_LARGE', '工具归档超过大小上限')
          hash.update(chunk.value)
          let offset = 0
          while (offset < chunk.value.byteLength) {
            const { bytesWritten } = await output.write(
              chunk.value,
              offset,
              chunk.value.byteLength - offset,
            )
            if (bytesWritten <= 0)
              throw new ToolingError('TOOLING_DOWNLOAD_FAILED', '工具归档写入中断')
            offset += bytesWritten
          }
          this.setPhase(entry.id, {
            phase: 'downloading',
            progress: {
              receivedBytes: received,
              ...(Number.isFinite(declared) && declared > 0 ? { totalBytes: declared } : {}),
            },
          })
        }
      } catch (cause) {
        throw cause
      } finally {
        await output.close()
      }
      if (hash.digest('hex') !== entry.archiveSha256)
        throw new ToolingError('TOOLING_CHECKSUM_MISMATCH', '工具归档 SHA-256 校验失败')
    } catch (cause) {
      if (controller.signal.aborted)
        throw new ToolingError(
          externalSignal?.aborted ? 'TOOLING_ABORTED' : 'TOOLING_DOWNLOAD_TIMEOUT',
          externalSignal?.aborted ? '工具下载已取消' : '工具下载超时',
        )
      throw cause
    } finally {
      externalSignal?.removeEventListener('abort', abort)
      clearTimeout(totalTimer)
      clearTimeout(inactivityTimer)
    }
  }

  private async extract(
    entry: ToolCatalogEntry,
    archivePath: string,
    destination: string,
    signal?: AbortSignal,
  ) {
    if (entry.archive === 'portable-git') {
      await this.runChecked(archivePath, ['-y', `-o${destination}`], 3 * 60_000, signal)
      return
    }
    if (entry.archive === 'python-installer') {
      await this.runChecked(
        archivePath,
        [
          '/quiet',
          'InstallAllUsers=0',
          `TargetDir=${destination}`,
          'Include_pip=1',
          'Include_launcher=0',
          'AssociateFiles=0',
          'Shortcuts=0',
          'PrependPath=0',
          'Include_test=0',
          'Include_doc=0',
          'Include_tcltk=0',
          'Include_tools=1',
          'CompileAll=0',
        ],
        4 * 60_000,
        signal,
      )
      return
    }
    const validationScript = [
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
    await this.runChecked(
      shell,
      [
        '-NoLogo',
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        validationScript,
      ],
      30_000,
      signal,
      {
        ...process.env,
        PIDEX_ZIP_VALIDATION_ARCHIVE: archivePath,
        PIDEX_ZIP_VALIDATION_DESTINATION: destination,
      },
    )
    if (signal?.aborted) throw new ToolingError('TOOLING_ABORTED', '工具安装已取消')
    await extractZip(archivePath, {
      dir: destination,
      onEntry: (entry) => {
        const target = resolve(destination, entry.fileName)
        const unixType = (entry.externalFileAttributes >> 16) & 0xf000
        if (!contained(destination, target) || unixType === 0xa000) {
          throw new ToolingError('TOOLING_ARCHIVE_UNSAFE', 'ZIP 包含越界路径或 symlink')
        }
      },
    })
    if (signal?.aborted) throw new ToolingError('TOOLING_ABORTED', '工具安装已取消')
  }

  private async activateInstall(id: ManagedToolID, version: string, extracted: string) {
    const destination = join(this.root, id, version)
    const trash = join(this.root, '.trash', `${id}-${version}-${randomUUID()}`)
    await mkdir(dirname(destination), { recursive: true })
    await mkdir(dirname(trash), { recursive: true })
    let movedOld = false
    try {
      await rename(destination, trash)
      movedOld = true
    } catch (cause) {
      const error = cause as NodeJS.ErrnoException
      if (error.code !== 'ENOENT') throw cause
    }
    try {
      await rename(extracted, destination)
    } catch (cause) {
      if (movedOld) await rename(trash, destination).catch(() => undefined)
      throw cause
    }
    if (movedOld) void rm(trash, { recursive: true, force: true })
  }

  private async findManaged(
    id: ManagedToolID,
  ): Promise<Extract<ToolingResolution, { available: true }> | null> {
    const entry = TOOLING_CATALOG[id]
    const directory = this.installDir(id)
    const manifestPath = join(directory, 'install.json')
    try {
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as InstallManifest
      if (
        manifest.id !== id ||
        manifest.toolVersion !== entry.version ||
        manifest.archiveSha256 !== entry.archiveSha256 ||
        manifest.executable !== entry.executable
      )
        return null
      const executable = resolve(directory, manifest.executable)
      if (!contained(directory, executable) || !(await fileExists(executable))) return null
      if (
        !/^[a-f\d]{64}$/i.test(manifest.executableSha256) ||
        (await fileSha256(executable)) !== manifest.executableSha256.toLowerCase()
      )
        return null
      const version = await this.validateExecutable(id, executable)
      return version ? { available: true, path: executable, source: 'managed', version } : null
    } catch {
      return null
    }
  }

  private async findSystem(
    id: ManagedToolID,
  ): Promise<Extract<ToolingResolution, { available: true }> | null> {
    const override = this.systemOverride(id)
    const candidates = override ? [resolve(override)] : await this.systemCandidates(id)
    for (const candidate of [...new Set(candidates)]) {
      const normalized = candidate.replaceAll('/', '\\').toLowerCase()
      if (id === 'git-bash' && normalized.includes('\\windows\\system32\\bash.exe')) continue
      // Windows 的 Microsoft Store execution alias 只是跳转 stub，不能作为稳定运行环境。
      if (id === 'python' && normalized.includes('\\microsoft\\windowsapps\\')) continue
      const version = await this.validateExecutable(id, candidate)
      if (version) return { available: true, path: candidate, source: 'system', version }
    }
    return null
  }

  private async systemCandidates(id: ManagedToolID) {
    if (id === 'nodejs') return this.where('node.exe')
    if (id === 'python') return this.where('python.exe')
    if (id === 'ripgrep') return this.where('rg.exe')
    const candidates: string[] = []
    for (const git of await this.where('git.exe'))
      candidates.push(join(dirname(dirname(git)), 'bin', 'bash.exe'))
    if (process.env.ProgramFiles)
      candidates.push(join(process.env.ProgramFiles, 'Git', 'bin', 'bash.exe'))
    if (process.env.LOCALAPPDATA)
      candidates.push(join(process.env.LOCALAPPDATA, 'Programs', 'Git', 'bin', 'bash.exe'))
    return candidates
  }

  private async where(name: string) {
    try {
      const output = await this.runCapture('where.exe', [name], 5_000)
      return output
        .split(/\r?\n/)
        .map((value) => value.trim())
        .filter(Boolean)
    } catch {
      return []
    }
  }

  private async validateExecutable(id: ManagedToolID, executable: string): Promise<string | null> {
    if (!(await fileExists(executable))) return null
    try {
      const output = await this.runCapture(executable, ['--version'], 8_000)
      if (id === 'nodejs') {
        const match = /^v([^\s]+)/im.exec(output)
        if (!match) return null
        const directory = dirname(executable)
        if (
          !(await fileExists(join(directory, 'npm.cmd'))) ||
          !(await fileExists(join(directory, 'npx.cmd')))
        )
          return null
        return match[1] ?? null
      }
      if (id === 'python') {
        const match = /Python\s+([^\s]+)/i.exec(output)
        if (!match) return null
        await this.runCapture(executable, ['-m', 'pip', '--version'], 12_000)
        return match[1] ?? null
      }
      if (id === 'ripgrep') {
        const match = /ripgrep\s+([^\s]+)/i.exec(output)
        return match?.[1] ?? null
      }
      if (!/GNU bash/i.test(output)) return null
      const git = join(dirname(dirname(executable)), 'cmd', 'git.exe')
      const gitOutput = await this.runCapture(git, ['--version'], 8_000)
      const match = /git version\s+([^\s]+)/i.exec(gitOutput)
      return match?.[1] ?? null
    } catch {
      return null
    }
  }

  private runCapture(
    executable: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal,
    env?: NodeJS.ProcessEnv,
  ) {
    return new Promise<string>((resolvePromise, reject) => {
      const child = spawn(executable, args, {
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        ...(env ? { env } : {}),
      })
      const chunks: Buffer[] = []
      let bytes = 0
      const stop = () => child.kill('SIGKILL')
      signal?.addEventListener('abort', stop, { once: true })
      const timer = setTimeout(stop, timeoutMs)
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength
        if (bytes <= 64 * 1024) chunks.push(chunk)
        else stop()
      })
      child.stderr.on('data', (chunk: Buffer) => {
        bytes += chunk.byteLength
        if (bytes <= 64 * 1024) chunks.push(chunk)
        else stop()
      })
      child.once('error', reject)
      child.once('close', (code) => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', stop)
        if (code === 0) resolvePromise(Buffer.concat(chunks).toString('utf8'))
        else reject(new Error(`${basename(executable)} exited ${code}`))
      })
    })
  }

  private async runChecked(
    executable: string,
    args: string[],
    timeoutMs: number,
    signal?: AbortSignal,
    env?: NodeJS.ProcessEnv,
  ) {
    await this.runCapture(executable, args, timeoutMs, signal, env)
  }

  private installDir(id: ManagedToolID) {
    return join(this.root, id, TOOLING_CATALOG[id].version)
  }
  private settingsPath() {
    return join(this.root, 'v2', 'settings.json')
  }
  private legacySettingsPath() {
    return join(this.root, 'v1', 'settings.json')
  }

  private systemOverride(id: ManagedToolID) {
    switch (id) {
      case 'nodejs':
        return process.env.PIDEX_NODEJS_PATH?.trim()
      case 'python':
        return process.env.PIDEX_PYTHON_PATH?.trim()
      case 'git-bash':
        return process.env.PIDEX_GIT_BASH_PATH?.trim()
      case 'ripgrep':
        return process.env.PIDEX_RIPGREP_PATH?.trim()
    }
  }

  private environmentPaths(id: ManagedToolID, executable: string) {
    const directory = dirname(executable)
    switch (id) {
      case 'nodejs':
        return [directory]
      case 'python':
        return [directory, join(directory, 'Scripts')]
      case 'git-bash':
        return [directory, join(dirname(directory), 'cmd')]
      case 'ripgrep':
        return [directory]
    }
  }

  private async initialize() {
    if (!this.initialization) this.initialization = this.doInitialize()
    return this.initialization
  }

  private async doInitialize() {
    await mkdir(join(this.root, 'v2'), { recursive: true })
    await mkdir(join(this.root, '.staging'), { recursive: true })
    await mkdir(join(this.root, '.trash'), { recursive: true })
    if (this.configuredPreferences) {
      this.settings = this.normalizeSettings({
        preferences: this.configuredPreferences as Record<ManagedToolID, ToolingPreference>,
      })
    } else {
      try {
        const parsed = JSON.parse(
          await readFile(this.settingsPath(), 'utf8'),
        ) as Partial<ToolingSettings>
        this.settings = this.normalizeSettings(parsed)
      } catch {
        this.settings = await this.migrateLegacySettings()
        if (this.persistPreferences) await this.saveSettings()
      }
    }
    await this.cleanupDirectory(join(this.root, '.staging'))
    await this.cleanupDirectory(join(this.root, '.trash'))
    for (const id of TOOL_IDS) {
      if (this.settings.preferences[id] === 'system') await this.removeManaged(id)
    }
  }

  private normalizeSettings(parsed: Partial<ToolingSettings>): ToolingSettings {
    return {
      version: 2,
      preferences: Object.fromEntries(
        TOOL_IDS.map((id) => [id, parsed.preferences?.[id] === 'system' ? 'system' : 'managed']),
      ) as Record<ManagedToolID, ToolingPreference>,
    }
  }

  private async migrateLegacySettings(): Promise<ToolingSettings> {
    let legacy: {
      preferences?: Partial<Record<ManagedToolID, unknown>>
      installPidexDependencies?: unknown
    } = {}
    try {
      legacy = JSON.parse(await readFile(this.legacySettingsPath(), 'utf8')) as typeof legacy
    } catch {
      /* 首次安装没有旧设置。 */
    }
    const oldDependencyPreference =
      typeof this.legacyInstallPidexDependencies === 'boolean'
        ? this.legacyInstallPidexDependencies
        : typeof legacy.installPidexDependencies === 'boolean'
          ? legacy.installPidexDependencies
          : true
    return {
      version: 2,
      preferences: {
        nodejs: oldDependencyPreference ? 'managed' : 'system',
        python: oldDependencyPreference ? 'managed' : 'system',
        'git-bash': legacy.preferences?.['git-bash'] === 'system' ? 'system' : 'managed',
        ripgrep: legacy.preferences?.ripgrep === 'system' ? 'system' : 'managed',
      },
    }
  }

  private saveSettings() {
    const snapshot = structuredClone(this.settings)
    const task = this.settingsSave.catch(() => undefined).then(() => this.writeSettings(snapshot))
    this.settingsSave = task
    return task
  }

  private async writeSettings(settings: ToolingSettings) {
    const path = this.settingsPath()
    const temporary = `${path}.${randomUUID()}.tmp`
    const previous = `${path}.${randomUUID()}.previous`
    await mkdir(dirname(path), { recursive: true })
    await writeFile(temporary, `${JSON.stringify(settings, null, 2)}\n`, 'utf8')
    let movedPrevious = false
    try {
      await rename(path, previous)
      movedPrevious = true
    } catch (cause) {
      const error = cause as NodeJS.ErrnoException
      if (error.code !== 'ENOENT') throw cause
    }
    try {
      await rename(temporary, path)
      if (movedPrevious) await rm(previous, { force: true })
    } catch (cause) {
      if (movedPrevious) await rename(previous, path).catch(() => undefined)
      await rm(temporary, { force: true }).catch(() => undefined)
      throw cause
    }
  }

  private async removeManaged(id: ManagedToolID) {
    const source = join(this.root, id)
    if (
      !(await access(source)
        .then(() => true)
        .catch(() => false))
    )
      return
    const trash = join(this.root, '.trash', `${id}-${randomUUID()}`)
    try {
      await mkdir(dirname(trash), { recursive: true })
      await rename(source, trash)
      await rm(trash, { recursive: true, force: true })
      this.phases.delete(id)
    } catch {
      this.setPhase(id, { phase: 'cleanup-pending' })
    }
  }

  private async cleanupDirectory(path: string) {
    await rm(path, { recursive: true, force: true }).catch(() => undefined)
    await mkdir(path, { recursive: true }).catch(() => undefined)
  }

  private setPhase(id: ManagedToolID, state: Pick<ToolingStatus, 'phase' | 'progress' | 'error'>) {
    this.phases.set(id, state)
    if (this.pendingEmits.has(id)) return
    const timer = setTimeout(
      () => {
        this.pendingEmits.delete(id)
        const cached = this.statusCache.get(id)
        const latest = this.phases.get(id)
        if (cached && latest) {
          const { progress: _progress, error: _error, ...base } = cached
          const status: ToolingStatus = {
            ...base,
            phase: latest.phase,
            ...(latest.progress ? { progress: latest.progress } : {}),
            ...(latest.error ? { error: latest.error } : {}),
          }
          this.statusCache.set(id, status)
          this.emit(status)
          return
        }
        void this.getStatus(id).then((status) => this.emit(status))
      },
      state.phase === 'downloading' ? 200 : 0,
    )
    this.pendingEmits.set(id, timer)
  }

  private emit(status: ToolingStatus) {
    for (const listener of this.listeners) listener(status)
  }
}

let defaultManager: ToolingManager | undefined
export const getToolingManager = (options: ToolingManagerOptions = {}) =>
  (defaultManager ??= new ToolingManager(options))
