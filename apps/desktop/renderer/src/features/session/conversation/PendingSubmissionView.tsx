import React from 'react'

import type { Attachment } from '@pidex/shared/thread'
import type { DesktopComposerAttachment } from '../../../../shared/Types.js'
import { Spinner } from '../../../components/ui/Spinner.js'
import { CanonicalUserMessageContent } from '../timeline/CanonicalUserMessageContent.js'
import { useOptionalConversationItemContext } from '../timeline/ConversationItemContext.js'
import type { PendingSubmission } from '../state/PendingSubmissionStore.js'

const CONTENT_WIDTH_CLASS =
  'tw:w-[min(var(--page-content-max-width),var(--session-content-w))]'

const PENDING_CONTENT_CLASS =
  'pending-submission-content tw:mx-auto tw:flex tw:min-w-0 tw:flex-col tw:gap-2'

const PENDING_STATUS_CLASS =
  'pending-submission-status tw:flex tw:items-center tw:justify-center tw:gap-2 tw:py-3 tw:text-app-text-soft tw:type-body-sm'

/**
 * 提交快照里的附件在发送前已生成，附件行需要的消息级字段在 pending 阶段
 * 只用于展示元信息，因此补足展示所需的最小字段，不引入新的附件状态。
 */
export function pendingAttachmentDisplay(attachment: DesktopComposerAttachment): Attachment {
  return {
    id: attachment.id,
    kind: attachment.kind === 'image' ? 'image' : 'text',
    name: attachment.name,
    mediaType: attachment.mediaType,
    sizeBytes: attachment.sizeBytes,
    sha256: '',
    createdAt: 0,
  }
}

/**
 * 新建会话的首条消息：复用已落盘用户消息的正文、附件与 Skill 展示，
 * 不复制 canonical projection，也不显示尚未存在的发送时间与操作。
 */
export function PendingSubmissionMessages({
  onOpenAttachment,
  submission,
}: {
  onOpenAttachment?: (attachment: DesktopComposerAttachment) => void
  submission: PendingSubmission
}): React.ReactNode {
  const context = useOptionalConversationItemContext()
  return (
    <div className={CONTENT_WIDTH_CLASS}>
      <div className={PENDING_CONTENT_CLASS} data-pending-submission={submission.submissionId}>
        <article
          className="canonical-user-message"
          data-input-navigation-id={submission.submissionId}
        >
          <CanonicalUserMessageContent
            attachments={(submission.input.attachments ?? []).map(pendingAttachmentDisplay)}
            content={submission.input.text}
            contextReferences={[]}
            createdAt={submission.createdAt}
            onOpenAttachment={onOpenAttachment}
            onOpenLocalContext={context.onOpenLocalContext}
            skills={submission.input.skills}
            withActions={false}
          />
        </article>
        <p className={PENDING_STATUS_CLASS} role="status" aria-live="polite">
          <Spinner />
          <span>正在开启聊天…</span>
        </p>
      </div>
    </div>
  )
}
