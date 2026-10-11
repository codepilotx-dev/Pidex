import React from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  CircleAlert,
  FileText,
  Globe2,
  Info,
  Link2,
  TriangleAlert,
  type LucideIcon,
} from 'lucide-react'
import type {
  ResultCard,
  ResultCardReference,
  ResultCardSection,
  ResultCardTone,
} from '@pidex/shared/thread-result-card'

import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { DisclosureContent } from '../../../components/ui/DisclosureContent.js'
import type { MarkdownFileOpenOptions, MarkdownFileReference } from '../../markdown/index.js'
import { ConversationItemContext } from './ConversationItemContext.js'
import { CopyButton } from './CopyButton.js'
import { safeCitationUrl } from './CitationUrl.js'

/** Items beyond this count stay behind the existing disclosure control. */
const VISIBLE_ITEM_LIMIT = 3

/**
 * Tone is never the only status cue: every tone carries a stable icon and a
 * visible text label next to the semantic color.
 */
const TONE_PRESENTATION: Record<ResultCardTone, { icon: LucideIcon; label: string }> = {
  neutral: { icon: Info, label: '信息' },
  success: { icon: Check, label: '成功' },
  warning: { icon: TriangleAlert, label: '需关注' },
  danger: { icon: CircleAlert, label: '风险' },
}

const REFERENCE_ICON: Record<ResultCardReference['kind'], LucideIcon> = {
  file: FileText,
  url: Globe2,
  thread: Link2,
  subagent: Bot,
}

/** Deterministic plain-text projection of a card, used by the copy action. */
export function resultCardPlainText(card: ResultCard): string {
  const lines = [card.title, card.summary]
  for (const section of card.sections) {
    lines.push('', section.title)
    for (const item of section.items) {
      lines.push(`- ${item.value ? `${item.label}：${item.value}` : item.label}`)
    }
  }
  if (card.references.length > 0) {
    lines.push('', '引用')
    for (const reference of card.references) {
      lines.push(
        `- ${reference.label ? `${reference.label}：${reference.value}` : reference.value}`,
      )
    }
  }
  return lines.join('\n')
}

/**
 * A reference may only open a file when the value is a workspace-relative path
 * and the client knows its workspace: absolute, drive-lettered or
 * parent-traversing values stay display-only.
 */
export function resultCardFilePath(
  value: string,
  workspacePath: string | null | undefined,
): string | null {
  if (!workspacePath) return null
  const normalized = value
    .trim()
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
  if (!normalized || /^(?:[a-z]:|\/)/i.test(normalized)) return null
  const parts = normalized.split('/').filter(Boolean)
  if (!parts.length || parts.includes('..')) return null
  return parts.join('/')
}

/**
 * Shared result card for a normalized Pidex envelope: main-agent and
 * subagent deliveries and opt-in tool results all render through this view.
 * Semantic `article` / `section` / `dl` / `ul` structure, no actions beyond
 * copying, safe external links and workspace-confirmed file previews.
 */
export function ResultCardView({ card }: { card: ResultCard }): React.ReactNode {
  const conversation = React.useContext(ConversationItemContext)
  const titleId = React.useId()
  const tone = TONE_PRESENTATION[card.tone]
  const ToneIcon = tone.icon
  return (
    <article aria-labelledby={titleId} className="canonical-result-card" data-tone={card.tone}>
      <header className="canonical-result-card__header">
        <ToneIcon
          aria-hidden="true"
          className="canonical-result-card__icon"
          size={APP_ICON_SIZES.lg}
        />
        <h3 className="canonical-result-card__title" id={titleId}>
          {card.title}
        </h3>
        <span className="canonical-result-card__tone">{tone.label}</span>
        <CopyButton ariaLabel="复制结构化结果" text={resultCardPlainText(card)} />
      </header>
      <p className="canonical-result-card__summary">{card.summary}</p>
      {card.sections.map((section, index) => (
        <ResultCardSectionView key={`${index}:${section.title}`} section={section} />
      ))}
      {card.references.length > 0 ? (
        <section aria-label="引用" className="canonical-result-card__section">
          <h4 className="canonical-result-card__section-title">引用</h4>
          <ul className="canonical-result-card__references">
            {card.references.map((reference, index) => (
              <ResultCardReferenceItem
                key={`${index}:${reference.kind}:${reference.value}`}
                onOpenFileReference={conversation?.onOpenFileReference}
                reference={reference}
                workspacePath={conversation?.workspacePath}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </article>
  )
}

function ResultCardSectionView({ section }: { section: ResultCardSection }): React.ReactNode {
  const [expanded, setExpanded] = React.useState(false)
  const contentId = React.useId()
  const titleId = React.useId()
  const hiddenItems = section.items.slice(VISIBLE_ITEM_LIMIT)
  const hiddenCount = hiddenItems.length
  return (
    <section aria-labelledby={titleId} className="canonical-result-card__section">
      <h4 className="canonical-result-card__section-title" id={titleId}>
        {section.title}
      </h4>
      <dl className="canonical-result-card__items">
        {section.items.slice(0, VISIBLE_ITEM_LIMIT).map((item, index) => (
          <ResultCardItemView item={item} key={`${index}:${item.label}`} />
        ))}
      </dl>
      {hiddenCount > 0 ? (
        <>
          <DisclosureContent expanded={expanded} id={contentId} mountPolicy="until-exit">
            <dl className="canonical-result-card__items canonical-result-card__items--hidden">
              {hiddenItems.map((item, index) => (
                <ResultCardItemView
                  item={item}
                  key={`${index + VISIBLE_ITEM_LIMIT}:${item.label}`}
                />
              ))}
            </dl>
          </DisclosureContent>
          <button
            aria-controls={contentId}
            aria-expanded={expanded}
            className="canonical-result-card__disclosure"
            onClick={() => setExpanded((current) => !current)}
            type="button"
          >
            {expanded ? '收起' : `再显示 ${hiddenCount} 项`}
            <ChevronDown
              aria-hidden="true"
              className={expanded ? 'is-expanded' : undefined}
              size={APP_ICON_SIZES.sm}
            />
          </button>
        </>
      ) : null}
    </section>
  )
}

function ResultCardItemView({
  item,
}: {
  item: ResultCardSection['items'][number]
}): React.ReactNode {
  return (
    <div className="canonical-result-card__item" data-tone={item.tone ?? 'neutral'}>
      <dt>{item.label}</dt>
      {item.value ? <dd>{item.value}</dd> : null}
    </div>
  )
}

function ResultCardReferenceItem({
  onOpenFileReference,
  reference,
  workspacePath,
}: {
  onOpenFileReference?: (reference: MarkdownFileReference, options: MarkdownFileOpenOptions) => void
  reference: ResultCardReference
  workspacePath?: string | null
}): React.ReactNode {
  const Icon = REFERENCE_ICON[reference.kind]
  const text = reference.label ?? reference.value
  if (reference.kind === 'url') {
    const url = safeCitationUrl(reference.value)
    return (
      <li className="canonical-result-card__reference">
        <Icon aria-hidden="true" size={APP_ICON_SIZES.sm} />
        {url ? (
          <a href={url} rel="noopener noreferrer" target="_blank" title={reference.value}>
            {text}
          </a>
        ) : (
          <span title={reference.value}>{text}</span>
        )}
      </li>
    )
  }
  if (reference.kind === 'file') {
    const path = resultCardFilePath(reference.value, workspacePath)
    if (path && onOpenFileReference) {
      return (
        <li className="canonical-result-card__reference">
          <Icon aria-hidden="true" size={APP_ICON_SIZES.sm} />
          <button
            aria-label={`打开文件 ${text}`}
            className="canonical-result-card__file-link"
            onClick={() => onOpenFileReference({ path }, { preview: true })}
            title={reference.value}
            type="button"
          >
            {text}
          </button>
        </li>
      )
    }
    return (
      <li className="canonical-result-card__reference">
        <Icon aria-hidden="true" size={APP_ICON_SIZES.sm} />
        <span title={reference.value}>{text}</span>
      </li>
    )
  }
  return (
    <li className="canonical-result-card__reference">
      <Icon aria-hidden="true" size={APP_ICON_SIZES.sm} />
      <span title={reference.value}>{text}</span>
    </li>
  )
}
