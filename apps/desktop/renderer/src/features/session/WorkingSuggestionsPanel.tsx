import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import type React from 'react'
import { ArrowLeft, FilePlus2, LayoutTemplate, ListChecks, RefreshCw, Search } from 'lucide-react'
import type { WorkingSuggestionState } from './WorkingSuggestions.js'
import {
  SUGGESTION_HEADING_ACTION_CLASS,
  SUGGESTION_HEADING_CLASS,
  SUGGESTION_HEADING_TITLE_CLASS,
  SUGGESTION_ROW_CLASS,
} from './NewSessionSuggestionPanel.js'
import {
  findWorkingSuggestionCategory,
  WORKING_SUGGESTION_CATEGORIES,
  type WorkingSuggestionCategory,
  type WorkingSuggestionCategoryId,
  type WorkingContextualSuggestion,
  type WorkingSuggestionTask,
} from './WorkingSuggestions.js'

const CATEGORY_ICONS: Record<
  WorkingSuggestionCategoryId,
  React.ComponentType<{
    'aria-hidden'?: boolean
    className?: string
    size?: number
  }>
> = {
  create: FilePlus2,
  research: Search,
  automate: RefreshCw,
}

type WorkingSuggestionsPanelProps = {
  state: WorkingSuggestionState
  suggestions: readonly WorkingContextualSuggestion[]
  onSelectSuggestion: (suggestion: WorkingContextualSuggestion) => void
  onShowTemplates: () => void
  onShowSuggestions: () => void
  onSelectCategory: (category: WorkingSuggestionCategory) => void
  onSelectTask: (category: WorkingSuggestionCategory, task: WorkingSuggestionTask) => void
  onBack: (category: WorkingSuggestionCategory) => void
}

/**
 * Working 首屏的无卡片纵向建议列表：上下文建议可进入模板分类，再下钻到具体任务。
 * 复用 NewSessionSuggestions 的行与标题基础样式（hover、focus、动效、reduced-motion），
 * 但不用卡片网格与 .is-follow-up 面板背景，仅保留 Working 差异覆盖。
 */
export function WorkingSuggestionsPanel({
  state,
  suggestions,
  onSelectSuggestion,
  onShowTemplates,
  onShowSuggestions,
  onSelectCategory,
  onSelectTask,
  onBack,
}: WorkingSuggestionsPanelProps): React.ReactNode {
  if (state.kind === 'hidden') return null

  if (state.kind === 'root') {
    return (
      <section
        aria-label="工作建议"
        className="working-suggestions tw:max-w-full"
        style={{ width: 'var(--quick-chat-surface-width)' }}
      >
        <div className="working-suggestion-list tw:grid tw:gap-0.5">
          {suggestions.slice(0, 3).map((suggestion, index) => (
            <button
              key={suggestion.id}
              className={`${SUGGESTION_ROW_CLASS} working-suggestion-row`}
              style={
                {
                  '--new-session-suggestion-index': index,
                  minHeight: 44,
                } as React.CSSProperties
              }
              type="button"
              onClick={() => onSelectSuggestion(suggestion)}
            >
              <ListChecks
                aria-hidden
                className="tw:shrink-0 tw:text-app-text-soft"
                size="var(--inline-icon-size, 1em)"
              />
              <span>{suggestion.label}</span>
            </button>
          ))}
          <button
            className={`${SUGGESTION_ROW_CLASS} working-suggestion-row tw:text-app-text-soft`}
            style={
              {
                '--new-session-suggestion-index': 3,
                minHeight: 44,
              } as React.CSSProperties
            }
            type="button"
            onClick={onShowTemplates}
          >
            <LayoutTemplate aria-hidden className="tw:shrink-0" size="var(--inline-icon-size, 1em)" />
            <span>查看工作模板</span>
          </button>
        </div>
      </section>
    )
  }

  if (state.kind === 'templates') {
    return (
      <section
        aria-label="工作模板"
        className="working-suggestions tw:max-w-full"
        style={{ width: 'var(--quick-chat-surface-width)' }}
      >
        <div className="working-suggestion-list tw:grid tw:gap-0.5">
          <div className={`${SUGGESTION_HEADING_CLASS} working-suggestion-list-heading`}>
            <span className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-2 tw:text-app-text-soft">
              <LayoutTemplate aria-hidden size="var(--inline-icon-size, 1em)" />
              工作模板
            </span>
            <button
              type="button"
              className={SUGGESTION_HEADING_ACTION_CLASS}
              onClick={onShowSuggestions}
            >
              <ArrowLeft aria-hidden size="var(--inline-icon-size, 1em)" />
              返回建议
            </button>
          </div>
          {WORKING_SUGGESTION_CATEGORIES.map((category, index) => {
            const Icon = CATEGORY_ICONS[category.id]
            return (
              <button
                key={category.id}
                className={`${SUGGESTION_ROW_CLASS} working-suggestion-row`}
                style={
                  {
                    '--new-session-suggestion-index': index,
                    minHeight: 44,
                  } as React.CSSProperties
                }
                type="button"
                onClick={() => onSelectCategory(category)}
              >
                <Icon
                  aria-hidden
                  className="tw:shrink-0 tw:text-app-text-soft"
                  size={APP_ICON_SIZE}
                />
                <span>{category.label}</span>
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  const category = findWorkingSuggestionCategory(state.categoryId)
  const Icon = CATEGORY_ICONS[category.id]

  return (
    <section
      aria-label={`${category.label}的建议任务`}
      className="working-suggestions tw:max-w-full"
      style={{ width: 'var(--quick-chat-surface-width)' }}
    >
      <div className="working-suggestion-list tw:grid tw:gap-0.5">
        <div className={`${SUGGESTION_HEADING_CLASS} working-suggestion-list-heading`}>
          <span className="tw:inline-flex tw:min-w-0 tw:items-center tw:gap-2 tw:text-app-text-soft">
            <Icon aria-hidden className="tw:shrink-0 tw:text-app-text-soft" size={APP_ICON_SIZE} />
            {category.label}
          </span>
          <button
            type="button"
            className={SUGGESTION_HEADING_ACTION_CLASS}
            onClick={() => onBack(category)}
          >
            <ArrowLeft aria-hidden size="var(--inline-icon-size, 1em)" />
            返回
          </button>
        </div>
        {category.tasks.map((task, index) => (
          <button
            key={task.id}
            className={`${SUGGESTION_ROW_CLASS} working-suggestion-row`}
            style={
              {
                '--new-session-suggestion-index': index,
                minHeight: 44,
              } as React.CSSProperties
            }
            type="button"
            onClick={() => onSelectTask(category, task)}
          >
            <span>{task.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
