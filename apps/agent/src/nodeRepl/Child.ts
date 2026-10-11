import type { NodeReplChildMessage, NodeReplHostMessage } from './Protocol'
import { runNodeReplScript, type NodeReplChildTransport } from './ChildRuntime'

/** Child process entry: reads the init frame, runs one cell, then exits. */
const writeMessage = (message: NodeReplChildMessage) => {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

const createTransport = (): NodeReplChildTransport => {
  const queue: NodeReplHostMessage[] = []
  let resolveNext: ((message: NodeReplHostMessage | null) => void) | null = null
  let closed = false
  let buffer = ''

  const deliver = (message: NodeReplHostMessage | null) => {
    if (resolveNext) {
      const resolve = resolveNext
      resolveNext = null
      resolve(message)
    } else if (message) {
      queue.push(message)
    }
  }

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    for (;;) {
      const index = buffer.indexOf('\n')
      if (index < 0) break
      const line = buffer.slice(0, index)
      buffer = buffer.slice(index + 1)
      if (!line.trim()) continue
      try {
        deliver(JSON.parse(line) as NodeReplHostMessage)
      } catch {
        // A malformed host frame is ignored; the host kill-switch owns failures.
      }
    }
  })
  process.stdin.on('end', () => {
    closed = true
    deliver(null)
  })
  process.stdin.resume()

  return {
    send: writeMessage,
    next: () =>
      queue.length
        ? Promise.resolve(queue.shift()!)
        : closed
          ? Promise.resolve(null)
          : new Promise<NodeReplHostMessage | null>((resolve) => {
              resolveNext = resolve
            }),
  }
}

export async function runNodeReplChild(): Promise<void> {
  const transport = createTransport()
  const init = await transport.next()
  if (!init || init.type !== 'init') {
    process.stderr.write('pidex node_repl child: missing init frame\n')
    process.exit(1)
  }
  await runNodeReplScript(transport, init.code)
  process.exit(0)
}

// Dedicated entry: dev runs this file through Bun, installed mode imports it
// after the `--pidex-node-repl` dispatch. It never boots the agent server.
await runNodeReplChild()
