import { expect, test } from 'bun:test'
import { Schema } from 'effect'
import { QUESTION_CHOICES_READ_MAX } from '@pidex/shared/thread'
import { RpcMethods } from '../src/methods/index'
import { decodeServerRequestResult } from '../src/wire/Interactions'

test('五题多选答案贯通待答列表、提交和完成回包，仍拒绝超限载荷', () => {
  const questions = Array.from({ length: 5 }, (_, index) => ({
    id: `q${index}`,
    header: '范围',
    prompt: '选择功能',
    choices: ['a', 'b', 'c'].map((id) => ({ id, label: id, description: id, recommended: false })),
    allowFreeform: true,
    required: true,
    minAnswers: 1,
    maxAnswers: 4,
  }))
  const pending = {
    interactions: [
      {
        interactionId: 'question-1',
        threadId: 'thread-1',
        turnId: 'turn-1',
        agentId: 'agent-1',
        createdAt: 1,
        version: 2,
        kind: 'question',
        questions,
      },
    ],
    nextCursor: null,
  }
  const decodePending = Schema.decodeUnknownSync(RpcMethods['interaction/listPending'].result)
  expect(decodePending(pending).interactions).toHaveLength(1)
  const response = {
    kind: 'question',
    status: 'answered',
    resolution: 'user',
    answers: questions.map(({ id }) => ({
      questionId: id,
      choiceIds: ['a', 'b', 'c'],
      text: '补充',
    })),
  } as const
  const params = { interactionId: 'question-1', expectedVersion: 2, operationId: 'op-1', response }
  const decode = Schema.decodeUnknownSync(RpcMethods['interaction/respond'].params)
  expect(decode(params).response).toEqual(response)
  expect(
    Schema.decodeUnknownSync(RpcMethods['interaction/respond'].result)({
      interactionId: 'question-1',
      kind: 'question',
      state: 'resolved',
      version: 3,
      resolvedAt: 2,
      response,
    }).response,
  ).toEqual(response)
  expect(decodeServerRequestResult('question/request', response)).toEqual(response)
  expect(() =>
    decode({
      ...params,
      response: { ...response, answers: [...response.answers, response.answers[0]] },
    }),
  ).toThrow()
  expect(() =>
    decode({
      ...params,
      response: {
        ...response,
        answers: [
          {
            questionId: 'q0',
            choiceIds: Array.from({ length: QUESTION_CHOICES_READ_MAX + 1 }, (_, i) => String(i)),
          },
        ],
      },
    }),
  ).toThrow()
  expect(() =>
    decodePending({
      ...pending,
      interactions: [{ ...pending.interactions[0], questions: [...questions, questions[0]] }],
    }),
  ).toThrow()
})
