import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { chmod, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { killProcessTree, preferredShell } from '../tool/Shell/HostProcess'
import { environmentDelta, EnvironmentDeltaStore } from './EnvironmentDeltaStore'
import type {
  EnvironmentDelta,
  LocalEnvironmentOperation,
  LocalEnvironmentOperationKind,
} from './Types'

const OUTPUT_LIMIT_BYTES = 64 * 1024
const OUTPUT_TTL_MS = 10 * 60 * 1_000
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1_000

type OutputChunk = { sequence: number; data: string; bytes: number }
type InternalOperation = LocalEnvironmentOperation & {
  chunks: OutputChunk[]
  outputBytes: number
  nextSequence: number
}

export type LocalEnvironmentOutputPage = {
  operation: LocalEnvironmentOperation
  oldestSequence: number
  nextSequence: number
  chunks: Array<{ sequence: number; data: string }>
}

export type LocalEnvironmentRunInput = {
  operationId?: string | undefined
  kind: LocalEnvironmentOperationKind
  bindingId: string
  cwd: string
  command: string
  environment?: Readonly<Record<string, string | undefined>> | undefined
  signal?: AbortSignal | undefined
  onOutput?: ((chunk: string) => void) | undefined
}

type SpawnResult = {
  exitCode: number
  environment: Record<string, string>
}

export class LocalEnvironmentRunner {
  private readonly operations = new Map<string, InternalOperation>()

  constructor(
    private readonly deltas: EnvironmentDeltaStore,
    private readonly timeoutMs = DEFAULT_TIMEOUT_MS,
  ) {}

  async run(input: LocalEnvironmentRunInput): Promise<LocalEnvironmentOperation> {
    const operationId = input.operationId ?? randomUUID()
    if (this.operations.has(operationId)) throw new Error('本地环境操作 ID 已存在')
    const operation: InternalOperation = {
      operationId,
      kind: input.kind,
      status: 'running',
      revision: 1,
      startedAt: Date.now(),
      completedAt: null,
      exitCode: null,
      errorCode: null,
      chunks: [],
      outputBytes: 0,
      nextSequence: 0,
    }
    this.operations.set(operationId, operation)
    const baseEnvironment = { ...process.env, ...input.environment }
    try {
      const result = await this.spawnWrapper(
        input.cwd,
        input.command,
        baseEnvironment,
        operation,
        input.signal,
        input.onOutput,
      )
      operation.exitCode = result.exitCode
      if (result.exitCode !== 0) {
        operation.status = 'failed'
        operation.errorCode = 'LOCAL_ENVIRONMENT_COMMAND_FAILED'
      } else {
        if (input.kind === 'setup') {
          const delta = environmentDelta(baseEnvironment, result.environment)
          await this.deltas.replace(input.bindingId, delta)
        }
        operation.status = 'succeeded'
      }
    } catch {
      operation.status = 'failed'
      operation.errorCode = 'LOCAL_ENVIRONMENT_COMMAND_FAILED'
    } finally {
      operation.completedAt = Date.now()
      operation.revision += 1
      const timer = setTimeout(() => this.operations.delete(operationId), OUTPUT_TTL_MS)
      timer.unref?.()
    }
    return this.publicOperation(operation)
  }

  output(operationId: string, afterSequence = 0): LocalEnvironmentOutputPage | null {
    const operation = this.operations.get(operationId)
    if (!operation) return null
    return {
      operation: this.publicOperation(operation),
      oldestSequence: operation.chunks[0]?.sequence ?? operation.nextSequence,
      nextSequence: operation.nextSequence,
      chunks: operation.chunks
        .filter((chunk) => chunk.sequence >= afterSequence)
        .map(({ sequence, data }) => ({ sequence, data })),
    }
  }

  async environment(bindingId: string): Promise<EnvironmentDelta> {
    return this.deltas.read(bindingId)
  }

  private publicOperation(operation: InternalOperation): LocalEnvironmentOperation {
    const {
      chunks: _chunks,
      outputBytes: _outputBytes,
      nextSequence: _nextSequence,
      ...result
    } = operation
    return { ...result }
  }

  private append(operation: InternalOperation, bytes: Buffer) {
    const data = bytes.toString('utf8')
    const chunk = {
      sequence: operation.nextSequence++,
      data,
      bytes: Buffer.byteLength(data, 'utf8'),
    }
    operation.chunks.push(chunk)
    operation.outputBytes += chunk.bytes
    while (operation.outputBytes > OUTPUT_LIMIT_BYTES && operation.chunks.length > 0) {
      const overflow = operation.outputBytes - OUTPUT_LIMIT_BYTES
      const first = operation.chunks[0]!
      if (first.bytes <= overflow) {
        operation.chunks.shift()
        operation.outputBytes -= first.bytes
        continue
      }
      const buffer = Buffer.from(first.data, 'utf8')
      const shortened = buffer
        .subarray(overflow)
        .toString('utf8')
        .replace(/^\uFFFD/, '')
      operation.outputBytes -= first.bytes
      first.data = shortened
      first.bytes = Buffer.byteLength(shortened, 'utf8')
      operation.outputBytes += first.bytes
      break
    }
    return data
  }

  private async spawnWrapper(
    cwd: string,
    command: string,
    environment: NodeJS.ProcessEnv,
    operation: InternalOperation,
    signal?: AbortSignal,
    onOutput?: (chunk: string) => void,
  ): Promise<SpawnResult> {
    const temporaryRoot = await mkdtemp(join(tmpdir(), 'pidex-local-environment-'))
    const environmentPath = join(temporaryRoot, 'environment.capture')
    const windows = process.platform === 'win32'
    const wrapperPath = join(temporaryRoot, windows ? 'setup.ps1' : 'setup.sh')
    const quotePowerShell = (value: string) => `'${value.replaceAll("'", "''")}'`
    const quoteShell = (value: string) => `'${value.replaceAll("'", `'"'"'`)}'`
    const wrapper = windows
      ? [
          "$ErrorActionPreference = 'Stop'",
          '$pidexExitCode = 0',
          'try {',
          '  & {',
          command,
          '  }',
          '  if ($null -ne $LASTEXITCODE) { $pidexExitCode = $LASTEXITCODE }',
          '} catch {',
          '  $pidexExitCode = 1',
          '  Write-Error $_',
          '} finally {',
          `  [Environment]::GetEnvironmentVariables('Process') | ConvertTo-Json -Compress | Set-Content -LiteralPath ${quotePowerShell(environmentPath)} -Encoding utf8`,
          '}',
          'exit $pidexExitCode',
          '',
        ].join('\r\n')
      : [
          '#!/bin/sh',
          'pidex_exit_code=0',
          command,
          'pidex_exit_code=$?',
          `env -0 > ${quoteShell(environmentPath)}`,
          'exit $pidex_exit_code',
          '',
        ].join('\n')
    try {
      await chmod(temporaryRoot, 0o700).catch(() => undefined)
      await writeFile(environmentPath, '', { encoding: 'utf8', mode: 0o600 })
      await chmod(environmentPath, 0o600).catch(() => undefined)
      await writeFile(wrapperPath, wrapper, { encoding: 'utf8', mode: 0o700 })
      await chmod(wrapperPath, 0o700).catch(() => undefined)
      const windowsShell = windows ? preferredShell().exe : null
      const child = spawn(
        windows ? windowsShell! : '/bin/sh',
        windows
          ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-File', wrapperPath]
          : [wrapperPath],
        {
          cwd,
          env: environment,
          shell: false,
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe'],
        },
      )
      child.stdout.on('data', (chunk: Buffer) => onOutput?.(this.append(operation, chunk)))
      child.stderr.on('data', (chunk: Buffer) => onOutput?.(this.append(operation, chunk)))
      let timedOut = false
      const stop = () => killProcessTree(child)
      signal?.addEventListener('abort', stop, { once: true })
      const timer = setTimeout(() => {
        timedOut = true
        stop()
      }, this.timeoutMs)
      const exitCode = await new Promise<number>((resolveExit, rejectExit) => {
        child.once('error', rejectExit)
        child.once('exit', (code) => resolveExit(code ?? 1))
      }).finally(() => {
        clearTimeout(timer)
        signal?.removeEventListener('abort', stop)
      })
      if (timedOut || signal?.aborted) return { exitCode: 1, environment: {} }
      const captured = await readFile(environmentPath)
      const capturedEnvironment = windows
        ? (JSON.parse(captured.toString('utf8').replace(/^\uFEFF/, '')) as Record<string, string>)
        : Object.fromEntries(
            captured
              .toString('utf8')
              .split('\0')
              .filter(Boolean)
              .map((entry) => {
                const separator = entry.indexOf('=')
                return [entry.slice(0, separator), entry.slice(separator + 1)]
              }),
          )
      return { exitCode, environment: capturedEnvironment }
    } finally {
      await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined)
    }
  }
}
