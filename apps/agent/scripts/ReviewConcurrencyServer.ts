import { Effect } from 'effect'
import { createBootstrap } from '../src/Bootstrap'
import {
  createReviewConcurrencyModels,
  initializeReviewConcurrencyDatabase,
} from './ReviewConcurrencyFixture'

const fixture = createReviewConcurrencyModels()
const reviewEvents: Array<
  | { type: 'git'; args: readonly string[] }
  | {
      type: 'rpc'
      method: string
      generation?: string
      path?: string
    }
> = []
let runtime:
  Awaited<ReturnType<typeof Effect.runPromise<ReturnType<typeof createBootstrap>>>> | undefined
let server: ReturnType<typeof Bun.serve> | undefined
let closing = false
let exposeBatchCapability = true
let activeFileDiffRequests = 0
let maxActiveFileDiffRequests = 0

try {
  runtime = await Effect.runPromise(
    createBootstrap({
      models: fixture.models,
      initializeDatabase: initializeReviewConcurrencyDatabase,
      onReviewGitCommand: (args) => {
        reviewEvents.push({ type: 'git', args: [...args] })
      },
    }),
  )
  server = Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    fetch: async (request) => {
      const url = new URL(request.url)
      if (request.method === 'GET' && url.pathname === '/__review-concurrency/events') {
        return Response.json({
          events: reviewEvents,
          maxActiveFileDiffRequests,
        })
      }
      if (request.method === 'DELETE' && url.pathname === '/__review-concurrency/events') {
        reviewEvents.length = 0
        activeFileDiffRequests = 0
        maxActiveFileDiffRequests = 0
        return Response.json({ ok: true })
      }
      if (request.method === 'POST' && url.pathname === '/__review-concurrency/batch-capability') {
        const input = (await request.json().catch(() => null)) as {
          enabled?: unknown
        } | null
        if (typeof input?.enabled !== 'boolean') {
          return Response.json({ error: 'invalid capability input' }, { status: 400 })
        }
        exposeBatchCapability = input.enabled
        return Response.json({ enabled: exposeBatchCapability })
      }
      if (request.method === 'POST' && url.pathname === '/__review-concurrency/seed-history') {
        const input = (await request.json()) as {
          threadId?: unknown
          count?: unknown
        }
        if (
          typeof input.threadId !== 'string' ||
          !Number.isInteger(input.count) ||
          Number(input.count) < 1 ||
          Number(input.count) > 500
        ) {
          return Response.json({ error: 'invalid seed input' }, { status: 400 })
        }
        const count = Number(input.count)
        for (let index = 0; index < count; index += 1) {
          const turn = runtime!.db.createTurn(
            input.threadId,
            {
              content: `[review-history] 历史压力回合 ${index + 1}`,
              model: { providerID: 'openai', id: 'faux-1' },
              permissionConfig: {
                sandboxMode: 'danger-full-access',
                approvalPolicy: 'never',
                approvalsReviewer: 'user',
              },
              strategy: 'queue',
              taskMode: 'chat',
            },
            'running',
          )
          runtime!.db.finalizeTurn({
            threadID: input.threadId,
            turnID: turn.turnID,
            agentID: turn.agentID,
            status: 'completed',
          })
        }
        return Response.json({ seeded: count })
      }
      if (request.method === 'POST' && url.pathname === '/rpc') {
        const payload = (await request
          .clone()
          .json()
          .catch(() => null)) as {
          method?: unknown
          params?: {
            generation?: unknown
            path?: unknown
          }
        } | null
        if (typeof payload?.method === 'string' && payload.method.startsWith('review/')) {
          reviewEvents.push({
            type: 'rpc',
            method: payload.method,
            ...(typeof payload.params?.generation === 'string'
              ? { generation: payload.params.generation }
              : {}),
            ...(typeof payload.params?.path === 'string' ? { path: payload.params.path } : {}),
          })
        }
        const tracksFileDiff = payload?.method === 'review/fileDiff'
        if (tracksFileDiff) {
          activeFileDiffRequests += 1
          maxActiveFileDiffRequests = Math.max(maxActiveFileDiffRequests, activeFileDiffRequests)
        }
        try {
          const response = await runtime!.app.fetch(request)
          if (payload?.method !== 'initialize' || exposeBatchCapability) {
            return response
          }
          const body = (await response.json()) as {
            result?: { capabilities?: unknown }
          }
          if (Array.isArray(body.result?.capabilities)) {
            body.result.capabilities = body.result.capabilities.filter(
              (capability) => capability !== 'git.review.batch.v1',
            )
          }
          const headers = new Headers(response.headers)
          headers.delete('content-length')
          headers.set('content-type', 'application/json')
          return new Response(JSON.stringify(body), {
            status: response.status,
            headers,
          })
        } finally {
          if (tracksFileDiff) activeFileDiffRequests -= 1
        }
      }
      return runtime!.app.fetch(request)
    },
    idleTimeout: 120,
  })
  process.stdout.write(
    `${JSON.stringify({
      type: 'review-concurrency-ready',
      origin: `http://127.0.0.1:${server.port}`,
    })}\n`,
  )
} catch (cause) {
  process.stderr.write(`Review concurrency Agent 启动失败：${safeError(cause)}\n`)
  await dispose()
  process.exit(1)
}

const shutdown = () => {
  void dispose().finally(() => process.exit(0))
}
process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)

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
