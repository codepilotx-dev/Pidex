import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { ForkOriginDivider } from '../src/features/session/timeline/ForkOriginDivider'
import { CanonicalTurnRow } from '../src/features/session/timeline/CanonicalThreadView'
import { createKeyedDisclosureStore } from '../src/components/ui/KeyedDisclosureStore'
import type { RenderTurnEntry } from '@pidex/session-view'

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

describe('ForkOriginDivider', () => {
  beforeEach(() => {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: {
        localStorage: {
          getItem: () => null,
          setItem: () => {},
          removeItem: () => {},
          clear: () => {},
          length: 0,
          key: () => null,
        },
        matchMedia: () => ({
          matches: false,
          addEventListener: () => {},
          removeEventListener: () => {},
        }),
      },
    })
  })

  afterEach(() => {
    if (originalWindowDescriptor) {
      Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
    } else {
      Reflect.deleteProperty(globalThis, 'window')
    }
  })
  test('渲染从聊天中继续链接及图标', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ForkOriginDivider sourceThreadId="thread-abc-123" />
      </MemoryRouter>,
    )
    expect(markup).toContain('canonical-fork-origin-divider')
    expect(markup).toContain('href="/threads/thread-abc-123"')
    expect(markup).toContain('从聊天中继续')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).not.toContain('role="separator"')
  })

  test('正确转义特殊字符的来源会话 ID', () => {
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <ForkOriginDivider sourceThreadId="parent/thread#special" />
      </MemoryRouter>,
    )
    expect(markup).toContain('href="/threads/parent%2Fthread%23special"')
  })

  test('CanonicalTurnRow 在 forkedFrom 匹配时渲染分割线，未提供时不渲染', () => {
    const makeEntry = (id: string): RenderTurnEntry => ({
      id,
      turn: {
        id,
        threadId: 'test-thread',
        status: 'completed',
        mode: 'chat',
        model: { providerID: 'openai', id: 'gpt-4o' },
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
        rootAgentId: 'agent-1',
        sourceInputID: `input-${id}`,
        mergedInputIDs: [],
        queuePosition: null,
        startedAt: 1,
        finishedAt: 2,
        elapsedSeconds: 1,
        error: null,
      },
      userItems: [],
      items: [],
      processItems: [],
      assistantResultItems: [],
      patchItems: [],
      postAssistantItems: [],
      planItem: null,
      executionPlanItems: [],
      blockers: [],
      contentBlocks: [],
      attachments: [],
      contextReferences: [],
    })

    const entry = makeEntry('turn-1')
    const disclosureStore = createKeyedDisclosureStore({})

    const markupWithFork = renderToStaticMarkup(
      <MemoryRouter>
        <CanonicalTurnRow
          threadId="test-thread"
          entry={entry}
          disclosureState={disclosureStore}
          diffMarkerStyle="color"
          dockedPlanItemId={null}
          onOpenPlanInRightDock={() => {}}
          onOpenSubagent={() => {}}
          forkedFrom={{
            threadId: 'source-thread-999',
            inheritedThroughTurnId: 'turn-1',
          }}
        />
      </MemoryRouter>,
    )

    // 分割线存在，且指向 source-thread-999
    expect(markupWithFork).toContain('canonical-fork-origin-divider')
    expect(markupWithFork).toContain('href="/threads/source-thread-999"')
    expect(markupWithFork).toContain('从聊天中继续')

    // 无 forkedFrom 时不渲染
    const markupWithoutFork = renderToStaticMarkup(
      <MemoryRouter>
        <CanonicalTurnRow
          threadId="test-thread"
          entry={entry}
          disclosureState={disclosureStore}
          diffMarkerStyle="color"
          dockedPlanItemId={null}
          onOpenPlanInRightDock={() => {}}
          onOpenSubagent={() => {}}
          forkedFrom={undefined}
        />
      </MemoryRouter>,
    )
    expect(markupWithoutFork).not.toContain('canonical-fork-origin-divider')
    expect(markupWithoutFork).not.toContain('从聊天中继续')
  })

  test('分页未加载边界或当前 Turn 与 inheritedThroughTurnId 不匹配时，不渲染分割线', () => {
    const makeEntry = (id: string): RenderTurnEntry => ({
      id,
      turn: {
        id,
        threadId: 'test-thread',
        status: 'completed',
        mode: 'chat',
        model: { providerID: 'openai', id: 'gpt-4o' },
        permissionConfig: {
          sandboxMode: 'workspace-write',
          approvalPolicy: 'on-request',
          approvalsReviewer: 'user',
        },
        rootAgentId: 'agent-1',
        sourceInputID: `input-${id}`,
        mergedInputIDs: [],
        queuePosition: null,
        startedAt: 1,
        finishedAt: 2,
        elapsedSeconds: 1,
        error: null,
      },
      userItems: [],
      items: [],
      processItems: [],
      assistantResultItems: [],
      patchItems: [],
      postAssistantItems: [],
      planItem: null,
      executionPlanItems: [],
      blockers: [],
      contentBlocks: [],
      attachments: [],
      contextReferences: [],
    })

    const entry2 = makeEntry('turn-2')
    const disclosureStore = createKeyedDisclosureStore({})

    // 边界是未加载的旧 turn-0（或当前是新追加的 turn-2）
    const markup = renderToStaticMarkup(
      <MemoryRouter>
        <CanonicalTurnRow
          threadId="test-thread"
          entry={entry2}
          disclosureState={disclosureStore}
          diffMarkerStyle="color"
          dockedPlanItemId={null}
          onOpenPlanInRightDock={() => {}}
          onOpenSubagent={() => {}}
          forkedFrom={{
            threadId: 'source-thread-999',
            inheritedThroughTurnId: 'turn-0-unloaded',
          }}
        />
      </MemoryRouter>,
    )
    expect(markup).not.toContain('canonical-fork-origin-divider')
    expect(markup).not.toContain('从聊天中继续')
  })
})
