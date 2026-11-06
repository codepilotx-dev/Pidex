import { isUint8Array } from 'node:util/types'
import { createContext, Script, type Context } from 'node:vm'
import type { ComputerAction, ComputerResult } from '@pidex/agent-protocol'
import type { NodeReplChildMessage, NodeReplHostMessage, NodeReplImage } from './Protocol'

/** Transport used by the child runtime; injected so it is testable without spawning. */
export type NodeReplChildTransport = {
  send(message: NodeReplChildMessage): void
  next(): Promise<NodeReplHostMessage | null>
  /** 结束本单元格的读取循环；迟到的帧不再进入脚本。 */
  close?(): void
}

/** Transport failures surface to the script as typed errors, never silent successes. */
export class NodeReplCallError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message)
    this.name = 'NodeReplCallError'
  }
}

/** 一次调用（单元格）的状态；迟到的回调只在它自己的单元格里有效。 */
type NodeReplCell = {
  cellId: string
  transport: NodeReplChildTransport
  pending: Map<
    number,
    { resolve: (result: ComputerResult) => void; reject: (error: Error) => void }
  >
  sequence: number
  closed: boolean
}

const CELL_FILENAME = 'pidex-node-repl-cell.js'

const toImage = (data: unknown, mimeType: unknown): NodeReplImage => {
  // 脚本运行在 vm 上下文中，它的 Uint8Array 与宿主构造器不同源，必须用结构判定。
  if (isUint8Array(data))
    return {
      data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
      mimeType: defaultMime(mimeType),
    }
  if (typeof data === 'string') return { data, mimeType: defaultMime(mimeType) }
  throw new NodeReplCallError(
    'NODE_REPL_INVALID_ARGUMENT',
    'emitImage 需要 Uint8Array 或 base64 字符串',
  )
}

const defaultMime = (mimeType: unknown) =>
  typeof mimeType === 'string' && mimeType.trim() ? mimeType : 'image/png'

const format = (value: unknown) => {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

const requireString = (value: unknown, name: string) => {
  if (typeof value !== 'string' || !value.trim())
    throw new NodeReplCallError('NODE_REPL_INVALID_ARGUMENT', `${name} 必须是非空字符串`)
  return value
}

const thenable = (value: unknown): value is PromiseLike<unknown> =>
  typeof value === 'object' &&
  value !== null &&
  typeof (value as { then?: unknown }).then === 'function'

/** 脚本错误来自 vm 上下文，`instanceof Error` 不成立，按结构化字段取消息。 */
const errorMessage = (cause: unknown) => {
  if (typeof cause === 'object' && cause !== null) {
    const message = (cause as { message?: unknown }).message
    if (typeof message === 'string' && message) return message
    const name = (cause as { name?: unknown }).name
    if (typeof name === 'string' && name) return name
  }
  return String(cause)
}

/**
 * Builds the bridge handed to one cell: the `computer` API and the `nodeRepl`
 * output helpers bound to that cell's transport. A cell owns its own bridge, so
 * a callback left over from an earlier cell can only reach the earlier cell's
 * already-closed transport instead of borrowing the current cell's identity.
 */
const createBridge = (cell: NodeReplCell) => {
  const emit = (message: NodeReplChildMessage) => {
    if (!cell.closed) cell.transport.send(message)
  }

  const call = (method: string, args: Record<string, unknown>) => {
    if (cell.closed)
      return Promise.reject(
        new NodeReplCallError('NODE_REPL_CONTEXT_LOST', '单元格已结束，不能再发起电脑操作'),
      )
    const id = ++cell.sequence
    return new Promise<ComputerResult>((resolve, reject) => {
      cell.pending.set(id, { resolve, reject })
      cell.transport.send({ type: 'call', id, method: method as never, args })
    })
  }

  const pump = async () => {
    for (;;) {
      const message = await cell.transport.next().catch(() => null)
      if (!message || cell.closed) return
      if (message.type !== 'result') continue
      const entry = cell.pending.get(message.id)
      if (!entry) continue
      cell.pending.delete(message.id)
      if (message.ok) entry.resolve(message.result)
      else entry.reject(new NodeReplCallError(message.error.code, message.error.message))
    }
  }

  const computer = Object.freeze({
    apps: () => call('apps', {}),
    read: (windowRef: unknown) =>
      call('read', { windowRef: requireString(windowRef, 'windowRef') }),
    action: (windowRef: unknown, observationId: unknown, operation: unknown) =>
      call('action', {
        windowRef: requireString(windowRef, 'windowRef'),
        observationId: requireString(observationId, 'observationId'),
        operation: (operation ?? {}) as ComputerAction,
      }),
  })

  const nodeRepl = Object.freeze({
    write: (value: unknown) => emit({ type: 'write', text: format(value) }),
    emitImage: (data: unknown, mimeType?: unknown) =>
      emit({ type: 'image', ...toImage(data, mimeType) }),
  })

  return { pump, computer, nodeRepl }
}

const dormantCall = () =>
  Promise.reject(new NodeReplCallError('NODE_REPL_CONTEXT_LOST', '当前没有正在执行的单元格'))
const DORMANT_COMPUTER = Object.freeze({
  apps: dormantCall,
  read: dormantCall,
  action: dormantCall,
})
const DORMANT_NODE_REPL = Object.freeze({
  write: () => undefined,
  emitImage: () => undefined,
})

// ponytail: 顶层 await 的单元格改用 globalThis 承接声明，所以嵌套块或缩进语句里的
// const/let/var 也会被抬到 globalThis（例如 if 块内的局部变量会泄漏成全局），解构声明
// 与函数声明不参与承接。当前这是可接受的近似；需要真正的作用域语义时改为按 AST 重写。
const HOIST_BOUNDARY = '(^|[;\\n])[ \\t]*'
const HOIST_BINDING = new RegExp(
  `${HOIST_BOUNDARY}(?:const|let|var)\\s+([A-Za-z_$][\\w$]*)\\s*=`,
  'gm',
)
const HOIST_CLASS = new RegExp(`${HOIST_BOUNDARY}class\\s+([A-Za-z_$][\\w$]*)`, 'gm')

const hoistDeclarations = (code: string) =>
  code
    .replace(
      HOIST_BINDING,
      (_, boundary: string, name: string) => `${boundary}globalThis.${name} =`,
    )
    .replace(
      HOIST_CLASS,
      (_, boundary: string, name: string) => `${boundary}globalThis.${name} = class ${name}`,
    )

/**
 * 子进程里唯一的求值上下文：一次连接、一个 chat 复用它，单元格之间保持绑定与对象身份。
 *
 * 只暴露 `computer` 与 `nodeRepl`；`process`/`Bun`/`require`/`fetch` 显式置空，并且
 * 禁止字符串代码生成（`eval`/`new Function`）以免绕回宿主。这是收敛的可用面，不是安全
 * 沙箱：进程隔离用于清理和故障隔离，超时、取消、审批暂停都会终止整个上下文。
 */
export class NodeReplRuntime {
  private context: Context | undefined
  private current: (ReturnType<typeof createBridge> & { cell: NodeReplCell }) | undefined

  /** 当前单元格标识；单元格结束后清空，迟到的结果帧不再被接受。 */
  get cellId(): string | undefined {
    return this.current?.cell.cellId
  }

  /** 只有属于当前单元格的结果帧才会被接受。 */
  accepts(cellId: string | undefined) {
    if (!cellId) return true
    return cellId === this.current?.cell.cellId
  }

  /** 丢弃当前上下文：变量、绑定、全局对象与模块级状态全部清除。 */
  reset() {
    this.detach()
    this.context = undefined
  }

  /** 执行一个单元格；调用方负责会话级串行。 */
  async run(transport: NodeReplChildTransport, code: string, cellId = 'cell'): Promise<void> {
    const cell: NodeReplCell = {
      cellId,
      transport,
      pending: new Map(),
      sequence: 0,
      closed: false,
    }
    const bridge = createBridge(cell)
    this.current = { ...bridge, cell }
    const pumping = bridge.pump()
    try {
      await this.evaluate(code)
      transport.send({ type: 'done' })
    } catch (cause) {
      transport.send({ type: 'error', message: errorMessage(cause) })
    } finally {
      this.detach()
      void pumping
    }
  }

  private detach() {
    const current = this.current
    if (!current) return
    this.current = undefined
    current.cell.closed = true
    current.cell.pending.clear()
    current.cell.transport.close?.()
  }

  private evaluate(code: string): Promise<void> | void {
    const context = this.scope()
    let script: Script | undefined
    let failure: unknown
    try {
      script = new Script(code, { filename: CELL_FILENAME })
    } catch (cause) {
      failure = cause
    }
    if (script) {
      const value = script.runInContext(context)
      // 与旧实现一致：最后一个表达式是 Promise 时等待它。
      return thenable(value) ? Promise.resolve(value).then(() => undefined) : undefined
    }
    let wrapped: Script
    try {
      // 顶层 await / 顶层 return 只在函数体内合法，改走 async 包装并承接声明。
      wrapped = new Script(`(async () => {\n${hoistDeclarations(code)}\n})()`, {
        filename: CELL_FILENAME,
      })
    } catch {
      // 两条路径都编译不过：原始语法错误更有信息量。
      throw failure
    }
    return Promise.resolve(wrapped.runInContext(context)).then(() => undefined)
  }

  private scope(): Context {
    if (this.context) return this.context
    const sandbox: Record<string, unknown> = {}
    const expose = (name: string, read: () => unknown) =>
      Object.defineProperty(sandbox, name, {
        enumerable: true,
        configurable: true,
        get: read,
      })
    expose('computer', () => this.current?.computer ?? DORMANT_COMPUTER)
    expose('nodeRepl', () => this.current?.nodeRepl ?? DORMANT_NODE_REPL)
    for (const name of ['process', 'Bun', 'require', 'fetch'])
      Object.defineProperty(sandbox, name, {
        value: undefined,
        enumerable: false,
        writable: false,
        configurable: false,
      })
    this.context = createContext(sandbox, {
      name: 'pidex-node-repl',
      codeGeneration: { strings: false, wasm: false },
    })
    return this.context
  }
}

/**
 * Runs one cell in a fresh runtime. Kept for single-cell callers and tests; the
 * child process itself reuses one `NodeReplRuntime` for the whole connection.
 */
export async function runNodeReplScript(
  transport: NodeReplChildTransport,
  code: string,
): Promise<void> {
  await new NodeReplRuntime().run(transport, code)
}
