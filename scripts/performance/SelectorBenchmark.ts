import {
  createCanonicalThreadState,
  createRenderTurnEntriesSelector,
  type ThreadHistoryPageLike,
} from '../../packages/session-view/src/canonical/index.js'
import type { AgentExecution, Input, Item, Thread, Turn } from '@pidex/shared/thread'
import { mkdir, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { PerformanceSample } from './Metrics.js'

const permissionConfig = {
  sandboxMode: 'workspace-write',
  approvalPolicy: 'on-request',
  approvalsReviewer: 'user',
} as const
const model = { providerID: 'openai', id: 'performance' }

const short = benchmark(100)
const long = benchmark(500)
const batch = Math.max(1, Number.parseInt(process.env.PIDEX_PERF_BATCH ?? '1', 10) || 1)
const sample: PerformanceSample = {
  batch,
  environment: {
    platform: process.platform,
    runtime: `bun-${Bun.version}`,
  },
  metrics: {
    growthFactor: long.median / Math.max(0.001, short.median),
    selectorP95Ms: long.p95,
  },
  sample: 1,
  scenario: 'selector',
  suite: 'renderer',
  timestamp: new Date().toISOString(),
}
const outputDirectory = resolve(import.meta.dirname, '../../performance-results/raw/renderer')
await mkdir(outputDirectory, { recursive: true })
await writeFile(
  resolve(outputDirectory, `selector-b${batch}-s1.json`),
  `${JSON.stringify(sample, null, 2)}\n`,
  'utf8',
)

function benchmark(turnCount: number): { median: number; p95: number } {
  const state = createCanonicalThreadState(page(turnCount))
  const selector = createRenderTurnEntriesSelector()
  for (let warmup = 0; warmup < 10; warmup += 1) selector(state)
  const values: number[] = []
  for (let sampleIndex = 0; sampleIndex < 30; sampleIndex += 1) {
    const startedAt = performance.now()
    selector(state)
    values.push(performance.now() - startedAt)
  }
  values.sort((left, right) => left - right)
  return {
    median: values[Math.ceil(values.length * 0.5) - 1]!,
    p95: values[Math.ceil(values.length * 0.95) - 1]!,
  }
}

function page(turnCount: number): ThreadHistoryPageLike {
  const thread: Thread = {
    id: `selector-${turnCount}`,
    title: 'Selector benchmark',
    projectID: null,
    gitBranch: null,
    settings: { taskMode: 'chat', permissionConfig },
    createdAt: 1,
    updatedAt: turnCount,
  }
  return {
    thread,
    subagents: [],
    turns: Array.from({ length: turnCount }, (_, turnIndex) => {
      const id = `turn-${turnIndex}`
      const turn: Turn = {
        id,
        threadId: thread.id,
        sourceInputID: `input-${id}`,
        status: 'completed',
        mode: 'chat',
        model,
        permissionConfig,
        rootAgentId: `agent-${id}`,
        mergedInputIDs: [],
        startedAt: turnIndex,
        finishedAt: turnIndex + 1,
        elapsedSeconds: 1,
        error: null,
      }
      const input: Input = {
        id: `input-${id}`,
        threadId: thread.id,
        turnId: id,
        content: `Input ${turnIndex}`,
        delivery: 'start',
        mode: 'chat',
        model,
        permissionConfig,
        state: 'completed',
        attachmentIds: [],
        createdAt: turnIndex,
      }
      const agent: AgentExecution = {
        id: `agent-${id}`,
        threadId: thread.id,
        turnId: id,
        parentAgentId: null,
        profile: 'main',
        task: input.content,
        model,
        sessionId: `session-${id}`,
        depth: 0,
        status: 'completed',
        error: null,
        subagentRunId: null,
        runSequence: 0,
        createdAt: turnIndex,
        updatedAt: turnIndex + 1,
      }
      const items: Item[] = Array.from({ length: 10 }, (_, itemIndex) => ({
        id: `item-${turnIndex}-${itemIndex}`,
        messageID: `message-${turnIndex}-${itemIndex}`,
        turnId: id,
        agentId: agent.id,
        type: 'text',
        placement: itemIndex === 0 ? 'process' : 'result',
        text: `Item ${turnIndex}:${itemIndex}`,
        status: 'completed',
        ordinal: itemIndex,
        createdAt: turnIndex * 10 + itemIndex,
      }))
      return {
        turn,
        inputs: [input],
        messages: [],
        agents: [agent],
        items,
        approvals: [],
        attachments: [],
      }
    }),
    queue: { version: 0, pauseReason: null, turns: [], inputs: [] },
    olderCursor: null,
    hasOlder: false,
    streamPosition: { streamId: thread.id, sequence: 0 },
  }
}
