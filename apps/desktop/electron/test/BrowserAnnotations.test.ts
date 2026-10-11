import { expect, test } from 'bun:test'
import { EventEmitter } from 'node:events'
import { BrowserAnnotations, requireBrowserAnnotation } from '../src/browser/BrowserAnnotations.js'
import type { DesktopBrowserAnnotationEvent } from '@pidex/shared/desktop-browser-ipc'

function fixture() {
  const commands: string[] = [],
    debuggerApi = new EventEmitter() as any
  let contextId = 10,
    current = true,
    failCapture = false
  debuggerApi.isAttached = () => true
  debuggerApi.sendCommand = async (name: string, params: any) => {
    commands.push(name === 'Runtime.evaluate' ? params.expression : name)
    if (name === 'Page.getFrameTree') return { frameTree: { frame: { id: 'main' } } }
    if (name === 'Page.createIsolatedWorld') return { executionContextId: ++contextId }
    return { result: { value: true } }
  }
  const contents = {
    id: 1,
    debugger: debuggerApi,
    isDestroyed: () => false,
    capturePage: async () => {
      commands.push('capture')
      if (failCapture) throw new Error('capture failed')
      return { isEmpty: () => false, toPNG: () => Buffer.from('image') }
    },
  } as any
  const events: DesktopBrowserAnnotationEvent[] = [],
    host = new BrowserAnnotations()
  const identity = { tabId: 'tab', generation: 'gen', documentId: 'doc' }
  return {
    commands,
    debuggerApi,
    contents,
    host,
    identity,
    events,
    current: () => current,
    invalidate: () => {
      current = false
    },
    fail: () => {
      failCapture = true
    },
  }
}

test('隔离上下文、binding 与交互身份拒绝伪造或迟到回调，截图始终恢复页面', async () => {
  const f = fixture()
  const started = await f.host.perform(
    f.contents,
    f.identity,
    { ...f.identity, operation: { action: 'start', mode: 'element', annotations: [], theme: {} } },
    f.current,
    (e) => f.events.push(e),
  )
  const bindingCommand = f.commands.find((c) => c.includes('cpxAnnotation_'))!
  const binding = bindingCommand.match(/cpxAnnotation_[a-z0-9]+/)![0]
  const event = { name: binding, executionContextId: 11, payload: '{"kind":"delete","id":"one"}' }
  f.debuggerApi.emit('message', {}, 'Runtime.bindingCalled', { ...event, executionContextId: 12 })
  f.debuggerApi.emit('message', {}, 'Runtime.bindingCalled', { ...event, name: 'wrong' })
  expect(f.events).toHaveLength(0)
  f.debuggerApi.emit('message', {}, 'Runtime.bindingCalled', event)
  expect(f.events[0]?.kind).toBe('delete')
  const input = {
    ...f.identity,
    interactionId: started.interactionId,
    operation: { action: 'capture' as const },
  }
  await expect(
    f.host.perform(
      f.contents,
      f.identity,
      { ...input, interactionId: 'wrong' },
      f.current,
      () => {},
    ),
  ).rejects.toThrow('失效')
  await f.host.perform(f.contents, f.identity, input, f.current, () => {})
  expect(f.commands.slice(-3)).toEqual([
    'globalThis.__cpxAnnotations.prepare()',
    'capture',
    'globalThis.__cpxAnnotations.restore()',
  ])
  f.fail()
  await expect(f.host.perform(f.contents, f.identity, input, f.current, () => {})).rejects.toThrow(
    'capture failed',
  )
  expect(f.commands.at(-1)).toBe('globalThis.__cpxAnnotations.restore()')
  f.invalidate()
  f.debuggerApi.emit('message', {}, 'Runtime.bindingCalled', event)
  expect(f.events).toHaveLength(1)
  await expect(f.host.perform(f.contents, f.identity, input, f.current, () => {})).rejects.toThrow(
    '失效',
  )
  f.host.stop(f.contents)
  expect(f.debuggerApi.listenerCount('message')).toBe(0)
})

test('批注接口拒绝任意脚本，导航和接管后拒绝旧文档及旧 generation', async () => {
  const f = fixture()
  expect(() =>
    requireBrowserAnnotation({ ...f.identity, operation: { action: 'execute', script: 'bad' } }),
  ).toThrow()
  const started = await f.host.perform(
    f.contents,
    f.identity,
    { ...f.identity, operation: { action: 'start', mode: 'text', annotations: [], theme: {} } },
    f.current,
    () => {},
  )
  for (const stale of [{ generation: 'old' }, { documentId: 'old' }])
    await expect(
      f.host.perform(
        f.contents,
        f.identity,
        {
          ...f.identity,
          ...stale,
          interactionId: started.interactionId,
          operation: { action: 'capture' },
        },
        f.current,
        () => {},
      ),
    ).rejects.toThrow('失效')
  f.host.stop(f.contents)
  await expect(
    f.host.perform(
      f.contents,
      f.identity,
      { ...f.identity, interactionId: started.interactionId, operation: { action: 'capture' } },
      f.current,
      () => {},
    ),
  ).rejects.toThrow('失效')
})
