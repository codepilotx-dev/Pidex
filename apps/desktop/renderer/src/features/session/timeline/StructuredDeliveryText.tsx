import React from 'react'
import { decodeSubagentResult, type Item, type SubagentResult } from '@pidex/shared/thread'
import {
  decodeResultCardEnvelope,
  type ResultCard,
  type ResultCardReference,
} from '@pidex/shared/thread-result-card'
import { MarkdownMessage } from '../../markdown/index.js'
import { ConversationMarkdownErrorBoundary } from '../conversation/ConversationTurnErrorBoundary.js'
import { ConversationItemContext } from './ConversationItemContext.js'
import { CopyButton } from './CopyButton.js'
import { resultCardFilePath } from './ResultCardView.js'
import { safeCitationUrl } from './CitationUrl.js'

const validationLabel = { passed: '通过', failed: '失败', skipped: '跳过' }
const outcomeLabel = { succeeded: '已完成', partial: '部分完成', blocked: '受阻' }
const toneLabel = { neutral: '', success: '通过', warning: '需关注', danger: '风险' }

function mirroredDeliveryText(card: ResultCard): string | null {
  const outcome = (
    { success: 'succeeded', warning: 'partial', danger: 'blocked', neutral: null } as const
  )[card.tone]
  if (!outcome) return null
  const lines = [
    `已提交结构化结果（outcome: ${outcome} · ${outcomeLabel[outcome]}）`,
    `摘要：${card.summary}`,
  ]
  const validation = card.sections.find((section) => section.title === '验证')
  if (validation?.items.length) {
    lines.push(
      '验证：',
      ...validation.items.map(
        (item) =>
          `- ${item.label}（${item.tone === 'success' ? '通过' : item.tone === 'danger' ? '失败' : '跳过'}）`,
      ),
    )
  }
  const risks = card.sections.find((section) => section.title === '风险与未决事项')
  if (risks?.items.length) lines.push('风险：', ...risks.items.map((item) => `- ${item.label}`))
  return lines.join('\n')
}

function referenceMarkdown(reference: ResultCardReference, workspacePath?: string | null): string {
  const target =
    reference.kind === 'url'
      ? safeCitationUrl(reference.value)
      : reference.kind === 'file'
        ? resultCardFilePath(reference.value, workspacePath)
        : null
  const label = (reference.label ?? reference.value).replace(/([\\\[\]])/gu, '\\$1')
  return target
    ? `- [${label}](<${target.replace(/>/gu, '%3E')}>)${reference.label ? `：${reference.value}` : ''}`
    : `- ${reference.label ? `${reference.label}：` : ''}${reference.value}`
}

export function subagentResultMarkdown(
  result: SubagentResult,
  workspacePath?: string | null,
): string {
  const lines = [`${outcomeLabel[result.outcome]}\n\n${result.summary}`]
  const sections = [
    [
      '关键结论',
      result.findings.map(
        (item) =>
          `- ${item.title}${item.severity === 'info' ? '' : item.severity === 'warning' ? '（需关注）' : '（错误）'}：${item.detail}`,
      ),
    ],
    ['改动文件', result.changedFiles.map((item) => `- ${item.path}：${item.summary}`)],
    [
      '验证',
      result.validation.map(
        (item) =>
          `- ${item.command}（${validationLabel[item.status]}）${item.output ? `：${item.output}` : ''}`,
      ),
    ],
    ['风险与未决事项', result.risks.map((risk) => `- ${risk}`)],
    ['引用', result.references.map((reference) => referenceMarkdown(reference, workspacePath))],
  ] as const
  for (const [title, items] of sections) {
    if (items.length) lines.push(`### ${title}\n\n${items.join('\n')}`)
  }
  return lines.join('\n\n')
}

export function historicalDeliveryText(
  item: Extract<Item, { type: 'tool' }>,
  workspacePath?: string | null,
): string | null {
  if (item.tool.split(/[./]/u).at(-1) !== 'finalize_result' || item.state !== 'completed')
    return null
  const mirroredTexts = new Set(
    (item.resultBlocks ?? []).flatMap((block) => {
      const envelope = block.type === 'json' ? decodeResultCardEnvelope(block.value) : null
      return envelope ? [mirroredDeliveryText(envelope.card)] : []
    }),
  )
  const lines: string[] = []
  for (const block of item.resultBlocks ?? []) {
    if (block.type === 'text') {
      // 仅省略与信封完全一致的文本镜像，截短信封之外的原始内容仍保留。
      if (mirroredTexts.has(block.text)) continue
      if (block.text.trim()) lines.push(block.text)
      continue
    }
    if (block.type === 'citation') {
      lines.push(
        referenceMarkdown({ kind: 'url', value: block.url, label: block.title }, workspacePath),
      )
      continue
    }
    if (block.type !== 'json') {
      lines.push(`\`\`\`json\n${JSON.stringify(block, null, 2)}\n\`\`\``)
      continue
    }
    const envelope = decodeResultCardEnvelope(block.value)
    if (envelope) {
      const card = envelope.card
      lines.push(`${card.title}\n\n${card.summary}`)
      for (const section of card.sections) {
        const items = section.items.map((item) => {
          const status =
            section.title === '验证' && item.tone === 'danger'
              ? '失败'
              : toneLabel[item.tone ?? 'neutral']
          return `- ${item.label}${status ? `（${status}）` : ''}${item.value ? `：${item.value}` : ''}`
        })
        lines.push(`### ${section.title}\n\n${items.join('\n')}`)
      }
      if (envelope.card.references.length) {
        lines.push(
          `### 引用\n\n${envelope.card.references.map((reference) => referenceMarkdown(reference, workspacePath)).join('\n')}`,
        )
      }
    } else {
      try {
        lines.push(subagentResultMarkdown(decodeSubagentResult(block.value), workspacePath))
      } catch {
        lines.push(`\`\`\`json\n${JSON.stringify(block.value, null, 2)}\n\`\`\``)
      }
    }
  }
  return lines.length ? lines.join('\n\n') : item.output?.trim() || null
}

export function StructuredDeliveryText({ text }: { text: string }): React.ReactNode {
  const context = React.useContext(ConversationItemContext)
  return (
    <article className="canonical-text-item canonical-text-item--result tw:min-w-0 tw:w-full tw:bg-transparent tw:text-app-text tw:shadow-none tw:type-reading">
      <ConversationMarkdownErrorBoundary contentKey={text}>
        <MarkdownMessage
          presentation="conversation"
          cwd={context?.workspacePath}
          canCopyFileReferenceContents={context?.canCopyFileReferenceContents}
          onCopyFileReferenceContents={context?.onCopyFileReferenceContents}
          onOpenFileReference={context?.onOpenFileReference}
          text={text}
        />
      </ConversationMarkdownErrorBoundary>
      <div className="canonical-message-actions canonical-message-actions--assistant">
        <CopyButton text={text} />
      </div>
    </article>
  )
}
