/**
 * FakePackagedAgent.ts — AgentRuntimeVerifier 测试用假打包 Agent。
 *
 * 通过 bun.exe 直接执行：bun scripts/fixtures/FakePackagedAgent.ts <mode>
 * 模式：ready | early-exit | timeout | bad-catalog
 */

import { serve } from 'bun'

const mode = process.argv[2] ?? 'ready'

if (mode === 'early-exit') {
  console.error('fake agent exiting before ready')
  process.exit(2)
}
if (mode === 'timeout') {
  await Bun.sleep(60_000)
  process.exit(0)
}

const server = serve({
  port: 0,
  async fetch(request) {
    const url = new URL(request.url)
    if (url.pathname === '/api/ready') {
      return Response.json({ ok: true })
    }
    if (url.pathname === '/rpc') {
      const body = (await request.json()) as { method?: string }
      if (body.method === 'initialize') {
        return Response.json({
          jsonrpc: '2.0',
          result: { connectionId: 'fake-connection' },
        })
      }
      if (body.method === 'provider/list') {
        if (mode === 'bad-catalog') {
          return Response.json({ jsonrpc: '2.0', result: { providers: [] } })
        }
        return Response.json({
          jsonrpc: '2.0',
          result: { providers: [{ id: 'pi', source: { type: 'pi' } }] },
        })
      }
      if (body.method === 'model/list') {
        return Response.json({
          jsonrpc: '2.0',
          result: {
            providers: [{ id: 'pi', models: [{ id: 'm1', api: { type: 'pi' } }] }],
          },
        })
      }
      return Response.json({ jsonrpc: '2.0', result: {} })
    }
    return new Response('not found', { status: 404 })
  },
})

console.log(JSON.stringify({ type: 'ready', url: `http://127.0.0.1:${server.port}` }))
setInterval(() => undefined, 60_000)
