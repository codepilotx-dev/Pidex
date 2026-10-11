import { afterAll, beforeAll, describe, expect, test } from 'bun:test'
import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type {
  ApprovalRequest,
  Item,
  SubagentRun,
  SubagentTask,
  ThreadSnapshot,
} from '@pidex/shared/thread'

import { SubagentThreadPanel } from '../src/features/session/subagents/SubagentThreadPanel.js'
import { QuickChatContext } from '../src/features/session/QuickChatContext.js'
import { ConversationItemContext } from '../src/features/session/timeline/ConversationItemContext.js'
import { TooltipProvider } from '../src/components/ui/Tooltip.js'

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

beforeAll(() => {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: memoryStorage(),
      sessionStorage: memoryStorage(),
    },
  })
})

afterAll(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

function TestProviders({ children }: { children: React.ReactNode }): React.ReactNode {
  return (
    <QuickChatContext.Provider value={{} as React.ContextType<typeof QuickChatContext>}>
      <ConversationItemContext.Provider
        value={{
          canCopyFileReferenceContents: () => false,
          onCopyFileReferenceContents: () => undefined,
          onOpenFileReference: () => undefined,
          onSubmitEditedUserMessage: async () => undefined,
          sessionStatus: 'idle',
          workspacePath: null,
        }}
      >
        <TooltipProvider>{children}</TooltipProvider>
      </ConversationItemContext.Provider>
    </QuickChatContext.Provider>
  )
}

const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const

const modelRef = { providerID: 'deepseek', id: 'deepseek-chat' } as const

const task: SubagentTask = {
  id: 'task:1',
  parentThreadId: 'thread:parent:1',
  parentTurnId: 'turn:parent:1',
  parentAgentId: 'agent:parent:1',
  childThreadId: 'thread:child:1',
  displayName: '代码检查助手',
  profile: 'explorer',
  task: '检查 fixture 目录中的改动。',
  permissionCeiling: permissionConfig,
  workspace: {
    mode: 'worktree',
    state: 'ready',
    rootPath: 'F:\\fixture-worktree',
    baselineRef: 'HEAD',
  },
  currentRun: null,
  createdAt: 1,
  updatedAt: 2,
}

function run(overrides: Partial<SubagentRun> = {}): SubagentRun {
  return {
    id: 'run:1',
    taskId: task.id,
    generation: 1,
    status: 'completed',
    queueReason: null,
    model: modelRef,
    permissionConfig,
    result: null,
    error: null,
    createdAt: 1,
    startedAt: 1,
    finishedAt: 2,
    updatedAt: 2,
    ...overrides,
  }
}

function snapshot({
  items = [],
  approvals = [],
}: {
  items?: Item[]
  approvals?: ApprovalRequest[]
} = {}): ThreadSnapshot {
  return {
    thread: {
      id: task.childThreadId,
      title: '代码检查助手',
      kind: 'subagent',
      parentThreadId: task.parentThreadId,
      taskMode: 'chat',
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'user',
      createdAt: 1,
      updatedAt: 2,
    },
    turns: [
      {
        id: 'turn:child:1',
        threadId: task.childThreadId,
        sourceInputID: 'input:child:1',
        status: 'completed',
        mode: 'chat',
        model: modelRef,
        permissionConfig,
        rootAgentId: 'agent:child:1',
        mergedInputIDs: [],
        startedAt: 1,
        finishedAt: 2,
        elapsedSeconds: 1,
        error: null,
      },
    ],
    agents: [
      {
        id: 'agent:child:1',
        threadId: task.childThreadId,
        turnId: 'turn:child:1',
        parentAgentId: null,
        profile: 'worker',
        task: '检查 fixture 目录中的改动。',
        model: modelRef,
        sessionId: `${task.childThreadId}:main`,
        depth: 1,
        status: 'completed',
        error: null,
        subagentRunId: 'run:1',
        runSequence: 1,
        createdAt: 1,
        updatedAt: 2,
      },
    ],
    subagents: [],
    inputs: [
      {
        id: 'input:child:1',
        threadId: task.childThreadId,
        turnId: 'turn:child:1',
        content: '检查 fixture 目录中的改动。',
        delivery: 'start',
        mode: 'chat',
        model: modelRef,
        permissionConfig,
        state: 'completed',
        createdAt: 1,
      },
    ],
    messages: [],
    items,
    approvals,
  }
}

function renderPanel({
  currentRun,
  snapshot: panelSnapshot,
  capabilities,
  onBackToParent,
}: {
  currentRun: SubagentRun
  snapshot: ThreadSnapshot
  capabilities: Parameters<typeof SubagentThreadPanel>[0]['capabilities']
  onBackToParent?: () => void
}): string {
  return renderToStaticMarkup(
    <TestProviders>
      <SubagentThreadPanel
        capabilities={capabilities}
        callbacks={{
          onApplyWorktree: () => undefined,
          onDiscardWorktree: () => undefined,
          onRestoreWorkspace: () => undefined,
          onStop: () => undefined,
          onRetry: () => undefined,
          onRequestRespond: async () => undefined,
          onInterrupt: async () => undefined,
        }}
        onBackToParent={onBackToParent}
        run={currentRun}
        snapshot={panelSnapshot}
        task={task}
      />
    </TestProviders>,
  )
}

const fullCapabilities = {
  canStop: true,
  canRetry: true,
  canRespondToApprovals: true,
  canRespondToQuestions: true,
  canApplyWorktree: true,
  canDiscardWorktree: true,
  canRestoreWorkspace: false,
} as const

describe('subagent thread panel', () => {
  test('renders a read-only workbench thread for a completed subagent', () => {
    const text: Item = {
      id: 'text:child:1',
      messageID: 'turn:child:1',
      turnId: 'turn:child:1',
      agentId: 'agent:child:1',
      type: 'text',
      placement: 'result',
      text: '检查完成，没有发现问题。',
      status: 'completed',
      createdAt: 2,
    }
    const markup = renderPanel({
      currentRun: run(),
      snapshot: snapshot({ items: [text] }),
      capabilities: fullCapabilities,
      onBackToParent: () => undefined,
    })

    // 返回箭头、状态与专用操作
    expect(markup).toContain('title="返回父对话"')
    expect(markup).toContain('已完成')
    expect(markup).toContain('title="重试"')
    expect(markup).toContain('aria-label="应用子智能体变更"')
    expect(markup).not.toContain('title="停止此子智能体及全部后代"')

    // 正文复用 canonical 渲染器
    expect(markup).toContain('检查完成，没有发现问题。')

    // 没有 composer、自由输入、附件、模型或权限入口
    expect(markup).not.toContain('subagent-thread-panel__composer-slot')
    expect(markup).not.toContain('placeholder=')
    expect(markup).not.toContain('<textarea')
    expect(markup).not.toContain('附件')
    expect(markup).not.toContain('权限模式')
    expect(markup).not.toContain('模型')
    // 不再固定显示 profile、模型与运行次数
    expect(markup).not.toContain('探索 · ')
    expect(markup).not.toContain('第 1 次运行')
  })

  test('renders a running subagent with stop instead of retry', () => {
    const markup = renderPanel({
      currentRun: run({ status: 'running', startedAt: 1, finishedAt: null }),
      snapshot: snapshot(),
      capabilities: fullCapabilities,
      onBackToParent: () => undefined,
    })

    expect(markup).toContain('运行中')
    expect(markup).toContain('title="停止此子智能体及全部后代"')
    expect(markup).not.toContain('title="重试"')
    expect(markup).not.toContain('subagent-thread-panel__composer-slot')
  })

  test('keeps structured checkpoint answers and approvals for pending interactions', () => {
    const question: Item = {
      id: 'question:child:1',
      messageID: 'turn:child:1',
      turnId: 'turn:child:1',
      agentId: 'agent:child:1',
      type: 'question',
      prompt: '是否继续检查其他目录？',
      choices: [
        { id: 'yes', label: '继续', description: '继续检查', recommended: true },
        { id: 'no', label: '停止', description: '停止检查', recommended: false },
      ],
      status: 'pending',
      answer: null,
      createdAt: 3,
    }
    const approval: ApprovalRequest = {
      id: 'approval:child:1',
      threadId: task.childThreadId,
      turnId: 'turn:child:1',
      agentId: 'agent:child:1',
      toolCallID: 'tool:child:1',
      tool: 'powershell.exec',
      command: 'bun test',
      cwd: null,
      paths: [],
      requestedPermissions: { readPaths: [], writePaths: [], networkDomains: [] },
      review: null,
      risk: 'medium',
      reason: '需要运行测试',
      status: 'pending',
      createdAt: 2,
    }
    const markup = renderPanel({
      currentRun: run({ status: 'waiting-question' }),
      snapshot: snapshot({ items: [question], approvals: [approval] }),
      capabilities: fullCapabilities,
      onBackToParent: () => undefined,
    })

    // 每次只展示最早请求；解决审批后再显示整组提问。
    expect(markup).not.toContain('aria-label="自定义回答"')
    expect(markup).toContain('data-variant="permission"')
    expect(markup).toContain('允许一次')
    expect(markup).toContain('拒绝')
    expect(markup).toContain('需要运行测试')

    const questionMarkup = renderPanel({
      currentRun: run({ status: 'waiting-question' }),
      snapshot: snapshot({ items: [question] }),
      capabilities: fullCapabilities,
    })
    expect(questionMarkup).toContain('data-variant="question"')
    expect(questionMarkup).toContain('是否继续检查其他目录？')
    expect(questionMarkup).toContain('aria-label="自定义回答"')
    expect(questionMarkup).toContain('role="radio"')
    expect(questionMarkup).toContain('跳过')
    expect(questionMarkup).toContain('跳过当前问题')
    expect(questionMarkup).toContain('提交')
    const disabledMarkup = renderPanel({
      currentRun: run({ status: 'waiting-question' }),
      snapshot: snapshot({ items: [question] }),
      capabilities: { ...fullCapabilities, canRespondToQuestions: false },
    })
    expect(disabledMarkup).toContain('此子智能体当前不可操作')
    expect(disabledMarkup).toContain('disabled=""')

    // 仍然没有自由聊天入口
    expect(markup).not.toContain('subagent-thread-panel__composer-slot')
    expect(markup).not.toContain('placeholder="随心输入"')
  })

  test('omits the back arrow when no parent navigation is available', () => {
    const markup = renderPanel({
      currentRun: run(),
      snapshot: snapshot(),
      capabilities: fullCapabilities,
      onBackToParent: undefined,
    })

    expect(markup).not.toContain('title="返回父对话"')
  })
})

function memoryStorage(): Storage {
  const entries = new Map<string, string>()
  return {
    get length() {
      return entries.size
    },
    clear: () => entries.clear(),
    getItem: (key) => entries.get(key) ?? null,
    key: (index) => [...entries.keys()][index] ?? null,
    removeItem: (key) => entries.delete(key),
    setItem: (key, value) => entries.set(key, value),
  }
}
