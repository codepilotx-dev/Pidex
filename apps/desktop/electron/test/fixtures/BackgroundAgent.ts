import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'

let ticks = 0
const timer = setInterval(() => {
  void writeFile(join(process.env.PIDEX_TEST_RUNTIME_DIR!, 'ticks'), String(++ticks), 'utf8')
}, 30)
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: Number(process.env.PIDEX_PORT),
  fetch(request) {
    if (request.headers.get('Authorization') !== `Bearer ${process.env.PIDEX_AUTH_TOKEN}`)
      return new Response(null, { status: 401 })
    if (new URL(request.url).pathname === '/api/shutdown') {
      clearInterval(timer)
      setTimeout(() => { void server.stop(true); process.exit(0) }, 25)
      return Response.json({ ok: true })
    }
    return Response.json({ ok: true, pid: process.pid, instanceToken: process.env.PIDEX_SIDECAR_INSTANCE_TOKEN })
  },
})
// A failing test must not leave a detached fixture behind.
setTimeout(() => process.exit(1), 60_000)
