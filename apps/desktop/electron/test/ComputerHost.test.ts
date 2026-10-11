import { expect, test } from 'bun:test'
import type { ComputerAction, ComputerCommand } from '@pidex/agent-protocol'
import {
  matchesIssuedWindow,
  DesktopComputerController,
  type ComputerHostClient,
  nativeAction,
  toResult,
} from '../src/computer/DesktopComputerController'
import { CpxCuaRuntime, resolveCpxCuaExecutable } from '../src/computer/CpxCuaRuntime'
import type { DesktopLogger } from '../src/logging/DesktopLogger'

const logger: DesktopLogger = {
  directory: '',
  consoleEnabled: false,
  debug() {},
  info() {},
  warn() {},
  error() {},
  forwardConsoleLine() {},
}
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((yes, no) => {
    resolve = yes
    reject = no
  })
  return { promise, resolve, reject }
}
async function until(predicate: () => boolean) {
  const end = Date.now() + 2500
  while (!predicate() && Date.now() < end) await Bun.sleep(5)
  expect(predicate()).toBe(true)
}

test('运行时缺失时启动失败，不能标记为可用', async () => {
  const runtime = new CpxCuaRuntime(() => undefined, logger)
  await expect(runtime.start()).rejects.toThrow('未找到 CPX-CUA')
  runtime.stop()
})

test('握手完成前不报告就绪，原生调用挂起时停止仍能结束运行时且不回报迟到结果', async () => {
  type Next = { generation: string; enabled: boolean; command: ComputerCommand | null }
  const polls: Array<ReturnType<typeof deferred<Next>>> = []
  const registrations: boolean[] = []
  const completions: unknown[] = []
  const ready = deferred<void>()
  const native = deferred<never>()
  let starts = 0
  let calls = 0
  let stops = 0
  const rpc = {
    invalidate() {},
    async call(method: string, params: Record<string, unknown>) {
      if (method === 'computer/host/registerIdentity')
        registrations.push(params.available as boolean)
      if (method === 'computer/host/complete') completions.push(params)
      if (method === 'computer/host/next') {
        const poll = deferred<Next>()
        polls.push(poll)
        return poll.promise
      }
      return { ok: true }
    },
  } as unknown as ComputerHostClient
  const controller = new DesktopComputerController(
    {
      getSupervisor: () => undefined,
      resolveExecutable: () => undefined,
      logger,
    },
    {
      rpc,
      runtime: {
        start: () => {
          starts++
          return ready.promise
        },
        stop: () => {
          stops++
          if (calls) native.reject(new Error('stopped'))
        },
        callTool: () => {
          calls++
          return native.promise
        },
      },
    },
  )
  try {
    await controller.ensure()
    await until(() => polls.length > 0)
    polls.shift()!.resolve({ generation: 'generation:1', enabled: true, command: null })
    await until(() => starts > 0)
    expect(registrations).toEqual([false])
    ready.resolve()
    await until(() => registrations.includes(true) && polls.length > 0)
    polls.shift()!.resolve({
      generation: 'generation:1',
      enabled: true,
      command: {
        requestId: 'request:blocked',
        generation: 'generation:1',
        kind: 'list',
        session: 'session:1',
      },
    })
    await until(() => calls > 0 && polls.length > 0)
    const before = stops
    polls.shift()!.resolve({ generation: 'generation:2', enabled: true, command: null })
    await until(() => stops > before)
    expect(completions).toEqual([])
  } finally {
    controller.dispose()
    for (const poll of polls)
      poll.resolve({ generation: 'generation:2', enabled: false, command: null })
  }
}, 6000)

const APP = {
  appId: 'aumid:notepad',
  name: '记事本',
  pid: 42,
  windowId: '7',
  processKey: '1:2',
  identity: {
    kind: 'unsigned' as const,
    fingerprint: 'a'.repeat(64),
    legacyAppId: 'exe:notepad',
    sha256: 'a'.repeat(64),
  },
}
const command = (
  operation: ComputerAction,
  extra: Partial<ComputerCommand> = {},
): ComputerCommand =>
  ({
    requestId: 'request:1',
    generation: 'generation:1',
    kind: 'action',
    session: 'cpx-turn:1',
    window: { ref: 'window:1', ...APP },
    operation,
    ...extra,
  }) as ComputerCommand

/**
 * Properties each CPX-CUA tool declares, plus the identity pair the native
 * entry point injects. Native schemas are `additionalProperties: false`, so an
 * unlisted key is a hard rejection rather than an ignored extra.
 */
const NATIVE_PARAMS: Record<string, readonly string[]> = {
  click:
    'action button capture_id count delivery_mode element_token from_zoom modifier pid scope session target window_id x y',
  double_click: 'delivery_mode element_token from_zoom modifier pid session window_id x y',
  right_click: 'delivery_mode element_token from_zoom modifier pid session window_id x y',
  drag: 'button delivery_mode duration_ms from_x from_y from_zoom modifier pid scope session steps target to_x to_y window_id',
  type_text: 'delay_ms delivery_mode element_token pid scope session target text window_id x y',
  press_key: 'delivery_mode element_token key modifiers pid scope session target window_id x y',
  hotkey: 'delivery_mode element_token keys pid scope session target window_id x y',
  scroll: 'amount by delivery_mode direction element_token pid scope session target window_id x y',
}
const INJECTED = ['cpx_app_id', 'cpx_process_key', 'cpx_fingerprint', 'cpx_window_id']
const assertDeclared = ([name, args]: [string, Record<string, unknown>]) => {
  const declared = [...NATIVE_PARAMS[name]!.split(' '), ...INJECTED]
  expect(Object.keys(args).filter((key) => !declared.includes(key))).toEqual([])
}

const OPERATIONS: ComputerAction[] = [
  { action: 'click', elementToken: 's00000001:4', delivery: 'background' },
  { action: 'click', x: 10, y: 20, delivery: 'background' },
  { action: 'click', x: 10, y: 20, delivery: 'foreground' },
  { action: 'double_click', elementToken: 's00000001:4', delivery: 'background' },
  { action: 'double_click', x: 10, y: 20, delivery: 'background' },
  { action: 'right_click', x: 10, y: 20, delivery: 'background' },
  { action: 'type_text', elementToken: 's00000001:4', text: '你好', delivery: 'background' },
  { action: 'type_text', x: 10, y: 20, text: '你好', delivery: 'background' },
  { action: 'press_key', key: 'return', delivery: 'background' },
  { action: 'press_key', key: 'a', keys: ['ctrl'], delivery: 'background' },
  { action: 'hotkey', keys: ['ctrl', 'c'], delivery: 'background' },
  { action: 'scroll', direction: 'down', amount: 3, delivery: 'background' },
  { action: 'scroll', elementToken: 's00000001:4', direction: 'up', delivery: 'background' },
  { action: 'drag', x: 1, y: 2, endX: 3, endY: 4, delivery: 'foreground' },
]

test('窗口身份必须与宿主发放的引用完全一致', () => {
  expect(matchesIssuedWindow(APP, { ...APP })).toBe(true)
  // A recycled PID must not pass as the same application.
  expect(matchesIssuedWindow(APP, { ...APP, processKey: '1:3' })).toBe(false)
  expect(matchesIssuedWindow(APP, { ...APP, appId: 'aumid:calc' })).toBe(false)
  expect(matchesIssuedWindow(APP, { ...APP, pid: 43 })).toBe(false)
  expect(matchesIssuedWindow(APP, { ...APP, windowId: '8' })).toBe(false)
  expect(
    matchesIssuedWindow(APP, {
      ...APP,
      identity: { ...APP.identity, fingerprint: 'b'.repeat(64) },
    }),
  ).toBe(false)
})

test('每个操作只发送目标原生工具声明的字段', () => {
  for (const operation of OPERATIONS)
    assertDeclared(nativeAction(operation, command(operation, { captureId: 'capture:2' }), APP))
})

test('元素优先使用 token，坐标形式带窗口坐标与截图', () => {
  expect(
    nativeAction(
      { action: 'click', elementToken: 's00000001:4', delivery: 'background' },
      command({ action: 'click', elementToken: 's00000001:4', delivery: 'background' }),
      APP,
    ),
  ).toEqual([
    'click',
    {
      session: 'cpx-turn:1',
      pid: APP.pid,
      cpx_app_id: APP.appId,
      cpx_process_key: APP.processKey,
      cpx_fingerprint: APP.identity.fingerprint,
      cpx_window_id: APP.windowId,
      delivery_mode: 'background',
      element_token: 's00000001:4',
    },
  ])

  const coordinateClick = nativeAction(
    { action: 'click', x: 10, y: 20, delivery: 'foreground' },
    command({ action: 'click', x: 10, y: 20, delivery: 'foreground' }, { captureId: 'capture:2' }),
    APP,
  )
  expect(coordinateClick[1]).toEqual({
    session: 'cpx-turn:1',
    pid: APP.pid,
    cpx_app_id: APP.appId,
    cpx_process_key: APP.processKey,
    cpx_fingerprint: APP.identity.fingerprint,
    cpx_window_id: APP.windowId,
    delivery_mode: 'foreground',
    window_id: 7,
    x: 10,
    y: 20,
    capture_id: 'capture:2',
  })
})

test('拖拽只走坐标形式，元素 token 不会泄漏到原生拖拽参数', () => {
  const [name, args] = nativeAction(
    {
      action: 'drag',
      elementToken: 's00000001:4',
      x: 1,
      y: 2,
      endX: 3,
      endY: 4,
      delivery: 'foreground',
    },
    command({ action: 'drag', x: 1, y: 2, endX: 3, endY: 4, delivery: 'foreground' }),
    APP,
  )
  expect(name).toBe('drag')
  expect(args).toMatchObject({ from_x: 1, from_y: 2, to_x: 3, to_y: 4 })
  expect(args).not.toHaveProperty('element_token')
  expect(args.window_id).toBe(7)
})

test('没有截图时不带 capture_id，原生只对 click 做截图准入', () => {
  const [, click] = nativeAction(
    { action: 'click', x: 1, y: 2, delivery: 'foreground' },
    command({ action: 'click', x: 1, y: 2, delivery: 'foreground' }),
    APP,
  )
  expect(click).not.toHaveProperty('capture_id')
})

test('原生结果保留文本、错误码与截图，用于聊天与渲染', () => {
  const grounded = toResult({
    structuredContent: {
      elements: [{ element_token: 's00000001:4', role: 'button', label: '确定' }],
    },
  })
  expect(grounded.text).toContain('s00000001:4')
  expect(grounded.text).toContain('确定')
  expect(
    toResult({
      content: [
        { type: 'text', text: '窗口内容' },
        { type: 'image', data: 'AAAA', mimeType: 'image/png' },
      ],
    }),
  ).toEqual({ text: '窗口内容', images: [{ data: 'AAAA', mimeType: 'image/png' }] })

  expect(
    toResult({
      isError: true,
      content: [{ type: 'text', text: '后台不可用' }],
      structuredContent: { code: 'background_unavailable' },
    }),
  ).toEqual({ text: '后台不可用', isError: true, code: 'background_unavailable' })

  // The native runtime defaults a missing mime type to PNG.
  expect(toResult({ content: [{ type: 'image', data: 'AAAA' }] }).images).toEqual([
    { data: 'AAAA', mimeType: 'image/png' },
  ])
  expect(toResult({ structuredContent: {} }).text).toBe('操作已完成')
})

test('打包后从 resources/cua 解析运行时，开发态用 Cargo 输出', () => {
  expect(
    resolveCpxCuaExecutable({
      packaged: true,
      resourcesPath: 'C:\\app\\resources',
      moduleDirectory: 'C:\\repo\\apps\\desktop\\electron\\dist',
    }),
  ).toBe('C:\\app\\resources\\cua\\cpx-cua.exe')
  expect(
    resolveCpxCuaExecutable({
      packaged: false,
      resourcesPath: 'C:\\app\\resources',
      moduleDirectory: 'C:\\repo\\apps\\desktop\\electron\\dist',
    }),
  ).toBe('C:\\repo\\apps\\desktop\\native\\cpx-cua\\dist\\cpx-cua.exe')
})
