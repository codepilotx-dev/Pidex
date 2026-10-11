import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  createDefaultConversationUiState,
  loadConversationUiState,
  patchConversationUiState,
  saveConversationUiState,
  transferConversationUiStateForHandoff,
} from '../src/features/layout/tabs/ConversationUiState.js'
import { createSkillPreviewTab } from '../src/features/layout/dock/RightDockState.js'

const originalWindowDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'window')

afterEach(() => {
  if (originalWindowDescriptor) {
    Object.defineProperty(globalThis, 'window', originalWindowDescriptor)
  } else {
    Reflect.deleteProperty(globalThis, 'window')
  }
})

describe('Handoff UI transfer', () => {
  beforeEach(() => installStorage(new MemoryStorage()))

  test('copies logical terminal state without old workspace paths or history IDs', () => {
    const source = createDefaultConversationUiState()
    source.sideChatAttachments = [
      {
        id: 'attachment-1',
        name: 'old.txt',
        path: 'F:\\managed-worktree\\old.txt',
        mediaType: 'text/plain',
        sizeBytes: 3,
        kind: 'file',
        status: 'ready',
      },
    ]
    source.review.source = {
      kind: 'last-turn',
      threadId: 'source-thread',
      turnId: 'source-turn',
    }
    source.workbench.tabsById = {
      terminal: { id: 'terminal', kind: 'terminal' },
      'file:old.txt': {
        id: 'file:old.txt',
        kind: 'file-preview',
        workspacePath: 'F:\\managed-worktree',
        relativePath: 'old.txt',
        preview: false,
      },
      'plan:source-event': {
        id: 'plan:source-event',
        kind: 'plan',
        eventId: 'source-event',
        title: '旧计划',
      },
    }
    source.workbench.bottom = {
      open: true,
      activeTabId: 'terminal',
      tabIds: ['terminal', 'file:old.txt', 'plan:source-event'],
    }
    saveConversationUiState('source-thread', source)

    expect(
      transferConversationUiStateForHandoff({
        sourceThreadId: 'source-thread',
        targetThreadId: 'target-thread',
        sourceWorkspacePath: 'F:\\managed-worktree',
      }),
    ).toEqual({ transferred: true })

    const target = loadConversationUiState('target-thread')
    expect(target?.workbench.tabsById).toEqual({
      terminal: { id: 'terminal', kind: 'terminal' },
    })
    expect(target?.workbench.bottom.tabIds).toEqual(['terminal'])
    expect(target?.review.source).toEqual({ kind: 'unstaged' })
    expect(target?.sideChatAttachments).toEqual([])
  })

  test('field patches preserve the scroll position owned by ConversationPage', () => {
    const initial = createDefaultConversationUiState()
    initial.mainScrollTop = 428
    saveConversationUiState('thread-1', initial)

    patchConversationUiState('thread-1', {
      sideChatInput: 'shell-owned draft',
    })

    expect(loadConversationUiState('thread-1')).toMatchObject({
      mainScrollTop: 428,
      sideChatInput: '',
    })
  })

  test('never persists dynamic side-chat, attachment preview, Skill preview tabs or drafts', () => {
    const state = createDefaultConversationUiState()
    const tab = {
      id: 'side-chat:temporary-thread',
      kind: 'side-chat',
      threadId: 'temporary-thread',
      sourceThreadId: 'thread-1',
      inheritedThroughTurnId: 'turn-1',
      title: '侧边聊天',
    } as const
    state.sideChatInput = 'temporary draft'
    state.workbench.tabsById[tab.id] = tab
    state.workbench.tabsById['user-attachment-preview'] = {
      id: 'user-attachment-preview',
      kind: 'attachment-preview',
      attachment: {
        id: 'draft-attachment',
        kind: 'text',
        name: 'draft.txt',
        mediaType: 'text/plain',
        sizeBytes: 5,
      },
      source: { storage: 'draft', encoding: 'utf8', data: 'draft' },
    }
    const skillPreview = createSkillPreviewTab({
      name: 'release-check',
      path: 'F:\\private-workspace\\skills\\release-check\\SKILL.md',
      workspacePath: 'F:\\private-workspace',
    })
    state.workbench.tabsById[skillPreview.id] = skillPreview
    state.workbench.right = {
      open: true,
      activeTabId: tab.id,
      tabIds: [tab.id, 'user-attachment-preview', skillPreview.id],
    }

    saveConversationUiState('thread-1', state)

    expect(loadConversationUiState('thread-1')).toMatchObject({
      sideChatInput: '',
      sideChatAttachments: [],
      workbench: {
        tabsById: {},
        right: { activeTabId: null, tabIds: [] },
      },
    })
    expect(window.localStorage.getItem('conversation.ui-state.thread-1')).not.toContain(
      'private-workspace',
    )
    expect(window.localStorage.getItem('conversation.ui-state.thread-1')).not.toContain(
      'release-check',
    )
  })
})

class MemoryStorage implements Storage {
  readonly #values = new Map<string, string>()
  get length(): number {
    return this.#values.size
  }
  clear(): void {
    this.#values.clear()
  }
  getItem(key: string): string | null {
    return this.#values.get(key) ?? null
  }
  key(index: number): string | null {
    return [...this.#values.keys()][index] ?? null
  }
  removeItem(key: string): void {
    this.#values.delete(key)
  }
  setItem(key: string, value: string): void {
    this.#values.set(key, value)
  }
}

function installStorage(localStorage: Storage): void {
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { localStorage },
  })
}
