import { createContext, useContext } from 'react'

import type { DesktopSessionStatus, DesktopUserMessageInput } from '../../../../shared/Types.js'
import type { Attachment, LocalContextReference } from '@pidex/shared/thread'
import type { MarkdownFileOpenOptions, MarkdownFileReference } from '../../markdown/index.js'

export type ConversationItemContextValue = {
  modelProviderNames?: Readonly<Record<string, string>>
  canCopyFileReferenceContents: (reference: MarkdownFileReference) => boolean
  onCopyFileReferenceContents: (reference: MarkdownFileReference) => void | Promise<void>
  onOpenFileReference: (reference: MarkdownFileReference, options: MarkdownFileOpenOptions) => void
  onOpenAttachment?: (attachment: Attachment) => void
  onOpenLocalContext?: (reference: LocalContextReference) => void
  onForkFromMessage?: (request: { itemId: string; turnId: string }) => void
  onSubmitEditedUserMessage: (
    input: DesktopUserMessageInput,
    target: { turnId: string; inputId: string; operationId: string },
  ) => Promise<void>
  canEditUserMessage?: boolean
  editableInputId?: string | null
  sessionStatus: DesktopSessionStatus
  workspacePath: string | null
}

export const ConversationItemContext = createContext<ConversationItemContextValue | null>(null)

/**
 * 读取当前线程的工作区根目录；仅用于展示增强，缺少 Provider 时返回 null 而不是抛错。
 */
export function useWorkspacePath(): string | null {
  return useContext(ConversationItemContext)?.workspacePath ?? null
}

export function useConversationItemContext(): ConversationItemContextValue {
  const context = useContext(ConversationItemContext)
  if (!context) {
    throw new Error(
      'useConversationItemContext must be used within ConversationItemContext.Provider',
    )
  }
  return context
}

/**
 * 可复用的消息展示只依赖可选上下文：pending 首条消息等尚未进入 canonical
 * 投影的呈现可以在没有完整回调的环境里退化展示，而不是抛出错误。
 */
export const OPTIONAL_CONVERSATION_ITEM_CONTEXT: ConversationItemContextValue = {
  canCopyFileReferenceContents: () => false,
  onCopyFileReferenceContents: () => undefined,
  onOpenFileReference: () => undefined,
  onSubmitEditedUserMessage: async () => undefined,
  sessionStatus: 'idle',
  workspacePath: null,
}

export function useOptionalConversationItemContext(): ConversationItemContextValue {
  return useContext(ConversationItemContext) ?? OPTIONAL_CONVERSATION_ITEM_CONTEXT
}
