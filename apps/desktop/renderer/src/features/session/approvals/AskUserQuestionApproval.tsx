import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import React from 'react'
import {
  ArrowRight,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleDot,
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
  enterQuestionAction,
  firstUnansweredQuestionIndex,
  hasQuestionAnswer,
  initialPlanQuestionState,
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
  initialPlanQuestionState,
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
  /**
   * 由所属 Turn 的 canonical 状态传入，而不是可能已改变的 Composer 草稿模式：
   * Plan 澄清走逐题显式确认，Chat 提问保留既有语义。
   */
  taskMode?: 'chat' | 'plan'
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
  supportsQuestionSkip = false,
  taskMode = 'chat',
  draftKey,
}: QuestionAnswerFormProps & { draftKey: string }): React.ReactNode {
  const isPlan = taskMode === 'plan'
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
  const pauseAttemptedRef = React.useRef(false)
  const supportsPause = useApprovalCapability(
    requestId,
    !isPlan,
    'interaction.questionPause.v1',
  )
  const [busy, setBusy] = React.useState(false)
  const disabled = busy || Boolean(disabledReason)
  const questionCount = questions?.length ?? 0

  const draftFor = React.useCallback(
    (question: AskUserQuestion): QuestionState =>
      questionStates[questionKey(question)] ??
      (isPlan ? initialPlanQuestionState() : initialQuestionState(question)),
    [isPlan, questionStates],
  )

  React.useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
    }
  }, [])

  React.useEffect(() => {
    if (!submittedRef.current)
      questionDrafts.set(draftKey, { states: questionStates, index: currentQuestionIndex })
  }, [draftKey, questionStates, currentQuestionIndex])

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
        // Plan 问题只退出当前编辑焦点；结束等待必须点击“停止本轮”。
        if (isPlan) blurCurrentFocus()
        else void reject()
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
      if (isPlan) {
        // 方向键只移动焦点，Space 由按钮原生激活选择，Enter 确认当前题。
        if (event.key === 'ArrowUp' || event.key === 'ArrowDown') {
          event.preventDefault()
          movePlanFocus(event.key === 'ArrowUp' ? -1 : 1)
        } else if (event.key === 'Enter') {
          event.preventDefault()
          confirmCurrentQuestionAndAdvance(currentQuestion)
        }
        return
      }
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestionIndex, onReject, questionCount, questionStates, questions, disabled, isPlan])

  if (!questions || questions.length === 0) {
    return (
      <div
        ref={approvalRef}
        className="ask-user-question-approval tw:flex tw:w-full tw:flex-col tw:gap-3 tw:outline-none"
        tabIndex={-1}
      >
        <p className="ask-user-question-error tw:mx-3 tw:my-0 tw:px-3 tw:py-2 tw:border tw:border-app-danger-border tw:rounded-lg tw:bg-app-danger-subtle tw:text-app-danger-fg tw:type-body-sm">
          无法解析 AskUserQuestion 的选项，请拒绝后让 Pidex 重新提问。
        </p>
        <div className="inline-approval-footer inline-approval-footer-split tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:justify-between">
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
      void desktopClient.pauseQuestion(requestId.replace(/^question:/u, ''), input.version).catch(() => {
        pauseAttemptedRef.current = false
      })
    }
    setQuestionStates((current) => {
      const question = questions?.find((item) => questionKey(item) === questionText)
      const previous = question
        ? (current[questionText] ??
          (isPlan ? initialPlanQuestionState() : initialQuestionState(question)))
        : initialPlanQuestionState()
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
        const draft = drafts[questionKey(question)] ?? draftFor(question)
        return [questionKey(question), draft.skipped ? draft : answerStateForConfirmation(draft)]
      }),
    )
    const firstUnanswered = firstUnansweredQuestionIndex(questions, effectiveStates)
    if (firstUnanswered !== -1) {
      setCurrentQuestionIndex(firstUnanswered)
      // 先聚焦再设置错误：聚焦会触发 onFocus 的 updateQuestion，它清空既有错误。
      customInputRef.current?.focus()
      setError('请回答必答问题后再提交。')
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
    draft = draftFor(question),
  ): void {
    if (submittedRef.current || disabledReason) return
    const blankState = isPlan ? initialPlanQuestionState() : initialQuestionState(question)
    const confirmedState = answerStateForConfirmation(draft.skipped ? blankState : draft)
    if (!confirmedState.answered) {
      // 先聚焦再设置错误：聚焦会触发 onFocus 的 updateQuestion，它清空既有错误。
      customInputRef.current?.focus()
      setError('请输入回答后再继续。')
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

  /** 方向键只移动真实键盘焦点，不改变答案。 */
  function movePlanFocus(delta: -1 | 1): void {
    const container = approvalRef.current
    if (!container) return
    const targets = Array.from(
      container.querySelectorAll<HTMLElement>(
        'button[role="radio"], button[role="checkbox"], textarea',
      ),
    ).filter((element) => !(element as HTMLButtonElement).disabled)
    if (targets.length === 0) return
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const index = active ? targets.indexOf(active) : -1
    const next =
      index < 0
        ? delta > 0
          ? 0
          : targets.length - 1
        : (index + delta + targets.length) % targets.length
    targets[next]?.focus()
  }

  function blurCurrentFocus(): void {
    const active = document.activeElement
    if (active instanceof HTMLElement && approvalRef.current?.contains(active)) active.blur()
  }

  function goToQuestion(delta: -1 | 1): void {
    if (submittedRef.current) return
    setCurrentQuestionIndex((current) => nextQuestionIndex(current, delta, questionCount))
    setError(null)
  }

  function goToQuestionIndex(index: number): void {
    if (submittedRef.current) return
    setCurrentQuestionIndex(Math.max(0, Math.min(questionCount - 1, index)))
    setError(null)
  }

  function chooseOption(question: AskUserQuestion, id: string): void {
    updateQuestion(questionKey(question), (current) => ({
      ...selectQuestionOption(current, id, question.multiSelect, 'toggle'),
      touched: true,
      skipped: false,
    }))
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
      setError('中断对话失败，请重试。')
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
  const state = draftFor(currentQuestion)
  const isLastQuestion = currentQuestionIndex === questionCount - 1
  const showSubmit = shouldShowQuestionSubmit(questions, questionStates, currentQuestionIndex)
  const currentAnswered = hasQuestionAnswer(state)
  const planHasChoices = currentQuestion.options.length > 0
  const choiceOptions = currentQuestion.options.map((option, index) => ({ option, index }))
  const customFocused = state.focused === CUSTOM_OPTION_ID

  const customRow = (
    <div
      className={cx(
        'inline-approval-option custom tw:mt-1 tw:grid tw:w-full tw:grid-cols-[var(--cpx-sys-space-7)_minmax(0,1fr)_auto] tw:gap-2 tw:rounded-lg tw:border tw:bg-app-control tw:p-2 tw:text-left tw:text-app-text tw:type-body tw:cursor-text',
        // Plan 的「自己回答」多一行标题，标记随之顶部对齐；Chat 保持原来的行内居中。
        isPlan && planHasChoices ? 'tw:items-start' : 'tw:items-center',
        planHasChoices && 'tw:col-start-1',
        'tw:focus-within:border-app-accent',
        customFocused ? 'tw:border-app-accent' : 'tw:border-transparent',
        customFocused ? 'focused' : undefined,
        state.custom.trim() ? 'filled' : undefined,
      )}
      key={CUSTOM_OPTION_ID}
    >
      <RequestMarker>
        <PenLine size={APP_ICON_SIZE} />
      </RequestMarker>
      <span className="ask-user-question-option-copy tw:grid tw:min-w-0 tw:gap-1 tw:text-left">
        {isPlan && planHasChoices ? (
          <span className="inline-approval-option-label tw:block tw:min-w-0 tw:type-row-title">
            自己回答
          </span>
        ) : null}
        <textarea
          ref={customInputRef}
          className="ask-user-question-custom-input tw:block tw:w-full tw:min-w-0 tw:min-h-[1.5em] tw:max-h-[120px] tw:resize-none tw:overflow-y-auto tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:type-body tw:wrap-anywhere tw:outline-none tw:placeholder:text-app-text-meta"
          aria-label="自定义回答"
          placeholder="输入你的回答"
          rows={1}
          disabled={disabled}
          value={state.custom}
          onKeyDown={(event) => {
            const confirmKey = isPlan
              ? event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.altKey
              : event.key === 'Enter' &&
                !event.shiftKey &&
                !event.ctrlKey &&
                !event.altKey &&
                !event.metaKey
            if (!confirmKey) return
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
            // Plan 澄清：聚焦只是焦点，清除选择只由真实输入触发。
            updateQuestion(questionKey(currentQuestion), (current) =>
              isPlan
                ? { ...current, focused: CUSTOM_OPTION_ID, skipped: false }
                : {
                    ...selectQuestionOption(
                      current,
                      CUSTOM_OPTION_ID,
                      currentQuestion.multiSelect,
                      'focus',
                    ),
                    answered: false,
                    skipped: false,
                  },
            )
          }}
          onChange={(event) => {
            const custom = event.target.value
            updateQuestion(questionKey(currentQuestion), (current) =>
              isPlan
                ? {
                    ...current,
                    custom,
                    focused: CUSTOM_OPTION_ID,
                    selected: currentQuestion.multiSelect ? current.selected : [],
                    answered:
                      Boolean(custom.trim()) ||
                      (currentQuestion.multiSelect && current.selected.length > 0),
                    skipped: false,
                  }
                : {
                    ...selectQuestionOption(
                      current,
                      CUSTOM_OPTION_ID,
                      currentQuestion.multiSelect,
                      'focus',
                    ),
                    custom,
                    answered: false,
                    skipped: false,
                  },
            )
          }}
        />
      </span>
      {isPlan ? null : (
        <div className="inline-approval-split ask-user-question-actions tw:flex tw:flex-none tw:items-center tw:justify-end tw:gap-1 tw:self-end">
          {showSubmit ? (
            <Button
              color="primary"
              disabled={disabled}
              onClick={() => confirmCurrentQuestionAndAdvance(currentQuestion)}
            >
              {isLastQuestion ? '提交' : '下一步'}
              <CornerDownLeft size={APP_ICON_SIZE} />
            </Button>
          ) : (
            <Button
              color="secondary"
              aria-label="跳过当前问题"
              title="仅跳过当前题；Esc 忽略整组问题"
              disabled={disabled || !supportsQuestionSkip}
              onClick={() => skipCurrentQuestion(currentQuestion)}
            >
              跳过
            </Button>
          )}
          {showSubmit ? (
            <Button
              color="secondary"
              aria-label="跳过当前问题"
              disabled={disabled || !supportsQuestionSkip}
              onClick={() => skipCurrentQuestion(currentQuestion)}
            >
              跳过
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )

  return (
    <div
      ref={approvalRef}
      className="ask-user-question-approval tw:flex tw:w-full tw:flex-col tw:gap-3 tw:outline-none"
      tabIndex={-1}
    >
      <RequestCard
        variant="question"
        title={currentQuestion.question}
        identity={isPlan ? (identity ?? '需要你确认') : identity}
        disabledReason={disabledReason}
        error={error}
        navigation={
          isPlan ? (
            <div className="ask-user-question-navigation tw:flex tw:shrink-0 tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption">
              {questionCount > 1 ? (
                <div
                  className="ask-user-question-pagination tw:inline-flex tw:items-center tw:gap-1 tw:whitespace-nowrap"
                  role="group"
                  aria-label="问题导航"
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
                  {questions.map((question, index) => {
                    const answered = hasQuestionAnswer(draftFor(question))
                    return (
                      <button
                        key={questionKey(question)}
                        type="button"
                        className={cx(
                          ASK_USER_QUESTION_PAGINATION_NAV_BUTTON_CLASS,
                          'ask-user-question-step',
                          index === currentQuestionIndex && 'current',
                          answered && 'answered',
                        )}
                        aria-current={index === currentQuestionIndex ? 'step' : undefined}
                        aria-label={`第 ${index + 1} 题${answered ? '（已答）' : '（待答）'}`}
                        data-answered={answered ? 'true' : 'false'}
                        disabled={disabled}
                        onClick={() => goToQuestionIndex(index)}
                      >
                        {index + 1}
                      </button>
                    )
                  })}
                  <span aria-live="polite">
                    {currentQuestionIndex + 1} / {questionCount}
                  </span>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="ask-user-question-navigation tw:flex tw:shrink-0 tw:items-center tw:gap-2 tw:text-app-text-meta tw:type-caption">
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
              <button
                type="button"
                className={ASK_USER_QUESTION_NAV_BUTTON_CLASS}
                aria-label="中断当前对话"
                disabled={disabled || !onInterrupt}
                onClick={() => void interrupt()}
              >
                <X size={APP_ICON_SIZES.sm} />
              </button>
            </div>
          )
        }
      >
        {planHasChoices ? (
          <div
            className="inline-approval-options tw:grid tw:grid-cols-[minmax(0,1fr)] tw:items-end tw:gap-x-3 tw:gap-y-1"
            role={currentQuestion.multiSelect ? 'group' : 'radiogroup'}
          >
            {choiceOptions.map(({ option, index }) => {
              const selected = state.selected.includes(questionOptionId(option))
              const focused = state.focused === questionOptionId(option)
              return (
                <button
                  aria-checked={selected}
                  className={cx(
                    'inline-approval-option tw:col-span-full tw:grid tw:w-full tw:grid-cols-[var(--cpx-sys-space-7)_minmax(0,1fr)_auto] tw:items-center tw:gap-2 tw:rounded-lg tw:border tw:border-transparent tw:p-2 tw:text-left tw:text-app-text tw:type-body tw:focus-visible:shadow-[var(--cpx-sys-focus-ring)] tw:focus-visible:outline-none',
                    !selected && 'tw:hover:bg-app-hover',
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
                  <RequestMarker>
                    {isPlan ? (
                      selected ? (
                        <CircleDot size={APP_ICON_SIZE} />
                      ) : (
                        <Circle size={APP_ICON_SIZE} />
                      )
                    ) : (
                      index + 1
                    )}
                  </RequestMarker>
                  <span className="ask-user-question-option-copy tw:grid tw:min-w-0 tw:gap-1 tw:text-left">
                    <span className="inline-approval-option-label tw:block tw:min-w-0 tw:type-row-title tw:wrap-anywhere">
                      {option.label}
                      {option.recommended ? (
                        isPlan ? (
                          <span className="inline-approval-option-hint ask-user-question-recommendation tw:type-caption tw:text-app-text-soft">
                            推荐
                          </span>
                        ) : (
                          <span className="inline-approval-option-hint tw:type-caption tw:text-app-text-soft">
                            {' （推荐）'}
                          </span>
                        )
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
            {customRow}
          </div>
        ) : (
          customRow
        )}
        {isPlan ? (
          <div className="ask-user-question-footer tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-2 tw:px-1 tw:pt-2">
            <Button
              color="secondary"
              disabled={disabled || !onInterrupt}
              onClick={() => void interrupt()}
            >
              停止本轮
            </Button>
            <Button
              color="primary"
              disabled={disabled || (!isLastQuestion && !currentAnswered)}
              onClick={() => {
                if (!isLastQuestion) {
                  goToQuestion(1)
                  return
                }
                submitAnswers()
              }}
            >
              {isLastQuestion ? '提交回答' : '下一题'}
              <CornerDownLeft size={APP_ICON_SIZE} />
            </Button>
          </div>
        ) : null}
        {!isPlan && !supportsQuestionSkip ? (
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
