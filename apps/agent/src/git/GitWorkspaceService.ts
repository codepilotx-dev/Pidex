import { realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { AgentError } from '../Domain'
import type { RepositoryDatabase } from '../storage/repositories/RepositoryDatabase'
import { GitCommandRunner } from './GitCommandRunner'

const DEFAULT_MAX_OUTPUT_BYTES = 4 * 1024 * 1024
const DEFAULT_TIMEOUT_MS = 30_000

const isContainedPath = (parent: string, candidate: string) => {
  const value = relative(parent, candidate)
  return value === '' || (!value.startsWith('..') && !isAbsolute(value))
}

export class GitWorkspaceService {
  private readonly runner: GitCommandRunner

  constructor(
    private readonly db: RepositoryDatabase,
    runner?: GitCommandRunner,
  ) {
    this.runner =
      runner ??
      new GitCommandRunner({
        maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
        timeoutMs: DEFAULT_TIMEOUT_MS,
      })
  }

  async createBranch(input: {
    projectId: string
    branchName: string
    startPoint?: string | undefined
  }) {
    const { project, repositoryRoot } = await this.repository(input.projectId)
    const branchName = await this.validateBranchName(repositoryRoot, input.branchName)
    const branchRef = `refs/heads/${branchName}`
    const existing = await this.runner.run({
      cwd: repositoryRoot,
      args: ['show-ref', '--verify', '--quiet', branchRef],
      acceptedCodes: [0, 1],
    })
    if (existing.code === 0) {
      throw new AgentError('GIT_BRANCH_EXISTS', '同名本地分支已经存在', 409)
    }

    const startPoint = await this.resolveCommit(repositoryRoot, input.startPoint?.trim() || 'HEAD')
    const created = await this.runner.run({
      cwd: repositoryRoot,
      args: ['switch', '-c', branchName, startPoint],
      acceptedCodes: [0, 1, 128],
    })
    if (created.code !== 0) {
      throw new AgentError('GIT_CHECKOUT_CONFLICT', '本地修改阻止了分支创建或检出', 409)
    }
    return { project }
  }

  async checkoutBranch(input: { projectId: string; branchName: string }) {
    const { project, repositoryRoot } = await this.repository(input.projectId)
    const branchName = await this.validateBranchName(repositoryRoot, input.branchName)
    const branchRef = `refs/heads/${branchName}`
    const existing = await this.runner.run({
      cwd: repositoryRoot,
      args: ['show-ref', '--verify', '--quiet', branchRef],
      acceptedCodes: [0, 1],
    })
    if (existing.code !== 0) {
      throw new AgentError('GIT_BRANCH_NOT_FOUND', '本地分支不存在', 404)
    }

    const checkout = await this.runner.run({
      cwd: repositoryRoot,
      args: ['switch', '--no-guess', '--', branchName],
      acceptedCodes: [0, 1, 128],
    })
    if (checkout.code !== 0) {
      throw new AgentError('GIT_CHECKOUT_CONFLICT', '本地修改阻止了分支切换', 409)
    }
    return { project }
  }

  private async repository(projectId: string) {
    const project = this.db.getProject(projectId)
    if (!project || project.removedAt) {
      throw new AgentError('PROJECT_NOT_FOUND', '项目不存在', 404)
    }
    if (!project.rootPath) {
      throw new AgentError('REPOSITORY_NOT_FOUND', '项目没有可用的工作区目录', 404)
    }

    let projectRoot: string
    try {
      projectRoot = await realpath(resolve(project.rootPath))
    } catch {
      throw new AgentError('REPOSITORY_NOT_FOUND', '项目工作区不可访问', 404)
    }
    const root = await this.runner.run({
      cwd: projectRoot,
      args: ['rev-parse', '--show-toplevel'],
      acceptedCodes: [0, 128],
    })
    if (root.code !== 0 || !root.stdout.trim()) {
      throw new AgentError('REPOSITORY_NOT_FOUND', '项目工作区不是 Git 仓库', 404)
    }

    let repositoryRoot: string
    try {
      repositoryRoot = await realpath(resolve(root.stdout.trim()))
    } catch {
      throw new AgentError('REPOSITORY_NOT_FOUND', 'Git 仓库目录不可访问', 404)
    }
    if (!isContainedPath(projectRoot, repositoryRoot)) {
      throw new AgentError('PATH_DENIED', 'Git 仓库超出项目工作区边界', 403)
    }
    return { project, repositoryRoot }
  }

  private async validateBranchName(repositoryRoot: string, value: string) {
    const branchName = value.trim()
    if (!branchName || branchName.startsWith('-') || branchName.includes('\0')) {
      throw new AgentError('GIT_BRANCH_INVALID', '分支名称无效', 400)
    }
    const result = await this.runner.run({
      cwd: repositoryRoot,
      args: ['check-ref-format', `refs/heads/${branchName}`],
      acceptedCodes: [0, 1],
    })
    if (result.code !== 0) {
      throw new AgentError('GIT_BRANCH_INVALID', '分支名称无效', 400)
    }
    return branchName
  }

  private async resolveCommit(repositoryRoot: string, value: string) {
    const result = await this.runner.run({
      cwd: repositoryRoot,
      args: ['rev-parse', '--verify', '--end-of-options', `${value}^{commit}`],
      acceptedCodes: [0, 128],
    })
    const sha = result.stdout.trim()
    if (result.code !== 0 || !/^[0-9a-f]{40,64}$/i.test(sha)) {
      throw new AgentError('GIT_BRANCH_NOT_FOUND', '分支起点不存在或不是提交', 404)
    }
    return sha
  }
}
