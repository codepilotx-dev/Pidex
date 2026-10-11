import { isRecord } from '@pidex/shared/guards'
export type AskUserQuestionOption = {
  id?: string
  label: string
  description: string
  recommended?: boolean
}

export const questionOptionId = (option: { id?: string; label: string }): string =>
  option.id ?? option.label

// Drafts belong to this Renderer lifetime; never persist answers to browser storage.
export const questionDrafts = new Map<
  string,
  {
    states: Record<string, QuestionState>
    index: number
  }
>()
export function reconcileQuestionDrafts(threadId: string, activeKeys: ReadonlySet<string>): void {
  for (const key of questionDrafts.keys()) {
    if (key.startsWith(`${threadId}:`) && !activeKeys.has(key)) questionDrafts.delete(key)
  }
}

export type AskUserQuestion = {
  id?: string
  question: string
  header: string
  options: AskUserQuestionOption[]
  multiSelect: boolean
}

export const CUSTOM_OPTION_ID = '__custom'

export type QuestionState = {
  selected: string[]
  custom: string
  answered: boolean
  focused?: string
  touched?: boolean
  skipped?: boolean
}

export function questionKey(question: { id?: string; question: string }): string {
  return question.id ?? question.question
}

export function nextQuestionIndex(
  currentIndex: number,
  delta: number,
  questionCount: number,
): number {
  if (questionCount <= 0) return 0
  return Math.max(0, Math.min(questionCount - 1, currentIndex + delta))
}

export function firstUnansweredQuestionIndex(
  questions: Array<{ id?: string; question: string }>,
  questionStates: Record<string, QuestionState>,
): number {
  return questions.findIndex(
    (question) => !isQuestionComplete(questionStates[questionKey(question)]),
  )
}

export function areAllQuestionsAnswered(
  questions: Array<{ id?: string; question: string }>,
  questionStates: Record<string, QuestionState>,
): boolean {
  return (
    questions.length > 0 &&
    questions.every((question) => isQuestionComplete(questionStates[questionKey(question)]))
  )
}

export function canSubmitFromCurrentQuestion(
  questions: Array<{
    id?: string
    question: string
    options: Array<{ id?: string; label: string }>
  }>,
  questionStates: Record<string, QuestionState>,
  currentQuestionIndex: number,
): boolean {
  if (questions.length === 0) return false
  return questions.every((question) => {
    const state = questionStates[questionKey(question)] ?? initialQuestionState(question)
    return state.skipped || state.selected.length > 0 || Boolean(state.custom.trim())
  })
}

export function shouldShowQuestionSubmit(
  questions: AskUserQuestion[],
  states: Record<string, QuestionState>,
  index: number,
): boolean {
  const question = questions[index]!
  const state = states[questionKey(question)] ?? initialQuestionState(question)
  return (
    !state.skipped &&
    (index === questions.length - 1 ||
      Boolean(state.custom.trim()) ||
      (question.multiSelect && state.touched === true && state.selected.length > 0))
  )
}

export type FooterControls = {
  showPrevious: boolean
  showNext: boolean
  showSubmit: boolean
}

export function footerControls(
  currentQuestionIndex: number,
  questionCount: number,
): FooterControls {
  const isLastQuestion = currentQuestionIndex >= questionCount - 1
  return {
    showPrevious: questionCount > 1 && currentQuestionIndex > 0,
    showNext: questionCount > 1 && !isLastQuestion,
    showSubmit: questionCount > 0 && isLastQuestion,
  }
}

export type EnterQuestionAction = 'confirm-and-next' | 'confirm-and-submit'

export function enterQuestionAction(
  currentQuestionIndex: number,
  questionCount: number,
): EnterQuestionAction {
  return currentQuestionIndex >= questionCount - 1 ? 'confirm-and-submit' : 'confirm-and-next'
}

export function initialQuestionState(question: {
  options: Array<{ id?: string; label: string }>
  multiSelect?: boolean
}): QuestionState {
  const firstOption = question.multiSelect ? undefined : question.options[0]
  return {
    selected: firstOption ? [questionOptionId(firstOption)] : [],
    custom: '',
    answered: false,
  }
}

export function toggleMultiSelectOption(current: QuestionState, label: string): QuestionState {
  const selected = current.selected.includes(label)
    ? current.selected.filter((item) => item !== label)
    : [...current.selected, label]
  return {
    ...current,
    selected,
    focused: label,
    answered: selected.length > 0 || Boolean(current.custom.trim()),
  }
}

export function answerStateForConfirmation(state: QuestionState): QuestionState {
  return {
    ...state,
    skipped: false,
    answered: state.selected.length > 0 || Boolean(state.custom.trim()),
  }
}

export function answerForSelectedOption(
  question: { question: string },
  selectedLabel: string,
): Record<string, string> {
  return { [question.question]: selectedLabel }
}

export function nextOptionLabel(
  question: { options: Array<{ label: string }> },
  currentLabel: string | undefined,
  delta: -1 | 1,
): string | undefined {
  const currentIndex = Math.max(
    0,
    question.options.findIndex((option) => option.label === currentLabel),
  )
  const nextIndex = nextQuestionIndex(currentIndex, delta, question.options.length)
  return question.options[nextIndex]?.label
}

export function questionOptionIds(question: {
  options: Array<{ id?: string; label: string }>
}): string[] {
  return [...question.options.map(questionOptionId), CUSTOM_OPTION_ID]
}

export function nextQuestionOptionId(
  question: { options: Array<{ id?: string; label: string }> },
  currentLabel: string | undefined,
  delta: -1 | 1,
): string | undefined {
  const optionIds = questionOptionIds(question)
  const currentIndex = Math.max(0, optionIds.indexOf(currentLabel ?? ''))
  const nextIndex = nextQuestionIndex(currentIndex, delta, optionIds.length)
  return optionIds[nextIndex]
}

export function selectQuestionOption(
  current: QuestionState,
  optionId: string,
  multiSelect: boolean,
  intent: 'focus' | 'toggle',
): QuestionState {
  if (optionId === CUSTOM_OPTION_ID) {
    const selected = multiSelect ? current.selected : []
    return {
      ...current,
      selected,
      focused: optionId,
      answered: Boolean(current.custom.trim()) || (multiSelect && selected.length > 0),
    }
  }

  if (multiSelect && intent === 'toggle') {
    const selected = current.selected.includes(optionId)
      ? current.selected.filter((item) => item !== optionId)
      : [...current.selected, optionId]
    return {
      ...current,
      selected,
      focused: optionId,
      answered: selected.length > 0 || Boolean(current.custom.trim()),
    }
  }

  return {
    ...current,
    selected: multiSelect ? current.selected : [optionId],
    custom: multiSelect ? current.custom : '',
    focused: optionId,
    answered: intent === 'toggle' ? true : multiSelect ? current.answered : false,
  }
}

export function buildAskUserQuestionAnswers(
  questions: AskUserQuestion[],
  questionStates: Record<string, QuestionState>,
  override?: { question: AskUserQuestion; state: QuestionState },
): Record<string, string> {
  const answers: Record<string, string> = {}
  for (const question of questions) {
    const state =
      override && questionKey(override.question) === questionKey(question)
        ? override.state
        : (questionStates[questionKey(question)] ??
          questionStates[question.question] ??
          initialQuestionState(question))
    const answerParts = state.skipped
      ? []
      : [
          ...state.selected.map(
            (id) => question.options.find((option) => questionOptionId(option) === id)?.label ?? id,
          ),
          ...(state.custom.trim() ? [state.custom.trim()] : []),
        ]
    answers[question.id ?? question.question] = answerParts.join(', ')
  }
  return answers
}

export function buildAskUserQuestionUpdatedInput(
  input: Record<string, unknown>,
  questions: AskUserQuestion[],
  questionStates: Record<string, QuestionState>,
): Record<string, unknown> {
  const answers = buildAskUserQuestionAnswers(questions, questionStates)
  const skippedQuestionIds = questions
    .filter((question) => questionStates[questionKey(question)]?.skipped)
    .map(questionKey)
  return {
    ...input,
    ...(questions.every((question) => question.options.every((option) => option.id))
      ? {
          questionAnswers: questions.map((question) => {
            const state = questionStates[questionKey(question)] ?? initialQuestionState(question)
            return {
              questionId: questionKey(question),
              choiceIds: state.skipped ? [] : state.selected,
              ...(state.skipped
                ? { skipped: true }
                : state.custom.trim()
                  ? { text: state.custom.trim() }
                  : {}),
            }
          }),
        }
      : {}),
    ...(questions.length === 1
      ? { answer: answers[questions[0]!.id ?? questions[0]!.question] ?? '' }
      : {}),
    answers,
    ...(skippedQuestionIds.length ? { skippedQuestionIds } : {}),
  }
}

export function hasQuestionAnswer(state: QuestionState | undefined): boolean {
  if (!state) return false
  return (
    !state.skipped && state.answered && (state.selected.length > 0 || Boolean(state.custom.trim()))
  )
}

function isQuestionComplete(state: QuestionState | undefined): boolean {
  return state?.skipped === true || hasQuestionAnswer(state)
}

export function shouldDeferAskUserQuestionShortcutToTextEntry(
  key: string,
  isTextEntry: boolean,
): boolean {
  return isTextEntry && key !== 'Escape'
}

export function parseAskUserQuestions(input: Record<string, unknown>): AskUserQuestion[] | null {
  const rawQuestions =
    Array.isArray(input.questions) && input.questions.length > 0 ? input.questions : null
  if (!rawQuestions) return null

  const questions: AskUserQuestion[] = []
  for (const rawQuestion of rawQuestions) {
    if (!isRecord(rawQuestion)) return null
    const question = stringValue(rawQuestion.question)
    const header = stringValue(rawQuestion.header)
    const rawOptions = rawQuestion.options
    if (!question || !Array.isArray(rawOptions) || rawOptions.length > 3 || rawOptions.length === 1)
      return null

    const options: AskUserQuestionOption[] = []
    for (const rawOption of rawOptions) {
      if (!isRecord(rawOption)) return null
      const label = normalizeRecommendedOptionLabel(stringValue(rawOption.label))
      const description = stringValue(rawOption.description) ?? ''
      if (!label) return null
      options.push({
        ...(typeof rawOption.id === 'string' ? { id: rawOption.id } : {}),
        label,
        description,
        ...(typeof rawOption.recommended === 'boolean'
          ? { recommended: rawOption.recommended }
          : /[（(](?:recommended|推荐)[）)]\s*$/iu.test(String(rawOption.label))
            ? { recommended: true }
            : {}),
      })
    }

    questions.push({
      id: typeof rawQuestion.id === 'string' ? rawQuestion.id : undefined,
      question,
      header: header ?? '',
      options,
      multiSelect: rawQuestion.multiSelect === true,
    })
  }
  return questions
}

function stringValue(value: unknown): string | null {
  return typeof value === 'string' ? value : null
}

function normalizeRecommendedOptionLabel(value: string | null): string | null {
  if (!value) return value
  return value.replace(/\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/iu, '').trim()
}
