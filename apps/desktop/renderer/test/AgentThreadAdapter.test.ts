import { describe, expect, test } from 'bun:test'
import type {
  AgentNotification,
  Item,
  Project,
  TextItem,
  ThreadListItem,
  ThreadSnapshot,
} from '@pidex/shared/thread'
import {
  agentEventsFromNotification,
  agentQuestionIdFromRequestId,
  agentThreadListItemToDesktop,
  agentThreadSnapshotToDesktop,
  agentTurnStatusToDesktopStatus,
  desktopPermissionModeToPermissionConfig,
  latestItemContextUsage,
  permissionModeFromPermissionConfig,
  questionToRequest,
  approvalToRequest,
} from '../src/services/AgentThreadAdapter.js'

const project: Project = {
  id: 'project-1',
  name: 'Pidex-Ts',
  rootPath: 'F:\\CodeProject\\Pidex-Ts',
  lastOpenedAt: 1_700_000_000_000,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  settings: { defaultModel: null },
}

const projectWorkspace = {
  kind: 'project' as const,
  projectID: project.id,
  workspaceRoot: project.rootPath,
  cwd: project.rootPath,
  outputDirectory: null,
}

describe('agent thread adapter', () => {
  test('MCP 参数独立于卡片展示字段，实时文件审批保留宿主 diff', () => {
    const input = {
      command: 'actual parameter',
      paths: ['actual'],
      risk: 'actual',
      threadId: 'actual',
    }
    const request = approvalToRequest({
      id: 'approval',
      threadId: 'thread',
      turnId: 'turn',
      agentId: 'agent',
      toolCallID: 'call',
      tool: 'mcp__fixture__save',
      command: null,
      cwd: null,
      paths: [],
      risk: 'high',
      reason: '确认',
      status: 'pending',
      createdAt: 1,
      requestedPermissions: {},
      review: null,
      input,
      toolIdentity: { server: 'fixture', tool: 'save' },
    })
    expect(request.toolInput).toEqual(input)
    const preview = {
      path: 'normal.txt',
      operation: 'create',
      patch: '+normal',
      hunks: [],
      renderable: true,
      tooLargeReason: null,
    }
    const events = agentEventsFromNotification({
      method: 'approval/requested',
      params: {
        interactionId: 'approval',
        threadId: 'thread',
        turnId: 'turn',
        agentId: 'agent',
        toolCallId: 'call',
        tool: 'apply_patch',
        reason: '确认',
        affectedPaths: [{ path: 'normal.txt', operation: 'create' }],
        input: { approvalFileDiffs: [preview] },
        risk: 'high',
        createdAt: 1,
        version: 1,
        kind: 'approval',
      },
    } as AgentNotification)
    expect(events[0]).toMatchObject({ request: { input: { approvalFileDiffs: [preview] } } })
  })

  test('restores the latest actual model and exact variant without adopting queued selections', () => {
    const permissionConfig = desktopPermissionModeToPermissionConfig('default')
    const snapshot: ThreadSnapshot = {
      thread: {
        id: 'thread-model',
        title: '模型恢复',
        projectID: project.id,
        gitBranch: null,
        workspace: projectWorkspace,
        settings: { taskMode: 'chat', permissionConfig },
        archivedAt: null,
        createdAt: 1,
        updatedAt: 3,
      },
      turns: [],
      inputs: [],
      agents: [],
      messages: [],
      items: [],
      approvals: [],
    }
    const actual: ThreadSnapshot['turns'][number] = {
      id: 'actual',
      threadId: 'thread-model',
      sourceInputID: 'actual-input',
      status: 'failed',
      mode: 'chat',
      model: { providerID: 'deepseek', id: 'deepseek-chat' },
      permissionConfig,
      rootAgentId: 'agent-1',
      mergedInputIDs: [],
      startedAt: 1,
      finishedAt: 2,
      elapsedSeconds: 1,
      error: null,
    }
    const queued: ThreadSnapshot['turns'][number] = {
      ...actual,
      id: 'queued',
      sourceInputID: 'queued-input',
      status: 'queued',
      startedAt: null,
      finishedAt: null,
      model: { providerID: 'openai', id: 'gpt-5', variant: 'high' },
    }
    snapshot.inputs = [
      {
        id: 'queued-input',
        threadId: 'thread-model',
        turnId: 'queued',
        content: '稍后执行',
        delivery: 'follow-up',
        mode: 'chat',
        model: queued.model,
        permissionConfig,
        state: 'queued',
        createdAt: 3,
      },
    ]
    for (const variant of [undefined, 'default', 'enabled', 'adaptive', 'disabled', 'high']) {
      snapshot.turns = [{ ...actual, model: { ...actual.model, variant } }, queued]
      const restored = agentThreadSnapshotToDesktop(snapshot)
      const expectedThinkingMode =
        variant === 'enabled' || variant === 'adaptive' || variant === 'disabled'
          ? variant
          : 'default'
      expect(restored.settings).toMatchObject({
        providerID: 'deepseek',
        model: 'deepseek-chat',
        variant,
        thinkingMode: expectedThinkingMode,
      })
      expect(restored.item).toMatchObject({
        providerID: 'deepseek',
        model: 'deepseek-chat',
        thinkingMode: expectedThinkingMode,
      })
    }
    snapshot.turns = [queued]
    const queuedOnly = agentThreadSnapshotToDesktop(snapshot)
    expect(queuedOnly.settings.model).toBeUndefined()
    expect(queuedOnly.settings.variant).toBeUndefined()
    expect(queuedOnly.settings.thinkingMode).toBe('default')
    expect(queuedOnly.item.model).toBeNull()
  })

  test('maps terminal lifecycle states out of the sidebar running state', () => {
    expect(agentTurnStatusToDesktopStatus('completed')).toBe('done')
    expect(agentTurnStatusToDesktopStatus('failed')).toBe('error')
    expect(agentTurnStatusToDesktopStatus('interrupted')).toBe('interrupted')
  })

  test('maps built-in permission modes without widening the default sandbox', () => {
    expect(desktopPermissionModeToPermissionConfig('default')).toEqual({
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    })
    expect(desktopPermissionModeToPermissionConfig('auto-review')).toEqual({
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    })
    expect(desktopPermissionModeToPermissionConfig('full-access')).toEqual({
      sandboxMode: 'danger-full-access',
      approvalPolicy: 'never',
      approvalsReviewer: 'user',
    })
    expect(
      permissionModeFromPermissionConfig({
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      }),
    ).toBe('default')
    expect(
      permissionModeFromPermissionConfig({
        sandboxMode: 'read-only',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      }),
    ).toBe('custom')
    expect(
      permissionModeFromPermissionConfig({
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'auto_review',
      }),
    ).toBe('auto-review')
    expect(
      permissionModeFromPermissionConfig({
        sandboxMode: 'danger-full-access',
        approvalPolicy: 'never',
        approvalsReviewer: 'auto_review',
      }),
    ).toBe('full-access')
  })

  test('maps thread list item status and workspace fields', () => {
    const thread: ThreadListItem = {
      id: 'thread-1',
      projectID: project.id,
      gitBranch: 'codex/hover-card',
      workspace: projectWorkspace,
      title: '历史对话',
      preview: '预览',
      firstUserMessage: '第一条消息',
      messageCount: 3,
      latestTurnStatus: 'waiting-permission',
      settings: {
        taskMode: 'plan',
        permissionConfig: {
          sandboxMode: 'danger-full-access',
          approvalPolicy: 'never',
          approvalsReviewer: 'auto_review',
        },
      },
      archivedAt: null,
      unreadAt: 1_700_000_000_500,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    }
    const item = agentThreadListItemToDesktop(thread, project)
    expect(item.status).toBe('waiting')
    expect(item.workspacePath).toBe(project.rootPath)
    expect(item.preview).toBe('预览')
    expect(item.firstPrompt).toBe('第一条消息')
    expect(item.permissionMode).toBe('full-access')
    expect(item.planModeActive).toBe(true)
    expect(item.gitBranch).toBe('codex/hover-card')
    expect(item.unreadAt).toBe('2023-11-14T22:13:20.500Z')
    expect(item.creationSurface).toBeUndefined()
  })

  test('maps creationSurface for coding, working, chat, and legacy undefined', () => {
    const baseThread: ThreadListItem = {
      id: 'thread-surface-test',
      projectID: project.id,
      gitBranch: 'main',
      workspace: projectWorkspace,
      title: 'Surface test',
      preview: 'preview',
      firstUserMessage: 'hello',
      messageCount: 1,
      latestTurnStatus: 'completed',
      settings: {
        taskMode: 'chat',
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
      archivedAt: null,
      unreadAt: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    }
    const itemCoding = agentThreadListItemToDesktop(
      { ...baseThread, creationSurface: 'coding' },
      project,
    )
    expect(itemCoding.creationSurface).toBe('coding')

    const itemWorking = agentThreadListItemToDesktop(
      { ...baseThread, creationSurface: 'working' },
      project,
    )
    expect(itemWorking.creationSurface).toBe('working')

    const itemChat = agentThreadListItemToDesktop(
      { ...baseThread, creationSurface: 'chat' },
      project,
    )
    expect(itemChat.creationSurface).toBe('chat')

    const itemLegacy = agentThreadListItemToDesktop(baseThread, project)
    expect(itemLegacy.creationSurface).toBeUndefined()
  })

  test('preserves independent schedule and fork markers in list and snapshot adapters', () => {
    const base: ThreadListItem = {
      id: 'thread-origin',
      projectID: project.id,
      gitBranch: null,
      workspace: projectWorkspace,
      title: '来源',
      preview: null,
      firstUserMessage: null,
      messageCount: 0,
      latestTurnStatus: null,
      settings: {
        taskMode: 'chat',
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
      archivedAt: null,
      createdAt: 1,
      updatedAt: 2,
    }
    for (const markers of [
      {},
      { isScheduledSession: true },
      { hasScheduledRun: true, isScheduledSession: false },
      { isFork: true },
      { hasScheduledRun: true, isScheduledSession: true, isFork: true },
      { hasScheduledRun: false, isScheduledSession: false, isFork: false },
    ]) {
      const thread = { ...base, ...markers }
      const list = agentThreadListItemToDesktop(thread, project)
      const snapshot = agentThreadSnapshotToDesktop(
        {
          thread,
          turns: [],
          agents: [],
          inputs: [],
          messages: [],
          items: [],
          approvals: [],
        },
        project,
      ).item
      for (const item of [list, snapshot]) {
        expect(item.hasScheduledRun).toBe(thread.hasScheduledRun)
        expect(item.isScheduledSession).toBe(thread.isScheduledSession)
        expect(item.isFork).toBe(thread.isFork)
      }
    }
  })

  test('maps a projectless thread to a standalone session with its real cwd', () => {
    const cwd = 'C:\\Users\\tester\\Documents\\Pidex\\2026-07-22\\new-chat'
    const thread: ThreadListItem = {
      id: 'thread-projectless',
      projectID: null,
      gitBranch: null,
      workspace: {
        kind: 'projectless',
        projectID: null,
        workspaceRoot: 'C:\\Users\\tester\\Documents\\Pidex',
        cwd,
        outputDirectory: `${cwd}\\outputs`,
      },
      title: '无项目对话',
      preview: null,
      firstUserMessage: null,
      messageCount: 0,
      latestTurnStatus: null,
      settings: {
        taskMode: 'chat',
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
      archivedAt: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_000_000,
    }

    const item = agentThreadListItemToDesktop(thread, null)
    expect(item.standalone).toBe(true)
    expect(item.workspaceName).toBe('无项目会话')
    expect(item.workspacePath).toBe(cwd)
  })

  test('maps native snapshot text, plan, tool, patch, approval, and question', () => {
    const snapshot: ThreadSnapshot = {
      thread: {
        id: 'thread-1',
        title: '历史对话',
        projectID: project.id,
        gitBranch: 'dev',
        workspace: projectWorkspace,
        settings: {
          taskMode: 'plan',
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'auto_review',
          },
        },
        archivedAt: 1_700_000_007_000,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_008_000,
      },
      turns: [
        {
          id: 'turn-1',
          threadId: 'thread-1',
          sourceInputID: 'input-1',
          status: 'running',
          mode: 'plan',
          model: { providerID: 'deepseek', id: 'deepseek-chat' },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'auto_review',
          },
          rootAgentId: 'agent-1',
          mergedInputIDs: [],
          startedAt: 1_700_000_001_000,
          finishedAt: null,
          elapsedSeconds: 7,
          error: null,
        },
      ],
      agents: [
        {
          id: 'agent-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          parentAgentId: null,
          profile: 'main',
          task: '实现历史对话',
          model: { providerID: 'deepseek', id: 'deepseek-chat' },
          sessionId: 'thread-1:main',
          depth: 0,
          status: 'running',
          error: null,
          createdAt: 1_700_000_001_000,
          updatedAt: 1_700_000_008_000,
        },
      ],
      inputs: [
        {
          id: 'input-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          content: '实现历史对话',
          delivery: 'start',
          mode: 'plan',
          model: { providerID: 'deepseek', id: 'deepseek-chat' },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'auto_review',
          },
          state: 'active',
          createdAt: 1_700_000_001_000,
        },
      ],
      messages: [],
      items: [
        {
          id: 'text-1',
          messageID: 'turn-1',
          turnId: 'turn-1',
          agentId: 'agent-1',
          type: 'text',
          placement: 'result',
          text: '可以开始。',
          status: 'completed',
          usage: {
            provider: 'deepseek',
            model: 'deepseek-chat',
            contextWindow: 128_000,
            input: 2_000,
            output: 200,
            cacheRead: 6_000,
            cacheWrite: 400,
            reasoning: 50,
          },
          createdAt: 1_700_000_002_000,
        },
        {
          id: 'tool-1',
          messageID: 'turn-1',
          turnId: 'turn-1',
          agentId: 'agent-1',
          type: 'tool',
          callID: 'tool-1',
          tool: 'powershell.exec',
          title: '运行 PowerShell',
          state: 'completed',
          input: { command: 'bun test' },
          command: 'bun test',
          output: 'pass',
          error: null,
          startedAt: 1_700_000_003_000,
          finishedAt: 1_700_000_004_000,
          durationMs: 1000,
          createdAt: 1_700_000_003_000,
        },
        {
          id: 'plan-1',
          messageID: 'turn-1',
          turnId: 'turn-1',
          agentId: 'agent-1',
          type: 'plan',
          title: '计划',
          markdown: '- 改 adapter',
          status: 'completed',
          createdAt: 1_700_000_005_000,
        },
        {
          id: 'patch-1',
          messageID: 'turn-1',
          turnId: 'turn-1',
          agentId: 'agent-1',
          type: 'patch',
          files: [{ path: 'a.ts', additions: 1, deletions: 0, patch: 'diff' }],
          totalAdditions: 1,
          totalDeletions: 0,
          createdAt: 1_700_000_006_000,
        },
        {
          id: 'question-1',
          messageID: 'turn-1',
          turnId: 'turn-1',
          agentId: 'agent-1',
          type: 'question',
          prompt: '继续吗？',
          choices: [
            { id: 'yes', label: '继续', description: '继续执行', recommended: true },
            { id: 'no', label: '停止', description: '停止执行', recommended: false },
          ],
          status: 'pending',
          answer: null,
          createdAt: 1_700_000_007_000,
        },
      ],
      approvals: [
        {
          id: 'approval-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          agentId: 'agent-1',
          toolCallID: 'tool-1',
          tool: 'powershell.exec',
          command: 'bun test',
          cwd: null,
          paths: [],
          requestedPermissions: { readPaths: [], writePaths: [], networkDomains: [] },
          review: null,
          risk: 'medium',
          reason: '需要运行测试',
          status: 'pending',
          createdAt: 1_700_000_003_500,
        },
      ],
    }

    const desktop = agentThreadSnapshotToDesktop(snapshot, project)
    expect(desktop.item.status).toBe('running')
    expect(desktop.item.providerID).toBe('deepseek')
    expect(desktop.item.model).toBe('deepseek-chat')
    expect(desktop.item.planModeActive).toBe(true)
    expect(desktop.item.permissionMode).toBe('auto-review')
    expect(desktop.item.archivedAt).toBe('2023-11-14T22:13:27.000Z')
    expect(desktop.view.messages.map((message) => message.text)).toContain('实现历史对话')
    expect(desktop.view.messages.map((message) => message.text)).toContain('可以开始。')
    expect(desktop.view.toolLog).toHaveLength(2)
    expect(desktop.events?.some((event) => event.type === 'proposed_plan')).toBe(true)
    expect(desktop.events?.some((event) => event.type === 'file_patch')).toBe(true)
    expect(desktop.events?.find((event) => event.id === 'patch-1')?.metadata?.agentId).toBe(
      'agent-1',
    )
    expect(desktop.events?.find((event) => event.id === 'approval-1')?.metadata?.agentId).toBe(
      'agent-1',
    )
    expect(desktop.view.contextUsage).toMatchObject({
      usedTokens: 8_400,
      totalTokens: 8_600,
      promptCacheReadTokens: 6_000,
      promptCacheWriteTokens: 400,
      promptUncachedTokens: 2_000,
      reasoningTokens: 50,
    })
    expect(desktop.view.pendingPermissions.map((request) => request.toolName)).toEqual(
      expect.arrayContaining(['powershell.exec', 'AskUserQuestion']),
    )
    const question = desktop.view.pendingPermissions.find(
      (request) => request.toolName === 'AskUserQuestion',
    )
    expect(agentQuestionIdFromRequestId(question!.requestId)).toBe('question-1')
  })

  test('uses current thread settings instead of the latest historical turn snapshot', () => {
    const snapshot: ThreadSnapshot = {
      thread: {
        id: 'thread-settings',
        title: '设置投影',
        projectID: project.id,
        gitBranch: null,
        workspace: projectWorkspace,
        settings: {
          taskMode: 'chat',
          permissionConfig: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'never',
            approvalsReviewer: 'auto_review',
          },
        },
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_008_000,
      },
      turns: [
        {
          id: 'turn-old',
          threadId: 'thread-settings',
          sourceInputID: 'input-old',
          status: 'completed',
          mode: 'plan',
          model: { providerID: 'openai', id: 'gpt-5' },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
          },
          rootAgentId: 'agent-old',
          mergedInputIDs: [],
          startedAt: 1_700_000_001_000,
          finishedAt: 1_700_000_002_000,
          elapsedSeconds: 1,
          error: null,
        },
      ],
      agents: [
        {
          id: 'agent-old',
          threadId: 'thread-settings',
          turnId: 'turn-old',
          parentAgentId: null,
          profile: 'main',
          task: '历史任务',
          model: { providerID: 'openai', id: 'gpt-5' },
          sessionId: 'thread-settings:main',
          depth: 0,
          status: 'completed',
          error: null,
          createdAt: 1_700_000_001_000,
          updatedAt: 1_700_000_002_000,
        },
      ],
      inputs: [],
      messages: [],
      items: [],
      approvals: [],
    }

    const desktop = agentThreadSnapshotToDesktop(snapshot, project)
    expect(desktop.item.planModeActive).toBe(false)
    expect(desktop.item.permissionMode).toBe('full-access')
  })

  test('projects queued inputs in queue order without duplicating them in the timeline', () => {
    const permissionConfig = {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    } as const
    const model = { providerID: 'openai', id: 'gpt-5' }
    const snapshot: ThreadSnapshot = {
      thread: {
        id: 'thread-queue',
        title: '队列投影',
        projectID: project.id,
        gitBranch: null,
        workspace: projectWorkspace,
        settings: { taskMode: 'chat', permissionConfig },
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_004_000,
      },
      queue: { version: 4, pauseReason: 'interrupted' },
      turns: [
        {
          id: 'turn-active',
          threadId: 'thread-queue',
          sourceInputID: 'input-active',
          status: 'running',
          mode: 'chat',
          model,
          permissionConfig,
          rootAgentId: 'agent-active',
          mergedInputIDs: [],
          startedAt: 1_700_000_001_000,
          finishedAt: null,
          elapsedSeconds: 3,
          error: null,
        },
        {
          id: 'turn-third',
          threadId: 'thread-queue',
          sourceInputID: 'input-third',
          status: 'queued',
          mode: 'chat',
          model,
          permissionConfig,
          rootAgentId: 'agent-third',
          mergedInputIDs: [],
          queuePosition: 2,
          startedAt: null,
          finishedAt: null,
          elapsedSeconds: 0,
          error: null,
        },
        {
          id: 'turn-second',
          threadId: 'thread-queue',
          sourceInputID: 'input-second',
          status: 'queued',
          mode: 'chat',
          model,
          permissionConfig,
          rootAgentId: 'agent-second',
          mergedInputIDs: [],
          queuePosition: 1,
          startedAt: null,
          finishedAt: null,
          elapsedSeconds: 0,
          error: null,
        },
      ],
      agents: [],
      inputs: [
        {
          id: 'input-active',
          threadId: 'thread-queue',
          turnId: 'turn-active',
          content: '正在执行',
          delivery: 'start',
          mode: 'chat',
          model,
          permissionConfig,
          state: 'active',
          createdAt: 1_700_000_001_000,
        },
        {
          id: 'input-third',
          threadId: 'thread-queue',
          turnId: 'turn-third',
          content: '第三条',
          delivery: 'follow-up',
          mode: 'chat',
          model,
          permissionConfig,
          state: 'queued',
          createdAt: 1_700_000_003_000,
        },
        {
          id: 'input-second',
          threadId: 'thread-queue',
          turnId: 'turn-second',
          content: '第二条',
          delivery: 'follow-up',
          mode: 'chat',
          model,
          permissionConfig,
          state: 'queued',
          createdAt: 1_700_000_002_000,
        },
      ],
      messages: [],
      items: [],
      approvals: [],
    }

    const desktop = agentThreadSnapshotToDesktop(snapshot, project)
    expect(desktop.item.status).toBe('running')
    expect(desktop.queuedFollowUps?.map((item) => item.previewText)).toEqual(['第二条', '第三条'])
    expect(desktop.queuePauseReason).toBe('interrupted')
    expect(desktop.queueVersion).toBe(4)
    expect(desktop.view.messages.map((message) => message.text)).toEqual(['正在执行'])
  })

  test('maps native item notification into a live desktop event', () => {
    const notification: AgentNotification = {
      jsonrpc: '2.0',
      method: 'item/completed',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'text-1',
          messageID: 'turn-1',
          turnId: 'turn-1',
          agentId: 'agent-1',
          type: 'text',
          placement: 'result',
          text: '完成',
          status: 'completed',
          usage: {
            provider: 'openai',
            model: 'gpt-5.6',
            contextWindow: 200_000,
            input: 1_000,
            output: 300,
            cacheRead: 8_000,
            cacheWrite: 500,
            reasoning: 120,
          },
          createdAt: 1_700_000_010_000,
        },
      },
    }
    expect(agentEventsFromNotification(notification)).toEqual([
      {
        type: 'message',
        sessionId: 'thread-1',
        role: 'assistant',
        text: '完成',
        createdAt: '2023-11-14T22:13:30.000Z',
        metadata: { itemId: 'text-1', turnId: 'turn-1', agentId: 'agent-1', kind: 'text' },
      },
      {
        type: 'context_usage',
        sessionId: 'thread-1',
        createdAt: '2023-11-14T22:13:30.000Z',
        usage: {
          provider: 'openai',
          model: 'gpt-5.6',
          usedTokens: 9_500,
          totalTokens: 9_800,
          contextWindow: 200_000,
          remainingTokens: 190_500,
          usedPercent: 4.75,
          remainingPercent: 95.25,
          percentUsed: 4.75,
          promptCacheReadTokens: 8_000,
          promptCacheWriteTokens: 500,
          promptUncachedTokens: 1_000,
          reasoningTokens: 120,
        },
      },
    ])
  })

  test('ignores agent upsert notifications until the renderer has an agent tree UI', () => {
    const notification: AgentNotification = {
      jsonrpc: '2.0',
      method: 'agent/upserted',
      params: {
        threadId: 'thread-1',
        agent: {
          id: 'agent-1',
          threadId: 'thread-1',
          turnId: 'turn-1',
          parentAgentId: null,
          profile: 'main',
          task: '实现历史对话',
          model: { providerID: 'openai', id: 'gpt-5' },
          sessionId: 'thread-1:main',
          depth: 0,
          status: 'running',
          error: null,
          createdAt: 1_700_000_001_000,
          updatedAt: 1_700_000_008_000,
        },
      },
    }
    expect(agentEventsFromNotification(notification)).toEqual([])
  })

  test('uses the persisted terminal timestamp for read-through events', () => {
    const event = agentEventsFromNotification({
      jsonrpc: '2.0',
      method: 'turn/completed',
      params: {
        threadId: 'thread-1',
        turn: {
          finishedAt: 1_700_000_010_000,
        },
      },
    } as AgentNotification)[0]

    expect(event).toMatchObject({
      type: 'done',
      sessionId: 'thread-1',
      createdAt: '2023-11-14T22:13:30.000Z',
    })
  })

  test('projects stable Pi live deltas and nested terminal tool payloads', () => {
    const text = agentEventsFromNotification({
      jsonrpc: '2.0',
      method: 'item/agentMessage/delta',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        itemId: 'text-1',
        delta: '你好',
      },
    })[0]!
    const reasoning = agentEventsFromNotification({
      jsonrpc: '2.0',
      method: 'reasoning/textDelta',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        itemId: 'reasoning-1',
        delta: '分析',
      },
    })[0]!
    const plan = agentEventsFromNotification({
      jsonrpc: '2.0',
      method: 'plan/delta',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        itemId: 'plan-1',
        delta: '# 计划',
      },
    })[0]!
    const output = agentEventsFromNotification({
      jsonrpc: '2.0',
      method: 'tool/outputDelta',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        itemId: 'tool-1',
        delta: '50%',
      },
    })[0]!
    const terminal = agentEventsFromNotification({
      jsonrpc: '2.0',
      method: 'tool/callCompleted',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        item: {
          id: 'tool-1',
          messageID: 'turn-1',
          turnId: 'turn-1',
          agentId: 'agent-1',
          type: 'tool',
          callID: 'call-1',
          tool: 'shell_command',
          title: '执行命令',
          state: 'completed',
          input: {},
          command: null,
          output: '完成',
          error: null,
          startedAt: 1,
          finishedAt: 2,
          durationMs: 1,
          createdAt: 1,
        },
      },
    })[0]!

    expect(text).toMatchObject({
      type: 'partial_message',
      text: '你好',
      metadata: { itemId: 'text-1', kind: 'text' },
    })
    expect(reasoning).toMatchObject({
      type: 'partial_message',
      text: '分析',
      metadata: { itemId: 'reasoning-1', kind: 'reasoning' },
    })
    expect(plan).toMatchObject({
      type: 'proposed_plan',
      text: '# 计划',
      streaming: true,
      metadata: { itemId: 'plan-1', kind: 'plan' },
    })
    expect(output).toMatchObject({
      type: 'tool_output_delta',
      toolUseId: 'tool-1',
      delta: '50%',
      metadata: { itemId: 'tool-1' },
    })
    expect(terminal).toMatchObject({
      type: 'tool_result',
      toolName: 'shell_command',
      toolUseId: 'call-1',
      summary: '完成',
      metadata: { itemId: 'tool-1' },
    })
  })

  test('projects Pi interaction payloads using persisted interaction and question ids', () => {
    const approval = agentEventsFromNotification({
      jsonrpc: '2.0',
      method: 'approval/requested',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        interactionId: 'approval-1',
        createdAt: 1,
        version: 1,
        kind: 'approval',
        toolCallId: 'call-1',
        tool: 'shell_command',
        input: { command: 'bun test', cwd: 'F:\\CodeProject\\Pidex-Ts' },
        risk: 'medium',
        reason: '需要执行',
        requestedPermissions: { readPaths: [], writePaths: [], networkDomains: [] },
        allowedChoices: ['allow-once', 'deny'],
      },
    })[0]!
    const question = agentEventsFromNotification({
      jsonrpc: '2.0',
      method: 'question/requested',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        interactionId: 'interaction-1',
        createdAt: 1,
        version: 1,
        kind: 'question',
        questions: [
          {
            id: 'question-1',
            header: '方式',
            prompt: '如何继续？',
            choices: [
              { id: 'safe', label: '安全模式', description: '只读', recommended: true },
              { id: 'fast', label: '快速模式', description: '可写', recommended: false },
            ],
            allowFreeform: false,
            required: true,
          },
        ],
      },
    })[0]!

    expect(approval).toMatchObject({
      type: 'permission_request',
      request: {
        requestId: 'approval-1',
        toolUseId: 'call-1',
        toolName: 'shell_command',
        input: { command: 'bun test', cwd: 'F:\\CodeProject\\Pidex-Ts' },
        requestKind: 'shell-command',
      },
    })
    expect(question).toMatchObject({
      type: 'permission_request',
      request: {
        requestId: 'question:interaction-1',
        toolUseId: 'interaction-1',
        description: '如何继续？',
      },
    })
  })

  test('keeps the same complete question group for snapshots and live events', () => {
    const questions = ['scope', 'format', 'filter'].map((id) => ({
      id,
      header: id,
      prompt: `请选择 ${id}`,
      choices: [
        { id: `${id}-yes`, label: '是', description: '保留', recommended: true },
        { id: `${id}-no`, label: '否', description: '排除', recommended: false },
      ],
      allowFreeform: true as const,
      required: true as const,
      maxAnswers: id === 'scope' ? 2 : 1,
    }))
    const request = questionToRequest(
      {
        id: 'interaction-group',
        messageID: 'turn-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        type: 'question',
        prompt: questions[0]!.prompt,
        version: 1,
        choices: questions[0]!.choices,
        questions,
        status: 'pending',
        answer: null,
        createdAt: 1,
      },
      'thread-1',
    )
    const events = agentEventsFromNotification({
      jsonrpc: '2.0',
      method: 'question/requested',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        interactionId: 'interaction-group',
        createdAt: 1,
        version: 1,
        kind: 'question',
        questions,
      },
    })
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ type: 'permission_request', request })
    expect(request.requestId).toBe('question:interaction-group')
    expect(request.input.questions).toEqual(
      questions.map((question) => ({
        id: question.id,
        question: question.prompt,
        header: question.header,
        multiSelect: question.maxAnswers > 1,
        options: [
          { id: `${question.id}-yes`, label: '是', description: '保留', recommended: true },
          { id: `${question.id}-no`, label: '否', description: '排除', recommended: false },
        ],
      })),
    )
    const withoutDescription = questionToRequest({
      id: 'plain',
      messageID: 'turn-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'question',
      prompt: '请选择',
      choices: [
        { id: 'a', label: 'A', recommended: true },
        { id: 'b', label: 'B', recommended: false },
      ],
      status: 'pending',
      answer: null,
      createdAt: 1,
    })
    expect(withoutDescription.input.options).toEqual([
      { id: 'a', label: 'A', description: '', recommended: true },
      { id: 'b', label: 'B', description: '', recommended: false },
    ])
  })

  test('maps dynamic permission requests to permission-grant desktop requests', () => {
    const permission = agentEventsFromNotification({
      jsonrpc: '2.0',
      method: 'permission/requested',
      params: {
        threadId: 'thread-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        interactionId: 'permission-1',
        createdAt: 1,
        version: 1,
        kind: 'permission',
        toolCallId: 'call-perm',
        tool: 'request_permissions',
        risk: 'critical',
        reason: '需要额外权限',
        requestedPermissions: {
          readPaths: ['C:\\workspace\\docs'],
          writePaths: ['C:\\workspace\\out'],
          networkDomains: ['api.example.com'],
        },
        requestedScope: 'session',
        allowedScopes: ['tool-call', 'turn', 'session'],
      },
    })[0]!

    expect(permission).toMatchObject({
      type: 'permission_request',
      request: {
        requestId: 'permission-1',
        toolUseId: 'call-perm',
        toolName: 'request_permissions',
        requestKind: 'permission-grant',
        description: '需要额外权限',
        input: {
          paths: ['C:\\workspace\\docs', 'C:\\workspace\\out', 'api.example.com'],
          risk: 'critical',
        },
        permissionGrant: {
          requestedScope: 'session',
          allowedScopes: ['tool-call', 'turn', 'session'],
          requestedPermissions: {
            readPaths: ['C:\\workspace\\docs'],
            writePaths: ['C:\\workspace\\out'],
            networkDomains: ['api.example.com'],
          },
        },
      },
    })
  })

  test('approvalToRequest exposes permissionGrant metadata as permission-grant', () => {
    const snapshot: ThreadSnapshot = {
      thread: {
        id: 'thread-1',
        title: '权限会话',
        projectID: null,
        gitBranch: null,
        workspace: {
          kind: 'projectless',
          projectID: null,
          workspaceRoot: 'C:\\workspace',
          cwd: 'C:\\workspace',
          outputDirectory: null,
        },
        settings: {
          taskMode: 'chat',
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
          },
        },
        createdAt: 1,
        updatedAt: 2,
      },
      turns: [],
      agents: [],
      subagents: [],
      inputs: [],
      messages: [],
      items: [],
      approvals: [
        {
          id: 'approval-perm',
          threadId: 'thread-1',
          turnId: 'turn-1',
          agentId: 'agent-1',
          toolCallID: 'call-perm',
          tool: 'request_permissions',
          command: null,
          cwd: null,
          paths: ['C:\\docs', 'C:\\out'],
          requestedPermissions: {
            readPaths: ['C:\\docs'],
            writePaths: ['C:\\out'],
            networkDomains: [],
          },
          review: null,
          risk: 'high',
          reason: '需要额外权限',
          status: 'pending',
          createdAt: 1,
          permissionGrant: { requestedScope: 'turn', allowedScopes: ['tool-call', 'turn'] },
        },
      ],
      queue: { version: 0, pauseReason: null },
    }
    const events = agentThreadSnapshotToDesktop(snapshot).events ?? []
    const request = events
      .filter((event) => event.type === 'permission_request')
      .map((event) => event.metadata?.request)
      .find((request) => request?.requestId === 'approval-perm')

    expect(request).toMatchObject({
      requestKind: 'permission-grant',
      permissionGrant: {
        requestedScope: 'turn',
        allowedScopes: ['tool-call', 'turn'],
        requestedPermissions: {
          readPaths: ['C:\\docs'],
          writePaths: ['C:\\out'],
          networkDomains: [],
        },
      },
    })
  })

  test('maps latestTurnStatus and pendingPlanApproval from the list item, missing fields default to false', () => {
    const thread: ThreadListItem = {
      id: 'thread-plan',
      projectID: project.id,
      gitBranch: null,
      workspace: projectWorkspace,
      title: '计划待审批',
      preview: null,
      firstUserMessage: null,
      messageCount: 2,
      latestTurnStatus: 'completed',
      pendingPlanApproval: true,
      settings: {
        taskMode: 'plan',
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
      archivedAt: null,
      unreadAt: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_008_000,
    }
    const item = agentThreadListItemToDesktop(thread, project)
    expect(item.latestTurnStatus).toBe('completed')
    expect(item.pendingPlanApproval).toBe(true)

    const { pendingPlanApproval: _omitted, ...legacyThread } = thread
    const legacyItem = agentThreadListItemToDesktop(legacyThread as ThreadListItem, project)
    expect(legacyItem.latestTurnStatus).toBe('completed')
    expect(legacyItem.pendingPlanApproval).toBe(false)
  })

  test('keeps waiting-question, waiting-permission and waiting-subagents distinct on the desktop item', () => {
    for (const latestTurnStatus of [
      'waiting-question',
      'waiting-permission',
      'waiting-subagents',
    ] as const) {
      const thread: ThreadListItem = {
        id: `thread-${latestTurnStatus}`,
        projectID: project.id,
        gitBranch: null,
        workspace: projectWorkspace,
        title: '等待中',
        preview: null,
        firstUserMessage: null,
        messageCount: 0,
        latestTurnStatus,
        settings: {
          taskMode: 'chat',
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
          },
        },
        archivedAt: null,
        unreadAt: null,
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_008_000,
      }
      const item = agentThreadListItemToDesktop(thread, project)
      expect(item.status).toBe('waiting')
      expect(item.latestTurnStatus).toBe(latestTurnStatus)
    }
  })

  test('uses durable pendingPlanApproval instead of inferring approval from plan text', () => {
    const permissionConfig = {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    } as const
    const model = { providerID: 'openai', id: 'gpt-5' }
    const snapshot: ThreadSnapshot = {
      thread: {
        id: 'thread-plan-snapshot',
        title: '计划待审批',
        projectID: project.id,
        gitBranch: null,
        workspace: projectWorkspace,
        settings: { taskMode: 'plan', permissionConfig },
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_008_000,
      },
      turns: [
        {
          id: 'turn-plan',
          threadId: 'thread-plan-snapshot',
          sourceInputID: 'input-plan',
          status: 'completed',
          mode: 'plan',
          model,
          permissionConfig,
          rootAgentId: 'agent-plan',
          mergedInputIDs: [],
          startedAt: 1_700_000_001_000,
          finishedAt: 1_700_000_007_000,
          elapsedSeconds: 6,
          error: null,
        },
      ],
      agents: [],
      inputs: [],
      messages: [],
      items: [
        {
          id: 'plan-1',
          messageID: 'turn-plan',
          turnId: 'turn-plan',
          agentId: 'agent-plan',
          type: 'plan',
          title: '实施计划',
          markdown: '- 步骤',
          status: 'completed',
          createdAt: 1_700_000_005_000,
        },
      ],
      approvals: [],
    }

    const desktop = agentThreadSnapshotToDesktop(snapshot, project)
    expect(desktop.item.latestTurnStatus).toBe('completed')
    expect(desktop.item.pendingPlanApproval).toBe(false)
    const approval = {
      id: 'approval-plan',
      threadId: snapshot.thread.id,
      turnId: 'turn-plan',
      planItemId: 'plan-1',
      version: 1,
      status: 'pending' as const,
      title: '实施计划',
      markdown: '- 步骤',
      nextTurnId: null,
      createdAt: 1,
      resolvedAt: null,
    }
    expect(
      agentThreadSnapshotToDesktop({ ...snapshot, pendingPlanApproval: approval }, project).item
        .pendingPlanApproval,
    ).toBe(true)
    expect(
      agentThreadSnapshotToDesktop(
        { ...snapshot, pendingPlanApproval: { ...approval, status: 'closed' } },
        project,
      ).item.pendingPlanApproval,
    ).toBe(false)
  })

  test('does not mark pendingPlanApproval for streaming plan, newer running turn, or planless completed turn', () => {
    const permissionConfig = {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    } as const
    const model = { providerID: 'openai', id: 'gpt-5' }
    const thread = {
      id: 'thread-plan-negative',
      title: '无待审批',
      projectID: project.id,
      gitBranch: null,
      workspace: projectWorkspace,
      settings: { taskMode: 'plan', permissionConfig },
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_008_000,
    }
    const turn = (id: string, status: 'completed' | 'running') => ({
      id,
      threadId: thread.id,
      sourceInputID: `input-${id}`,
      status,
      mode: 'plan' as const,
      model,
      permissionConfig,
      rootAgentId: `agent-${id}`,
      mergedInputIDs: [],
      startedAt: 1_700_000_001_000,
      finishedAt: status === 'completed' ? 1_700_000_007_000 : null,
      elapsedSeconds: 6,
      error: null,
    })
    const planItem = {
      id: 'plan-neg',
      messageID: 'turn-plan-old',
      turnId: 'turn-plan-old',
      agentId: 'agent-plan-old',
      type: 'plan' as const,
      title: '计划',
      markdown: '- 步骤',
      status: 'completed' as const,
      createdAt: 1_700_000_005_000,
    }

    const streamingPlan: ThreadSnapshot = {
      thread,
      turns: [
        {
          ...turn('turn-stream', 'completed'),
          id: 'turn-stream',
          sourceInputID: 'input-turn-stream',
        },
      ],
      agents: [],
      inputs: [],
      messages: [],
      approvals: [],
      items: [{ ...planItem, turnId: 'turn-stream', status: 'streaming' }],
    }
    expect(agentThreadSnapshotToDesktop(streamingPlan, project).item.pendingPlanApproval).toBe(
      false,
    )

    const newerRunning: ThreadSnapshot = {
      thread,
      turns: [turn('turn-old', 'completed'), turn('turn-new', 'running')],
      agents: [],
      inputs: [],
      messages: [],
      approvals: [],
      items: [planItem],
    }
    expect(agentThreadSnapshotToDesktop(newerRunning, project).item.pendingPlanApproval).toBe(false)

    const planless: ThreadSnapshot = {
      thread,
      turns: [turn('turn-plain', 'completed')],
      agents: [],
      inputs: [],
      messages: [],
      items: [],
      approvals: [],
    }
    expect(agentThreadSnapshotToDesktop(planless, project).item.pendingPlanApproval).toBe(false)
  })

  test('list item and full snapshot expose the same durable priority state', () => {
    const permissionConfig = {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
    } as const
    const model = { providerID: 'openai', id: 'gpt-5' }
    const thread: ThreadListItem = {
      id: 'thread-consistent',
      projectID: project.id,
      gitBranch: null,
      workspace: projectWorkspace,
      title: '一致推导',
      preview: null,
      firstUserMessage: null,
      messageCount: 1,
      latestTurnStatus: 'completed',
      pendingPlanApproval: true,
      settings: { taskMode: 'plan', permissionConfig },
      archivedAt: null,
      unreadAt: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_008_000,
    }
    const snapshot: ThreadSnapshot = {
      thread: {
        id: thread.id,
        title: thread.title,
        projectID: project.id,
        gitBranch: null,
        workspace: projectWorkspace,
        settings: { taskMode: 'plan', permissionConfig },
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_008_000,
      },
      turns: [
        {
          id: 'turn-consistent',
          threadId: thread.id,
          sourceInputID: 'input-consistent',
          status: 'completed',
          mode: 'plan',
          model,
          permissionConfig,
          rootAgentId: 'agent-consistent',
          mergedInputIDs: [],
          startedAt: 1_700_000_001_000,
          finishedAt: 1_700_000_007_000,
          elapsedSeconds: 6,
          error: null,
        },
      ],
      agents: [],
      inputs: [],
      messages: [],
      items: [
        {
          id: 'plan-consistent',
          messageID: 'turn-consistent',
          turnId: 'turn-consistent',
          agentId: 'agent-consistent',
          type: 'plan',
          title: '计划',
          markdown: '- 步骤',
          status: 'completed',
          createdAt: 1_700_000_005_000,
        },
      ],
      approvals: [],
    }

    expect(agentThreadListItemToDesktop(thread, project).pendingPlanApproval).toBe(
      agentThreadSnapshotToDesktop(
        {
          ...snapshot,
          pendingPlanApproval: {
            id: 'approval-consistent',
            threadId: thread.id,
            turnId: 'turn-consistent',
            planItemId: 'plan-consistent',
            version: 1,
            status: 'pending',
            title: '计划',
            markdown: '- 步骤',
            nextTurnId: null,
            createdAt: 1,
            resolvedAt: null,
          },
        },
        project,
      ).item.pendingPlanApproval,
    )
    expect(agentThreadListItemToDesktop(thread, project).latestTurnStatus).toBe(
      agentThreadSnapshotToDesktop(snapshot, project).item.latestTurnStatus,
    )
  })

  test('maps cancelled turn status to a cancelled session instead of idle', () => {
    const thread: ThreadListItem = {
      id: 'thread-cancelled',
      projectID: project.id,
      gitBranch: null,
      workspace: projectWorkspace,
      title: '已取消会话',
      preview: null,
      firstUserMessage: null,
      messageCount: 1,
      latestTurnStatus: 'cancelled',
      settings: {
        taskMode: 'chat',
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
      },
      archivedAt: null,
      unreadAt: null,
      createdAt: 1_700_000_000_000,
      updatedAt: 1_700_000_001_000,
    }
    const item = agentThreadListItemToDesktop(thread, project)
    expect(item.status).toBe('cancelled')
    expect(item.latestTurnStatus).toBe('cancelled')

    const snapshot: ThreadSnapshot = {
      thread: {
        id: 'thread-cancelled-snap',
        title: '已取消快照',
        projectID: project.id,
        gitBranch: null,
        workspace: projectWorkspace,
        settings: {
          taskMode: 'chat',
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
          },
        },
        createdAt: 1_700_000_000_000,
        updatedAt: 1_700_000_001_000,
      },
      turns: [
        {
          id: 'turn-cancelled',
          threadId: 'thread-cancelled-snap',
          sourceInputID: 'input-cancelled',
          status: 'cancelled',
          mode: 'chat',
          model: { providerID: 'openai', id: 'gpt-5' },
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
          },
          rootAgentId: 'agent-cancelled',
          mergedInputIDs: [],
          startedAt: 1_700_000_000_000,
          finishedAt: 1_700_000_001_000,
          elapsedSeconds: 1,
          error: null,
        },
      ],
      agents: [],
      inputs: [],
      messages: [],
      items: [],
      approvals: [],
    }
    const desktop = agentThreadSnapshotToDesktop(snapshot, project)
    expect(desktop.item.status).toBe('cancelled')
    expect(desktop.item.latestTurnStatus).toBe('cancelled')
  })

  test('透传上下文来源拆解并聚合会话缓存命中率', () => {
    const usageItem = (
      id: string,
      createdAt: number,
      usage: Partial<NonNullable<TextItem['usage']>>,
    ): Item => ({
      id,
      messageID: 'turn-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'text',
      placement: 'result',
      text: '完成',
      status: 'completed',
      usage: {
        provider: 'openai',
        model: 'gpt-5.6',
        contextWindow: 200_000,
        input: 1_000,
        output: 300,
        cacheRead: 0,
        cacheWrite: 0,
        reasoning: 120,
        ...usage,
      },
      createdAt,
    })
    const withoutBreakdown = usageItem('text-1', 1_000, {})
    const withBreakdown = usageItem('text-2', 2_000, {
      cacheRead: 9_000,
      breakdown: [
        { source: 'messages', chars: 120 },
        { source: 'system_tools', chars: 30 },
      ],
    })

    expect(latestItemContextUsage([withoutBreakdown])?.breakdown).toBeUndefined()
    const usage = latestItemContextUsage([withoutBreakdown, withBreakdown])
    expect(usage?.breakdown).toEqual([
      { source: 'messages', chars: 120 },
      { source: 'system_tools', chars: 30 },
    ])
    // 累计 cacheRead 9000 / 累计 prompt 侧 11000，而不是只看最后一条。
    expect(usage?.averageCacheHitRate).toBeCloseTo(9_000 / 11_000, 6)
  })
})
