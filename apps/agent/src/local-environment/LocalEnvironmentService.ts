import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import { basename, dirname, relative, resolve, sep } from 'node:path'
import type {
  LocalEnvironmentActionMetadata,
  LocalEnvironmentReadResult,
} from '@pidex/agent-protocol/local-environment'
import type { ConfigObject, ConfigValue } from '../config/ConfigService'
import {
  parseJsoncObject,
  patchJsonc,
  stringifyConfigJson,
  type JsoncEdit,
  type JsoncPathSegment,
} from '../config/JsoncDocument'
import { AgentError } from '../Domain'
import { LocalEnvironmentConfigError, parseLocalEnvironmentConfig } from './LocalEnvironmentConfig'
import {
  LocalEnvironmentDiscovery,
  localEnvironmentTrustIdentity,
} from './LocalEnvironmentDiscovery'
import type { LocalEnvironmentCatalog } from './LocalEnvironmentCatalog'
import type { LocalEnvironmentRunner } from './LocalEnvironmentRunner'
import type { ProjectTrustStore } from './ProjectTrustStore'
import {
  currentEnvironmentPlatform,
  resolvePlatformCommand,
  type LocalEnvironmentOperationKind,
} from './Types'

const EMPTY_REVISION = createHash('sha256').update('').digest('hex')
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex')

export type LocalEnvironmentContext = {
  bindingId: string
  contextVersion: string
  cwd: string
  workspaceKind: 'project' | 'projectless'
}

export type LocalEnvironmentContextResolver = (threadId: string) => Promise<LocalEnvironmentContext>

export class LocalEnvironmentService {
  catalog?: LocalEnvironmentCatalog
  constructor(
    private readonly discovery: LocalEnvironmentDiscovery,
    private readonly trust: ProjectTrustStore,
    private readonly runner: LocalEnvironmentRunner,
    private readonly resolveContext?: LocalEnvironmentContextResolver,
    private readonly folderTrusted?: (cwd: string) => Promise<boolean>,
  ) {}

  async readForThread(threadId: string) {
    const context = await this.requireProjectContext(threadId)
    return this.read(context.cwd)
  }

  async updateForThread(input: {
    threadId: string
    expectedRevision: string
    edits?: ReadonlyArray<{ keyPath: readonly JsoncPathSegment[]; value: ConfigValue }> | undefined
    trust?: { configHash: string; decision: 'allow' | 'revoke' } | undefined
  }) {
    const context = await this.requireProjectContext(input.threadId)
    return this.update({
      cwd: context.cwd,
      expectedRevision: input.expectedRevision,
      ...(input.edits ? { edits: input.edits } : {}),
      ...(input.trust ? { trust: input.trust } : {}),
    })
  }

  async actionListForThread(threadId: string) {
    const context = await this.requireProjectContext(threadId)
    return this.actionList(context.cwd)
  }

  async read(cwd: string, configPath?: string): Promise<LocalEnvironmentReadResult> {
    const loaded = await this.load(cwd, configPath)
    return {
      exists: loaded.exists,
      filePath: loaded.filePath,
      gitRoot: loaded.gitRoot,
      revision: loaded.revision,
      configHash: loaded.revision,
      config: loaded.raw,
      executionTrusted: await this.executionTrusted(cwd, loaded.projectIdentity, loaded.revision),
    }
  }

  async update(input: {
    cwd: string
    expectedRevision: string
    edits?: ReadonlyArray<{ keyPath: readonly JsoncPathSegment[]; value: ConfigValue }> | undefined
    trust?: { configHash: string; decision: 'allow' | 'revoke' } | undefined
    configPath?: string
  }) {
    const loaded = await this.load(input.cwd, input.configPath)
    if (loaded.frozen && input.edits)
      throw new AgentError(
        'LOCAL_ENVIRONMENT_CONFLICT',
        '工作树使用创建时的环境快照，请在项目环境页编辑源配置',
        409,
      )
    if (loaded.revision !== input.expectedRevision) {
      throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '本地环境配置已被其他操作修改', 409)
    }
    if (!input.edits && !input.trust) {
      throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '本地环境更新必须包含编辑或信任决策', 400)
    }
    if (input.trust?.configHash !== undefined && input.trust.configHash !== loaded.revision) {
      throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '本地环境配置已更改，需要重新确认', 409)
    }
    if (input.edits && input.trust?.decision === 'allow') {
      throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '请先保存配置，再确认执行信任', 409)
    }
    let revision = loaded.revision
    if (input.edits) {
      const source = loaded.exists
        ? loaded.source
        : stringifyConfigJson({ schema_version: 1, name: basename(loaded.gitRoot), actions: [] })
      let next: string
      try {
        next = patchJsonc(source, input.edits as readonly JsoncEdit[])
        parseLocalEnvironmentConfig(parseJsoncObject(next))
      } catch (cause) {
        if (cause instanceof LocalEnvironmentConfigError || cause instanceof Error) {
          throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '本地环境配置无效', 400)
        }
        throw cause
      }
      await this.assertControlledTarget(loaded.gitRoot, loaded.filePath)
      await mkdir(dirname(loaded.filePath), { recursive: true })
      await this.assertControlledTarget(loaded.gitRoot, loaded.filePath)
      const temporary = `${loaded.filePath}.${randomUUID()}.tmp`
      try {
        await writeFile(temporary, next, { encoding: 'utf8', flag: 'wx' })
        await this.assertControlledTarget(loaded.gitRoot, loaded.filePath)
        if ((await this.revisionAt(loaded.filePath)) !== loaded.revision) {
          throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '本地环境配置已被其他操作修改', 409)
        }
        await rename(temporary, loaded.filePath)
      } finally {
        await rm(temporary, { force: true }).catch(() => undefined)
      }
      revision = hash(next)
      await this.trust.revokeExecution(loaded.projectIdentity)
    }
    if (input.trust?.decision === 'allow') {
      await this.trust.trustExecution(loaded.projectIdentity, loaded.revision)
      const confirmed = await this.load(input.cwd, input.configPath)
      if (
        confirmed.projectIdentity !== loaded.projectIdentity ||
        confirmed.revision !== loaded.revision
      ) {
        await this.trust.revokeExecution(loaded.projectIdentity)
        throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '本地环境配置已更改，需要重新确认', 409)
      }
    } else if (input.trust?.decision === 'revoke') {
      await this.trust.revokeExecution(loaded.projectIdentity)
    }
    const executionTrusted = await this.executionTrusted(
      input.cwd,
      loaded.projectIdentity,
      revision,
    )
    return {
      filePath: loaded.filePath,
      revision,
      configHash: revision,
      executionTrusted,
    }
  }

  async actionList(
    cwd: string,
  ): Promise<{ revision: string; actions: LocalEnvironmentActionMetadata[] }> {
    const loaded = await this.load(cwd)
    const platform = currentEnvironmentPlatform()
    return {
      revision: loaded.revision,
      actions: loaded.config.actions.map((action) => ({
        name: action.name,
        ...(action.icon ? { icon: action.icon } : {}),
        availability: resolvePlatformCommand(action, platform)
          ? ('available' as const)
          : ('unsupported-platform' as const),
      })),
    }
  }

  async confirmExecution(cwd: string, expectedConfigHash: string) {
    const loaded = await this.load(cwd)
    if (loaded.revision !== expectedConfigHash) {
      throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '本地环境配置已更改，需要重新确认', 409)
    }
    await this.trust.trustExecution(loaded.projectIdentity, loaded.revision)
  }

  async runLifecycle(input: {
    cwd: string
    bindingId: string
    kind: LocalEnvironmentOperationKind
    operationId?: string | undefined
    environment?: Readonly<Record<string, string | undefined>> | undefined
    signal?: AbortSignal | undefined
    onOutput?: ((chunk: string) => void) | undefined
  }) {
    const loaded = await this.load(input.cwd)
    const definition = input.kind === 'setup' ? loaded.config.setup : loaded.config.cleanup
    if (!definition) return null
    await this.requireExecutionTrust(input.cwd, loaded.projectIdentity, loaded.revision)
    return this.runner.run({
      ...input,
      command: resolvePlatformCommand(definition, currentEnvironmentPlatform()),
    })
  }

  operationOutput(operationId: string, afterSequence = 0) {
    return this.runner.output(operationId, afterSequence)
  }

  async hostEnvironment(threadId: string) {
    const context = await this.requireContext(threadId)
    return this.runner.environment(context.bindingId)
  }

  hostEnvironmentForBinding(bindingId: string) {
    return this.runner.environment(bindingId)
  }

  async hostResolveAction(threadId: string, actionName: string) {
    const context = await this.requireProjectContext(threadId)
    const loaded = await this.load(context.cwd)
    await this.requireExecutionTrust(context.cwd, loaded.projectIdentity, loaded.revision)
    const action = loaded.config.actions.find((candidate) => candidate.name === actionName)
    if (!action)
      throw new AgentError('LOCAL_ENVIRONMENT_ACTION_NOT_FOUND', '本地环境 Action 不存在', 404)
    const command = resolvePlatformCommand(action, currentEnvironmentPlatform())
    if (!command)
      throw new AgentError('LOCAL_ENVIRONMENT_PLATFORM_UNSUPPORTED', '当前平台不支持此 Action', 409)
    const environment = await this.runner.environment(context.bindingId)
    return {
      contextVersion: context.contextVersion,
      environmentRevision: environment.revision,
      command,
    }
  }

  private async requireContext(threadId: string) {
    if (!this.resolveContext) throw new AgentError('INTERNAL_ERROR', '本地环境上下文尚未配置', 500)
    return this.resolveContext(threadId)
  }

  private async requireProjectContext(threadId: string) {
    const context = await this.requireContext(threadId)
    if (context.workspaceKind !== 'project') {
      throw new AgentError('LOCAL_ENVIRONMENT_NOT_GIT', '无项目任务不支持本地环境', 409)
    }
    return context
  }

  private async executionTrusted(cwd: string, identity: string, revision: string) {
    return this.folderTrusted
      ? this.folderTrusted(cwd)
      : this.trust.isExecutionTrusted(identity, revision)
  }

  private async requireExecutionTrust(cwd: string, identity: string, revision: string) {
    if (!(await this.executionTrusted(cwd, identity, revision))) {
      throw new AgentError('LOCAL_ENVIRONMENT_UNTRUSTED', '请先信任项目文件夹后再运行环境脚本', 403)
    }
  }

  private async assertControlledTarget(gitRoot: string, filePath: string) {
    const root = resolve(gitRoot)
    const target = resolve(filePath)
    const lexical = relative(root, target)
    if (!lexical || lexical === '..' || lexical.startsWith(`..${sep}`)) {
      throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '本地环境配置路径无效', 400)
    }
    const canonicalRoot = await realpath(root)
    let current = root
    const directoryParts = relative(root, dirname(target)).split(/[\\/]/).filter(Boolean)
    for (const part of directoryParts) {
      current = resolve(current, part)
      try {
        const info = await lstat(current)
        if (!info.isDirectory() || info.isSymbolicLink()) {
          throw new AgentError(
            'LOCAL_ENVIRONMENT_INVALID',
            '本地环境配置目录不能使用链接或重解析点',
            400,
          )
        }
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') break
        throw cause
      }
    }
    try {
      const info = await lstat(target)
      if (!info.isFile() || info.isSymbolicLink()) {
        throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '本地环境配置必须是普通文件', 400)
      }
      const canonicalTarget = await realpath(target)
      const canonicalRelation = relative(canonicalRoot, canonicalTarget)
      if (
        !canonicalRelation ||
        canonicalRelation === '..' ||
        canonicalRelation.startsWith(`..${sep}`)
      ) {
        throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '本地环境配置不能指向仓库外部', 400)
      }
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
      throw cause
    }
  }

  private async revisionAt(filePath: string) {
    try {
      return hash(await readFile(filePath, 'utf8'))
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return EMPTY_REVISION
      throw cause
    }
  }

  private async load(cwd: string, configPath?: string) {
    const original = await this.discovery.discover(cwd, configPath)
    const discovered = { ...original, projectIdentity: localEnvironmentTrustIdentity(original) }
    if (!discovered.frozen)
      await this.assertControlledTarget(discovered.gitRoot, discovered.filePath)
    if (!discovered.exists) {
      if (discovered.frozen)
        throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '工作树环境快照缺失', 409)
      const raw: ConfigObject = {
        schema_version: 1,
        name: basename(discovered.gitRoot),
        actions: [],
      }
      return {
        ...discovered,
        source: '',
        raw,
        revision: EMPTY_REVISION,
        config: parseLocalEnvironmentConfig(raw),
      }
    }
    try {
      const source = await readFile(discovered.filePath, 'utf8')
      if (discovered.frozen && hash(source) !== discovered.frozenRevision)
        throw new AgentError('LOCAL_ENVIRONMENT_CONFLICT', '环境快照已被修改', 409)
      const raw = parseJsoncObject(source)
      return {
        ...discovered,
        source,
        raw,
        revision: hash(source),
        config: parseLocalEnvironmentConfig(raw),
      }
    } catch (cause) {
      if (cause instanceof AgentError) throw cause
      throw new AgentError('LOCAL_ENVIRONMENT_INVALID', '本地环境配置无效', 400)
    }
  }
}
