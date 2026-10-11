import { Effect } from 'effect'
import { bootstrap } from './Bootstrap'
import { resolveAgentLogDirectory } from './config/Config'
import { AgentLogger } from './observability/AgentLogger'

export async function startAgentServer(): Promise<void> {
  const fallbackLogger = new AgentLogger(resolveAgentLogDirectory())
  const runtime = await Effect.runPromise(bootstrap).catch((cause) => {
    fallbackLogger.error('agent.startup-failed', {
      error: cause instanceof Error ? cause.message : String(cause),
    })
    throw cause
  })
  const server = Bun.serve({
    hostname: runtime.config.host,
    port: runtime.config.port,
    fetch: runtime.app.fetch,
    idleTimeout: 120,
  })
  runtime.config.port = server.port ?? runtime.config.port

  const url = `http://${server.hostname}:${server.port}`
  runtime.logger.info('agent.started', {
    host: server.hostname,
    port: server.port,
    pid: process.pid,
  })
  const instanceToken =
    process.env.PIDEX_DESKTOP_MANAGED === '1' ? process.env.PIDEX_SIDECAR_INSTANCE_TOKEN : undefined
  process.stdout.write(
    `${JSON.stringify({ type: 'ready', port: server.port, url, ...(instanceToken ? { instanceToken } : {}) })}\n`,
  )

  let closing = false
  const shutdown = async (exitCode = 0) => {
    if (closing) return
    closing = true
    runtime.logger.info('agent.stopping', { exitCode })
    await server.stop(true)
    await runtime.dispose()
    runtime.db.close()
    process.exit(exitCode)
  }

  process.once('SIGINT', shutdown)
  process.once('SIGTERM', shutdown)
  process.once('uncaughtException', (cause) => {
    runtime.logger.error('process.uncaught-exception', {
      error: cause instanceof Error ? cause.message : String(cause),
      stack: cause instanceof Error ? cause.stack : undefined,
    })
    void shutdown(1)
  })
  process.once('unhandledRejection', (cause) => {
    runtime.logger.error('process.unhandled-rejection', {
      error: cause instanceof Error ? cause.message : String(cause),
      stack: cause instanceof Error ? cause.stack : undefined,
    })
    void shutdown(1)
  })
}
