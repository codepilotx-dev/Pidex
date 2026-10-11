import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { AgentError } from '../Domain'
import type { HandoffDirection, HandoffJournal } from './HandoffRepository'

type GitResult = { code: number; stdout: string; stderr: string }

export interface HandoffGitRunner {
  run(cwd: string, args: readonly string[]): Promise<GitResult>
}

export type GitHandoffPlan = {
  direction: HandoffDirection
  sourceCwd: string
  destinationCwd: string
  sourceBranch: string
  sourceHead: string
  destinationBranch: string | null
  destinationHead: string
  fallbackBranch: string | null
}

export type GitHandoffResult = {
  journal: HandoffJournal
  warnings: string[]
}

const safeMessage: Record<string, string> = {
  NOT_GIT: '目标不是可用的 Git 工作区',
  LOCAL_DETACHED: 'Local 工作区处于 detached HEAD',
  WORKTREE_DETACHED: 'Worktree 未绑定命名分支',
  DEFAULT_BRANCH: '默认分支不能用于 Handoff',
  BRANCH_IN_USE: '目标分支已在其他工作区中签出',
  DESTINATION_DIRTY: '目标 Local 工作区存在未提交修改',
  HEAD_MISMATCH: '目标分支或 HEAD 与源任务不匹配',
  STASH_FAILED: '无法安全捕获工作区修改',
  CHECKOUT_FAILED: '无法安全切换目标分支',
  APPLY_FAILED: '无法安全应用源工作区修改',
  ROLLBACK_FAILED: 'Handoff 回滚未完整完成；所有 stash 均已保留',
}

const fail = (code: keyof typeof safeMessage, status = 409): never => {
  throw new AgentError(code, safeMessage[code]!, status)
}

const trim = (value: string) => value.trim()

export class BunHandoffGitRunner implements HandoffGitRunner {
  async run(cwd: string, args: readonly string[]) {
    const hooksPath = process.platform === 'win32' ? 'NUL' : '/dev/null'
    const child = Bun.spawn(['git', '-c', `core.hooksPath=${hooksPath}`, ...args], {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    return { code, stdout, stderr }
  }
}

/** Git-only mutation layer. It never invokes a shell, hard reset, or directory deletion. */
export class GitHandoffCoordinator {
  constructor(
    private readonly git: HandoffGitRunner = new BunHandoffGitRunner(),
    private readonly nextID: () => string = randomUUID,
  ) {}

  async inspect(
    direction: HandoffDirection,
    sourceCwd: string,
    destinationCwd: string,
  ): Promise<GitHandoffPlan> {
    const [sourceRoot, destinationRoot] = await Promise.all([
      this.required(sourceCwd, ['rev-parse', '--show-toplevel'], 'NOT_GIT'),
      this.required(destinationCwd, ['rev-parse', '--show-toplevel'], 'NOT_GIT'),
    ])
    const [sourceHead, destinationHead] = await Promise.all([
      this.required(sourceRoot, ['rev-parse', '--verify', 'HEAD'], 'NOT_GIT'),
      this.required(destinationRoot, ['rev-parse', '--verify', 'HEAD'], 'NOT_GIT'),
    ])
    const sourceBranchResult = await this.git.run(sourceRoot, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'HEAD',
    ])
    if (sourceBranchResult.code !== 0 || !trim(sourceBranchResult.stdout)) {
      fail(direction === 'local-to-worktree' ? 'LOCAL_DETACHED' : 'WORKTREE_DETACHED')
    }
    const sourceBranch = trim(sourceBranchResult.stdout)
    const branchHead = await this.required(
      sourceRoot,
      ['rev-parse', '--verify', `refs/heads/${sourceBranch}`],
      'HEAD_MISMATCH',
    )
    if (branchHead !== sourceHead) fail('HEAD_MISMATCH')
    await this.assertBranchOwnership(sourceRoot, sourceBranch, sourceRoot, destinationRoot)
    const fallbackBranch =
      direction === 'local-to-worktree' ? await this.defaultBranch(sourceRoot) : null
    if (direction === 'local-to-worktree' && (!fallbackBranch || sourceBranch === fallbackBranch))
      fail('DEFAULT_BRANCH')
    const destinationBranchResult = await this.git.run(destinationRoot, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'HEAD',
    ])
    const destinationBranch =
      destinationBranchResult.code === 0 ? trim(destinationBranchResult.stdout) || null : null
    if (direction === 'worktree-to-local') {
      const dirty = await this.required(
        destinationRoot,
        ['status', '--porcelain=v1', '--untracked-files=all'],
        'NOT_GIT',
      )
      if (dirty) fail('DESTINATION_DIRTY')
      const targetBranchHead = await this.required(
        destinationRoot,
        ['rev-parse', '--verify', `refs/heads/${sourceBranch}`],
        'HEAD_MISMATCH',
      )
      if (targetBranchHead !== sourceHead) fail('HEAD_MISMATCH')
    }
    return {
      direction,
      sourceCwd: sourceRoot,
      destinationCwd: destinationRoot,
      sourceBranch,
      sourceHead,
      destinationBranch,
      destinationHead,
      fallbackBranch,
    }
  }

  /**
   * Builds the durable recovery intent before the first Git mutation. Markers
   * contain only random identifiers and allow recovery to rediscover a stash
   * created immediately before a process crash.
   */
  createJournal(plan: GitHandoffPlan): HandoffJournal {
    return {
      sourceHead: plan.sourceHead,
      sourceBranch: plan.sourceBranch,
      destinationHead: plan.destinationHead,
      ...(plan.destinationBranch ? { destinationBranch: plan.destinationBranch } : {}),
      sourceStashMarker: `pidex-handoff-source-${this.nextID()}`,
      ...(plan.direction === 'local-to-worktree'
        ? { destinationStashMarker: `pidex-handoff-destination-${this.nextID()}` }
        : {}),
    }
  }

  async transfer(
    plan: GitHandoffPlan,
    onStep?: (
      step: 'capture-source' | 'release-branch' | 'checkout-destination' | 'apply-source-changes',
      journal: HandoffJournal,
    ) => void,
    preparedJournal: HandoffJournal = this.createJournal(plan),
  ): Promise<GitHandoffResult> {
    const journal: HandoffJournal = { ...preparedJournal }
    const warnings: string[] = []
    const sourceStashRef = await this.capture(
      plan.sourceCwd,
      journal.sourceStashMarker ?? `pidex-handoff-source-${this.nextID()}`,
    )
    if (sourceStashRef) journal.sourceStashRef = sourceStashRef
    onStep?.('capture-source', journal)
    if (plan.direction === 'local-to-worktree') {
      const destinationStashRef = await this.capture(
        plan.destinationCwd,
        journal.destinationStashMarker ?? `pidex-handoff-destination-${this.nextID()}`,
      )
      if (destinationStashRef) journal.destinationStashRef = destinationStashRef
      onStep?.('capture-source', journal)
    }

    if (plan.direction === 'local-to-worktree') {
      const fallbackBranch = plan.fallbackBranch ?? fail('DEFAULT_BRANCH')
      await this.required(
        plan.sourceCwd,
        ['checkout', '--quiet', fallbackBranch],
        'CHECKOUT_FAILED',
      )
    } else {
      await this.required(
        plan.sourceCwd,
        ['checkout', '--quiet', '--detach', plan.sourceHead],
        'CHECKOUT_FAILED',
      )
      journal.sourceDetached = true
    }
    onStep?.('release-branch', journal)

    await this.required(
      plan.destinationCwd,
      ['checkout', '--quiet', plan.sourceBranch],
      'CHECKOUT_FAILED',
    )
    onStep?.('checkout-destination', journal)
    if (journal.sourceStashRef) {
      await this.required(
        plan.destinationCwd,
        ['stash', 'apply', '--index', journal.sourceStashRef],
        'APPLY_FAILED',
      )
      onStep?.('apply-source-changes', journal)
    }
    if (journal.destinationStashRef) {
      const restored = await this.git.run(plan.destinationCwd, [
        'stash',
        'apply',
        '--index',
        journal.destinationStashRef,
      ])
      if (restored.code !== 0) warnings.push('目标工作区原有修改未能自动恢复；对应 stash 已保留')
      else journal.destinationStashApplied = true
      onStep?.('apply-source-changes', journal)
    }
    if (!journal.sourceStashRef && !journal.destinationStashRef)
      onStep?.('apply-source-changes', journal)
    return { journal, warnings }
  }

  async finalize(cwd: string, journal: HandoffJournal) {
    const warnings: string[] = []
    for (const oid of [
      journal.sourceStashRef,
      journal.destinationStashApplied ? journal.destinationStashRef : undefined,
    ]) {
      if (!oid) continue
      const list = await this.git.run(cwd, ['stash', 'list', '--format=%H%x00%gd'])
      const line =
        list.code === 0
          ? list.stdout.split(/\r?\n/).find((entry) => entry.startsWith(`${oid}\0`))
          : undefined
      const ref = line?.split('\0')[1]
      if (!ref || (await this.git.run(cwd, ['stash', 'drop', ref])).code !== 0)
        warnings.push('Handoff stash 已保留，可由用户稍后清理')
    }
    return warnings
  }

  async rollback(plan: GitHandoffPlan, journal: HandoffJournal) {
    let ok = true
    const sourceStashRef =
      journal.sourceStashRef ??
      (await this.findStashByMarker(plan.sourceCwd, journal.sourceStashMarker))
    const destinationStashRef =
      journal.destinationStashRef ??
      (await this.findStashByMarker(plan.destinationCwd, journal.destinationStashMarker))
    const run = async (cwd: string, args: readonly string[]) => {
      if ((await this.git.run(cwd, args)).code !== 0) ok = false
    }
    const checkout = async (cwd: string, ref: string | undefined) => {
      if (!ref) return
      await run(cwd, ['checkout', '--quiet', ref])
    }
    const applyStashIfNeeded = async (cwd: string, ref: string | undefined) => {
      if (!ref) return
      const status = await this.git.run(cwd, ['status', '--porcelain=v1', '--untracked-files=all'])
      if (status.code !== 0) {
        ok = false
        return
      }
      // A repeated recovery sees the changes restored by the previous attempt.
      // Do not apply the same stash twice; unresolved conflicts still fail safe.
      if (trim(status.stdout)) {
        const conflicts = await this.git.run(cwd, ['diff', '--name-only', '--diff-filter=U'])
        if (conflicts.code !== 0 || trim(conflicts.stdout)) ok = false
        return
      }
      await run(cwd, ['stash', 'apply', '--index', ref])
    }
    // Inverse order. We preserve every stash reference, even when restoring a
    // branch fails, so a user can recover without destructive commands.
    const destinationAtOriginal = await this.isAtOriginalDestination(plan)
    const destinationDirty = await this.git.run(plan.destinationCwd, [
      'status',
      '--porcelain=v1',
      '--untracked-files=all',
    ])
    if (destinationDirty.code !== 0) ok = false
    else if (!destinationAtOriginal && trim(destinationDirty.stdout))
      await run(plan.destinationCwd, [
        'stash',
        'push',
        '--include-untracked',
        '--message',
        `pidex-handoff-rollback-${this.nextID()}`,
      ])
    await checkout(plan.destinationCwd, journal.destinationBranch ?? journal.destinationHead)
    await checkout(plan.sourceCwd, journal.sourceBranch)
    await applyStashIfNeeded(plan.sourceCwd, sourceStashRef)
    await applyStashIfNeeded(plan.destinationCwd, destinationStashRef)
    return ok
  }

  async recover(input: {
    direction: HandoffDirection
    sourceCwd: string
    destinationCwd: string
    journal: HandoffJournal
  }) {
    const journal = input.journal
    if (!journal.sourceHead || !journal.sourceBranch || !journal.destinationHead) return false
    return this.rollback(
      {
        direction: input.direction,
        sourceCwd: input.sourceCwd,
        destinationCwd: input.destinationCwd,
        sourceBranch: journal.sourceBranch,
        sourceHead: journal.sourceHead,
        destinationBranch: journal.destinationBranch ?? null,
        destinationHead: journal.destinationHead,
        fallbackBranch: null,
      },
      journal,
    )
  }

  private async capture(cwd: string, message: string) {
    const dirty = await this.required(
      cwd,
      ['status', '--porcelain=v1', '--untracked-files=all'],
      'NOT_GIT',
    )
    if (!dirty) return undefined
    const before = await this.git.run(cwd, ['rev-parse', '--verify', 'refs/stash'])
    const stashed = await this.git.run(cwd, [
      'stash',
      'push',
      '--include-untracked',
      '--message',
      message,
    ])
    if (stashed.code !== 0) fail('STASH_FAILED', 409)
    const after = await this.required(cwd, ['rev-parse', '--verify', 'refs/stash'], 'STASH_FAILED')
    if (before.code === 0 && trim(before.stdout) === after) fail('STASH_FAILED')
    return after
  }

  private async findStashByMarker(cwd: string, marker: string | undefined) {
    if (!marker) return undefined
    const list = await this.git.run(cwd, ['stash', 'list', '--format=%H%x00%gs'])
    if (list.code !== 0) return undefined
    const entry = list.stdout.split(/\r?\n/).find((line) => line.includes(marker))
    const oid = entry?.split('\0', 1)[0]?.trim()
    return oid || undefined
  }

  private async isAtOriginalDestination(plan: GitHandoffPlan) {
    const head = await this.git.run(plan.destinationCwd, ['rev-parse', '--verify', 'HEAD'])
    if (head.code !== 0 || trim(head.stdout) !== plan.destinationHead) return false
    const branch = await this.git.run(plan.destinationCwd, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'HEAD',
    ])
    return plan.destinationBranch === null
      ? branch.code !== 0
      : branch.code === 0 && trim(branch.stdout) === plan.destinationBranch
  }

  private async defaultBranch(cwd: string) {
    const remote = await this.git.run(cwd, [
      'symbolic-ref',
      '--quiet',
      '--short',
      'refs/remotes/origin/HEAD',
    ])
    if (remote.code === 0) return trim(remote.stdout).replace(/^origin\//, '')
    for (const branch of ['main', 'master']) {
      if (
        (await this.git.run(cwd, ['show-ref', '--verify', '--quiet', `refs/heads/${branch}`]))
          .code === 0
      )
        return branch
    }
    return null
  }

  private async assertBranchOwnership(
    cwd: string,
    branch: string,
    sourceRoot: string,
    destinationRoot: string,
  ) {
    const result = await this.git.run(cwd, ['worktree', 'list', '--porcelain'])
    if (result.code !== 0) fail('NOT_GIT', 400)
    const pathKey = (value: string) =>
      process.platform === 'win32' ? resolve(value).toLowerCase() : resolve(value)
    const allowed = new Set([pathKey(sourceRoot), pathKey(destinationRoot)])
    let worktree: string | null = null
    for (const line of result.stdout.split(/\r?\n/)) {
      if (line.startsWith('worktree ')) worktree = trim(line.slice('worktree '.length))
      if (line === `branch refs/heads/${branch}` && worktree && !allowed.has(pathKey(worktree)))
        fail('BRANCH_IN_USE')
      if (!line) worktree = null
    }
  }

  private async required(cwd: string, args: readonly string[], code: keyof typeof safeMessage) {
    const result = await this.git.run(cwd, args)
    if (result.code !== 0) fail(code, code === 'NOT_GIT' ? 400 : 409)
    return trim(result.stdout)
  }
}
