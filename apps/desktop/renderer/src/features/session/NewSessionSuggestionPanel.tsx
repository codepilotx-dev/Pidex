import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import type React from 'react'
import { ArrowLeft, Bug, Hammer, ListChecks, SearchCode } from 'lucide-react'
import type { NewSessionSuggestionState } from './NewSessionSuggestionState.js'
import {
  findNewSessionSuggestionCategory,
  NEW_SESSION_SUGGESTIONS,
  type NewSessionSuggestionCategory,
  type NewSessionSuggestionCategoryId,
  type NewSessionSuggestionTask,
  type NewSessionTaskSuggestion,
} from './NewSessionSuggestions.js'

type NewSessionSuggestionPanelProps = {
  state: NewSessionSuggestionState
  suggestions: readonly NewSessionTaskSuggestion[]
  onSelectSuggestion: (suggestion: NewSessionTaskSuggestion) => void
  onSelectCategory: (category: NewSessionSuggestionCategory) => void
  onSelectTask: (category: NewSessionSuggestionCategory, task: NewSessionSuggestionTask) => void
  onShowAll: (category: NewSessionSuggestionCategory) => void
  onShowSuggestions: () => void
}

const CATEGORY_ICONS: Record<
  NewSessionSuggestionCategoryId,
  React.ComponentType<{ 'aria-hidden'?: boolean; size?: number }>
> = {
  'codex-explore': SearchCode,
  'codex-create': Hammer,
  'codex-review': ListChecks,
  'codex-fix': Bug,
}

/**
 * 建议卡片的语气色通过 `--new-session-suggestion-tone` 传给图标与标题；
 * `is-*` 只是动态拼出的语义锚点，颜色必须由这张静态映射表提供。
 */
const SUGGESTION_TONE_CLASS: Record<string, string> = {
  blue: 'tw:[--new-session-suggestion-tone:var(--cpx-sys-color-charts-blue,var(--cpx-sys-color-accent))]',
  purple:
    'tw:[--new-session-suggestion-tone:var(--cpx-sys-color-charts-purple,var(--cpx-sys-color-accent))]',
  green:
    'tw:[--new-session-suggestion-tone:var(--cpx-sys-color-charts-green,var(--cpx-sys-color-success))]',
  orange: 'tw:[--new-session-suggestion-tone:var(--cpx-sys-color-warning)]',
}

export const SUGGESTION_PANEL_CLASS =
  'new-session-suggestions tw:w-[var(--quick-chat-surface-width)] tw:max-w-full tw:[container-type:inline-size]'

const SUGGESTION_ICON_CLASS =
  'new-session-suggestion-icon tw:grid tw:size-[var(--inline-icon-size,1em)] tw:place-items-center tw:[color:var(--new-session-suggestion-tone)]'

const SUGGESTION_FOCUS_CLASS =
  'tw:border-0 tw:cursor-pointer tw:[font:inherit] tw:focus-visible:outline-1 tw:focus-visible:outline-offset-2 tw:focus-visible:outline-app-focus'

const SUGGESTION_CARD_CLASS = `new-session-suggestion-card tw:flex tw:min-h-26 tw:min-w-0 tw:flex-col tw:items-start tw:justify-between tw:gap-3 tw:rounded-container tw:border tw:border-app-border tw:bg-transparent tw:px-4 tw:py-3 tw:text-left tw:text-app-text tw:shadow-none tw:[transition:background_var(--cpx-sys-motion-instant)_var(--cpx-sys-ease-standard),color_var(--cpx-sys-motion-feedback)_var(--cpx-sys-ease-standard)] tw:hover:bg-app-hover tw:active:bg-app-selected ${SUGGESTION_FOCUS_CLASS}`

export const SUGGESTION_HEADING_CLASS =
  'new-session-suggestion-list-heading tw:flex tw:min-w-0 tw:items-center tw:justify-between tw:gap-2 tw:px-2 tw:py-1 tw:text-app-text-meta tw:type-label'

export const SUGGESTION_HEADING_ACTION_CLASS = `tw:inline-flex tw:flex-none tw:items-center tw:gap-2 tw:rounded-md tw:bg-transparent tw:px-2 tw:py-1 tw:text-app-text-soft tw:hover:bg-app-hover tw:hover:text-app-text ${SUGGESTION_FOCUS_CLASS}`

export const SUGGESTION_HEADING_TITLE_CLASS =
  'tw:inline-flex tw:min-w-0 tw:items-center tw:gap-2 tw:[color:var(--new-session-suggestion-tone)]'

export const SUGGESTION_ROW_CLASS = `new-session-suggestion-row tw:flex tw:min-h-10 tw:items-center tw:gap-2 tw:rounded-md tw:bg-transparent tw:px-3 tw:py-2 tw:text-left tw:text-app-text tw:type-control tw:hover:bg-app-hover ${SUGGESTION_FOCUS_CLASS}`

export function NewSessionSuggestions({
  state,
  suggestions,
  onSelectSuggestion,
  onSelectCategory,
  onSelectTask,
  onShowAll,
  onShowSuggestions,
}: NewSessionSuggestionPanelProps): React.ReactNode {
  if (state.kind === 'hidden') return null

  if (state.kind === 'root') {
    return (
      <section aria-label="建议任务" className={`${SUGGESTION_PANEL_CLASS} is-root`}>
        <div className="new-session-suggestion-grid tw:grid tw:grid-cols-4 tw:gap-3 tw:@max-[34rem]:grid-cols-2">
          {suggestions.slice(0, 4).map((suggestion, index) => {
            const category = findNewSessionSuggestionCategory(suggestion.categoryId)
            const Icon = CATEGORY_ICONS[category.id]
            return (
              <button
                key={suggestion.id}
                aria-label={suggestion.label}
                className={`${SUGGESTION_CARD_CLASS} is-${category.tone} ${SUGGESTION_TONE_CLASS[category.tone]}`}
                style={
                  {
                    '--new-session-suggestion-index': index,
                  } as React.CSSProperties
                }
                type="button"
                onClick={() => onSelectSuggestion(suggestion)}
              >
                <span className={SUGGESTION_ICON_CLASS}>
                  <Icon aria-hidden size={APP_ICON_SIZE} />
                </span>
                <span className="new-session-suggestion-label tw:type-row-title">
                  {suggestion.label}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  if (state.kind === 'templates') {
    return (
      <section
        aria-label="选择一个任务模板"
        className={`${SUGGESTION_PANEL_CLASS} is-root is-templates`}
      >
        <div className={`${SUGGESTION_HEADING_CLASS} tw:mb-2`}>
          <span className={SUGGESTION_HEADING_TITLE_CLASS}>任务模板</span>
          <button
            type="button"
            className={SUGGESTION_HEADING_ACTION_CLASS}
            onClick={onShowSuggestions}
          >
            <ArrowLeft aria-hidden size="var(--inline-icon-size, 1em)" />
            返回建议
          </button>
        </div>
        <div className="new-session-suggestion-grid tw:grid tw:grid-cols-4 tw:gap-3 tw:@max-[34rem]:grid-cols-2">
          {NEW_SESSION_SUGGESTIONS.map((category, index) => {
            const Icon = CATEGORY_ICONS[category.id]
            return (
              <button
                key={category.id}
                aria-label={category.label}
                className={`${SUGGESTION_CARD_CLASS} is-${category.tone} ${SUGGESTION_TONE_CLASS[category.tone]}`}
                style={
                  {
                    '--new-session-suggestion-index': index,
                  } as React.CSSProperties
                }
                type="button"
                onClick={() => onSelectCategory(category)}
              >
                <span className={SUGGESTION_ICON_CLASS}>
                  <Icon aria-hidden size={APP_ICON_SIZE} />
                </span>
                <span className="new-session-suggestion-label tw:type-row-title">
                  {category.label}
                </span>
              </button>
            )
          })}
        </div>
      </section>
    )
  }

  const category = findNewSessionSuggestionCategory(state.categoryId)
  const Icon = CATEGORY_ICONS[category.id]

  return (
    <section
      aria-label={`${category.label}的建议任务`}
      className={`${SUGGESTION_PANEL_CLASS} is-follow-up is-${category.tone} ${SUGGESTION_TONE_CLASS[category.tone]} tw:grid tw:gap-2 tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel tw:p-2 tw:shadow-none`}
    >
      <div className={SUGGESTION_HEADING_CLASS}>
        <span className={SUGGESTION_HEADING_TITLE_CLASS}>
          <Icon aria-hidden size={APP_ICON_SIZE} />
          {category.label}
        </span>
        <button
          type="button"
          className={SUGGESTION_HEADING_ACTION_CLASS}
          onClick={() => onShowAll(category)}
        >
          <ArrowLeft aria-hidden size="var(--inline-icon-size, 1em)" />
          显示全部
        </button>
      </div>
      <div className="new-session-suggestion-list tw:grid tw:gap-1">
        {category.tasks.map((task, index) => (
          <button
            key={task.id}
            className={SUGGESTION_ROW_CLASS}
            style={
              {
                '--new-session-suggestion-index': index,
              } as React.CSSProperties
            }
            type="button"
            onClick={() => onSelectTask(category, task)}
          >
            <span
              aria-hidden
              className="new-session-suggestion-prefix tw:flex-none tw:text-app-text-soft"
            >
              {category.starter.trim()}
            </span>
            <span>{task.label}</span>
          </button>
        ))}
      </div>
    </section>
  )
}
