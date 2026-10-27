import type { Dispatch, SetStateAction } from 'react'
import { useStore } from 'zustand/react'
import { createStore, type StoreApi } from 'zustand/vanilla'
import type {
  DesktopComposerAttachment,
  DesktopContextUsage,
  DesktopQueuePauseReason,
  DesktopQueuedFollowUp,
  DesktopSessionCatalogStatus,
  DesktopSessionEvent,
  DesktopSessionStatus,
  DesktopWorkflowEvent,
} from '../../../../shared/Types.js'
import type { Message, SessionListItem } from '../../../UiTypes.js'

/**
 * 会话展示状态：目录、当前选择、活动会话投影与队列视图。
 * 按工作台窗口实例创建（Side Chat / 辅助窗口互不共享“当前会话”），
 * 消费者按字段订阅；跨会话的视图缓存仍由 UseSessionState 的 refs 持有。
 */
export type SessionDisplayState = {
  sessionId: string | null
  sessionStatus: DesktopSessionStatus
  sessions: SessionListItem[]
  sessionsHydrated: boolean
  catalogStatus: DesktopSessionCatalogStatus
  sessionFallbackTitles: Record<string, string>
  pendingPermissionSessionIds: ReadonlySet<string>
  queuedFollowUps: DesktopQueuedFollowUp[]
  queuePauseReason: DesktopQueuePauseReason | null
  messages: Message[]
  events: DesktopSessionEvent[]
  workflowEvents: DesktopWorkflowEvent[]
  contextUsage: DesktopContextUsage | null
  input: string
  composerAttachments: DesktopComposerAttachment[]
}

export type SessionDisplayStore = StoreApi<SessionDisplayState> & {
  setSessionId: Dispatch<SetStateAction<string | null>>
  setSessionStatus: Dispatch<SetStateAction<DesktopSessionStatus>>
  setSessions: Dispatch<SetStateAction<SessionListItem[]>>
  setSessionsHydrated: Dispatch<SetStateAction<boolean>>
  setCatalogStatus: Dispatch<SetStateAction<DesktopSessionCatalogStatus>>
  setSessionFallbackTitles: Dispatch<SetStateAction<Record<string, string>>>
  setPendingPermissionSessionIds: Dispatch<SetStateAction<ReadonlySet<string>>>
  setQueuedFollowUps: Dispatch<SetStateAction<DesktopQueuedFollowUp[]>>
  setQueuePauseReason: Dispatch<SetStateAction<DesktopQueuePauseReason | null>>
  setMessages: Dispatch<SetStateAction<Message[]>>
  setEvents: Dispatch<SetStateAction<DesktopSessionEvent[]>>
  setWorkflowEvents: Dispatch<SetStateAction<DesktopWorkflowEvent[]>>
  setContextUsage: Dispatch<SetStateAction<DesktopContextUsage | null>>
  setInput: Dispatch<SetStateAction<string>>
  setComposerAttachments: Dispatch<SetStateAction<DesktopComposerAttachment[]>>
}

const EMPTY_MESSAGES: Message[] = []
const EMPTY_EVENTS: DesktopSessionEvent[] = []
const EMPTY_WORKFLOW_EVENTS: DesktopWorkflowEvent[] = []
const EMPTY_SESSIONS: SessionListItem[] = []
const EMPTY_TITLES: Record<string, string> = {}
const EMPTY_PERMISSION_IDS: ReadonlySet<string> = new Set()
const EMPTY_QUEUE: DesktopQueuedFollowUp[] = []
const EMPTY_ATTACHMENTS: DesktopComposerAttachment[] = []

// 空集合/空列表使用共享常量，保证初始快照与清空后的订阅引用稳定。

const FIELDS = [
  'sessionId',
  'sessionStatus',
  'sessions',
  'sessionsHydrated',
  'catalogStatus',
  'sessionFallbackTitles',
  'pendingPermissionSessionIds',
  'queuedFollowUps',
  'queuePauseReason',
  'messages',
  'events',
  'workflowEvents',
  'contextUsage',
  'input',
  'composerAttachments',
] as const satisfies readonly (keyof SessionDisplayState)[]

type Field = (typeof FIELDS)[number]

export function createSessionDisplayStore(): SessionDisplayStore {
  const store = createStore<SessionDisplayState>()(() => ({
    sessionId: null,
    sessionStatus: 'idle',
    sessions: EMPTY_SESSIONS,
    sessionsHydrated: false,
    catalogStatus: { state: 'loading' },
    sessionFallbackTitles: EMPTY_TITLES,
    pendingPermissionSessionIds: EMPTY_PERMISSION_IDS,
    queuedFollowUps: EMPTY_QUEUE,
    queuePauseReason: null,
    messages: EMPTY_MESSAGES,
    events: EMPTY_EVENTS,
    workflowEvents: EMPTY_WORKFLOW_EVENTS,
    contextUsage: null,
    input: '',
    composerAttachments: EMPTY_ATTACHMENTS,
  }))

  const actions: Partial<Record<`set${Capitalize<Field>}`, Dispatch<SetStateAction<never>>>> = {}
  for (const field of FIELDS) {
    const actionName = `set${field[0]!.toUpperCase()}${field.slice(1)}` as `set${Capitalize<Field>}`
    actions[actionName] = (value: SetStateAction<never>) => {
      store.setState((state) => ({
        [field]:
          typeof value === 'function'
            ? (value as (current: never) => never)(state[field] as never)
            : value,
      }))
    }
  }
  return Object.assign(store, actions) as SessionDisplayStore
}

export function useSessionDisplayField<T>(
  store: SessionDisplayStore,
  selector: (state: SessionDisplayState) => T,
): T {
  return useStore(store, selector)
}
