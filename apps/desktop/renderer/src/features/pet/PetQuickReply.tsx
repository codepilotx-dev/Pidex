import React from 'react'
import { Button } from '../../components/ui/Button.js'
import { Checkbox } from '../../components/ui/Checkbox.js'
import { RadioGroup, RadioItem } from '../../components/ui/RadioGroup.js'
import type { DesktopPermissionDecision, DesktopPermissionRequest } from '../../../shared/Types.js'
import {
  CUSTOM_OPTION_ID,
  buildAskUserQuestionUpdatedInput,
  hasQuestionAnswer,
  initialQuestionState,
  parseAskUserQuestions,
  selectQuestionOption,
  type AskUserQuestion,
  type QuestionState,
} from '../session/approvals/AskUserQuestionModel.js'

export type PetQuickReplyProps = {
  request: DesktopPermissionRequest
  disabled?: boolean
  onRespond: (
    request: DesktopPermissionRequest,
    decision: DesktopPermissionDecision,
  ) => void | Promise<void>
}

type QuickReplyAction = 'allow' | 'deny'

export function PetQuickReply({
  request,
  disabled = false,
  onRespond,
}: PetQuickReplyProps): React.ReactNode {
  const questions =
    request.toolName === 'AskUserQuestion' ? parseAskUserQuestions(request.input) : null
  const [questionStates, setQuestionStates] = React.useState<Record<string, QuestionState>>({})
  const [questionIndex, setQuestionIndex] = React.useState(0)
  const [action, setAction] = React.useState<QuickReplyAction>('allow')
  const [feedback, setFeedback] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const blocked = disabled || submitting

  React.useEffect(() => {
    setQuestionStates({})
    setQuestionIndex(0)
    setAction('allow')
    setFeedback('')
    setSubmitting(false)
    setError(null)
  }, [request.requestId])

  const respond = async (decision: DesktopPermissionDecision): Promise<void> => {
    if (blocked) return
    setSubmitting(true)
    setError(null)
    try {
      await onRespond(request, decision)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '提交失败，请重试。')
    } finally {
      setSubmitting(false)
    }
  }

  if (request.toolName === 'AskUserQuestion') {
    if (!questions) {
      return (
        <QuickReplyFrame error="无法解析问题，请打开任务后处理。">
          <Button
            color="secondary"
            disabled={blocked}
            type="button"
            onClick={() => void respond({ behavior: 'deny' })}
          >
            跳过
          </Button>
        </QuickReplyFrame>
      )
    }

    const question = questions[questionIndex] ?? questions[0]
    const canAdvance = hasQuestionAnswer(questionStates[question.question])
    const canSubmit = questions.every((question) =>
      hasQuestionAnswer(questionStates[question.question]),
    )
    const lastQuestion = questionIndex === questions.length - 1
    return (
      <QuickReplyFrame error={error}>
        <QuestionReply
          disabled={blocked}
          index={questionIndex}
          key={question.id ?? question.question}
          question={question}
          questionCount={questions.length}
          state={questionStates[question.question] ?? emptyQuestionState(question)}
          onChange={(state) => {
            setQuestionStates((current) => ({
              ...current,
              [question.question]: state,
            }))
            setError(null)
          }}
        />
        <div className="tw:flex tw:items-center tw:justify-end tw:gap-2">
          <Button
            color="secondary"
            disabled={blocked}
            type="button"
            onClick={() => void respond({ behavior: 'deny' })}
          >
            跳过
          </Button>
          {questionIndex > 0 ? (
            <Button
              color="secondary"
              disabled={blocked}
              type="button"
              onClick={() => setQuestionIndex((current) => current - 1)}
            >
              上一题
            </Button>
          ) : null}
          {lastQuestion ? (
            <Button
              color="primary"
              disabled={blocked || !canSubmit}
              type="button"
              onClick={() => {
                if (!canSubmit) {
                  setError('请先回答所有问题。')
                  return
                }
                void respond({
                  behavior: 'allow',
                  updatedInput: buildAskUserQuestionUpdatedInput(
                    request.input,
                    questions,
                    questionStates,
                  ),
                })
              }}
            >
              {submitting ? '提交中…' : '提交回答'}
            </Button>
          ) : (
            <Button
              color="primary"
              disabled={blocked || !canAdvance}
              type="button"
              onClick={() => setQuestionIndex((current) => current + 1)}
            >
              下一题
            </Button>
          )}
        </div>
      </QuickReplyFrame>
    )
  }

  return (
    <QuickReplyFrame error={error}>
      <p className="tw:type-body-sm tw:m-0 tw:text-app-text">
        {request.description || '是否允许这次操作？'}
      </p>
      <RadioGroup
        ariaLabel="权限决定"
        className="tw:grid tw:grid-cols-2 tw:gap-2"
        disabled={blocked}
        orientation="horizontal"
        value={action}
        onValueChange={(value) => {
          setAction(value as QuickReplyAction)
          setError(null)
        }}
      >
        <RadioItem label="允许一次" value="allow" variant="card" />
        <RadioItem label="拒绝" value="deny" variant="card" />
      </RadioGroup>
      {action === 'deny' ? (
        <textarea
          className="tw:type-control tw:min-h-16 tw:w-full tw:resize-y tw:border tw:border-app-border tw:bg-app-canvas tw:px-2.5 tw:py-2 tw:text-app-text tw:outline-none tw:focus:border-app-accent"
          disabled={blocked}
          placeholder="可选：说明拒绝原因"
          value={feedback}
          onChange={(event) => {
            setFeedback(event.target.value)
            setError(null)
          }}
        />
      ) : null}
      <Button
        color="primary"
        disabled={blocked}
        type="button"
        onClick={() => {
          const message = feedback.trim()
          void respond({
            behavior: action,
            ...(message ? { message, updatedInput: { feedback: message } } : {}),
          })
        }}
      >
        {submitting ? '提交中…' : '提交'}
      </Button>
    </QuickReplyFrame>
  )
}

function QuestionReply({
  question,
  index,
  questionCount,
  state,
  disabled,
  onChange,
}: {
  question: AskUserQuestion
  index: number
  questionCount: number
  state: QuestionState
  disabled: boolean
  onChange: (state: QuestionState) => void
}): React.ReactNode {
  return (
    <fieldset className="tw:m-0 tw:flex tw:min-w-0 tw:flex-col tw:gap-1.5 tw:border-0 tw:p-0">
      <legend className="tw:type-control tw:mb-1 tw:text-app-text">
        {question.header ? `${question.header} · ` : ''}
        {question.question}
        <span className="tw:type-caption tw:ml-1 tw:text-app-text-soft">
          {index + 1}/{questionCount}
        </span>
      </legend>
      {question.multiSelect ? (
        <>
          {question.options.map((option) => (
            <Checkbox
              checked={state.selected.includes(option.label)}
              disabled={disabled}
              key={option.label}
              onCheckedChange={() =>
                onChange(selectQuestionOption(state, option.label, true, 'toggle'))
              }
            >
              <span title={option.description}>{option.label}</span>
            </Checkbox>
          ))}
          <div className="tw:flex tw:items-start tw:gap-2">
            <Checkbox
              ariaLabel="使用自定义回答"
              checked={state.selected.includes(CUSTOM_OPTION_ID)}
              disabled={disabled}
              onCheckedChange={() =>
                onChange(selectQuestionOption(state, CUSTOM_OPTION_ID, true, 'toggle'))
              }
            />
            <CustomAnswerInput
              disabled={disabled}
              question={question}
              state={state}
              onChange={onChange}
            />
          </div>
        </>
      ) : (
        <RadioGroup
          ariaLabel={question.question}
          disabled={disabled}
          value={state.selected[0] ?? ''}
          onValueChange={(value) => onChange(selectQuestionOption(state, value, false, 'toggle'))}
        >
          {question.options.map((option) => (
            <RadioItem
              detail={option.description}
              key={option.label}
              label={option.label}
              value={option.label}
              variant="card"
            />
          ))}
          <div className="tw:flex tw:items-start tw:gap-2">
            <RadioItem ariaLabel="使用自定义回答" value={CUSTOM_OPTION_ID} />
            <CustomAnswerInput
              disabled={disabled}
              question={question}
              state={state}
              onChange={onChange}
            />
          </div>
        </RadioGroup>
      )}
    </fieldset>
  )
}

function emptyQuestionState(question: AskUserQuestion): QuestionState {
  return {
    ...initialQuestionState(question),
    selected: [],
  }
}

function CustomAnswerInput({
  question,
  state,
  disabled,
  onChange,
}: {
  question: AskUserQuestion
  state: QuestionState
  disabled: boolean
  onChange: (state: QuestionState) => void
}): React.ReactNode {
  return (
    <textarea
      aria-label={`${question.question}的自定义回答`}
      className="tw:type-control tw:min-h-14 tw:w-full tw:resize-y tw:border tw:border-app-border tw:bg-app-canvas tw:px-2.5 tw:py-2 tw:text-app-text tw:outline-none tw:focus:border-app-accent"
      disabled={disabled}
      placeholder="其他回答…"
      value={state.custom}
      onFocus={() =>
        onChange(selectQuestionOption(state, CUSTOM_OPTION_ID, question.multiSelect, 'focus'))
      }
      onChange={(event) => {
        const custom = event.target.value
        const next = selectQuestionOption(state, CUSTOM_OPTION_ID, question.multiSelect, 'focus')
        onChange({
          ...next,
          custom,
          answered: Boolean(custom.trim()) || (question.multiSelect && next.selected.length > 0),
        })
      }}
    />
  )
}

function QuickReplyFrame({
  children,
  error,
}: {
  children: React.ReactNode
  error: string | null
}): React.ReactNode {
  return (
    <div className="tw:flex tw:min-w-72 tw:max-w-96 tw:flex-col tw:gap-3">
      {children}
      {error ? (
        <p aria-live="polite" className="tw:type-caption tw:m-0 tw:text-app-danger" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}
