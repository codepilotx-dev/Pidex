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
  onSubmitEditedUserMessage: (input: DesktopUserMessageInput) => Promise<void>
  sessionStatus: DesktopSessionStatus
  workspacePath: string | null
}

export const ConversationItemContext = createContext<ConversationItemContextValue | null>(null)

export function useConversationItemContext(): ConversationItemContextValue {
  const context = useContext(ConversationItemContext)
  if (!context) {
    throw new Error(
      'useConversationItemContext must be used within ConversationItemContext.Provider',
    )
  }
  return context
}
