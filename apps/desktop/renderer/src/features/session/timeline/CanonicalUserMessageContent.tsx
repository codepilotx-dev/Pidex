import React from 'react'

import type { Attachment, LocalContextReference } from '@pidex/shared/thread'
import { desktopUserMessageInputToPreviewText } from '../../../../shared/DesktopUserMessage.js'
import { CollapsibleUserMarkdown } from '../conversation/CollapsibleUserMarkdown.js'
import { CopyButton } from './CopyButton.js'
import { MessageSentTime } from './MessageSentTime.js'
import { useConversationItemContext } from './ConversationItemContext.js'

const LazyThreadAttachmentRows = React.lazy(async () => {
  const module = await import('../attachments/AttachmentRows.js')
  return { default: module.ThreadAttachmentRows }
})

const LazyLocalContextRows = React.lazy(async () => {
  const module = await import('../attachments/LocalContextRows.js')
  return { default: module.LocalContextRows }
})

/**
 * 已落盘用户消息与 pending 首条消息共用的正文/附件投影。
 * `withActions=false` 时不展示落盘后才存在的发送时间与复制操作。
 */
export function CanonicalUserMessageContent({
  attachments,
  content,
  contextReferences,
  createdAt,
  onOpenAttachment,
  onOpenLocalContext,
  skills,
  withActions = true,
}: {
  attachments?: readonly Attachment[]
  content: string
  contextReferences: readonly LocalContextReference[]
  createdAt: number
  onOpenAttachment?: (attachment: { id: string }) => void
  onOpenLocalContext?: (reference: LocalContextReference) => void
  skills?: readonly { name: string; path: string }[]
  withActions?: boolean
}): React.ReactNode {
  const {
    canCopyFileReferenceContents,
    onCopyFileReferenceContents,
    onOpenFileReference,
    workspacePath,
  } = useConversationItemContext()
  const displayText = skills?.length
    ? desktopUserMessageInputToPreviewText({ text: content, skills })
    : content

  return (
    <>
      {attachments?.length ? (
        <React.Suspense fallback={null}>
          <LazyThreadAttachmentRows
            attachments={attachments}
            onOpen={
              onOpenAttachment as ((attachment: Attachment) => void) | undefined
            }
          />
        </React.Suspense>
      ) : null}
      {contextReferences.length > 0 ? (
        <React.Suspense fallback={null}>
          <LazyLocalContextRows references={contextReferences} onOpen={onOpenLocalContext} />
        </React.Suspense>
      ) : null}
      <div className="canonical-user-message__bubble" data-user-message-bubble>
        <CollapsibleUserMarkdown
          inlinePrefix={
            skills?.length ? (
              <>
                {skills.map((skill) => (
                  <React.Fragment key={skill.path}>
                    <span className="composer-inline-skill-token">
                      <span className="composer-inline-skill-token-label">${skill.name}</span>
                    </span>{' '}
                  </React.Fragment>
                ))}
              </>
            ) : undefined
          }
          canCopyFileReferenceContents={canCopyFileReferenceContents}
          cwd={workspacePath}
          onCopyFileReferenceContents={onCopyFileReferenceContents}
          onOpenFileReference={onOpenFileReference}
          text={content}
        />
      </div>
      {withActions ? (
        <div className="canonical-message-actions" aria-label="用户消息操作">
          <MessageSentTime sentAt={createdAt} />
          <CopyButton text={displayText} />
        </div>
      ) : null}
    </>
  )
}
