import { createHash } from 'node:crypto'
import { realpath } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import type { ConfigObject, ConfigService, ConfigValue } from '../config/ConfigService'
import type { InstalledSkill } from '@pidex/agent-protocol'
import {
  SkillSettingsConflictError,
  SkillSettingsRepository,
} from '../storage/repositories/SkillSettingsRepository'
import {
  SkillService,
  type PluginSkillRoot,
  type SkillMetadata,
  type SkillScanOptions,
} from './SkillService'

type SkillStorageRoots = {
  dataRoot: string
  userHome: string
  builtinSkillsRoot?: string
}

export class SkillManagementError extends Error {
  constructor(
    readonly code: 'SKILL_NOT_FOUND' | 'PATH_DENIED' | 'CONFLICT' | 'INTERNAL_ERROR',
    message: string,
    readonly status: number,
  ) {
    super(message)
  }
}

const normalizedIdentityPath = (path: string) => {
  if (path.startsWith('builtin://') || path.startsWith('plugin://')) {
    return path.toLowerCase()
  }
  const absolute = resolve(path)
  return process.platform === 'win32' ? absolute.toLowerCase() : absolute
}

const builtinPath = (path: string) => path.startsWith('builtin://')

const workspaceRootForSkill = (path: string) => {
  const normalized = resolve(path).replaceAll('\\', '/')
  for (const marker of [
    '/.pidex/skills/',
    '/.agents/skills/',
    '/.codex/skills/',
    '/.claude/skills/',
  ]) {
    const index = normalized.toLowerCase().indexOf(marker)
    if (index >= 0) return normalized.slice(0, index)
  }
  return null
}

export const skillPathIdentity = (path: string) =>
  createHash('sha256').update(normalizedIdentityPath(path), 'utf8').digest('hex')

const toInstalledSkill = (skill: SkillMetadata, disabled: ReadonlySet<string>): InstalledSkill => ({
  name: skill.name,
  description: skill.description,
  path: skill.path,
  // Keep thread-rpc-v4 wire-compatible while the desktop maps builtin:// to “内置”.
  scope: skill.origin === 'builtin' ? 'user' : skill.origin,
  format: skill.format,
  enabled: !disabled.has(skillPathIdentity(skill.path)),
})

export class SkillManagementService {
  private readonly knownSkills = new Map<string, SkillMetadata>()

  constructor(
    private readonly settings: SkillSettingsRepository,
    private readonly roots: SkillStorageRoots,
    private readonly configService?: ConfigService,
    private readonly pluginSkillRoots?: (
      workspaceRoot?: string,
    ) => Promise<readonly PluginSkillRoot[]>,
  ) {}

  runtimeService() {
    const disabled = this.configuredDisabled(
      this.settings.disabledPathHashes(),
      this.configService?.snapshot() ?? {},
    )
    return new SkillService({
      ...(this.roots.builtinSkillsRoot ? { builtinSkillsRoot: this.roots.builtinSkillsRoot } : {}),
      ...(this.pluginSkillRoots ? { pluginSkillRoots: this.pluginSkillRoots } : {}),
      enabled: (skill) => !disabled.has(skillPathIdentity(skill.path)),
    })
  }

  async list(input: { workspace?: string | undefined; forceReload?: boolean | undefined } = {}) {
    const catalog = await this.scan(input.workspace)
    const state = this.settings.state()
    const config = this.configService
      ? (await this.configService.read(input.workspace ? { cwd: input.workspace } : {})).config
      : {}
    const disabled = this.configuredDisabled(new Set(state.disabledPathHashes), config)
    for (const skill of catalog.skills) {
      this.knownSkills.set(normalizedIdentityPath(skill.path), skill)
    }
    return {
      skills: catalog.skills.map((skill) => toInstalledSkill(skill, disabled)),
      generation: state.generation,
      updatedAt: state.updatedAt,
    }
  }

  async read(input: { workspace?: string | undefined; path: string }) {
    const skill = await this.resolveDiscoveredSkill(input.path, input.workspace)
    const state = this.settings.state()
    try {
      const loaded = await this.scanService(input.workspace).then(({ service }) =>
        service.read(skill.name),
      )
      if (normalizedIdentityPath(loaded.path) !== normalizedIdentityPath(skill.path)) {
        throw new SkillManagementError('SKILL_NOT_FOUND', '技能不存在或已被替换', 404)
      }
      return {
        skill: toInstalledSkill(skill, new Set(state.disabledPathHashes)),
        content: loaded.content,
      }
    } catch (cause) {
      if (cause instanceof SkillManagementError) throw cause
      throw new SkillManagementError('SKILL_NOT_FOUND', '技能不存在或无法读取', 404)
    }
  }

  async setEnabled(input: { path: string; enabled: boolean; operationId: string }) {
    const skill = await this.resolveKnownSkill(input.path)
    try {
      const result = this.settings.setEnabled({
        pathHash: skillPathIdentity(skill.path),
        enabled: input.enabled,
        operationId: input.operationId,
      })
      if (this.configService && !builtinPath(skill.path)) {
        const workspaceRoot =
          skill.origin === 'workspace' ? workspaceRootForSkill(skill.path) : null
        const target = workspaceRoot
          ? {
              filePath: join(workspaceRoot, '.pidex', 'config.json'),
              cwd: workspaceRoot,
            }
          : {}
        const read = await this.configService.read(workspaceRoot ? { cwd: workspaceRoot } : {})
        const skills = read.config.skills
        const existing =
          skills &&
          typeof skills === 'object' &&
          !Array.isArray(skills) &&
          Array.isArray((skills as ConfigObject).config)
            ? ((skills as ConfigObject).config as ConfigValue[])
            : []
        const normalizedPath = normalizedIdentityPath(skill.path)
        const entries = existing.filter(
          (entry) =>
            !entry ||
            typeof entry !== 'object' ||
            Array.isArray(entry) ||
            normalizedIdentityPath(String(entry.path ?? '')) !== normalizedPath,
        )
        entries.push({ path: skill.path, enabled: input.enabled })
        await this.configService.writeValue({
          keyPath: ['skills', 'config'],
          value: entries,
          ...target,
        })
      }
      return {
        result: {
          skill: {
            ...toInstalledSkill(skill, new Set(result.state.disabledPathHashes)),
            enabled: input.enabled,
          },
          generation: result.state.generation,
          updatedAt: result.state.updatedAt,
        },
        changed: result.changed,
      }
    } catch (cause) {
      if (cause instanceof SkillSettingsConflictError) {
        throw new SkillManagementError('CONFLICT', cause.message, 409)
      }
      throw cause
    }
  }

  private configuredDisabled(base: Set<string>, config: ConfigObject) {
    const disabled = new Set(base)
    const skills = config.skills
    if (!skills || typeof skills !== 'object' || Array.isArray(skills)) return disabled
    const entries = Array.isArray((skills as ConfigObject).config)
      ? ((skills as ConfigObject).config as ConfigValue[])
      : []
    for (const entry of entries) {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue
      if (typeof entry.path !== 'string' || typeof entry.enabled !== 'boolean') continue
      const identity = skillPathIdentity(entry.path)
      if (entry.enabled) disabled.delete(identity)
      else disabled.add(identity)
    }
    return disabled
  }

  private scanOptions(workspace?: string): SkillScanOptions {
    return {
      workspaceRoot: workspace ?? this.roots.userHome,
      dataRoot: this.roots.dataRoot,
      userHome: this.roots.userHome,
      ...(this.roots.builtinSkillsRoot ? { builtinSkillsRoot: this.roots.builtinSkillsRoot } : {}),
      includeWorkspace: workspace !== undefined,
    }
  }

  private async scanService(workspace?: string) {
    const service = new SkillService(
      this.roots.builtinSkillsRoot ? { builtinSkillsRoot: this.roots.builtinSkillsRoot } : {},
    )
    try {
      const catalog = await service.scan(this.scanOptions(workspace))
      return { service, catalog }
    } catch {
      throw new SkillManagementError('INTERNAL_ERROR', '技能目录扫描失败', 500)
    }
  }

  private async scan(workspace?: string) {
    return (await this.scanService(workspace)).catalog
  }

  private async canonicalRequestedPath(path: string) {
    if (!isAbsolute(path)) {
      throw new SkillManagementError('PATH_DENIED', '技能路径必须是绝对路径', 403)
    }
    try {
      return await realpath(path)
    } catch {
      throw new SkillManagementError('SKILL_NOT_FOUND', '技能不存在', 404)
    }
  }

  private async resolveDiscoveredSkill(path: string, workspace?: string) {
    const canonical = builtinPath(path)
      ? normalizedIdentityPath(path)
      : await this.canonicalRequestedPath(path)
    const catalog = await this.scan(workspace)
    const skill = catalog.skills.find(
      (candidate) => normalizedIdentityPath(candidate.path) === normalizedIdentityPath(canonical),
    )
    if (!skill)
      throw new SkillManagementError('SKILL_NOT_FOUND', '技能不存在或不在允许的技能目录中', 404)
    this.knownSkills.set(normalizedIdentityPath(skill.path), skill)
    return skill
  }

  private async resolveKnownSkill(path: string) {
    const canonical = builtinPath(path)
      ? normalizedIdentityPath(path)
      : await this.canonicalRequestedPath(path)
    const skill = this.knownSkills.get(normalizedIdentityPath(canonical))
    if (!skill) throw new SkillManagementError('SKILL_NOT_FOUND', '技能不存在或尚未发现', 404)
    return skill
  }
}
