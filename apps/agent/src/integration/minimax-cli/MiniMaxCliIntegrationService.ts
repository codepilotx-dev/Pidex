import { createHash, randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  rm,
  rmdir,
  writeFile,
} from 'node:fs/promises'
import { dirname, isAbsolute, join, parse, resolve } from 'node:path'
import type { MiniMaxCliCredentialSource, MiniMaxCliStatus } from '@pidex/agent-protocol'
import { Effect } from 'effect'
import type { ProviderCredentialRepository } from '../../auth/ProviderCredentialRepository'
import {
  MiniMaxCliSettingsConflictError,
  type MiniMaxCliSettingsRepository,
} from '../../storage/repositories/MinimaxCliSettingsRepository'

const CN_PROVIDER = 'minimax-cn-coding-plan' as const
const GLOBAL_PROVIDER = 'minimax-coding-plan' as const
const PACKAGE_NAME = 'mmx-cli'
const LATEST_CACHE_MS = 5 * 60_000
const STATUS_CACHE_MS = 3_000

type ProcessResult = {
  exitCode: number
  stdout: string
  stderr: string
}

type ProcessRequest = {
  executable: string
  args: readonly string[]
  env?: NodeJS.ProcessEnv
  timeoutMs?: number
}

export type MiniMaxCliProcessRunner = (request: ProcessRequest) => Promise<ProcessResult>

export type MiniMaxCliIntegrationOptions = {
  userHome: string
  integrationRoot?: string
  env?: NodeJS.ProcessEnv
  platform?: NodeJS.Platform
  runProcess?: MiniMaxCliProcessRunner
  now?: () => number
}

type ResolvedCredential = {
  secret: string
  source: MiniMaxCliCredentialSource
}

type MiniMaxCredentialRepository = Pick<
  ProviderCredentialRepository,
  'activeCredential' | 'listProviderCredentials'
>

type JsonObject = Record<string, unknown>

export class MiniMaxCliIntegrationError extends Error {
  constructor(
    readonly code:
      | 'MINIMAX_CLI_PREREQUISITE_MISSING'
      | 'MINIMAX_CLI_INSTALL_FAILED'
      | 'MINIMAX_CLI_UNINSTALL_FAILED'
      | 'MINIMAX_CLI_CONFIG_FAILED'
      | 'CONFLICT'
      | 'PATH_DENIED'
      | 'INTERNAL_ERROR',
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const defaultProcessRunner: MiniMaxCliProcessRunner = (request) =>
  new Promise((resolvePromise, reject) => {
    const child = spawn(request.executable, [...request.args], {
      shell: false,
      windowsHide: true,
      env: request.env,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let settled = false
    const timer = setTimeout(() => {
      if (settled) return
      child.kill('SIGKILL')
    }, request.timeoutMs ?? 30_000)
    child.stdout.on('data', (chunk: Buffer) => {
      if (stdout.reduce((size, item) => size + item.byteLength, 0) < 1024 * 1024) stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      if (stderr.reduce((size, item) => size + item.byteLength, 0) < 64 * 1024) stderr.push(chunk)
    })
    child.once('error', (cause) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(cause)
    })
    child.once('close', (exitCode) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({
        exitCode: exitCode ?? 1,
        stdout: Buffer.concat(stdout).toString('utf8').trim(),
        stderr: Buffer.concat(stderr).toString('utf8').trim(),
      })
    })
  })

const record = (value: unknown): JsonObject | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null

const fingerprint = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

const versionMajor = (value: string | undefined) => {
  const match = value?.match(/^v?(\d+)/)
  return match ? Number(match[1]) : null
}

const versionParts = (value: string) => {
  const match = value.match(/^v?(\d+)\.(\d+)\.(\d+)/)
  return match ? match.slice(1, 4).map(Number) : null
}

const isNewerVersion = (latest: string, installed: string) => {
  const latestParts = versionParts(latest)
  const installedParts = versionParts(installed)
  if (!latestParts || !installedParts) return latest !== installed
  for (let index = 0; index < latestParts.length; index += 1) {
    if (latestParts[index] !== installedParts[index]) {
      return latestParts[index]! > installedParts[index]!
    }
  }
  return false
}

const credentialSecret = (value: unknown) => {
  if (typeof value === 'string') return value.trim()
  const object = record(value)
  return object?.type === 'key' && typeof object.key === 'string' ? object.key.trim() : ''
}

export class MiniMaxCliIntegrationService {
  private readonly runProcess: MiniMaxCliProcessRunner
  private readonly env: NodeJS.ProcessEnv
  private readonly platform: NodeJS.Platform
  private readonly now: () => number
  private readonly listeners = new Set<(status: MiniMaxCliStatus) => void>()
  private operation: 'installing' | 'updating' | 'uninstalling' | null = null
  private operationError: string | undefined
  private cachedStatus: { at: number; value: MiniMaxCliStatus } | null = null
  private latestCache: { at: number; value?: string } | null = null
  private currentCredentialSource: MiniMaxCliCredentialSource | undefined

  constructor(
    private readonly settings: MiniMaxCliSettingsRepository,
    private readonly credentials: MiniMaxCredentialRepository,
    private readonly options: MiniMaxCliIntegrationOptions,
  ) {
    this.runProcess = options.runProcess ?? defaultProcessRunner
    this.env = options.env ?? process.env
    this.platform = options.platform ?? process.platform
    this.now = options.now ?? Date.now
  }

  subscribe(listener: (status: MiniMaxCliStatus) => void) {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  async status(input: { forceReload?: boolean | undefined } = {}): Promise<MiniMaxCliStatus> {
    if (
      !input.forceReload &&
      this.cachedStatus &&
      this.now() - this.cachedStatus.at < STATUS_CACHE_MS
    ) {
      return this.withTransientState(this.cachedStatus.value)
    }
    const executables = await this.resolvePrerequisites()
    const state = this.settings.state()
    if (
      !executables.node ||
      !executables.npm ||
      versionMajor(executables.nodeVersion) === null ||
      versionMajor(executables.nodeVersion)! < 18
    ) {
      const value: MiniMaxCliStatus = {
        installationStatus: this.operation ?? 'missing-prerequisite',
        updateAvailable: false,
        ...(executables.nodeVersion ? { nodeVersion: executables.nodeVersion } : {}),
        ...(executables.npmVersion ? { npmVersion: executables.npmVersion } : {}),
        prerequisiteReason: '需要 Node.js 18 或更高版本',
        authStatus: 'unknown',
        ...(this.operationError ? { operationError: this.operationError } : {}),
        generation: state.generation,
        updatedAt: state.updatedAt,
      }
      this.cachedStatus = { at: this.now(), value }
      return value
    }

    const installedVersion = await this.installedVersion(executables.npm)
    const latestVersion = await this.latestVersion(executables.npm, input.forceReload === true)
    if (installedVersion) await this.reconcileCredential()
    const auth = await this.authState()
    const quota =
      input.forceReload && installedVersion && auth.authStatus !== 'not-authenticated'
        ? await this.quotaState(executables.npm)
        : {}
    const currentState = this.settings.state()
    const value: MiniMaxCliStatus = {
      installationStatus: this.operation ?? (installedVersion ? 'installed' : 'not-installed'),
      ...(installedVersion ? { installedVersion } : {}),
      ...(latestVersion ? { latestVersion } : {}),
      updateAvailable: Boolean(
        installedVersion && latestVersion && isNewerVersion(latestVersion, installedVersion),
      ),
      nodeVersion: executables.nodeVersion!,
      npmVersion: executables.npmVersion!,
      ...auth,
      ...quota,
      ...(this.operationError ? { operationError: this.operationError } : {}),
      generation: currentState.generation,
      updatedAt: currentState.updatedAt,
    }
    this.cachedStatus = { at: this.now(), value }
    return value
  }

  async install(input: { operationId: string }) {
    const prepared = this.prepareOperation(input.operationId, 'install')
    if (prepared.repeated) return this.status({ forceReload: true })
    if (this.operation)
      throw new MiniMaxCliIntegrationError('CONFLICT', 'MiniMax CLI 正在执行其他操作', 409)
    const prerequisites = await this.resolvePrerequisites()
    if (
      !prerequisites.npm ||
      versionMajor(prerequisites.nodeVersion) === null ||
      versionMajor(prerequisites.nodeVersion)! < 18
    ) {
      throw new MiniMaxCliIntegrationError(
        'MINIMAX_CLI_PREREQUISITE_MISSING',
        '需要先安装 Node.js 18 或更高版本',
        412,
      )
    }
    const installed = await this.installedVersion(prerequisites.npm)
    this.operation = installed ? 'updating' : 'installing'
    this.operationError = undefined
    await this.notify()
    try {
      const result = await this.runProcess({
        executable: prerequisites.npm,
        args: ['install', '-g', `${PACKAGE_NAME}@latest`],
        env: this.env,
        timeoutMs: 10 * 60_000,
      })
      if (result.exitCode !== 0) {
        throw new MiniMaxCliIntegrationError(
          'MINIMAX_CLI_INSTALL_FAILED',
          'MiniMax CLI 安装失败，请检查网络或 npm 配置后重试',
          502,
        )
      }
      this.settings.completeOperation(input.operationId, 'install')
      this.latestCache = null
      this.cachedStatus = null
      await this.reconcileCredential()
      this.operation = null
      return await this.status({ forceReload: true })
    } catch (cause) {
      this.operationError =
        cause instanceof MiniMaxCliIntegrationError ? cause.message : 'MiniMax CLI 安装失败'
      if (cause instanceof MiniMaxCliIntegrationError) throw cause
      throw new MiniMaxCliIntegrationError(
        'MINIMAX_CLI_INSTALL_FAILED',
        'MiniMax CLI 安装失败，请检查网络或 npm 配置后重试',
        502,
      )
    } finally {
      this.operation = null
      await this.notify()
    }
  }

  async uninstall(input: { operationId: string }) {
    const prepared = this.prepareOperation(input.operationId, 'uninstall')
    if (prepared.repeated) return this.status({ forceReload: true })
    if (this.operation)
      throw new MiniMaxCliIntegrationError('CONFLICT', 'MiniMax CLI 正在执行其他操作', 409)
    const prerequisites = await this.resolvePrerequisites()
    if (!prerequisites.npm) {
      throw new MiniMaxCliIntegrationError(
        'MINIMAX_CLI_PREREQUISITE_MISSING',
        '未找到 npm，无法卸载 MiniMax CLI',
        412,
      )
    }
    this.operation = 'uninstalling'
    this.operationError = undefined
    await this.notify()
    try {
      const result = await this.runProcess({
        executable: prerequisites.npm,
        args: ['uninstall', '-g', PACKAGE_NAME],
        env: this.env,
        timeoutMs: 10 * 60_000,
      })
      if (result.exitCode !== 0) {
        throw new MiniMaxCliIntegrationError(
          'MINIMAX_CLI_UNINSTALL_FAILED',
          'MiniMax CLI 卸载失败，请关闭正在使用它的终端后重试',
          502,
        )
      }
      await this.removeConfigFile()
      this.settings.recordCredential({})
      this.settings.completeOperation(input.operationId, 'uninstall')
      this.currentCredentialSource = undefined
      this.cachedStatus = null
      this.operation = null
      return await this.status({ forceReload: true })
    } catch (cause) {
      this.operationError =
        cause instanceof MiniMaxCliIntegrationError ? cause.message : 'MiniMax CLI 卸载失败'
      if (cause instanceof MiniMaxCliIntegrationError) throw cause
      throw new MiniMaxCliIntegrationError(
        'MINIMAX_CLI_UNINSTALL_FAILED',
        'MiniMax CLI 卸载失败，请关闭正在使用它的终端后重试',
        502,
      )
    } finally {
      this.operation = null
      await this.notify()
    }
  }

  async reconcileCredential() {
    const selected = await this.resolveCodingPlanCredential()
    const config = await this.readConfig()
    const state = this.settings.state()
    if (!selected) {
      const currentKey = typeof config.api_key === 'string' ? config.api_key : ''
      if (
        currentKey &&
        state.syncedCredentialFingerprint &&
        fingerprint(currentKey) === state.syncedCredentialFingerprint
      ) {
        delete config.api_key
        await this.writeConfig(config)
      }
      const result = this.settings.recordCredential({})
      this.currentCredentialSource = undefined
      if (result.changed) this.cachedStatus = null
      return result.changed
    }
    const nextFingerprint = fingerprint(selected.secret)
    const configChanged =
      config.api_key !== selected.secret ||
      config.region !== selected.source.region ||
      'oauth' in config
    if (configChanged) {
      config.api_key = selected.secret
      config.region = selected.source.region
      delete config.oauth
      await this.writeConfig(config)
    }
    const result = this.settings.recordCredential({
      providerId: selected.source.providerId,
      credentialId: selected.source.credentialId,
      fingerprint: nextFingerprint,
    })
    this.currentCredentialSource = selected.source
    if (result.changed || configChanged) this.cachedStatus = null
    return result.changed || configChanged
  }

  async credentialChanged(providerId: string) {
    if (providerId !== CN_PROVIDER && providerId !== GLOBAL_PROVIDER) return
    const prerequisites = await this.resolvePrerequisites()
    if (!prerequisites.npm || !(await this.installedVersion(prerequisites.npm))) return
    if (await this.reconcileCredential()) await this.notify()
  }

  async enabledSkillRoots() {
    const prerequisites = await this.resolvePrerequisites()
    if (!prerequisites.npm || !(await this.installedVersion(prerequisites.npm))) return []
    const integrationRoot = this.options.integrationRoot
    if (!integrationRoot) return []
    return [
      {
        pluginId: 'minimax-cli',
        pluginRoot: integrationRoot,
        skillsRoot: join(integrationRoot, 'skills'),
        generation: this.settings.state().generation,
      },
    ]
  }

  async shellPathEntries() {
    const prerequisites = await this.resolvePrerequisites()
    if (!prerequisites.npm) return []
    await this.reconcileCredential()
    const result = await this.runProcess({
      executable: prerequisites.npm,
      args: ['prefix', '-g'],
      env: this.env,
    }).catch(() => null)
    if (!result || result.exitCode !== 0 || !result.stdout) return []
    return [this.platform === 'win32' ? result.stdout : join(result.stdout, 'bin')]
  }

  private prepareOperation(operationId: string, kind: 'install' | 'uninstall') {
    try {
      return this.settings.prepareOperation(operationId, kind)
    } catch (cause) {
      if (cause instanceof MiniMaxCliSettingsConflictError) {
        throw new MiniMaxCliIntegrationError('CONFLICT', cause.message, 409)
      }
      throw cause
    }
  }

  private async resolveCodingPlanCredential(): Promise<ResolvedCredential | null> {
    for (const [providerId, region] of [
      [CN_PROVIDER, 'cn'],
      [GLOBAL_PROVIDER, 'global'],
    ] as const) {
      const summary = this.credentials
        .listProviderCredentials(providerId)
        .find((item) => item.active && item.enabled && item.kind === 'api-key')
      if (!summary?.maskedValue) continue
      const decrypted = await Effect.runPromise(this.credentials.activeCredential(providerId))
      const secret = credentialSecret(decrypted?.value)
      if (!decrypted || decrypted.id !== summary.id || !secret) continue
      return {
        secret,
        source: {
          providerId,
          credentialId: summary.id,
          label: summary.label,
          maskedValue: summary.maskedValue,
          region,
        },
      }
    }
    return null
  }

  private configDirectory() {
    const configured = this.env.MMX_CONFIG_DIR?.trim()
    return configured
      ? isAbsolute(configured)
        ? resolve(configured)
        : resolve(this.options.userHome, configured)
      : resolve(this.options.userHome, '.mmx')
  }

  private configPath() {
    return join(this.configDirectory(), 'config.json')
  }

  private async readConfig(): Promise<JsonObject> {
    try {
      const parsed = JSON.parse(await readFile(this.configPath(), 'utf8'))
      return record(parsed) ?? {}
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return {}
      if (cause instanceof SyntaxError) {
        throw new MiniMaxCliIntegrationError(
          'MINIMAX_CLI_CONFIG_FAILED',
          'MiniMax CLI 配置文件格式无效，请先修复配置后重试',
          409,
        )
      }
      throw new MiniMaxCliIntegrationError(
        'MINIMAX_CLI_CONFIG_FAILED',
        '无法读取 MiniMax CLI 配置',
        500,
      )
    }
  }

  private async writeConfig(config: JsonObject) {
    const directory = this.configDirectory()
    const path = this.configPath()
    const temporary = join(directory, `.config.${randomUUID()}.tmp`)
    try {
      await mkdir(directory, { recursive: true })
      await writeFile(temporary, `${JSON.stringify(config, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await rename(temporary, path)
      await chmod(path, 0o600).catch(() => undefined)
    } catch {
      await rm(temporary, { force: true }).catch(() => undefined)
      throw new MiniMaxCliIntegrationError(
        'MINIMAX_CLI_CONFIG_FAILED',
        '无法更新 MiniMax CLI 配置',
        500,
      )
    }
  }

  private async removeConfigFile() {
    const directory = this.configDirectory()
    const path = this.configPath()
    const root = parse(directory).root
    if (
      directory === root ||
      directory === resolve(this.options.userHome) ||
      dirname(path) !== directory
    ) {
      throw new MiniMaxCliIntegrationError(
        'PATH_DENIED',
        'MiniMax CLI 配置路径不安全，已停止清理',
        403,
      )
    }
    try {
      const canonicalDirectory = await realpath(directory)
      if (
        canonicalDirectory === parse(canonicalDirectory).root ||
        canonicalDirectory === (await realpath(this.options.userHome))
      ) {
        throw new MiniMaxCliIntegrationError(
          'PATH_DENIED',
          'MiniMax CLI 配置路径不安全，已停止清理',
          403,
        )
      }
      const stat = await lstat(path)
      if (stat.isSymbolicLink() || !stat.isFile()) {
        throw new MiniMaxCliIntegrationError(
          'PATH_DENIED',
          'MiniMax CLI 配置文件类型无效，已停止清理',
          403,
        )
      }
      await rm(path)
      await rmdir(directory).catch((cause) => {
        if (!['ENOTEMPTY', 'EEXIST'].includes((cause as NodeJS.ErrnoException).code ?? ''))
          throw cause
      })
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
      if (cause instanceof MiniMaxCliIntegrationError) throw cause
      throw new MiniMaxCliIntegrationError(
        'MINIMAX_CLI_CONFIG_FAILED',
        '无法删除 MiniMax CLI 登录配置',
        500,
      )
    }
  }

  private async resolvePrerequisites() {
    const [node, npm] = await Promise.all([
      this.findExecutable(this.platform === 'win32' ? 'node.exe' : 'node'),
      this.findExecutable(this.platform === 'win32' ? 'npm.cmd' : 'npm'),
    ])
    const [nodeVersion, npmVersion] = await Promise.all([
      node ? this.commandVersion(node, ['--version']) : undefined,
      npm ? this.commandVersion(npm, ['--version']) : undefined,
    ])
    return { node, npm, nodeVersion, npmVersion }
  }

  private async findExecutable(name: string) {
    const result = await this.runProcess({
      executable: this.platform === 'win32' ? 'where.exe' : 'which',
      args: [name],
      env: this.env,
    }).catch(() => null)
    if (!result || result.exitCode !== 0) return undefined
    return result.stdout
      .split(/\r?\n/)
      .map((value) => value.trim())
      .find(Boolean)
  }

  private async commandVersion(executable: string, args: readonly string[]) {
    const result = await this.runProcess({ executable, args, env: this.env }).catch(() => null)
    return result?.exitCode === 0 ? result.stdout.trim() : undefined
  }

  private async installedVersion(npm: string) {
    const result = await this.runProcess({
      executable: npm,
      args: ['list', '-g', PACKAGE_NAME, '--depth=0', '--json'],
      env: this.env,
    }).catch(() => null)
    if (!result?.stdout) return undefined
    try {
      const parsed = record(JSON.parse(result.stdout))
      const dependencies = record(parsed?.dependencies)
      const entry = record(dependencies?.[PACKAGE_NAME])
      const version = typeof entry?.version === 'string' ? entry.version : undefined
      if (!version) return undefined
      const prefix = await this.runProcess({
        executable: npm,
        args: ['prefix', '-g'],
        env: this.env,
      }).catch(() => null)
      if (!prefix || prefix.exitCode !== 0 || !prefix.stdout) return undefined
      const executable =
        this.platform === 'win32'
          ? join(prefix.stdout, 'mmx.cmd')
          : join(prefix.stdout, 'bin', 'mmx')
      const verified = await this.commandVersion(executable, ['--version'])
      return verified ? version : undefined
    } catch {
      return undefined
    }
  }

  private async latestVersion(npm: string, forceReload: boolean) {
    if (!forceReload && this.latestCache && this.now() - this.latestCache.at < LATEST_CACHE_MS) {
      return this.latestCache.value
    }
    const result = await this.runProcess({
      executable: npm,
      args: ['view', PACKAGE_NAME, 'version', '--json'],
      env: this.env,
    }).catch(() => null)
    let value: string | undefined
    if (result?.exitCode === 0 && result.stdout) {
      try {
        const parsed = JSON.parse(result.stdout)
        value = typeof parsed === 'string' ? parsed : undefined
      } catch {
        value = result.stdout.replace(/^"|"$/g, '').trim() || undefined
      }
    }
    this.latestCache = value ? { at: this.now(), value } : { at: this.now() }
    return value
  }

  private async authState(): Promise<Pick<MiniMaxCliStatus, 'authStatus' | 'credentialSource'>> {
    const config = await this.readConfig()
    if (this.currentCredentialSource && typeof config.api_key === 'string') {
      return { authStatus: 'coding-plan-synced', credentialSource: this.currentCredentialSource }
    }
    if (record(config.oauth)) return { authStatus: 'oauth' }
    if (typeof config.api_key === 'string' && config.api_key.trim())
      return { authStatus: 'api-key' }
    return { authStatus: 'not-authenticated' }
  }

  private async quotaState(
    npm: string,
  ): Promise<Pick<MiniMaxCliStatus, 'quotaStatus' | 'quotaLabel'>> {
    const prefix = await this.runProcess({
      executable: npm,
      args: ['prefix', '-g'],
      env: this.env,
    }).catch(() => null)
    if (!prefix || prefix.exitCode !== 0 || !prefix.stdout) return { quotaStatus: 'unknown' }
    const executable =
      this.platform === 'win32' ? join(prefix.stdout, 'mmx.cmd') : join(prefix.stdout, 'bin', 'mmx')
    const result = await this.runProcess({
      executable,
      args: ['quota', 'show', '--output', 'json', '--quiet', '--non-interactive'],
      env: this.env,
      timeoutMs: 30_000,
    }).catch(() => null)
    if (!result) return { quotaStatus: 'unknown' }
    if (result.exitCode === 0) return { quotaStatus: 'available', quotaLabel: '套餐可用' }
    if (result.exitCode === 3 || result.exitCode === 4) {
      return { quotaStatus: 'unavailable', quotaLabel: '套餐额度不可用' }
    }
    return { quotaStatus: 'unknown', quotaLabel: '暂时无法检查套餐状态' }
  }

  private withTransientState(value: MiniMaxCliStatus): MiniMaxCliStatus {
    return {
      ...value,
      installationStatus: this.operation ?? value.installationStatus,
      ...(this.operationError ? { operationError: this.operationError } : {}),
    }
  }

  private async notify() {
    this.cachedStatus = null
    const status = await this.status({ forceReload: false }).catch(() => null)
    if (!status) return
    for (const listener of this.listeners) listener(status)
  }
}
