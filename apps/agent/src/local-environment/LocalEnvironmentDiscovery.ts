import { access, readdir } from 'node:fs/promises'
import { basename, dirname, join, relative, resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { AgentError } from '../Domain'
import type { GitCommandRunner } from '../git/GitCommandRunner'

export const LOCAL_ENVIRONMENT_RELATIVE_PATH = join('.pidex', 'environments', 'environment.jsonc')

export type DiscoveredLocalEnvironment = {
  gitRoot: string
  filePath: string
  exists: boolean
  projectIdentity: string
  frozen?: boolean
  frozenRevision?: string | undefined
  trustIdentity?: string | undefined
}

export const localEnvironmentTrustIdentity = (environment: DiscoveredLocalEnvironment) =>
  environment.trustIdentity ??
  (basename(environment.filePath) === 'environment.jsonc'
    ? environment.projectIdentity
    : createHash('sha256')
        .update(
          `${environment.projectIdentity}:${relative(environment.gitRoot, environment.filePath).replaceAll('\\', '/')}`,
          'utf8',
        )
        .digest('hex'))

const fileExists = async (path: string) =>
  access(path).then(
    () => true,
    () => false,
  )

export class LocalEnvironmentDiscovery {
  constructor(
    private readonly git: GitCommandRunner,
    private readonly selected?: (
      cwd: string,
      gitRoot: string,
    ) => { filePath: string; frozen?: boolean; revision?: string; trustIdentity?: string } | null,
  ) {}

  async discover(cwd: string, explicitPath?: string): Promise<DiscoveredLocalEnvironment> {
    let gitRoot: string
    let isGit = true
    try {
      const result = await this.git.run({ cwd, args: ['rev-parse', '--show-toplevel'] })
      gitRoot = resolve(result.stdout.trim())
    } catch {
      gitRoot = resolve(cwd)
      isGit = false
    }
    const start = resolve(cwd)
    const relation = relative(gitRoot, start)
    if (relation.startsWith('..') || resolve(gitRoot, relation) !== start) {
      throw new AgentError('LOCAL_ENVIRONMENT_NOT_GIT', 'Git 工作目录解析结果无效', 409)
    }
    const commonDirResult = isGit
      ? await this.git.run({ cwd, args: ['rev-parse', '--git-common-dir'] })
      : null
    const commonDir = commonDirResult
      ? resolve(gitRoot, commonDirResult.stdout.trim())
      : `local:${gitRoot}`
    const canonical = process.platform === 'win32' ? commonDir.toLocaleLowerCase() : commonDir
    const projectIdentity = createHash('sha256').update(canonical, 'utf8').digest('hex')
    const selected = explicitPath ? { filePath: explicitPath } : this.selected?.(cwd, gitRoot)
    if (selected)
      return {
        gitRoot,
        filePath: selected.filePath,
        exists: await fileExists(selected.filePath),
        projectIdentity,
        frozen: selected.frozen === true,
        frozenRevision: selected.revision,
        trustIdentity: selected.trustIdentity,
      }
    let current = start
    while (true) {
      const candidate = join(current, LOCAL_ENVIRONMENT_RELATIVE_PATH)
      if (await fileExists(candidate))
        return { gitRoot, filePath: candidate, exists: true, projectIdentity }
      const named = await readdir(dirname(candidate), { withFileTypes: true }).catch(
        (cause: NodeJS.ErrnoException) => {
          if (cause.code === 'ENOENT') return []
          throw cause
        },
      )
      const configurations = named.filter(
        (entry) => entry.isFile() && !entry.isSymbolicLink() && entry.name.endsWith('.jsonc'),
      )
      if (configurations.length === 1)
        return {
          gitRoot,
          filePath: join(dirname(candidate), configurations[0]!.name),
          exists: true,
          projectIdentity,
        }
      if (current === gitRoot)
        return {
          gitRoot,
          filePath: join(gitRoot, LOCAL_ENVIRONMENT_RELATIVE_PATH),
          exists: false,
          projectIdentity,
        }
      const parent = dirname(current)
      if (parent === current)
        throw new AgentError('LOCAL_ENVIRONMENT_NOT_GIT', 'Git 工作目录解析结果无效', 409)
      current = parent
    }
  }
}
