import { createHash } from 'node:crypto'
import type { TerminalHostContextResult } from '@pidex/agent-protocol/terminal'
import type {
  ResolvedThreadWorkspace,
  ThreadWorkspaceResolver,
} from '../workspace/ThreadWorkspaceResolver'

export type TerminalTargetKindResolver = (
  workspace: ResolvedThreadWorkspace,
) => 'local' | 'worktree' | Promise<'local' | 'worktree'>

const digest = (...parts: string[]) =>
  createHash('sha256').update(parts.join('\0'), 'utf8').digest('hex')

/** Resolves the trusted launch context without owning PTYs or terminal state. */
export class TerminalContextService {
  constructor(
    private readonly workspaces: ThreadWorkspaceResolver,
    private readonly resolveTargetKind: TerminalTargetKindResolver = () => 'local',
  ) {}

  async resolve(threadId: string): Promise<TerminalHostContextResult> {
    const workspace = await this.workspaces.resolve(threadId)
    const executionBinding = workspace.executionBinding
    const targetKind = executionBinding?.kind ?? (await this.resolveTargetKind(workspace))
    const bindingId =
      executionBinding?.bindingId ??
      `terminal-binding:${digest(
        threadId,
        workspace.kind,
        workspace.projectID ?? '',
        workspace.workspaceRoot,
        targetKind,
      )}`
    const contextVersion = digest(
      bindingId,
      workspace.cwd,
      String(executionBinding?.revision ?? 1),
      String(executionBinding?.environmentRevision ?? 0),
    )
    return {
      threadId,
      bindingId,
      contextVersion,
      workspaceKind: workspace.kind,
      target: {
        kind: targetKind,
        cwd: workspace.cwd,
      },
    }
  }
}
