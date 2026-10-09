import { Effect } from 'effect'
import { readFile } from 'node:fs/promises'
import { parse } from 'smol-toml'
import { createBootstrap } from '../src/Bootstrap'
import { createPlanSmokeModels, initializePlanSmokeDatabase } from './PlanSmokeFixture'

const live = process.env.PIDEX_PLAN_SMOKE_LIVE === '1'
const fixture = live ? null : createPlanSmokeModels()
let runtime:
  Awaited<ReturnType<typeof Effect.runPromise<ReturnType<typeof createBootstrap>>>> | undefined
let server: ReturnType<typeof Bun.serve> | undefined
let closing = false

try {
  runtime = await Effect.runPromise(
    createBootstrap(
      fixture
        ? {
            models: fixture.models,
            initializeDatabase: initializePlanSmokeDatabase,
          }
        : {},
    ),
  )
  if (live) await validateLiveConfiguration(runtime)

  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: runtime.app.fetch,
    idleTimeout: 120,
  })
  process.stdout.write(
    `${JSON.stringify({
      type: 'plan-smoke-ready',
      origin: `http://127.0.0.1:${server.port}`,
    })}\n`,
  )
} catch (cause) {
  process.stderr.write(`Plan smoke Agent 启动失败：${safeError(cause)}\n`)
  await dispose()
  process.exit(1)
}

const shutdown = () => {
  void dispose().finally(() => process.exit(0))
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

async function validateLiveConfiguration(current: NonNullable<typeof runtime>): Promise<void> {
  const document = parse(await readFile(current.config.storage.userConfig, 'utf8')) as Record<
    string,
    unknown
  >
  const providerID =
    typeof document.model_provider === 'string' ? document.model_provider.trim() : ''
  const modelID = typeof document.model === 'string' ? document.model.trim() : ''
  if (!providerID || !modelID) {
    throw new Error('真实模型测试缺少默认模型，请先在 Pidex 设置中选择默认模型')
  }

  const model = (await current.providers.models()).find(
    (candidate) =>
      String(candidate.providerID) === providerID &&
      String(candidate.id) === modelID &&
      candidate.enabled,
  )
  if (!model) {
    throw new Error(`真实模型测试的默认模型不可用：${providerID}/${modelID}`)
  }

  const provider = (await current.providers.list()).find(
    (candidate) => String(candidate.id) === providerID,
  )
  if (provider?.auth.apiKey) {
    const credential = current.db.sqlite
      .query(
        `
      SELECT c.id
      FROM credentials c
      WHERE c.integration_id = ? AND c.enabled = 1
      ORDER BY c.priority, c.created_at
      LIMIT 1
    `,
      )
      .get(providerID)
    if (!credential) {
      throw new Error(
        `真实模型测试缺少 ${providerID} 的有效凭据，请先在 Pidex 中连接该 Provider`,
      )
    }
  }
}

async function dispose(): Promise<void> {
  if (closing) return
  closing = true
  await server?.stop(true)
  await runtime?.dispose()
  runtime?.db.close()
}

function safeError(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
