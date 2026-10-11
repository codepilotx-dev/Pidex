import { AgentHarness } from '../src/orchestration/harness/AgentHarness'
import type { AgentTool } from '../src/orchestration/harness/AgentTypes'
import { InMemorySessionRepo } from './support/PiSessionMemory'
import {
  Type,
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type AssistantMessage,
  type Context,
  type ImageContent,
} from '@earendil-works/pi-ai'

async function createHarness(options?: {
  responses?: Parameters<ReturnType<typeof fauxProvider>['setResponses']>[0]
  tokensPerSecond?: number
  tools?: AgentTool[]
}) {
  const faux = fauxProvider({
    tokensPerSecond: options?.tokensPerSecond ?? 1_000,
    models: [{ id: 'bun-smoke', input: ['text', 'image'], contextWindow: 64_000 }],
  })
  faux.setResponses(options?.responses ?? [])
  const models = createModels()
  models.setProvider(faux.provider)
  const repo = new InMemorySessionRepo()
  const session = await repo.create({ id: crypto.randomUUID() })
  const harness = new AgentHarness({
    session,
    models,
    model: faux.getModel(),
    ...(options?.tools ? { tools: options.tools } : {}),
    systemPrompt: 'Bun compatibility smoke',
  })
  return { faux, harness, session }
}

function textOf(message: AssistantMessage): string {
  return message.content
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}

export async function smokeTextImageToolAndHook(): Promise<void> {
  let executeCount = 0
  let hookFinished = false
  let sawImage = false
  const echoParameters = Type.Object({ value: Type.String() })
  const tool: AgentTool<typeof echoParameters> = {
    name: 'echo',
    label: 'Echo',
    description: 'Echo input',
    parameters: echoParameters,
    execute: async (_toolCallId, input) => {
      executeCount += 1
      if (!hookFinished) throw new Error('tool_call hook was not awaited')
      return { content: [{ type: 'text', text: input.value }], details: {} }
    },
  }

  const { harness } = await createHarness({
    tools: [tool],
    responses: [
      (context: Context) => {
        const user = context.messages.find((message) => message.role === 'user')
        sawImage =
          user?.role === 'user' &&
          Array.isArray(user.content) &&
          user.content.some((part) => part.type === 'image' && part.mimeType === 'image/png')
        return fauxAssistantMessage(fauxToolCall('echo', { value: 'from-tool' }), {
          stopReason: 'toolUse',
        })
      },
      fauxAssistantMessage('streamed final text'),
    ],
  })

  const deltas: string[] = []
  harness.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      deltas.push(event.assistantMessageEvent.delta)
    }
  })
  harness.on('tool_call', async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 15))
    hookFinished = true
    return undefined
  })

  const image: ImageContent = { type: 'image', data: 'iVBORw0KGgo=', mimeType: 'image/png' }
  const result = await harness.prompt('inspect this image', { images: [image] })

  if (!sawImage) throw new Error('image input did not reach the faux provider')
  if (executeCount !== 1) throw new Error(`tool executed ${executeCount} times`)
  if (textOf(result) !== 'streamed final text') throw new Error('unexpected final response')
  if (deltas.join('') !== 'streamed final text') throw new Error('text deltas were not streamed')
}

export async function smokeAsyncToolBlock(): Promise<void> {
  let executeCount = 0
  let hookFinished = false
  const tool: AgentTool = {
    name: 'side_effect',
    label: 'Side effect',
    description: 'Must be blocked',
    parameters: Type.Object({}),
    execute: async () => {
      executeCount += 1
      return { content: [{ type: 'text', text: 'bad' }], details: {} }
    },
  }
  const { harness } = await createHarness({
    tools: [tool],
    responses: [
      fauxAssistantMessage(fauxToolCall('side_effect', {}), { stopReason: 'toolUse' }),
      fauxAssistantMessage('blocked safely'),
    ],
  })
  harness.on('tool_call', async () => {
    await new Promise<void>((resolve) => setTimeout(resolve, 15))
    hookFinished = true
    return { block: true, reason: 'denied by smoke policy' }
  })

  const result = await harness.prompt('try the side effect')
  if (!hookFinished) throw new Error('tool_call hook did not finish')
  if (executeCount !== 0) throw new Error('blocked tool executed')
  if (textOf(result) !== 'blocked safely') throw new Error('blocked flow did not continue')
}

export async function smokeSteerAndFollowUp(): Promise<void> {
  const observedUserTexts: string[][] = []
  const response = (label: string) => (context: Context) => {
    observedUserTexts.push(
      context.messages
        .filter((message) => message.role === 'user')
        .map((message) =>
          typeof message.content === 'string'
            ? message.content
            : message.content
                .filter((part) => part.type === 'text')
                .map((part) => part.text)
                .join(''),
        ),
    )
    return fauxAssistantMessage(label)
  }
  const { harness } = await createHarness({
    tokensPerSecond: 30,
    responses: [
      response('initial response with enough tokens'),
      response('steered'),
      response('followed up'),
    ],
  })
  let queued = false
  harness.subscribe(async (event) => {
    if (
      !queued &&
      event.type === 'message_update' &&
      event.assistantMessageEvent.type === 'text_delta'
    ) {
      queued = true
      await harness.steer('steer-now')
      await harness.followUp('follow-after')
    }
  })

  const result = await harness.prompt('initial')
  if (textOf(result) !== 'followed up') throw new Error('follow-up did not complete')
  if (!observedUserTexts[1]?.includes('steer-now'))
    throw new Error('steer message was not injected')
  if (!observedUserTexts[2]?.includes('follow-after'))
    throw new Error('follow-up message was not injected')
}

export async function smokeAbort(): Promise<void> {
  const { harness } = await createHarness({
    tokensPerSecond: 5,
    responses: [fauxAssistantMessage('this response is intentionally long enough to abort')],
  })
  let resolveFirstDelta: (() => void) | undefined
  const firstDelta = new Promise<void>((resolve) => {
    resolveFirstDelta = resolve
  })
  harness.subscribe((event) => {
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      resolveFirstDelta?.()
    }
  })

  const prompt = harness.prompt('abort me')
  await firstDelta
  await harness.abort()
  const result = await prompt
  if (result.stopReason !== 'aborted')
    throw new Error(`unexpected abort reason: ${result.stopReason}`)
}

export async function smokeCompaction(): Promise<void> {
  const { faux, harness, session } = await createHarness({
    responses: [fauxAssistantMessage('answer before compaction')],
  })
  await harness.prompt('history to compact')
  faux.setResponses([fauxAssistantMessage('compact summary')])
  const result = await harness.compact('keep compatibility facts')
  const compactions = await session.getStorage().findEntries('compaction')
  if (!result.summary.includes('compact summary')) throw new Error('summary was not generated')
  if (compactions.length !== 1) throw new Error('compaction entry was not persisted')
}

export async function runPiBunCompatibilitySmoke(): Promise<void> {
  await smokeTextImageToolAndHook()
  await smokeAsyncToolBlock()
  await smokeSteerAndFollowUp()
  await smokeAbort()
  await smokeCompaction()
}

if (import.meta.main) {
  await runPiBunCompatibilitySmoke()
  console.log('Pi AgentHarness Bun compatibility smoke passed')
}
