import { describe, expect, test } from 'bun:test'
import type { RenderTurnEntry } from '@pidex/session-view'

import type { DesktopGitStatus } from '../shared/Types.js'
import { deriveConversationChangeSummary } from '../src/features/session/composer/ConversationChangeSummary.js'

describe('deriveConversationChangeSummary', () => {
  test('filters current Git stats to paths touched by this conversation', () => {
    const turns = [
      turn('turn-1', ['SRC\\Main.ts', 'src/reverted.ts']),
      turn('turn-2', ['src/main.ts', 'src/renamed-old.ts']),
    ]
    const status = gitStatus([
      gitFile('src/main.ts', 4, 2),
      gitFile('src/renamed.ts', 3, 1, 'src/renamed-old.ts'),
      gitFile('src/unrelated.ts', 99, 88),
    ])

    expect(deriveConversationChangeSummary(turns, status)).toEqual({
      files: [
        { path: 'src/main.ts', additions: 4, deletions: 2 },
        { path: 'src/renamed.ts', additions: 3, deletions: 1 },
      ],
      additions: 7,
      deletions: 3,
    })
  })

  test('uses the existing synthetic mutation fallback for historical turns', () => {
    const historicalTurn = {
      ...turn('turn-legacy', []),
      processItems: [
        {
          id: 'tool-legacy',
          messageID: 'message-legacy',
          turnId: 'turn-legacy',
          agentId: 'agent-1',
          type: 'tool',
          callID: 'call-legacy',
          tool: 'workspace.apply_patch',
          title: '修改文件',
          state: 'completed',
          input: { affectedPaths: [{ path: 'src/legacy.ts' }] },
          command: null,
          output: JSON.stringify({
            files: [{ path: 'src/legacy.ts', additions: 10, deletions: 5 }],
            additions: 10,
            deletions: 5,
          }),
          error: null,
          startedAt: 1,
          finishedAt: 2,
          durationMs: 1,
          createdAt: 1,
        },
      ],
    } as unknown as RenderTurnEntry

    expect(
      deriveConversationChangeSummary(
        [historicalTurn],
        gitStatus([gitFile('src/legacy.ts', 2, 1)]),
      ),
    ).toEqual({
      files: [{ path: 'src/legacy.ts', additions: 2, deletions: 1 }],
      additions: 2,
      deletions: 1,
    })
  })

  test('returns unavailable line totals instead of false zeroes', () => {
    expect(
      deriveConversationChangeSummary(
        [turn('turn-1', ['src/main.ts'])],
        gitStatus([gitFile('src/main.ts', null, null)]),
      ),
    ).toEqual({
      files: [{ path: 'src/main.ts', additions: null, deletions: null }],
      additions: null,
      deletions: null,
    })
  })
})

function turn(id: string, paths: string[]): RenderTurnEntry {
  return {
    id,
    processItems: [],
    patchItems:
      paths.length > 0
        ? [
            {
              id: `patch:${id}`,
              messageID: `message:${id}`,
              turnId: id,
              agentId: 'agent-1',
              type: 'patch',
              files: paths.map((path) => ({ path, additions: 100, deletions: 50 })),
              totalAdditions: paths.length * 100,
              totalDeletions: paths.length * 50,
              createdAt: 1,
            },
          ]
        : [],
  } as unknown as RenderTurnEntry
}

function gitStatus(files: DesktopGitStatus['files']): DesktopGitStatus {
  return {
    branchName: 'main',
    upstream: null,
    ahead: 0,
    behind: 0,
    clean: files.length === 0,
    files,
  }
}

function gitFile(
  path: string,
  additions: number | null,
  deletions: number | null,
  originalPath?: string,
): DesktopGitStatus['files'][number] {
  return {
    path,
    ...(originalPath ? { originalPath } : {}),
    status: ' M',
    stagedStatus: ' ',
    unstagedStatus: 'M',
    additions,
    deletions,
    isUntracked: false,
  }
}
