import { Effect } from 'effect'
import { Capabilities, decodeEventEnvelope } from '@pidex/agent-protocol'
import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createBootstrap } from '../src/Bootstrap'
import {
  createPlanSmokeModels,
  initializePlanSmokeDatabase,
  PLAN_SMOKE_STEPS,
  PLAN_SMOKE_TITLE,
} from './PlanSmokeFixture'

const dataDir = await mkdtemp(join(tmpdir(), 'pidex-pi-rpc-'))
const priorDataDir = process.env.PIDEX_DATA_DIR
const priorDesktopManaged = process.env.PIDEX_DESKTOP_MANAGED
process.env.PIDEX_DATA_DIR = dataDir
process.env.PIDEX_DESKTOP_MANAGED = '1'

const fixture = createPlanSmokeModels()
let runtime:
  Awaited<ReturnType<typeof Effect.runPromise<ReturnType<typeof createBootstrap>>>> | undefined

try {
  runtime = await Effect.runPromise(
    createBootstrap({
      models: fixture.models,
      initializeDatabase: initializePlanSmokeDatabase,
    }),
  )

  let requestSequence = 0
  let connectionId = ''
  const call = async (method: string, params: Record<string, unknown>) => {
    const response = await runtime!.app.request('http://agent.local/rpc', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(connectionId ? { 'x-pidex-connection-id': connectionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `smoke:${++requestSequence}`,
        method,
        params,
      }),
    })
    const payload = (await response.json()) as {
      result?: any
      error?: unknown
    }
    if (payload.error) {
      throw new Error(`${method}: ${JSON.stringify(payload.error)}`)
    }
    return payload.result
  }

  const initialized = await call('initialize', {
    clientInfo: {
      name: 'pi-plan-rpc-smoke',
      version: '1.0.0',
      platform: 'win32',
    },
    protocols: ['thread-rpc-v4'],
    capabilities: [...Capabilities],
    interactionDelivery: 'active',
  })
  connectionId = initialized.connectionId
  await runtime.app.request('http://agent.local/rpc', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-pidex-connection-id': connectionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialized',
      params: { protocol: 'thread-rpc-v4' },
    }),
  })

  const providers = (await call('provider/list', {})).providers as Array<{
    id: string
    auth: { apiKey: boolean; oauth: boolean }
  }>
  const smokeProvider = providers.find((provider) => provider.id === fixture.model.provider)
  if (!smokeProvider || !smokeProvider.auth.apiKey) {
    throw new Error(`Pi provider catalog mismatch: provider=${JSON.stringify(smokeProvider)}`)
  }

  const project = (
    await call('project/create', {
      primaryPath: resolve(import.meta.dir, '../../..'),
      operationId: crypto.randomUUID(),
    })
  ).project
  const created = await call('thread/create', {
    workspace: { kind: 'project', projectId: project.id },
    operationId: crypto.randomUUID(),
  })
  const threadId = created.snapshot.thread.id as string
  const subscription = await call('event/subscribe', {
    streams: [{ streamId: threadId, after: 'latest' }],
  })

  const eventTypes: string[] = []
  const strictPiEvents = new Set([
    'item/agentMessage/delta',
    'plan/delta',
    'reasoning/textDelta',
    'tool/outputDelta',
    'context/compacted',
  ])
  let terminalCount = 0
  const readSse = (async () => {
    const response = await runtime!.app.request(
      `http://agent.local/rpc/events?subscriptionId=${encodeURIComponent(subscription.subscriptionId)}&connectionId=${encodeURIComponent(connectionId)}`,
    )
    if (!response.ok || !response.body) {
      throw new Error(`SSE failed: ${response.status}`)
    }
    const reader = response.body.getReader()
    const decoder = new TextDecoder()
    let buffered = ''
    while (terminalCount < 2) {
      const next = await reader.read()
      if (next.done) break
      buffered += decoder.decode(next.value, { stream: true })
      const frames = buffered.split(/\r?\n\r?\n/)
      buffered = frames.pop() ?? ''
      for (const frame of frames) {
        const data = frame
          .split(/\r?\n/)
          .find((line) => line.startsWith('data:'))
          ?.slice(5)
          .trim()
        if (!data) continue
        const message = JSON.parse(data) as {
          method?: string
          params?: { event?: unknown }
        }
        const rawEnvelope =
          message.method === 'event/next' &&
          message.params?.event &&
          typeof message.params.event === 'object'
            ? (message.params.event as { type?: string })
            : null
        const envelope =
          rawEnvelope?.type && strictPiEvents.has(rawEnvelope.type)
            ? decodeEventEnvelope(rawEnvelope)
            : null
        const type = envelope?.type ?? rawEnvelope?.type
        if (!type) continue
        eventTypes.push(type)
        if (type === 'turn/completed') terminalCount += 1
      }
    }
    await reader.cancel().catch(() => undefined)
  })()

  const planTurn = await call('turn/start', {
    threadId,
    inputId: crypto.randomUUID(),
    content: '请输出 Plan 流程自动化测试方案。',
    model: {
      providerID: fixture.model.provider,
      id: fixture.model.id,
    },
    permissionConfig: DEFAULT_PERMISSION_CONFIG,
    taskMode: 'plan',
  })
  await waitFor(() => terminalCount >= 1, 'Plan turn 未完成')

  await call('turn/start', {
    threadId,
    inputId: crypto.randomUUID(),
    content: '请用 update_plan 执行两个验证步骤。',
    model: {
      providerID: fixture.model.provider,
      id: fixture.model.id,
    },
    permissionConfig: DEFAULT_PERMISSION_CONFIG,
    taskMode: 'chat',
  })
  await waitFor(() => terminalCount >= 2, 'Chat turn 未完成')

  await call('event/unsubscribe', {
    subscriptionId: subscription.subscriptionId,
  })
  await readSse

  for (const required of ['plan/delta', 'item/completed', 'turn/plan/updated', 'turn/completed']) {
    if (!eventTypes.includes(required)) {
      throw new Error(`RPC smoke 缺少事件 ${required}：${JSON.stringify(eventTypes)}`)
    }
  }

  const planItem = runtime.db.sqlite
    .query(
      `
    SELECT status, data
    FROM items
    WHERE thread_id = ? AND turn_id = ? AND type = 'plan'
    LIMIT 1
  `,
    )
    .get(threadId, planTurn.turnId) as {
    status: string
    data: string
  } | null
  const planData = planItem
    ? (JSON.parse(planItem.data) as {
        markdown?: string
      })
    : null
  if (
    planItem?.status !== 'completed' ||
    !planData?.markdown?.includes(PLAN_SMOKE_TITLE) ||
    planData.markdown.includes('<proposed_plan>')
  ) {
    throw new Error(`Plan item 持久化不符合预期：${JSON.stringify(planItem)}`)
  }

  const executionPlan = runtime.db.sqlite
    .query(
      `
    SELECT status, data
    FROM items
    WHERE thread_id = ? AND type = 'execution-plan'
    ORDER BY updated_at DESC
    LIMIT 1
  `,
    )
    .get(threadId) as {
    status: string
    data: string
  } | null
  const executionData = executionPlan
    ? (JSON.parse(executionPlan.data) as {
        steps?: Array<{ step: string; status: string }>
      })
    : null
  if (
    executionPlan?.status !== 'completed' ||
    executionData?.steps?.length !== 2 ||
    executionData.steps.some(
      (step, index) => step.step !== PLAN_SMOKE_STEPS[index] || step.status !== 'completed',
    )
  ) {
    throw new Error(`Execution plan 持久化不符合预期：${JSON.stringify(executionPlan)}`)
  }

  const durableMethods = (
    runtime.db.sqlite
      .query(
        `
      SELECT method
      FROM events
      WHERE thread_id = ?
      ORDER BY id
    `,
      )
      .all(threadId) as Array<{ method: string }>
  ).map((row) => row.method)
  for (const required of ['item/completed', 'turn/plan/updated']) {
    if (!durableMethods.includes(required)) {
      throw new Error(`数据库缺少持久事件 ${required}：${JSON.stringify(durableMethods)}`)
    }
  }

  const planInteractions = Number(
    (
      runtime.db.sqlite
        .query(
          `
      SELECT
        (SELECT COUNT(*) FROM approval_requests WHERE turn_id = ?)
        + (SELECT COUNT(*) FROM question_requests WHERE turn_id = ?)
        AS count
    `,
        )
        .get(planTurn.turnId, planTurn.turnId) as { count: number }
    ).count,
  )
  if (planInteractions !== 0) {
    throw new Error(`Plan turn 不应创建 interaction：count=${planInteractions}`)
  }

  await call('shutdown', { operationId: crypto.randomUUID() })
  process.stdout.write(
    'Plan RPC smoke passed: plan/delta、持久计划、Chat update_plan 2/2、无 Plan interaction\n',
  )
} finally {
  await runtime?.dispose()
  runtime?.db.close()
  if (priorDataDir === undefined) delete process.env.PIDEX_DATA_DIR
  else process.env.PIDEX_DATA_DIR = priorDataDir
  if (priorDesktopManaged === undefined) {
    delete process.env.PIDEX_DESKTOP_MANAGED
  } else {
    process.env.PIDEX_DESKTOP_MANAGED = priorDesktopManaged
  }
  await rm(dataDir, { recursive: true, force: true }).catch(() => undefined)
}

async function waitFor(condition: () => boolean, message: string): Promise<void> {
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline) {
    if (condition()) return
    await Bun.sleep(20)
  }
  throw new Error(message)
}
