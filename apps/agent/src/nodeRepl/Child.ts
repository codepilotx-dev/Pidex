import { createInterface } from 'node:readline'
import { z } from 'zod'
import type { NodeReplChildMessage, NodeReplHostMessage } from './Protocol'
import { runNodeReplScript } from './ChildRuntime'

const jsSchema = z
  .object({
    code: z.string().min(1).max(200_000),
    title: z.string().min(1).max(200).optional(),
    timeout_ms: z.number().int().min(1_000).max(120_000).optional(),
  })
  .strict()
const write = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`)
let sequence = 0
let busy = false
const pending = new Map<number, (message: NodeReplHostMessage) => void>()

/** Standard stdio MCP; computer requests always return to the calling host for authorization. */
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
      const resolve = pending.get(message.id)
      if (resolve) {
        pending.delete(message.id)
        const result = message.result as
          { ok?: boolean; result?: unknown; error?: { code: string; message: string } } | undefined
        resolve(
          result?.ok
            ? { type: 'result', id: message.id, ok: true, result: result.result as never }
            : {
                type: 'result',
                id: message.id,
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
        serverInfo: { name: 'pidex-node-repl', version: '0.1.0' },
      })
    } else if (message.method === 'ping') reply({})
    else if (message.method === 'tools/list')
      reply({
        tools: [
          {
            name: 'js',
            description:
              'Run JavaScript with the Pidex computer bridge; each call uses a fresh process.',
            inputSchema: z.toJSONSchema(jsSchema),
          },
        ],
      })
    else if (message.method === 'tools/call') {
      const params = message.params as { name?: string; arguments?: unknown } | undefined
      const parsed = jsSchema.safeParse(params?.arguments)
      if (params?.name !== 'js' || !parsed.success || busy) {
        error(-32602, 'Invalid js call or execution already active')
        continue
      }
      busy = true
      const content: Array<
        { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
      > = []
      let isError = false
      let next: ((message: NodeReplHostMessage) => void) | undefined
      const queue: NodeReplHostMessage[] = []
      const deliver = (result: NodeReplHostMessage) => {
        if (next) {
          const resolve = next
          next = undefined
          resolve(result)
        } else queue.push(result)
      }
      void runNodeReplScript(
        {
          next: () =>
            queue.length
              ? Promise.resolve(queue.shift()!)
              : new Promise((resolve) => {
                  next = resolve
                }),
          send: (output: NodeReplChildMessage) => {
            if (output.type === 'call') {
              const id = ++sequence
              pending.set(id, (result) =>
                deliver({ ...result, id: output.id } as NodeReplHostMessage),
              )
              write({
                jsonrpc: '2.0',
                id,
                method: 'pidex/computer',
                params: { method: output.method, args: output.args },
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
      )
        .then(() => reply({ content, ...(isError ? { isError } : {}) }))
        .finally(() => {
          busy = false
        })
    } else error(-32601, 'Method not found')
  }
}

await runNodeReplChild()
