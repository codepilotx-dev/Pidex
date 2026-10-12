import { describe, expect, test } from 'bun:test'
import type React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Item } from '@pidex/shared/thread'

import { TooltipProvider } from '../src/components/ui/Tooltip.js'
import { CanonicalItemRenderer } from '../src/features/session/timeline/CanonicalItemRenderer.js'
import { ConversationItemContext } from '../src/features/session/timeline/ConversationItemContext.js'
import { createEnvironmentDomainClient } from '../src/services/desktop-client/EnvironmentDomainClient.js'
import {
  abandonConversationFork,
  continueConversationForkWithoutSetup,
  retryConversationForkSetup,
  runConversationFork,
  type ConversationForkOperation,
} from '../src/features/session/workflow/fork/ConversationForkController.js'
import type { ConversationForkClient } from '../src/features/session/workflow/fork/ForkClient.js'
import { WORKTREE_SETUP_VARIABLES } from '../src/features/settings/local-environment/LocalEnvironmentSettings.js'

describe('conversation fork', () => {
  test('renders the fork action immediately after copy for a completed result', () => {
    const markup = renderItem(completedResult())

    expect(markup).toContain('aria-label="复制"')
    expect(markup).toContain('aria-label="在新聊天中继续"')
    expect(markup.indexOf('aria-label="复制"')).toBeLessThan(
      markup.indexOf('aria-label="在新聊天中继续"'),
    )
    expect(markup).toContain('lucide-split')
  })

  test('does not expose the fork action for streaming or process text', () => {
    expect(renderItem({ ...completedResult(), status: 'streaming' })).not.toContain(
      '在新聊天中继续',
    )
    expect(renderItem({ ...completedResult(), placement: 'process' })).not.toContain(
      '在新聊天中继续',
    )
  })

  test('keeps copy but hides fork for an interrupted result', () => {
    const markup = renderItem({ ...completedResult(), status: 'interrupted' })

    expect(markup).toContain('aria-label="复制"')
    expect(markup).not.toContain('在新聊天中继续')
  })

  test('uses only negotiated capabilities to determine fork support', async () => {
    const clientWithCapability = environmentClientWithCapabilities(['thread.fork.v1'])
    const clientWithoutCapability = environmentClientWithCapabilities(['rpc.typed.v1'])
    const clientWithFailedInitialization = createEnvironmentDomainClient({
      call: async () => {
        throw new Error('unexpected RPC call')
      },
      ensureInitialized: async () => {
        throw new Error('initialization failed')
      },
    } as unknown as Parameters<typeof createEnvironmentDomainClient>[0])

    expect(await clientWithCapability.supportsThreadFork()).toBe(true)
    expect(await clientWithoutCapability.supportsThreadFork()).toBe(false)
    expect(await clientWithFailedInitialization.supportsThreadFork()).toBe(false)
  })

  test('starts with the selected turn boundary and streams bounded setup output', async () => {
    const calls: Array<{ method: string; value: unknown }> = []
    const progress: string[] = []
    const running = operation({ status: 'running', step: 'setup', revision: 1 })
    const completed = operation({
      status: 'completed',
      step: 'complete',
      revision: 2,
      targetThreadId: 'thread-target',
    })
    const client = {
      startThreadFork: async (value: unknown) => {
        calls.push({ method: 'start', value })
        return { operation: running }
      },
      threadForkStatus: async (...value: unknown[]) => {
        calls.push({ method: 'status', value })
        return {
          operation: completed,
          changed: true,
          output: { cursor: 5, data: 'setup ok', truncated: false, complete: true },
        }
      },
    } as unknown as ConversationForkClient

    const result = await runConversationFork({
      client,
      point: {
        sourceThreadId: 'thread-source',
        lastTurnId: 'turn-selected',
        sourceItemId: 'item-selected',
      },
      destination: { kind: 'new-worktree' },
      onProgress: (next) => progress.push(next.output),
    })

    expect(result.kind).toBe('completed')
    expect(calls[0]).toMatchObject({
      method: 'start',
      value: {
        sourceThreadId: 'thread-source',
        lastTurnId: 'turn-selected',
        sourceItemId: 'item-selected',
        destination: { kind: 'new-worktree' },
      },
    })
    expect(progress).toEqual(['', 'setup ok'])
  })

  test('restores setup output and replaces stale data after a truncated cursor', async () => {
    const progress: string[] = []
    const running = operation({ status: 'running', step: 'setup', revision: 1 })
    const awaiting = operation({
      status: 'awaiting-setup-decision',
      step: 'setup',
      revision: 3,
    })
    let statusRead = 0
    const client = {
      startThreadFork: async () => ({ operation: running }),
      threadForkStatus: async () => {
        statusRead += 1
        if (statusRead === 1) {
          return {
            operation: operation({ status: 'running', step: 'setup', revision: 2 }),
            changed: true,
            output: { cursor: 9, data: 'stale output', truncated: false, complete: false },
          }
        }
        return {
          operation: awaiting,
          changed: true,
          output: { cursor: 20, data: 'current tail', truncated: true, complete: true },
        }
      },
    } as unknown as ConversationForkClient

    const result = await runConversationFork({
      client,
      point: {
        sourceThreadId: 'thread-source',
        lastTurnId: 'turn-selected',
        sourceItemId: 'item-selected',
      },
      destination: { kind: 'new-worktree' },
      onProgress: (next) => progress.push(next.output),
    })

    expect(result.kind).toBe('awaiting-setup-decision')
    expect(statusRead).toBe(2)
    expect(progress).toEqual(['', 'stale output', 'current tail'])
  })

  test('documents only the two safe worktree setup variable names', () => {
    expect(WORKTREE_SETUP_VARIABLES).toEqual([
      {
        name: 'PIDEX_SOURCE_TREE_PATH',
        description: '源任务的权威工作区路径',
      },
      {
        name: 'PIDEX_WORKTREE_PATH',
        description: '新托管工作树的路径',
      },
    ])
  })

  test('uses the current revision for all setup failure decisions', async () => {
    const calls: Array<[string, string, number]> = []
    const awaiting = operation({
      status: 'awaiting-setup-decision',
      step: 'setup',
      revision: 7,
    })
    const completed = operation({
      status: 'completed',
      step: 'complete',
      revision: 8,
      targetThreadId: 'thread-target',
    })
    const abandoned = operation({
      status: 'abandoned',
      step: 'complete',
      revision: 8,
    })
    let current = awaiting
    const client = {
      retryThreadForkSetup: async (operationId: string, revision: number) => {
        calls.push(['retry', operationId, revision])
        current = awaiting
        return { operation: awaiting }
      },
      continueThreadForkWithoutSetup: async (operationId: string, revision: number) => {
        calls.push(['continue', operationId, revision])
        current = completed
        return { operation: completed }
      },
      abandonThreadFork: async (operationId: string, revision: number) => {
        calls.push(['abandon', operationId, revision])
        current = abandoned
        return { operation: abandoned }
      },
      threadForkStatus: async () => ({
        operation: current,
        changed: false,
        output: { cursor: 0, data: '', truncated: false, complete: true },
      }),
    } as unknown as ConversationForkClient

    expect((await retryConversationForkSetup(client, awaiting)).kind).toBe(
      'awaiting-setup-decision',
    )
    expect((await continueConversationForkWithoutSetup(client, awaiting)).kind).toBe('completed')
    expect((await abandonConversationFork(client, awaiting)).kind).toBe('abandoned')
    expect(calls).toEqual([
      ['retry', 'operation-1', 7],
      ['continue', 'operation-1', 7],
      ['abandon', 'operation-1', 7],
    ])
  })
})

function renderItem(item: Extract<Item, { type: 'text' }>): string {
  return renderToStaticMarkup(
    <ConversationItemContext.Provider
      value={{
        canCopyFileReferenceContents: () => false,
        onCopyFileReferenceContents: () => undefined,
        onForkFromMessage: () => undefined,
        onOpenFileReference: () => undefined,
        onSubmitEditedUserMessage: async () => undefined,
        sessionStatus: 'idle',
        workspacePath: null,
      }}
    >
      <TooltipProvider>
        <CanonicalItemRenderer
          item={item}
          onOpenPlanInRightDock={() => undefined}
          onOpenSubagent={() => undefined}
          dockedPlanItemId={null}
          showAssistantActions
        />
      </TooltipProvider>
    </ConversationItemContext.Provider>,
  )
}

function completedResult(): Extract<Item, { type: 'text' }> {
  return {
    id: 'item-result',
    messageID: 'message-result',
    turnId: 'turn-result',
    agentId: 'agent-main',
    type: 'text',
    placement: 'result',
    text: '完成。',
    status: 'completed',
    createdAt: 1,
  }
}

function operation(overrides: Partial<ConversationForkOperation>): ConversationForkOperation {
  return {
    operationId: 'operation-1',
    sourceThreadId: 'thread-source',
    sourceTurnId: 'turn-selected',
    sourceItemId: 'item-selected',
    targetThreadId: null,
    targetWorktreeId: null,
    destinationKind: 'new-worktree',
    snapshotMode: 'working-tree',
    status: 'running',
    step: 'preflight',
    revision: 0,
    errorCode: null,
    warnings: [],
    createdAt: 1,
    updatedAt: 1,
    completedAt: null,
    ...overrides,
  }
}

function environmentClientWithCapabilities(capabilities: string[]) {
  return createEnvironmentDomainClient({
    call: async () => {
      throw new Error('unexpected RPC call')
    },
    ensureInitialized: async () => ({ capabilities }),
  } as unknown as Parameters<typeof createEnvironmentDomainClient>[0])
}
