import { expect, test } from 'bun:test'

test('请求 close 后仍可取消响应下载，空响应不构造非法 Response', async () => {
  // Isolate the Electron module mock from other main-process tests.
  const moduleUrl = new URL('../src/computer/CuaArtifactNetwork.ts', import.meta.url).href
  const electronModule = import.meta.resolve('electron')
  const child = Bun.spawn(
    [
      process.execPath,
      '-e',
      `
    import { mock } from 'bun:test'
    import { EventEmitter } from 'node:events'
    import assert from 'node:assert/strict'
    let request
    mock.module(${JSON.stringify(electronModule)}, () => ({ net: { request() {
      request = new EventEmitter()
      request.end = () => {}
      request.abort = () => { request.aborted = true }
      return request
    } } }))
    const { fetchCuaArtifact } = await import(${JSON.stringify(moduleUrl)})
    const controller = new AbortController()
    const pending = fetchCuaArtifact('https://github.com/test', { signal: controller.signal })
    const rejected = pending.then(() => false, () => true)
    request.emit('close')
    controller.abort()
    assert.equal(request.aborted, true)
    assert.equal(await rejected, true)
    const empty = fetchCuaArtifact('https://github.com/test', { signal: new AbortController().signal })
    const response = new EventEmitter()
    response.statusCode = 204
    request.emit('response', response)
    assert.equal((await empty).status, 204)
    const progress = []
    const downloading = fetchCuaArtifact('https://github.com/test', { signal: new AbortController().signal }, received => progress.push(received))
    const body = new EventEmitter()
    body.statusCode = 200
    request.emit('response', body)
    request.emit('close')
    body.emit('data', Buffer.from('abc'))
    body.emit('end')
    assert.deepEqual(progress, [3])
    assert.equal(await (await downloading).text(), 'abc')
  `,
    ],
    { stdout: 'pipe', stderr: 'pipe' },
  )
  try {
    const [code, stderr] = await Promise.all([child.exited, new Response(child.stderr).text()])
    expect(stderr).toBe('')
    expect(code).toBe(0)
  } finally {
    child.kill()
  }
})
