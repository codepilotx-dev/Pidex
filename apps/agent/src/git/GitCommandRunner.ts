import { AgentError } from '../Domain'

export type GitCommandResult = {
  code: number
  stdout: string
  stderr: string
}

type GitCommandRunnerOptions = {
  maxOutputBytes: number
  timeoutMs: number
  onCommand?: ((args: readonly string[]) => void) | undefined
}

type RunGitCommandOptions = {
  cwd: string
  args: readonly string[]
  input?: string | undefined
  acceptedCodes?: readonly number[] | null | undefined
  env?: Readonly<Record<string, string>> | undefined
  literalPathspecs?: boolean | undefined
  maxOutputBytes?: number | undefined
}

const decodeUtf8 = (value: Uint8Array) => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(value)
  } catch {
    throw new AgentError('GIT_OUTPUT_ENCODING_INVALID', 'Git 输出不是有效 UTF-8', 500)
  }
}

const readLimited = async (
  stream: ReadableStream<Uint8Array>,
  limit: number,
  child: { kill(signal?: number | NodeJS.Signals): void },
) => {
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > limit) {
        child.kill()
        throw new AgentError('GIT_OUTPUT_TOO_LARGE', 'Git 输出超过安全上限', 413)
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }

  const output = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

export class GitCommandRunner {
  constructor(private readonly options: GitCommandRunnerOptions) {}

  async run({
    cwd,
    args,
    input,
    acceptedCodes = [0],
    env,
    literalPathspecs = false,
    maxOutputBytes = this.options.maxOutputBytes,
  }: RunGitCommandOptions): Promise<GitCommandResult> {
    this.options.onCommand?.(args)
    const child = Bun.spawn(
      ['git', '-c', 'core.quotepath=false', '-c', 'core.fsmonitor=false', ...args],
      {
        cwd,
        env: {
          ...process.env,
          GIT_OPTIONAL_LOCKS: '0',
          ...(literalPathspecs ? { GIT_LITERAL_PATHSPECS: '1' } : {}),
          ...env,
        },
        stdin: input === undefined ? 'ignore' : new Blob([input]),
        stdout: 'pipe',
        stderr: 'pipe',
      },
    )
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, this.options.timeoutMs)
    try {
      const [stdoutBytes, stderrBytes, code] = await Promise.all([
        readLimited(child.stdout, maxOutputBytes, child),
        readLimited(child.stderr, maxOutputBytes, child),
        child.exited,
      ])
      if (timedOut) {
        throw new AgentError('GIT_COMMAND_FAILED', 'Git 操作超时', 504)
      }
      const result = {
        code,
        stdout: decodeUtf8(stdoutBytes),
        stderr: decodeUtf8(stderrBytes),
      }
      if (acceptedCodes !== null && !acceptedCodes.includes(code)) {
        throw new AgentError('GIT_COMMAND_FAILED', 'Git 操作失败', 409)
      }
      return result
    } catch (cause) {
      child.kill()
      await child.exited.catch(() => undefined)
      throw cause
    } finally {
      clearTimeout(timer)
    }
  }
}
