import { expect, test } from 'bun:test'
import type { SidecarSupervisor } from '../src/sidecar/Supervisor'
import { BrowserHostRpcClient } from '../src/browser/BrowserHostRpcClient'

test('browser host completes one notification handshake before concurrent requests', async () => {
  const requests: Array<{ body: any; headers: RequestInit['headers'] }> = []
  let finish!: () => void
  let notified!: () => void
  const notification = new Promise<void>((resolve) => {
    notified = resolve
  })
  const pending = new Promise<void>((resolve) => {
    finish = resolve
  })
  const supervisor = {
    request: async (_path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      requests.push({ body, headers: init.headers })
      if (body.method === 'initialize')
        return Response.json({
          result: {
            connectionId: 'browser:1',
            capabilities: ['browser.host.v1', 'browser.manage.v1'],
          },
        })
      if (body.method === 'initialized') {
        notified()
        await pending
        return new Response(null, { status: 204 })
      }
      return Response.json({ result: { tabs: [], permissions: [] } })
    },
  } as unknown as SidecarSupervisor
  const client = new BrowserHostRpcClient(() => supervisor)
  const calls = Promise.all([client.call('browser/list', {}), client.call('browser/list', {})])
  await notification
  expect(requests.map(({ body }) => body.method)).toEqual(['initialize', 'initialized'])
  expect(requests[1]!.body).not.toHaveProperty('id')
  expect(requests[1]!.headers).toMatchObject({ 'X-Pidex-Connection-ID': 'browser:1' })
  finish()
  expect(await calls).toEqual([
    { tabs: [], permissions: [] },
    { tabs: [], permissions: [] },
  ])
  const count = requests.length
  await expect(client.call('browser/preferences/get', {})).rejects.toThrow('未提供此浏览器能力')
  expect(requests).toHaveLength(count)
})

test('failed browser handshake is not retained as a ready connection', async () => {
  let initialization = 0
  const supervisor = {
    request: async (_path: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body))
      if (body.method === 'initialize') {
        initialization++
        return Response.json({
          result: {
            connectionId: `browser:${initialization}`,
            capabilities: ['browser.host.v1', 'browser.manage.v1'],
          },
        })
      }
      if (body.method === 'initialized')
        return new Response(null, { status: initialization === 1 ? 401 : 204 })
      return Response.json({ result: { tabs: [], permissions: [] } })
    },
  } as unknown as SidecarSupervisor
  const client = new BrowserHostRpcClient(() => supervisor)
  await expect(client.call('browser/list', {})).rejects.toThrow('无法完成')
  expect(client.capabilities.size).toBe(0)
  await expect(client.call('browser/list', {})).resolves.toEqual({ tabs: [], permissions: [] })
  expect(initialization).toBe(2)
})
