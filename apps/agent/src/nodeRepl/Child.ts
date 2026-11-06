import { createInterface } from 'node:readline'
import { z } from 'zod'
import type { NodeReplChildMessage, NodeReplHostMessage } from './Protocol'
import { NodeReplRuntime } from './ChildRuntime'

const jsSchema = z
  .object({
    code: z.string().min(1).max(200_000),
    title: z.string().min(1).max(200).optional(),
    timeout_ms: z.number().int().min(1_000).max(120_000).optional(),
  })
  .strict()
const resetSchema = z.object({}).strict()

const write = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`)
let sequence = 0
let cellSequence = 0
let busy = false
/** 每个在途请求记录发起它的单元格，迟到的结果帧不能落到别的单元格。 */
const pending = new Map<
  number,
  { cellId: string; deliver: (message: NodeReplHostMessage) => void }
>()
/** 一次连接只有一个求值上下文；`js_reset` 或宿主关闭连接才丢弃。 */
const runtime = new NodeReplRuntime()

/**
 * Standard stdio MCP; computer requests always return to the calling host for
 * authorization. The evaluation context lives as long as this connection, so a
 * chat's cells share bindings and object identity, while separate chats (each
 * owning its own child process) stay isolated. Cells still run one at a time.
 */
export async function runNodeReplChild(): Promise<void> {
  const lines = createInterface({ input: process.stdin })
  for await (const line of lines) {
    let message: {
      id?: number | string
      method?: string
      params?: unknown
      result?: unknown
      error?: unknown
    }
    try {
      message = JSON.parse(line)
    } catch {
      write({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })
      continue
    }
    if (!message.method && typeof message.id === 'number') {
      const entry = pending.get(message.id)
      if (entry) {
        pending.delete(message.id)
        const result = message.result as
          | {
              ok?: boolean
              cellId?: string
              result?: unknown
              error?: { code: string; message: string }
            }
          | undefined
        // 宿主回填单元格标识；不属于当前活动单元格的帧直接丢弃。
        if (!runtime.accepts(entry.cellId)) continue
        entry.deliver(
          result?.ok
            ? {
                type: 'result',
                id: message.id,
                cellId: entry.cellId,
                ok: true,
                result: result.result as never,
              }
            : {
                type: 'result',
                id: message.id,
                cellId: entry.cellId,
                ok: false,
                error: result?.error ?? { code: 'HOST_UNAVAILABLE', message: '电脑控制宿主未连接' },
              },
        )
      }
      continue
    }
    if (message.id === undefined) continue
    const reply = (result: unknown) => write({ jsonrpc: '2.0', id: message.id, result })
    const error = (code: number, text: string) =>
      write({ jsonrpc: '2.0', id: message.id, error: { code, message: text } })
    if (message.method === 'initialize') {
      reply({
        protocolVersion: '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'pidex-node-repl', version: '0.2.0' },
      })
    } else if (message.method === 'ping') reply({})
    else if (message.method === 'tools/list')
      reply({
        tools: [
          {
            name: 'js',
            description:
              'Run JavaScript with the Pidex computer bridge. State persists across calls in the same chat.',
            inputSchema: z.toJSONSchema(jsSchema),
          },
          {
            name: 'js_reset',
            description: 'Discard the current chat evaluation context and its bindings.',
            inputSchema: z.toJSONSchema(resetSchema),
          },
        ],
      })
    else if (message.method === 'tools/call') {
      const params = message.params as { name?: string; arguments?: unknown } | undefined
      if (params?.name === 'js_reset') {
        if (!resetSchema.safeParse(params.arguments ?? {}).success || busy) {
          error(-32602, 'Invalid js_reset call or execution already active')
          continue
        }
        runtime.reset()
        reply({ content: [{ type: 'text', text: '已重置当前 chat 的 JavaScript 上下文' }] })
        continue
      }
      const parsed = jsSchema.safeParse(params?.arguments)
      if (params?.name !== 'js' || !parsed.success || busy) {
        error(-32602, 'Invalid js call or execution already active')
        continue
      }
      busy = true
      // 单元格标识由子进程生成并随请求发出；宿主原样回填，用于丢弃迟到的帧。
      const cellId = `cell-${++cellSequence}`
      const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
      > = []
      let isError = false
      let active = true
      let next: ((message: NodeReplHostMessage | null) => void) | undefined
      const queue: NodeReplHostMessage[] = []
      const deliver = (result: NodeReplHostMessage) => {
        // 已经结束的单元格不再接收任何结果；这是迟到消息的最终拦截点。
        if (!active) return
        if (next) {
          const resolve = next
          next = undefined
          resolve(result)
        } else queue.push(result)
      }
      void runtime
        .run(
          {
            next: () =>
              queue.length
                ? Promise.resolve(queue.shift()!)
                : new Promise<NodeReplHostMessage | null>((resolve) => {
                    next = resolve
                  }),
            close: () => {
              const resolve = next
              next = undefined
              resolve?.(null)
            },
            send: (output: NodeReplChildMessage) => {
              if (output.type === 'call') {
                const id = ++sequence
                pending.set(id, { cellId, deliver })
                write({
                  jsonrpc: '2.0',
                  id,
                  method: 'pidex/computer',
                  params: { cellId, method: output.method, args: output.args },
                })
              } else if (output.type === 'write') content.push({ type: 'text', text: output.text })
              else if (output.type === 'image')
                content.push({ type: 'image', data: output.data, mimeType: output.mimeType })
              else if (output.type === 'error') {
                isError = true
                content.push({ type: 'text', text: output.message })
              }
            },
          },
          parsed.data.code,
          cellId,
        )
        .then(() => reply({ content, ...(isError ? { isError } : {}) }))
        .finally(() => {
          active = false
          busy = false
          // 单元格结束后它的在途请求不再需要投递；迟到的帧由 active 拦掉。
          for (const [id, entry] of pending) if (entry.cellId === cellId) pending.delete(id)
        })
    } else error(-32601, 'Method not found')
  }
}

await runNodeReplChild()
