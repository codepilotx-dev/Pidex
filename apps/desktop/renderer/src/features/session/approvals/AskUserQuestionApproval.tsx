import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import React from 'react'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  CornerDownLeft,
  PenLine,
  X,
} from 'lucide-react'
import type { DesktopPermissionRequest } from '../../../../shared/Types.js'
import { Button } from '../../../components/ui/Button.js'
import {
  ASK_USER_QUESTION_NAV_BUTTON_CLASS,
  ASK_USER_QUESTION_PAGINATION_NAV_BUTTON_CLASS,
  RequestCard,
  RequestMarker,
} from './RequestCard.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { cx } from '../../../utils/Cx.js'
import { useApprovalCapability } from './UseQuestionSkipCapability.js'
import {
  CUSTOM_OPTION_ID,
  answerStateForConfirmation,
  buildAskUserQuestionUpdatedInput,
  canSubmitFromCurrentQuestion,
  enterQuestionAction,
  firstUnansweredQuestionIndex,
  initialQuestionState,
  questionKey,
  questionOptionId,
  questionDrafts,
  nextQuestionIndex,
  nextQuestionOptionId,
  parseAskUserQuestions,
  selectQuestionOption,
  shouldShowQuestionSubmit,
  shouldDeferAskUserQuestionShortcutToTextEntry,
  type AskUserQuestion,
  type QuestionState,
} from './AskUserQuestionModel.js'

export {
  CUSTOM_OPTION_ID,
  answerForSelectedOption,
  areAllQuestionsAnswered,
  buildAskUserQuestionAnswers,
  buildAskUserQuestionUpdatedInput,
  canSubmitFromCurrentQuestion,
  enterQuestionAction,
  firstUnansweredQuestionIndex,
  footerControls,
  hasQuestionAnswer,
  initialQuestionState,
  nextOptionLabel,
  nextQuestionIndex,
  nextQuestionOptionId,
  parseAskUserQuestions,
  questionOptionIds,
  selectQuestionOption,
  shouldDeferAskUserQuestionShortcutToTextEntry,
  toggleMultiSelectOption,
  type AskUserQuestion,
  type AskUserQuestionOption,
  type EnterQuestionAction,
  type FooterControls,
  type QuestionState,
} from './AskUserQuestionModel.js'

export type AskUserQuestionApprovalProps = {
  request: DesktopPermissionRequest
  onSubmit: (updatedInput: Record<string, unknown>) => void | Promise<void>
  onReject: () => void | Promise<void>
  onInterrupt?: () => void | Promise<void>
  identity?: string
  disabledReason?: string
  supportsQuestionSkip?: boolean
}

export function AskUserQuestionApproval({
  request,
  ...props
}: AskUserQuestionApprovalProps): React.ReactNode {
  return (
    <QuestionAnswerForm
      {...props}
      requestId={request.requestId}
      input={request.input}
      questions={parseAskUserQuestions(request.input)}
    />
  )
}

export type QuestionAnswerFormProps = Omit<AskUserQuestionApprovalProps, 'request' | 'onSubmit'> & {
  onSubmit: (
    updatedInput: Record<string, unknown>,
    states: Readonly<Record<string, QuestionState>>,
  ) => void | Promise<void>
  requestId: string
  input?: Record<string, unknown>
  questions: AskUserQuestion[] | null
  variant?: 'question' | 'plan'
  dismissLabel?: string
  closeLabel?: string
  closeError?: string
}

export function QuestionAnswerForm({ ...props }: QuestionAnswerFormProps): React.ReactNode {
  const key = `${String(props.input?.threadId ?? '')}:${props.requestId}:${String(props.input?.version ?? '')}`
  return <QuestionAnswerFormInstance key={key} {...props} draftKey={key} />
}

function QuestionAnswerFormInstance({
  requestId,
  input = {},
  questions,
  onSubmit,
  onReject,
  onInterrupt,
  identity,
  disabledReason,
  variant = 'question',
  dismissLabel = '跳过',
  closeLabel = '中断当前对话',
  closeError = '中断对话失败，请重试。',
  supportsQuestionSkip = false,
  draftKey,
}: QuestionAnswerFormProps & { draftKey: string }): React.ReactNode {
  const [questionStates, setQuestionStates] = React.useState<Record<string, QuestionState>>(
    () => questionDrafts.get(draftKey)?.states ?? {},
  )
  const [currentQuestionIndex, setCurrentQuestionIndex] = React.useState(
    () => questionDrafts.get(draftKey)?.index ?? 0,
  )
  const [error, setError] = React.useState<string | null>(null)
  const customInputRef = React.useRef<HTMLTextAreaElement | null>(null)
  const approvalRef = React.useRef<HTMLDivElement | null>(null)
  const focusFirstOptionRef = React.useRef(false)
  const submittedRef = React.useRef(false)
  const mountedRef = React.useRef(true)
  const advanceTimer = React.useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const pauseAttemptedRef = React.useRef(false)
  const supportsPause = useApprovalCapability(
    requestId,
    variant === 'question',
    'interaction.questionPause.v1',
  )
  const [busy, setBusy] = React.useState(false)
  const disabled = busy || Boolean(disabledReason)
  const questionCount = questions?.length ?? 0

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      clearTimeout(advanceTimer.current)
    }
  }, [])

  React.useEffect(() => {
    if (!submittedRef.current)
      questionDrafts.set(draftKey, { states: questionStates, index: currentQuestionIndex })
  }, [draftKey, questionStates, currentQuestionIndex])

  React.useEffect(() => () => clearTimeout(advanceTimer.current), [currentQuestionIndex])

  React.useEffect(() => {
    setCurrentQuestionIndex((current) =>
      questionCount > 0 ? Math.min(current, questionCount - 1) : 0,
    )
  }, [questionCount])

  React.useLayoutEffect(() => {
    const input = customInputRef.current
    if (!input) return
    input.style.height = 'auto'
    input.style.height = `${Math.min(input.scrollHeight, 120)}px`
  }, [currentQuestionIndex, questionStates])

  React.useLayoutEffect(() => {
    if (!focusFirstOptionRef.current) return
    focusFirstOptionRef.current = false
    approvalRef.current
      ?.querySelector<HTMLButtonElement>('button[role="radio"], button[role="checkbox"]')
      ?.focus()
  }, [currentQuestionIndex])

  React.useLayoutEffect(() => {
    if (typeof window === 'undefined') return
    const frame = window.requestAnimationFrame(() => {
      if (
        isTextEntryTarget(document.activeElement) ||
        document.activeElement?.closest('[role="dialog"], [role="menu"]')
      )
        return
      approvalRef.current?.focus()
    })
    return () => window.cancelAnimationFrame(frame)
  }, [requestId])

  React.useEffect(() => {
    if (!questions || disabled || typeof window === 'undefined') return
    function handleKeyDown(event: KeyboardEvent): void {
      if (!(event.target instanceof Node) || !approvalRef.current?.contains(event.target)) return
      if (event.isComposing || event.keyCode === 229 || event.repeat || submittedRef.current) return
      if ((event.target as HTMLElement).closest('[role="dialog"], [role="menu"]')) return
      if (event.key === 'Escape') {
        event.preventDefault()
        void reject()
        return
      }
      if (
        event.target instanceof HTMLElement &&
        event.target.closest('button:not([role="radio"]):not([role="checkbox"])')
      )
        return
      if (shouldDeferAskUserQuestionShortcutToTextEntry(event.key, isTextEntryTarget(event.target)))
        return
      const currentQuestion = questions[currentQuestionIndex] ?? questions[0]
      if (!currentQuestion) return
      if (event.key === 'ArrowLeft') {
        event.preventDefault()
        setCurrentQuestionIndex((current) => nextQuestionIndex(current, -1, questionCount))
      } else if (event.key === 'ArrowRight') {
        event.preventDefault()
        goToQuestion(1)
      } else if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
        event.preventDefault()
        updateQuestionSelection(currentQuestion, event.key === 'ArrowUp' ? -1 : 1)
      } else if (/^[1-9]$/.test(event.key)) {
        const option = currentQuestion.options[Number(event.key) - 1]
        if (option) {
          event.preventDefault()
          chooseOption(currentQuestion, questionOptionId(option))
        }
      } else if (event.key === 'Enter') {
        event.preventDefault()
        confirmCurrentQuestionAndAdvance(currentQuestion)
      } else if (event.key === ' ') {
        if (currentQuestion.multiSelect) {
          event.preventDefault()
          toggleFocusedMultiSelectOption(currentQuestion)
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [currentQuestionIndex, onReject, questionCount, questionStates, questions, disabled])

  if (!questions) {
    return (
      <div
        ref={approvalRef}
        className="ask-user-question-approval tw:flex tw:w-full tw:flex-col tw:gap-3 tw:outline-none"
        tabIndex={-1}
      >
        <p className="ask-user-question-error tw:mx-3 tw:my-0 tw:px-3 tw:py-2 tw:border tw:border-app-danger-border tw:rounded-lg tw:bg-app-danger-subtle tw:text-app-danger-fg tw:type-body-sm">
          无法解析 AskUserQuestion 的选项，请拒绝后让 Pidex 重新提问。
        </p>
        <div
          className={cx(
            'inline-approval-footer inline-approval-footer-split tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:justify-between',
            variant === 'question' &&
              'tw:border-t tw:border-app-border-subtle tw:px-0 tw:pt-3 tw:pb-0',
          )}
        >
          <span className="inline-approval-footer-spacer tw:flex-none" aria-hidden="true" />
          <Button color="danger" disabled={disabled} onClick={() => void reject()}>
            拒绝
            <CornerDownLeft size={APP_ICON_SIZE} />
          </Button>
        </div>
      </div>
    )
  }

  function updateQuestion(
    questionText: string,
    updater: (current: QuestionState) => QuestionState,
  ): void {
    if (supportsPause && !pauseAttemptedRef.current && typeof input.version === 'number') {
      pauseAttemptedRef.current = true
      void desktopClient
        .pauseQuestion(requestId.replace(/^question:/u, ''), input.version)
        .catch(() => {
          pauseAttemptedRef.current = false
        })
    }
    setQuestionStates((current) => {
      const question = questions?.find((item) => questionKey(item) === questionText)
      const previous = question
        ? (current[questionText] ?? initialQuestionState(question))
        : { selected: [], custom: '', answered: false }
      return {
        ...current,
        [questionText]: updater(previous),
      }
    })
    setError(null)
  }

  function submitAnswers(override?: { question: AskUserQuestion; state: QuestionState }): void {
    if (!questions || submittedRef.current || disabledReason) return
    const drafts = override
      ? { ...questionStates, [questionKey(override.question)]: override.state }
      : questionStates
    const effectiveStates = Object.fromEntries(
      questions.map((question) => {
        const draft = drafts[questionKey(question)] ?? initialQuestionState(question)
        return [questionKey(question), draft.skipped ? draft : answerStateForConfirmation(draft)]
      }),
    )
    const firstUnanswered = firstUnansweredQuestionIndex(questions, effectiveStates)
    if (firstUnanswered !== -1) {
      setCurrentQuestionIndex(firstUnanswered)
      setError('请回答必答问题后再提交。')
      customInputRef.current?.focus()
      return
    }
    questionDrafts.set(draftKey, { states: drafts, index: currentQuestionIndex })
    submittedRef.current = true
    setBusy(true)
    try {
      const submission = Promise.resolve(
        onSubmit(
          buildAskUserQuestionUpdatedInput(input, questions, effectiveStates),
          effectiveStates,
        ),
      )
      void submission
        .then(() => {
          questionDrafts.delete(draftKey)
        })
        .catch(() => {
          if (mountedRef.current) setError('提交回答失败，请重试。')
          submittedRef.current = false
        })
        .finally(() => {
          if (mountedRef.current) setBusy(false)
        })
    } catch {
      submittedRef.current = false
      setBusy(false)
      setError('提交回答失败，请重试。')
    }
  }

  function confirmCurrentQuestionAndAdvance(
    question: AskUserQuestion,
    draft = questionStates[questionKey(question)] ?? initialQuestionState(question),
  ): void {
    if (submittedRef.current || disabledReason) return
    const confirmedState = answerStateForConfirmation(
      draft.skipped ? initialQuestionState(question) : draft,
    )
    if (!confirmedState.answered) {
      setError('请输入回答后再继续。')
      customInputRef.current?.focus()
      return
    }
    updateQuestion(questionKey(question), () => confirmedState)
    if (enterQuestionAction(currentQuestionIndex, questionCount) === 'confirm-and-submit') {
      submitAnswers({ question, state: confirmedState })
      return
    }
    goToQuestion(1)
  }

  function skipCurrentQuestion(question: AskUserQuestion): void {
    if (submittedRef.current || disabledReason || !supportsQuestionSkip) return
    const state: QuestionState = { selected: [], custom: '', answered: false, skipped: true }
    updateQuestion(questionKey(question), () => state)
    if (currentQuestionIndex === questionCount - 1) submitAnswers({ question, state })
    else {
      focusFirstOptionRef.current = true
      goToQuestion(1)
    }
  }

  function updateQuestionSelection(question: AskUserQuestion, delta: -1 | 1): void {
    updateQuestion(questionKey(question), (current) => {
      const currentLabel =
        current.focused ??
        current.selected[0] ??
        (question.options[0] && questionOptionId(question.options[0]))
      const nextLabel = nextQuestionOptionId(question, currentLabel, delta)
      if (nextLabel === undefined) return current
      return {
        ...selectQuestionOption(current, nextLabel, question.multiSelect, 'focus'),
        answered: false,
        skipped: false,
      }
    })
  }

  function toggleFocusedMultiSelectOption(question: AskUserQuestion): void {
    updateQuestion(questionKey(question), (current) => {
      const label =
        current.focused ??
        current.selected[0] ??
        (question.options[0] && questionOptionId(question.options[0]))
      if (!label) return current
      return {
        ...selectQuestionOption(current, label, question.multiSelect, 'toggle'),
        answered: false,
        touched: true,
        skipped: false,
      }
    })
  }

  function goToQuestion(delta: -1 | 1): void {
    if (submittedRef.current) return
    clearTimeout(advanceTimer.current)
    setCurrentQuestionIndex((current) => nextQuestionIndex(current, delta, questionCount))
    setError(null)
  }

  function chooseOption(question: AskUserQuestion, id: string): void {
    clearTimeout(advanceTimer.current)
    const next = {
      ...selectQuestionOption(
        questionStates[questionKey(question)] ?? initialQuestionState(question),
        id,
        question.multiSelect,
        'toggle',
      ),
      touched: true,
      skipped: false,
    }
    updateQuestion(questionKey(question), () => next)
    if (!question.multiSelect && currentQuestionIndex < questionCount - 1) {
      advanceTimer.current = setTimeout(() => {
        if (mountedRef.current) goToQuestion(1)
      }, 180)
    }
  }

  async function interrupt(): Promise<void> {
    if (!onInterrupt || submittedRef.current || disabledReason) return
    submittedRef.current = true
    setBusy(true)
    setError(null)
    try {
      await onInterrupt()
      questionDrafts.delete(draftKey)
    } catch {
      setError(closeError)
      submittedRef.current = false
      setBusy(false)
    }
  }

  async function reject(): Promise<void> {
    if (submittedRef.current || disabledReason) return
    submittedRef.current = true
    setBusy(true)
    setError(null)
    try {
      await onReject()
      questionDrafts.delete(draftKey)
    } catch {
      setError('操作失败，请重试。')
      submittedRef.current = false
      setBusy(false)
    }
  }

  const currentQuestion = questions[currentQuestionIndex] ?? questions[0]
  const state =
    questionStates[questionKey(currentQuestion)] ?? initialQuestionState(currentQuestion)
  const canSubmit = canSubmitFromCurrentQuestion(questions, questionStates, currentQuestionIndex)
  const isLastQuestion = currentQuestionIndex === questionCount - 1
  const showSubmit = shouldShowQuestionSubmit(questions, questionStates, currentQuestionIndex)
  const canConfirm =
    state.skipped ||
    (isLastQuestion ? canSubmit : state.selected.length > 0 || Boolean(state.custom.trim()))
  const questionOptions = [
    ...currentQuestion.options.map((option, index) => ({
      kind: 'choice' as const,
      id: questionOptionId(option),
      option,
      index,
    })),
    { kind: 'custom' as const, id: CUSTOM_OPTION_ID },
  ]

  return (
    <div
      ref={approvalRef}
      className="ask-user-question-approval tw:flex tw:w-full tw:flex-col tw:gap-3 tw:outline-none"
      tabIndex={-1}
    >
      <RequestCard
        variant={variant}
        title={currentQuestion.question}
        identity={identity}
        disabledReason={disabledReason}
        error={error}
        navigation={
          <div className="ask-user-question-navigation tw:flex tw:shrink-0 tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption">
            {variant === 'question' || questionCount > 1 ? (
              <div
                className="ask-user-question-pagination tw:inline-flex tw:items-center tw:gap-1 tw:whitespace-nowrap"
                role="group"
                aria-label="问题分页"
              >
                <button
                  type="button"
                  className={ASK_USER_QUESTION_PAGINATION_NAV_BUTTON_CLASS}
                  aria-label="上一题"
                  disabled={disabled || currentQuestionIndex === 0}
                  onClick={() => goToQuestion(-1)}
                >
                  <ChevronLeft size={APP_ICON_SIZE} />
                </button>
                <span aria-live="polite">
                  {currentQuestionIndex + 1} of {questionCount}
                </span>
                <button
                  type="button"
                  className={ASK_USER_QUESTION_PAGINATION_NAV_BUTTON_CLASS}
                  aria-label="下一题"
                  disabled={disabled || isLastQuestion}
                  onClick={() => goToQuestion(1)}
                >
                  <ChevronRight size={APP_ICON_SIZES.sm} />
                </button>
              </div>
            ) : null}
            <button
              type="button"
              className={ASK_USER_QUESTION_NAV_BUTTON_CLASS}
              aria-label={closeLabel}
              disabled={disabled || !onInterrupt}
              onClick={() => void interrupt()}
            >
              <X size={APP_ICON_SIZES.sm} />
            </button>
          </div>
        }
      >
        <div
          className="inline-approval-options tw:grid tw:grid-cols-[minmax(0,1fr)] tw:items-end tw:gap-x-3 tw:gap-y-1"
          role={currentQuestion.multiSelect ? 'group' : 'radiogroup'}
        >
          {questionOptions.map((questionOption) => {
            if (questionOption.kind === 'custom') {
              const focused = state.focused === questionOption.id
              return (
                <div
                  className={cx(
                    'inline-approval-option custom tw:col-start-1 tw:mt-1 tw:grid tw:w-full tw:grid-cols-[var(--cpx-sys-space-7)_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:bg-app-control tw:p-2 tw:text-left tw:text-app-text tw:type-body tw:cursor-text',
                    variant === 'question' && 'tw:focus-within:border-app-accent',
                    variant === 'question' && focused
                      ? 'tw:border-app-accent'
                      : 'tw:border-transparent',
                    focused ? 'focused' : undefined,
                    state.custom.trim() ? 'filled' : undefined,
                  )}
                  key={questionOption.id}
                >
                  <RequestMarker>
                    <PenLine size={APP_ICON_SIZE} />
                  </RequestMarker>
                  <textarea
                    ref={customInputRef}
                    className="ask-user-question-custom-input tw:block tw:w-full tw:min-w-0 tw:min-h-[1.5em] tw:max-h-[120px] tw:resize-none tw:overflow-y-auto tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:type-body tw:wrap-anywhere tw:outline-none tw:placeholder:text-app-text-meta"
                    aria-label="自定义回答"
                    placeholder={variant === 'plan' ? '请说明如何调整' : '输入你的回答'}
                    rows={1}
                    disabled={disabled}
                    value={state.custom}
                    onKeyDown={(event) => {
                      if (
                        event.key !== 'Enter' ||
                        event.shiftKey ||
                        event.ctrlKey ||
                        event.altKey ||
                        event.metaKey
                      )
                        return
                      if (
                        event.nativeEvent.isComposing ||
                        event.nativeEvent.keyCode === 229 ||
                        event.repeat
                      )
                        return
                      event.preventDefault()
                      if (state.custom.trim()) confirmCurrentQuestionAndAdvance(currentQuestion)
                    }}
                    onFocus={() => {
                      if (state.skipped) return
                      updateQuestion(questionKey(currentQuestion), (current) => ({
                        ...selectQuestionOption(
                          current,
                          questionOption.id,
                          currentQuestion.multiSelect,
                          'focus',
                        ),
                        answered: false,
                        skipped: false,
                      }))
                    }}
                    onChange={(event) => {
                      const custom = event.target.value
                      updateQuestion(questionKey(currentQuestion), (current) => ({
                        ...selectQuestionOption(
                          current,
                          questionOption.id,
                          currentQuestion.multiSelect,
                          'focus',
                        ),
                        custom,
                        answered: false,
                        skipped: false,
                      }))
                    }}
                  />
                  <div className="inline-approval-split ask-user-question-actions tw:flex tw:flex-none tw:items-center tw:justify-end tw:gap-1 tw:self-end">
                    {showSubmit ? (
                      <Button
                        color="primary"
                        disabled={disabled}
                        onClick={() => confirmCurrentQuestionAndAdvance(currentQuestion)}
                      >
                        {variant === 'plan'
                          ? state.custom.trim()
                            ? '提交反馈'
                            : '实施计划'
                          : isLastQuestion
                            ? '提交'
                            : '下一步'}
                        <CornerDownLeft size={APP_ICON_SIZE} />
                      </Button>
                    ) : (
                      <Button
                        color="secondary"
                        aria-label={variant === 'question' ? '跳过当前问题' : dismissLabel}
                        title={
                          variant === 'question' ? '仅跳过当前题；Esc 忽略整组问题' : undefined
                        }
                        disabled={disabled || (variant === 'question' && !supportsQuestionSkip)}
                        onClick={() =>
                          variant === 'question'
                            ? skipCurrentQuestion(currentQuestion)
                            : void reject()
                        }
                      >
                        {dismissLabel}
                      </Button>
                    )}
                    {showSubmit && variant === 'question' ? (
                      <Button
                        color="secondary"
                        aria-label="跳过当前问题"
                        disabled={disabled || !supportsQuestionSkip}
                        onClick={() => skipCurrentQuestion(currentQuestion)}
                      >
                        {dismissLabel}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            }

            const { option, index } = questionOption
            const selected = state.selected.includes(questionOptionId(option))
            const focused = state.focused === questionOption.id
            return (
              <button
                aria-checked={selected}
                className={cx(
                  'inline-approval-option tw:col-span-full tw:grid tw:w-full tw:grid-cols-[var(--cpx-sys-space-7)_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:border-transparent tw:p-2 tw:text-left tw:text-app-text tw:type-body tw:focus-visible:shadow-[var(--cpx-sys-focus-ring)] tw:focus-visible:outline-none',
                  variant === 'question' && !selected && 'tw:hover:bg-app-hover',
                  selected ? 'selected tw:bg-app-selected' : 'tw:bg-transparent',
                  focused ? 'focused' : undefined,
                )}
                key={questionOptionId(option)}
                role={currentQuestion.multiSelect ? 'checkbox' : 'radio'}
                type="button"
                disabled={disabled}
                onClick={() => {
                  if (submittedRef.current || disabledReason) return
                  chooseOption(currentQuestion, questionOptionId(option))
                }}
              >
                <RequestMarker>{index + 1}</RequestMarker>
                <span className="ask-user-question-option-copy tw:grid tw:min-w-0 tw:gap-1 tw:text-left">
                  <span className="inline-approval-option-label tw:block tw:min-w-0 tw:type-row-title tw:wrap-anywhere">
                    {option.label}
                    {option.recommended ? (
                      <span
                        className={cx(
                          'inline-approval-option-hint tw:type-caption',
                          variant === 'question'
                            ? 'tw:text-app-text-soft'
                            : 'tw:text-app-text-meta',
                        )}
                      >
                        {' （推荐）'}
                      </span>
                    ) : null}
                  </span>
                  {option.description ? (
                    <span className="ask-user-question-option-description tw:block tw:text-app-text-soft tw:type-body-sm tw:whitespace-normal tw:wrap-anywhere">
                      {option.description}
                    </span>
                  ) : null}
                </span>
                {currentQuestion.multiSelect ? (
                  <span className="inline-approval-option-trailing tw:inline-flex tw:flex-none tw:items-center tw:gap-2">
                    <span
                      className={cx(
                        'inline-approval-option-checkbox tw:inline-flex tw:size-5 tw:items-center tw:justify-center tw:rounded-md tw:border tw:border-app-border tw:text-app-canvas',
                        selected
                          ? 'selected tw:border-app-text tw:bg-app-text'
                          : 'tw:bg-transparent',
                      )}
                      aria-hidden="true"
                    >
                      {selected ? <Check size={APP_ICON_SIZES.sm} /> : null}
                    </span>
                  </span>
                ) : selected ? (
                  <span className="inline-approval-option-trailing tw:inline-flex tw:flex-none tw:items-center tw:gap-2">
                    <span
                      className="inline-approval-option-arrows tw:inline-flex tw:items-center tw:gap-1 tw:text-app-text-meta"
                      aria-hidden="true"
                    >
                      <ArrowRight size={APP_ICON_SIZE} />
                    </span>
                  </span>
                ) : null}
              </button>
            )
          })}
        </div>
        {variant === 'question' && !supportsQuestionSkip ? (
          <p
            className="ask-user-question-error tw:mx-3 tw:my-0 tw:px-3 tw:py-2 tw:border tw:border-app-danger-border tw:rounded-lg tw:bg-app-danger-subtle tw:text-app-danger-fg tw:type-body-sm"
            role="status"
          >
            当前 Agent 尚未提供逐题跳过能力，请升级并重启 Agent。
          </p>
        ) : null}
      </RequestCard>
    </div>
  )
}

function isTextEntryTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  return (
    target.tagName === 'INPUT' ||
    target.tagName === 'TEXTAREA' ||
    target.tagName === 'SELECT' ||
    target.isContentEditable
  )
}
