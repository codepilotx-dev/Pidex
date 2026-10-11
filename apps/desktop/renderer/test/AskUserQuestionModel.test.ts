import { describe, expect, test } from 'bun:test'
import {
  buildAskUserQuestionAnswers,
  buildAskUserQuestionUpdatedInput,
  canSubmitFromCurrentQuestion,
  firstUnansweredQuestionIndex,
  initialQuestionState,
  hasQuestionAnswer,
  parseAskUserQuestions,
  selectQuestionOption,
  shouldShowQuestionSubmit,
  type QuestionState,
  questionDrafts,
  reconcileQuestionDrafts,
  nextQuestionIndex,
} from '../src/features/session/approvals/AskUserQuestionModel'

const input = {
  questions: [
    {
      id: 'editor',
      header: '编辑器',
      question: '选择编辑器',
      options: [
        { label: 'VS Code (Recommended)', description: '使用 VS Code' },
        { label: 'Zed', description: '使用 Zed' },
      ],
      multiSelect: false,
    },
    {
      id: 'features',
      header: '功能',
      question: '选择功能',
      options: [
        { label: '格式化', description: '自动格式化' },
        { label: '检查', description: '运行类型检查' },
      ],
      multiSelect: true,
    },
  ],
}

test('keeps options without descriptions without inventing explanatory text', () => {
  const questions = parseAskUserQuestions({
    questions: [
      { question: '如何继续？', options: [{ label: '继续' }, { label: '调整', description: '' }] },
    ],
  })
  expect(questions?.[0]?.options).toEqual([
    { label: '继续', description: '' },
    { label: '调整', description: '' },
  ])
})

describe('AskUserQuestion pure model', () => {
  test('纯文本问题、重复选项文案和显式推荐使用结构化 ID', () => {
    const questions = parseAskUserQuestions({
      questions: [
        { id: 'text', question: '补充', options: [] },
        {
          id: 'choice',
          question: '选择',
          options: [
            { id: 'a', label: '同名', recommended: false },
            { id: 'b', label: '同名', recommended: true },
          ],
        },
      ],
    })!
    expect(initialQuestionState(questions[0]!)).toMatchObject({ selected: [] })
    expect(canSubmitFromCurrentQuestion(questions, {}, 1)).toBe(false)
    const states = {
      text: { selected: [], custom: '回答', answered: false },
      choice: { selected: ['b'], custom: '', answered: false },
    }
    expect(buildAskUserQuestionUpdatedInput({}, questions, states).questionAnswers).toEqual([
      { questionId: 'text', choiceIds: [], text: '回答' },
      { questionId: 'choice', choiceIds: ['b'] },
    ])
    expect(questions[1]?.options.map((option) => option.recommended)).toEqual([false, true])
  })
  test('草稿隔离聊天和版本，翻题仅变更题号，失效请求清除草稿', () => {
    const states = { q: { selected: ['a'], custom: '', answered: false } }
    questionDrafts.set('thread:a:req:1', { states, index: 0 })
    questionDrafts.set('thread:b:req:1', { states: {}, index: 0 })
    const draft = questionDrafts.get('thread:a:req:1')!
    draft.index = nextQuestionIndex(draft.index, 1, 3)
    expect(draft.states).toEqual(states)
    expect(draft.index).toBe(1)
    reconcileQuestionDrafts('thread:a', new Set(['thread:a:req:2']))
    expect(questionDrafts.has('thread:a:req:1')).toBe(false)
    expect(questionDrafts.has('thread:b:req:1')).toBe(true)
    questionDrafts.delete('thread:b:req:1')
  })
  test('末题显式提交，其他页仅自定义或编辑后的多选显示提交', () => {
    const [single, multi] = parseAskUserQuestions(input)!
    const draft = initialQuestionState(single!)
    expect(shouldShowQuestionSubmit([single!], {}, 0)).toBe(true)
    expect(shouldShowQuestionSubmit([single!], { editor: { ...draft, answered: true } }, 0)).toBe(
      true,
    )
    expect(
      shouldShowQuestionSubmit(
        [single!],
        { editor: { ...draft, selected: [], custom: '说明' } },
        0,
      ),
    ).toBe(true)
    expect(
      shouldShowQuestionSubmit([single!], { editor: { ...draft, selected: [], custom: '  ' } }, 0),
    ).toBe(true)
    expect(shouldShowQuestionSubmit([multi!], {}, 0)).toBe(true)
    expect(shouldShowQuestionSubmit([multi!], { features: { ...draft, touched: true } }, 0)).toBe(
      true,
    )
    expect(
      shouldShowQuestionSubmit(
        [multi!],
        { features: { ...draft, selected: [], touched: true } },
        0,
      ),
    ).toBe(true)
    expect(shouldShowQuestionSubmit([single!, multi!], {}, 1)).toBe(true)
    const confirmed = { editor: { ...draft, answered: true } }
    expect(shouldShowQuestionSubmit([single!, multi!], confirmed, 0)).toBe(false)
    expect(shouldShowQuestionSubmit([single!, multi!], confirmed, 1)).toBe(true)
    expect(
      shouldShowQuestionSubmit([single!, multi!], { editor: { ...draft, answered: false } }, 1),
    ).toBe(true)
    expect(
      shouldShowQuestionSubmit(
        [single!, multi!],
        { editor: { ...draft, selected: [], custom: '自定义' } },
        0,
      ),
    ).toBe(true)
  })

  test('explicit skips complete a question without an answer or default selection', () => {
    const questions = parseAskUserQuestions(input)!
    const skipped: QuestionState = { selected: [], custom: '', answered: false, skipped: true }
    const states = { editor: skipped, features: { selected: ['检查'], custom: '', answered: true } }
    expect(hasQuestionAnswer(skipped)).toBe(false)
    expect(firstUnansweredQuestionIndex(questions, states)).toBe(-1)
    expect(buildAskUserQuestionUpdatedInput(input, questions, states)).toMatchObject({
      answers: { editor: '', features: '检查' },
      skippedQuestionIds: ['editor'],
    })
    expect(firstUnansweredQuestionIndex(questions, { editor: skipped })).toBe(1)
  })

  test('同名问题按 ID 独立，有效默认草稿可一起提交', () => {
    const questions = parseAskUserQuestions({
      questions: [input.questions[0], { ...input.questions[0], id: 'second-editor' }],
    })!
    const states = { editor: { ...initialQuestionState(questions[0]!), answered: true } }
    expect(firstUnansweredQuestionIndex(questions, states)).toBe(1)
    expect(canSubmitFromCurrentQuestion(questions, states, 0)).toBe(true)
    expect(canSubmitFromCurrentQuestion(questions, states, 1)).toBe(true)
    expect(
      buildAskUserQuestionAnswers(questions, {
        ...states,
        'second-editor': { selected: ['Zed'], custom: '', answered: true },
      }),
    ).toEqual({ editor: 'VS Code', 'second-editor': 'Zed' })
  })

  test('parses single and multi questions while normalizing recommended labels', () => {
    expect(parseAskUserQuestions(input)).toEqual([
      {
        id: 'editor',
        header: '编辑器',
        question: '选择编辑器',
        options: [
          { label: 'VS Code', description: '使用 VS Code', recommended: true },
          { label: 'Zed', description: '使用 Zed' },
        ],
        multiSelect: false,
      },
      {
        id: 'features',
        header: '功能',
        question: '选择功能',
        options: [
          { label: '格式化', description: '自动格式化' },
          { label: '检查', description: '运行类型检查' },
        ],
        multiSelect: true,
      },
    ])
    expect(parseAskUserQuestions({ questions: [] })).toBeNull()
    expect(
      parseAskUserQuestions({
        questions: [{ question: '无效', options: [{ label: 'A' }] }],
      }),
    ).toBeNull()
  })

  test('builds stable answer maps for multiple questions and custom text', () => {
    const questions = parseAskUserQuestions(input)!
    const states: Record<string, QuestionState> = {
      选择编辑器: {
        selected: ['Zed'],
        custom: '',
        answered: true,
      },
      选择功能: {
        selected: ['格式化', '检查'],
        custom: '生成报告',
        answered: true,
      },
    }
    expect(buildAskUserQuestionAnswers(questions, states)).toEqual({
      editor: 'Zed',
      features: '格式化, 检查, 生成报告',
    })
    expect(buildAskUserQuestionUpdatedInput(input, questions, states)).toEqual({
      ...input,
      answers: {
        editor: 'Zed',
        features: '格式化, 检查, 生成报告',
      },
    })
  })

  test('keeps option selection semantics shared by main session and pet reply', () => {
    const initial: QuestionState = {
      selected: ['格式化'],
      custom: '',
      answered: false,
    }
    const selected = selectQuestionOption(initial, '检查', true, 'toggle')
    expect(selected).toMatchObject({
      selected: ['格式化', '检查'],
      answered: true,
    })
    const custom = selectQuestionOption(selected, '__custom', true, 'focus')
    expect(custom.selected).toEqual(['格式化', '检查'])
    expect(hasQuestionAnswer({ ...custom, custom: '生成报告', answered: true })).toBe(true)
  })

  test('adds the legacy single answer field for one-question submissions', () => {
    const questions = parseAskUserQuestions({
      questions: [input.questions[0]],
    })!
    const states = {
      选择编辑器: {
        selected: ['VS Code'],
        custom: '',
        answered: true,
      },
    }
    expect(
      buildAskUserQuestionUpdatedInput({ questions: [input.questions[0]] }, questions, states),
    ).toMatchObject({
      answer: 'VS Code',
      answers: { editor: 'VS Code' },
    })
  })
})
