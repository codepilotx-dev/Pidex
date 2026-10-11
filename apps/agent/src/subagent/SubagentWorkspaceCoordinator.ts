import { createHash } from 'node:crypto'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import {
  WorkspaceIsolationService,
  type BaselineMetadata,
  type WorkspaceDiff,
} from './WorkspaceIsolationService'
import type { SubagentWorkspaceProvider } from './SubagentService'

type PersistedWorkspace = {
  mode: 'shared' | 'worktree'
  state: 'ready' | 'preparing' | 'conflict' | 'applied' | 'discarded'
  rootPath: string | null
  baselineRef: string | null
  isolation?: BaselineMetadata
  outputPatchSha256?: string
}

const within = (parent: string, child: string) => {
  const path = relative(parent, child)
  return path === '' || (!path.startsWith('..') && !isAbsolute(path))
}

export class SubagentWorkspaceCoordinator implements SubagentWorkspaceProvider {
  private readonly services = new Map<string, Promise<WorkspaceIsolationService>>()

  constructor(
    private readonly db: AgentDatabase,
    private readonly workspacesRoot: string,
  ) {}

  async prepare(taskID: string, rootPath: string, mode: 'shared' | 'worktree') {
    const service = await this.service(rootPath)
    const stored = this.workspace(taskID)
    if (stored.isolation) {
      await service.adoptBaseline(stored.isolation, mode === 'worktree' ? taskID : undefined)
      return { rootPath: stored.isolation.workspacePath, baselineRef: stored.isolation.ref }
    }
    if (mode === 'worktree') {
      // A legacy task may have been persisted before its worktree was
      // actually created. Resume it in the source workspace; never create a
      // new worktree after the shared-workspace rollout.
      this.migrateToShared(taskID, service.repository.rootPath, 'ready')
      return { rootPath: service.repository.rootPath, baselineRef: null }
    }
    if (service.repository.kind !== 'git') {
      return { rootPath: service.repository.rootPath, baselineRef: null }
    }
    const baseline = await service.captureSharedBaseline()
    this.update(taskID, {
      mode,
      state: 'ready',
      rootPath: baseline.workspacePath,
      baselineRef: baseline.ref,
      isolation: baseline,
    })
    return { rootPath: baseline.workspacePath, baselineRef: baseline.ref }
  }

  async finalize(taskID: string) {
    const { service, baseline } = await this.context(taskID)
    const diff = await service.diff(baseline)
    this.update(taskID, { ...this.workspace(taskID), outputPatchSha256: diff.sha256 })
    if (baseline.mode !== 'worktree') return diff
    return this.applyWorktree(taskID, service, baseline, diff, false)
  }

  async recoverLegacyWorktrees() {
    const rows = this.db.sqlite
      .query(
        `
      SELECT id
      FROM subagent_tasks
      WHERE workspace_mode = 'worktree'
      ORDER BY created_at
    `,
      )
      .all() as Array<{ id: string }>
    const recovered: Array<{ taskID: string; result: unknown }> = []
    for (const row of rows) {
      try {
        const stored = this.workspace(row.id)
        if (!stored.isolation || stored.state === 'applied' || stored.state === 'discarded') {
          const rootPath = stored.isolation?.sourceRoot ?? stored.rootPath
          if (!rootPath) continue
          this.migrateToShared(
            row.id,
            rootPath,
            stored.state === 'discarded'
              ? 'discarded'
              : stored.state === 'applied'
                ? 'applied'
                : 'ready',
          )
          recovered.push({ taskID: row.id, result: { status: 'migrated-to-shared' } })
          continue
        }
        recovered.push({ taskID: row.id, result: await this.finalize(row.id) })
      } catch {
        // Missing/corrupt legacy isolation metadata is kept intact for the
        // existing manual recovery controls. Never guess or delete it.
      }
    }
    return recovered
  }

  async diff(taskID: string) {
    const { service, baseline } = await this.context(taskID)
    return service.diff(baseline)
  }

  async apply(taskID: string) {
    const { service, baseline } = await this.context(taskID)
    if (baseline.mode !== 'worktree')
      throw new AgentError('WORKTREE_UNAVAILABLE', 'shared 子 Agent 不能使用 worktree apply', 409)
    const diff = await service.diff(baseline)
    return this.applyWorktree(taskID, service, baseline, diff, true)
  }

  private async applyWorktree(
    taskID: string,
    service: WorkspaceIsolationService,
    baseline: BaselineMetadata,
    diff: WorkspaceDiff,
    throwOnConflict: boolean,
  ) {
    const stored = { ...this.workspace(taskID), outputPatchSha256: diff.sha256 }
    this.update(taskID, stored)
    if (diff.empty) {
      const cleanup = await service.complete(taskID)
      this.migrateToShared(taskID, baseline.sourceRoot, 'applied')
      return { status: 'applied' as const, empty: true, cleanup }
    }
    const preflight = await service.preflightThreeWay(diff.patch)
    if (preflight.status === 'conflict') {
      this.update(taskID, { ...stored, state: 'conflict' })
      if (throwOnConflict) {
        throw new AgentError(
          'WORKTREE_CONFLICT',
          '子 Agent 变更与父工作区冲突，父工作区未修改',
          409,
          preflight,
        )
      }
      return { status: 'conflict' as const, workspaceUnchanged: true }
    }
    const applied = await service.applyThreeWay(preflight.token)
    if (applied.status !== 'applied') {
      this.update(taskID, { ...stored, state: 'conflict' })
      if (!throwOnConflict) {
        return {
          status: 'conflict' as const,
          workspaceUnchanged:
            applied.status === 'failed' ? applied.workspaceUnchanged : applied.status === 'stale',
        }
      }
      const code = applied.status === 'stale' ? 'WORKTREE_CONFLICT' : 'WORKTREE_APPLY_FAILED'
      throw new AgentError(
        code,
        applied.status === 'stale'
          ? '父工作区在预检后发生变化，未应用子 Agent 变更'
          : '子 Agent 变更应用失败',
        409,
        applied,
      )
    }
    const cleanup = await service.complete(taskID)
    this.migrateToShared(taskID, baseline.sourceRoot, 'applied')
    return { status: 'applied' as const, applied, cleanup }
  }

  async discard(taskID: string) {
    const { service, baseline } = await this.context(taskID)
    const cleanup =
      baseline.mode === 'worktree'
        ? await service.discard(taskID)
        : await service.releaseSharedBaseline(baseline).then(() => ({
            workspaceID: taskID,
            disposition: 'discarded' as const,
            path: baseline.workspacePath,
          }))
    if (baseline.mode === 'worktree') this.migrateToShared(taskID, baseline.sourceRoot, 'discarded')
    else
      this.update(taskID, {
        ...this.workspace(taskID),
        state: 'discarded',
        rootPath: baseline.sourceRoot,
      })
    return cleanup
  }

  async restore(taskID: string) {
    const stored = this.workspace(taskID)
    const { service, baseline } = await this.context(taskID)
    if (baseline.mode !== 'shared' || baseline.repositoryKind !== 'git')
      throw new AgentError('NON_GIT_WRITE_UNAVAILABLE', '只有 Git shared writer 支持安全恢复', 409)
    if (!stored.outputPatchSha256)
      throw new AgentError('SUBAGENT_RESTORE_UNAVAILABLE', '子 Agent 尚未记录可恢复产物', 409)
    const current = await service.diff(baseline)
    if (current.sha256 !== stored.outputPatchSha256)
      throw new AgentError(
        'WORKTREE_CONFLICT',
        '父工作区文件已在子 Agent 完成后变化，拒绝覆盖',
        409,
      )
    await this.gitApplyReverse(baseline.sourceRoot, current)
    await service.releaseSharedBaseline(baseline)
    this.update(taskID, { ...stored, state: 'discarded', rootPath: baseline.sourceRoot })
    return { restored: true, sha256: current.sha256 }
  }

  private async context(taskID: string) {
    const stored = this.workspace(taskID)
    if (!stored.isolation)
      throw new AgentError('SUBAGENT_BASELINE_UNKNOWN', '子 Agent 尚未建立工作区基线', 404)
    const service = await this.service(stored.isolation.sourceRoot)
    await service.adoptBaseline(stored.isolation, stored.mode === 'worktree' ? taskID : undefined)
    return { service, baseline: stored.isolation }
  }

  private workspace(taskID: string) {
    const row = this.db.sqlite
      .query('SELECT workspace_state FROM subagent_tasks WHERE id = ?')
      .get(taskID) as { workspace_state: string } | null
    if (!row) throw new AgentError('SUBAGENT_NOT_FOUND', '子 Agent 不存在', 404)
    return JSON.parse(row.workspace_state) as PersistedWorkspace
  }

  private update(taskID: string, value: PersistedWorkspace) {
    this.db.sqlite
      .query('UPDATE subagent_tasks SET workspace_state = ?, updated_at = ? WHERE id = ?')
      .run(JSON.stringify(value), Date.now(), taskID)
  }

  private migrateToShared(taskID: string, rootPath: string, state: PersistedWorkspace['state']) {
    this.db.sqlite
      .query(
        "UPDATE subagent_tasks SET workspace_mode = 'shared', workspace_state = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        JSON.stringify({ mode: 'shared', state, rootPath, baselineRef: null }),
        Date.now(),
        taskID,
      )
  }

  private service(rootPath: string) {
    const canonical = resolve(rootPath)
    let opened = this.services.get(canonical)
    if (!opened) {
      const configured = resolve(this.workspacesRoot)
      if (within(canonical, configured) || within(configured, canonical)) {
        throw new AgentError(
          'WORKSPACE_DATA_ROOT_CONFLICT',
          '工作区不能与 Pidex 用户数据目录互相包含',
          409,
        )
      }
      const key = createHash('sha256').update(canonical.toLowerCase()).digest('hex').slice(0, 16)
      opened = WorkspaceIsolationService.open(canonical, join(configured, key))
      this.services.set(canonical, opened)
    }
    return opened
  }

  private async gitApplyReverse(rootPath: string, diff: WorkspaceDiff) {
    const run = async (check: boolean) => {
      const child = Bun.spawn(
        ['git', 'apply', '--reverse', '--binary', ...(check ? ['--check'] : []), '-'],
        {
          cwd: rootPath,
          stdin: new Blob([diff.patch]),
          stdout: 'pipe',
          stderr: 'pipe',
        },
      )
      const [stderr, code] = await Promise.all([new Response(child.stderr).text(), child.exited])
      if (code !== 0)
        throw new AgentError(
          'WORKTREE_CONFLICT',
          check ? '当前文件不再匹配子 Agent 产物，拒绝恢复' : '恢复子 Agent 变更失败',
          409,
          stderr.slice(0, 4_000),
        )
    }
    await run(true)
    await run(false)
  }
}
