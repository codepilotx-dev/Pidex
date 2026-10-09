import { describe, expect, test } from 'bun:test'
import { createCanonicalThreadState, type CanonicalThreadPage } from '@pidex/session-view'

import {
  selectCanonicalConversationAuxiliaryState,
  selectCanonicalLatestTurnStatus,
  selectCanonicalSessionLifecycle,
  selectCanonicalSessionStatus,
} from '../src/features/session/conversation/CanonicalConversationSelectors.js'
import { canRegenerateConversationTitle } from '../src/features/session/conversation/ConversationTitleActions.js'

const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const
const model = { providerID: 'openai', id: 'gpt-5' }

describe('canonical conversation auxiliary selector', () => {
  test('derives permissions, usage, sources, title, and message presence', () => {
    const page: CanonicalThreadPage = {
      thread: {
        id: 'thread-1',
        projectID: null,
        title: null,
        gitBranch: null,
        workspace: {
          kind: 'projectless',
          projectID: null,
          workspaceRoot: 'C:\\workspace',
          cwd: 'C:\\workspace',
          outputDirectory: null,
        },
        settings: { taskMode: 'chat', permissionConfig },
        createdAt: 1,
        updatedAt: 12,
      },
      subagents: [],
      turns: [
        {
          turn: {
            id: 'turn-1',
            threadId: 'thread-1',
            sourceInputID: 'input-1',
            status: 'waiting-permission',
            mode: 'chat',
            model,
            permissionConfig,
            rootAgentId: 'agent-1',
            mergedInputIDs: [],
            startedAt: 2,
            finishedAt: null,
            elapsedSeconds: 10,
            error: null,
          },
          inputs: [
            {
              id: 'input-1',
              threadId: 'thread-1',
              turnId: 'turn-1',
              content: '请分析这个链接\n并继续',
              delivery: 'start',
              mode: 'chat',
              model,
              permissionConfig,
              state: 'active',
              createdAt: 2,
            },
          ],
          messages: [],
          agents: [],
          items: [
            {
              id: 'text-1',
              messageID: 'message-1',
              turnId: 'turn-1',
              agentId: 'agent-1',
              type: 'text',
              placement: 'result',
              text: '参考 [文档](https://example.com/docs) 和 http://localhost/private',
              status: 'completed',
              usage: {
                provider: 'openai',
                model: 'gpt-5',
                contextWindow: 10_000,
                input: 100,
                output: 20,
                cacheRead: 200,
                cacheWrite: 10,
                reasoning: 5,
              },
              createdAt: 10,
            },
            {
              id: 'tool-1',
              messageID: 'message-1',
              turnId: 'turn-1',
              agentId: 'agent-1',
              type: 'tool',
              callID: 'call-1',
              tool: 'shell',
              title: '运行测试',
              state: 'waiting-permission',
              input: { command: 'bun test' },
              command: 'bun test',
              output: null,
              error: null,
              startedAt: 7,
              finishedAt: null,
              durationMs: null,
              createdAt: 7,
            },
            {
              id: 'question-1',
              messageID: 'message-1',
              turnId: 'turn-1',
              agentId: 'agent-1',
              type: 'question',
              prompt: '继续吗？',
              choices: [
                {
                  id: 'yes',
                  label: '继续',
                  description: '继续执行',
                  recommended: true,
                },
                {
                  id: 'no',
                  label: '停止',
                  description: '停止执行',
                  recommended: false,
                },
              ],
              status: 'pending',
              answer: null,
              createdAt: 8,
            },
          ],
          approvals: [
            {
              id: 'approval-1',
              threadId: 'thread-1',
              turnId: 'turn-1',
              agentId: 'agent-1',
              toolCallID: 'call-1',
              tool: 'shell',
              command: 'bun test',
              cwd: null,
              paths: [],
              requestedPermissions: {
                readPaths: [],
                writePaths: [],
                networkDomains: [],
              },
              review: null,
              risk: 'medium',
              reason: '需要运行测试',
              status: 'pending',
              createdAt: 7,
            },
          ],
          attachments: [],
        },
      ],
      olderCursor: null,
      hasOlder: false,
      streamPosition: { streamId: 'thread:thread-1', sequence: 1 },
    }

    const result = selectCanonicalConversationAuxiliaryState(createCanonicalThreadState(page))

    expect(result.hasConversationMessages).toBe(true)
    expect(result.fallbackTitle).toBe('请分析这个链接')
    expect(
      canRegenerateConversationTitle({
        hasActiveSession: true,
        hasFirstMessage: result.fallbackTitle !== null,
        pending: false,
        status: 'done',
      }),
    ).toBe(true)
    expect(result.contextUsage).toMatchObject({
      usedTokens: 310,
      totalTokens: 330,
      reasoningTokens: 5,
    })
    expect(result.pendingPermissions).toHaveLength(2)
    expect(result.pendingPermissions[0]).toMatchObject({
      requestId: 'approval-1',
      toolUseId: 'call-1',
      description: '需要运行测试',
    })
    expect(result.pendingPermissions[1]?.toolName).toBe('AskUserQuestion')
    expect(result.sourceLinks).toEqual([{ label: '文档', url: 'https://example.com/docs' }])
  })

  test('maps a pending dynamic permission approval to a permission-grant request', () => {
    const page: CanonicalThreadPage = {
      thread: {
        id: 'thread-perm',
        projectID: null,
        title: null,
        gitBranch: null,
        settings: { taskMode: 'chat', permissionConfig },
        createdAt: 1,
        updatedAt: 12,
      },
      subagents: [],
      turns: [
        {
          turn: {
            id: 'turn-perm',
            threadId: 'thread-perm',
            sourceInputID: 'input-1',
            status: 'waiting-permission',
            mode: 'chat',
            model,
            permissionConfig,
            rootAgentId: 'agent-1',
            mergedInputIDs: [],
            startedAt: 2,
            finishedAt: null,
            elapsedSeconds: 10,
            error: null,
          },
          inputs: [],
          messages: [],
          agents: [],
          items: [],
          approvals: [
            {
              id: 'permission-1',
              threadId: 'thread-perm',
              turnId: 'turn-perm',
              agentId: 'agent-1',
              toolCallID: 'call-perm',
              tool: 'request_permissions',
              command: null,
              cwd: null,
              paths: ['C:\\docs', 'C:\\out', 'api.example.com'],
              requestedPermissions: {
                readPaths: ['C:\\docs'],
                writePaths: ['C:\\out'],
                networkDomains: ['api.example.com'],
              },
              review: null,
              risk: 'high',
              reason: '需要额外权限',
              status: 'pending',
              createdAt: 7,
              permissionGrant: {
                requestedScope: 'turn',
                allowedScopes: ['tool-call', 'turn'],
              },
            },
          ],
          attachments: [],
        },
      ],
      olderCursor: null,
      hasOlder: false,
      streamPosition: { streamId: 'thread:thread-perm', sequence: 1 },
    }

    const result = selectCanonicalConversationAuxiliaryState(createCanonicalThreadState(page))

    expect(result.pendingPermissions).toHaveLength(1)
    expect(result.pendingPermissions[0]).toMatchObject({
      requestId: 'permission-1',
      toolName: 'request_permissions',
      requestKind: 'permission-grant',
      permissionGrant: {
        requestedScope: 'turn',
        allowedScopes: ['tool-call', 'turn'],
      },
    })
  })

  test('maps a pending hook trust interaction into the shared approval card model', () => {
    const page: CanonicalThreadPage = {
      thread: {
        id: 'thread-hook',
        projectID: null,
        title: 'Hook trust',
        gitBranch: null,
        settings: { taskMode: 'chat', permissionConfig },
        createdAt: 1,
        updatedAt: 2,
      },
      subagents: [],
      turns: [],
      queue: { version: 0, pauseReason: null, turns: [], inputs: [] },
      pendingHookTrusts: [
        {
          interactionId: 'hook-trust-1',
          threadId: 'thread-hook',
          turnId: 'turn-hook',
          agentId: 'agent-hook',
          createdAt: 2,
          version: 1,
          kind: 'hookTrust',
          configPath: '.pidex/hooks.json',
          sha256: 'fixture-sha256',
          hook: {
            id: 'hook-1',
            name: 'Pre tool hook',
            event: 'pre-tool',
            command: 'fixture-command',
          },
        },
      ],
      olderCursor: null,
      hasOlder: false,
      streamPosition: { streamId: 'thread-hook', sequence: 2 },
    }

    const result = selectCanonicalConversationAuxiliaryState(createCanonicalThreadState(page))

    expect(result.pendingPermissions).toEqual([
      expect.objectContaining({
        requestId: 'hook-trust-1',
        toolName: 'HookTrust',
        description: '项目 Hook“Pre tool hook”请求信任，是否允许？',
        input: expect.objectContaining({
          configPath: '.pidex/hooks.json',
          configSha256: 'fixture-sha256',
        }),
      }),
    ])
  })

  test('returns an empty projection before canonical history is ready', () => {
    const result = selectCanonicalConversationAuxiliaryState(null)
    expect(result).toEqual({
      hasConversationMessages: false,
      pendingPermissions: [],
      contextUsage: null,
      queuedFollowUps: [],
      queuePauseReason: null,
      sessionStatus: null,
      sourceLinks: [],
      fallbackTitle: null,
    })
    expect(
      canRegenerateConversationTitle({
        hasActiveSession: true,
        hasFirstMessage: result.fallbackTitle !== null,
        pending: false,
        status: 'done',
      }),
    ).toBe(false)
  })

  test('keeps the full first line for the shared display helper', () => {
    const page: CanonicalThreadPage = {
      thread: {
        id: 'thread-long-title',
        projectID: null,
        title: null,
        gitBranch: null,
        workspace: {
          kind: 'projectless',
          projectID: null,
          workspaceRoot: 'C:\\workspace',
          cwd: 'C:\\workspace',
          outputDirectory: null,
        },
        settings: { taskMode: 'chat', permissionConfig },
        createdAt: 1,
        updatedAt: 2,
      },
      subagents: [],
      turns: [
        {
          turn: {
            id: 'turn-long-title',
            threadId: 'thread-long-title',
            sourceInputID: 'input-long-title',
            status: 'completed',
            mode: 'chat',
            model,
            permissionConfig,
            rootAgentId: 'agent-1',
            mergedInputIDs: [],
            startedAt: 2,
            finishedAt: 2,
            elapsedSeconds: 0,
            error: null,
          },
          inputs: [
            {
              id: 'input-long-title',
              threadId: 'thread-long-title',
              turnId: 'turn-long-title',
              content: '# 这是一个超过二十八个字符且不应在投影阶段提前截断的标题\n继续',
              delivery: 'start',
              mode: 'chat',
              model,
              permissionConfig,
              state: 'active',
              createdAt: 2,
            },
          ],
          messages: [],
          agents: [],
          items: [],
          approvals: [],
          attachments: [],
        },
      ],
      olderCursor: null,
      hasOlder: false,
      streamPosition: { streamId: 'thread:thread-long-title', sequence: 1 },
    }

    expect(
      selectCanonicalConversationAuxiliaryState(createCanonicalThreadState(page)).fallbackTitle,
    ).toBe('# 这是一个超过二十八个字符且不应在投影阶段提前截断的标题')
  })

  test('derives real-time sessionStatus from canonical state', () => {
    expect(selectCanonicalSessionStatus(null)).toBeNull()

    const completedPage: CanonicalThreadPage = {
      thread: {
        id: 'thread-completed',
        projectID: null,
        title: null,
        gitBranch: null,
        workspace: {
          kind: 'projectless',
          projectID: null,
          workspaceRoot: 'C:\\workspace',
          cwd: 'C:\\workspace',
          outputDirectory: null,
        },
        settings: { taskMode: 'chat', permissionConfig },
        createdAt: 1,
        updatedAt: 12,
      },
      subagents: [],
      turns: [
        {
          turn: {
            id: 'turn-1',
            threadId: 'thread-completed',
            sourceInputID: 'input-1',
            status: 'completed',
            mode: 'chat',
            model,
            permissionConfig,
            rootAgentId: 'agent-1',
            mergedInputIDs: [],
            startedAt: 2,
            finishedAt: 5,
            elapsedSeconds: 3,
            error: null,
          },
          inputs: [],
          messages: [],
          agents: [],
          items: [],
          approvals: [],
          attachments: [],
        },
      ],
      olderCursor: null,
      hasOlder: false,
      streamPosition: { streamId: 'thread:thread-completed', sequence: 1 },
    }

    const completedState = createCanonicalThreadState(completedPage)
    expect(selectCanonicalSessionStatus(completedState)).toBe('done')
    expect(selectCanonicalConversationAuxiliaryState(completedState).sessionStatus).toBe('done')

    const runningPage: CanonicalThreadPage = {
      ...completedPage,
      turns: [
        {
          ...completedPage.turns[0]!,
          turn: {
            ...completedPage.turns[0]!.turn,
            status: 'running',
            finishedAt: null,
          },
        },
      ],
    }
    const runningState = createCanonicalThreadState(runningPage)
    expect(selectCanonicalSessionStatus(runningState)).toBe('running')
    expect(selectCanonicalConversationAuxiliaryState(runningState).sessionStatus).toBe('running')
  })

  test('exposes the raw lifecycle status for list surfaces', () => {
    const page: CanonicalThreadPage = {
      thread: {
        id: 'thread-list-status',
        projectID: null,
        title: null,
        gitBranch: null,
        workspace: {
          kind: 'projectless',
          projectID: null,
          workspaceRoot: 'C:\\workspace',
          cwd: 'C:\\workspace',
          outputDirectory: null,
        },
        settings: { taskMode: 'chat', permissionConfig },
        createdAt: 1,
        updatedAt: 12,
      },
      subagents: [],
      turns: [
        {
          turn: {
            id: 'turn-active',
            threadId: 'thread-list-status',
            sourceInputID: 'input-1',
            status: 'waiting-question',
            mode: 'chat',
            model,
            permissionConfig,
            rootAgentId: 'agent-1',
            mergedInputIDs: [],
            startedAt: 2,
            finishedAt: null,
            elapsedSeconds: 3,
            error: null,
          },
          inputs: [],
          messages: [],
          agents: [],
          items: [],
          approvals: [],
          attachments: [],
        },
      ],
      olderCursor: null,
      hasOlder: false,
      streamPosition: { streamId: 'thread:thread-list-status', sequence: 1 },
    }

    expect(selectCanonicalLatestTurnStatus(null)).toBeNull()
    expect(selectCanonicalSessionLifecycle(null)).toBeNull()

    const waitingState = createCanonicalThreadState(page)
    expect(selectCanonicalLatestTurnStatus(waitingState)).toBe('waiting-question')
    expect(selectCanonicalSessionLifecycle(waitingState)).toEqual({
      status: 'waiting',
      latestTurnStatus: 'waiting-question',
    })

    const completedState = createCanonicalThreadState({
      ...page,
      turns: [
        {
          ...page.turns[0]!,
          turn: {
            ...page.turns[0]!.turn,
            status: 'completed',
            finishedAt: 5,
          },
        },
      ],
    })
    expect(selectCanonicalSessionLifecycle(completedState)).toEqual({
      status: 'done',
      latestTurnStatus: 'completed',
    })

    // A turn waiting in the queue is never the active turn, but list surfaces
    // must still report it as queued instead of idle.
    const queueOnlyState = createCanonicalThreadState({
      ...page,
      turns: [],
      queue: {
        version: 1,
        pauseReason: null,
        turns: [
          {
            ...page.turns[0]!.turn,
            id: 'turn-queued',
            status: 'queued',
            startedAt: null,
          },
        ],
        inputs: [],
      },
    })
    expect(selectCanonicalLatestTurnStatus(queueOnlyState)).toBeNull()
    expect(selectCanonicalSessionLifecycle(queueOnlyState)).toEqual({
      status: 'queued',
      latestTurnStatus: 'queued',
    })
    // The open conversation keeps its existing queue-only behaviour.
    expect(selectCanonicalSessionStatus(queueOnlyState)).toBe('idle')

    const emptyState = createCanonicalThreadState({ ...page, turns: [] })
    expect(selectCanonicalSessionLifecycle(emptyState)).toBeNull()
  })
})
