import React from 'react'
import { useParams } from 'react-router-dom'

import { ConversationPage } from './ConversationPage.js'

/**
 * `/pending/:submissionId` 只改变 Renderer 呈现的临时身份：
 * 会话查询、订阅和 RPC 仍由 `ConversationPage` 使用真实的空会话目标。
 */
export function PendingSubmissionPage(): React.ReactNode {
  const { submissionId } = useParams<{ submissionId: string }>()
  return <ConversationPage key={`pending:${submissionId ?? ''}`} />
}
