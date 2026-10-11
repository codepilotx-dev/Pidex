import type { SpeechStatus } from '@pidex/agent-protocol'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { AgentError } from '../Domain'
import {
  SPEECH_MAX_AUDIO_BYTES,
  SPEECH_MAX_DURATION_MS,
  SPEECH_MODEL_ID,
  SPEECH_RUNTIME_VERSION,
  type SpeechRuntimeVariant,
} from './SpeechCatalog'
import { SpeechInstaller, SpeechInstallError } from './SpeechInstaller'
import { decodeSpeechWav } from './WavAudio'

const STDOUT_LIMIT = 1024 * 1024
const STDERR_LIMIT = 64 * 1024
const TRANSCRIPTION_TIMEOUT_MS = 180_000
const LANGUAGE_TAGS = new Set(['zh', 'yue', 'en', 'ja', 'ko', 'nospeech'])

type SpeechResult = {
  text: string
  detectedLanguage?: 'zh' | 'yue' | 'en' | 'ja' | 'ko' | 'nospeech'
  durationMs: number
}

const baseStatus = (
  state: SpeechStatus['state'],
  variant: SpeechStatus['variant'],
): SpeechStatus => ({
  state,
  provider: 'sensevoice-llamacpp',
  runtimeVersion: SPEECH_RUNTIME_VERSION,
  model: SPEECH_MODEL_ID,
  variant,
  maxDurationMs: SPEECH_MAX_DURATION_MS,
  maxAudioBytes: SPEECH_MAX_AUDIO_BYTES,
})

const parseOutput = (stdout: string, durationMs: number): SpeechResult | null => {
  const candidate = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .reverse()
    .find((line) => line.includes('<|'))
  if (!candidate) return null
  const tags = [...candidate.matchAll(/<\|([^|>]+)\|>/g)].map((match) =>
    match[1]!.trim().toLowerCase(),
  )
  const language = tags.find((tag) => LANGUAGE_TAGS.has(tag)) as
    SpeechResult['detectedLanguage'] | undefined
  const text = candidate.replace(/<\|[^|>]+\|>/g, '').trim()
  if (!text && language !== 'nospeech') return null
  return { text, ...(language ? { detectedLanguage: language } : {}), durationMs }
}

export class SpeechTranscriptionService {
  private readonly installer: SpeechInstaller
  private currentStatus: SpeechStatus
  private installTask: Promise<SpeechStatus> | null = null
  private installController: AbortController | null = null
  private active: { operationId: string; controller: AbortController } | null = null
  private preferredVariant: SpeechRuntimeVariant = 'avx2'
  private disposed = false
  private verifiedInstalled = false

  constructor(
    private readonly root: string,
    private readonly statusChanged: (status: SpeechStatus) => void | Promise<void> = () =>
      undefined,
  ) {
    this.currentStatus = baseStatus(
      process.platform === 'win32' && process.arch === 'x64' ? 'not-installed' : 'unsupported',
      null,
    )
    this.installer = new SpeechInstaller(root, (progress, installing) => {
      this.setStatus({ ...baseStatus(installing ? 'installing' : 'downloading', null), progress })
    })
  }

  async initialize() {
    if (this.currentStatus.state === 'unsupported') return
    this.preferredVariant = await this.readPreferredVariant()
    const installed = await this.installer.installed()
    this.verifiedInstalled = installed
    this.setStatus(
      baseStatus(installed ? 'ready' : 'not-installed', installed ? this.preferredVariant : null),
    )
  }

  status() {
    return structuredClone(this.currentStatus)
  }

  async install(force = false) {
    if (this.currentStatus.state === 'unsupported')
      throw new AgentError('SPEECH_PLATFORM_UNSUPPORTED', '语音听写仅支持 Windows x64', 409)
    if (this.active) throw new AgentError('SPEECH_BUSY', '语音识别运行期间不能安装组件', 409)
    if (!force && this.verifiedInstalled) {
      this.setStatus(baseStatus('ready', this.preferredVariant))
      return this.status()
    }
    if (this.installTask) return this.installTask
    const task = (async () => {
      const controller = new AbortController()
      this.installController = controller
      try {
        await this.installer.install(controller.signal)
        this.verifiedInstalled = true
        this.preferredVariant = 'avx2'
        await this.writePreferredVariant('avx2')
        this.setStatus(baseStatus('ready', 'avx2'))
        return this.status()
      } catch (cause) {
        const code = cause instanceof SpeechInstallError ? cause.code : 'SPEECH_INSTALL_FAILED'
        const message = cause instanceof SpeechInstallError ? cause.message : '语音运行时安装失败'
        this.setStatus({ ...baseStatus('error', null), error: { code, message } })
        throw new AgentError(code, message, 503)
      } finally {
        this.installTask = null
        this.installController = null
      }
    })()
    this.installTask = task
    return task
  }

  async transcribe(input: {
    operationId: string
    audio: { mediaType: 'audio/wav'; encoding: 'base64'; data: string }
  }): Promise<SpeechResult> {
    if (this.currentStatus.state === 'unsupported')
      throw new AgentError('SPEECH_PLATFORM_UNSUPPORTED', '语音听写仅支持 Windows x64', 409)
    if (this.installTask)
      throw new AgentError('SPEECH_RUNTIME_NOT_READY', '语音运行时正在安装', 409)
    if (!this.verifiedInstalled)
      throw new AgentError('SPEECH_RUNTIME_NOT_READY', '语音运行时尚未安装', 409)
    if (this.active) throw new AgentError('SPEECH_BUSY', '已有语音识别正在运行', 409)
    const { bytes, durationMs } = decodeSpeechWav(input.audio.data)
    const controller = new AbortController()
    this.active = { operationId: input.operationId, controller }
    const tempRoot = join(this.root, '.tmp')
    const wavPath = join(tempRoot, `${randomUUID()}.wav`)
    try {
      await mkdir(tempRoot, { recursive: true })
      await writeFile(wavPath, bytes, { flag: 'wx' })
      if (controller.signal.aborted) throw new AgentError('SPEECH_CANCELLED', '语音识别已取消', 409)
      this.setStatus(baseStatus('transcribing', this.preferredVariant))
      let result = await this.run(this.preferredVariant, wavPath, durationMs, controller.signal)
      if (!result && this.preferredVariant === 'avx2' && !controller.signal.aborted) {
        result = await this.run('generic', wavPath, durationMs, controller.signal)
        if (result) {
          this.preferredVariant = 'generic'
          await this.writePreferredVariant('generic')
        }
      }
      if (!result)
        throw new AgentError('SPEECH_TRANSCRIPTION_FAILED', '语音识别未返回有效结果', 502)
      return result
    } finally {
      this.active = null
      await rm(wavPath, { force: true }).catch(() => undefined)
      this.setStatus(baseStatus('ready', this.preferredVariant))
    }
  }

  cancel(operationId: string) {
    if (!this.active || this.active.operationId !== operationId) return { cancelled: false }
    this.active.controller.abort()
    return { cancelled: true }
  }

  async dispose() {
    this.disposed = true
    this.installController?.abort()
    this.active?.controller.abort()
    const deadline = Date.now() + 5_000
    while ((this.installTask || this.active) && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 20))
    }
  }

  private async run(
    variant: SpeechRuntimeVariant,
    audioPath: string,
    durationMs: number,
    signal: AbortSignal,
  ): Promise<SpeechResult | null> {
    if (signal.aborted) throw new AgentError('SPEECH_CANCELLED', '语音识别已取消', 409)
    const executable = this.installer.runtimePath(variant)
    const args = [
      '-m',
      this.installer.modelPath(),
      '-a',
      audioPath,
      '--vad',
      this.installer.vadPath(),
      '--vad-maxseg',
      '30000',
      '--keep-tags',
    ]
    let timedOut = false
    const child = spawn(executable, args, {
      windowsHide: true,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let overflow = false
    child.stdout.on('data', (chunk: Buffer) => {
      stdoutBytes += chunk.byteLength
      if (stdoutBytes > STDOUT_LIMIT) {
        overflow = true
        child.kill()
      } else stdout.push(chunk)
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderrBytes += chunk.byteLength
      if (stderrBytes > STDERR_LIMIT) {
        overflow = true
        child.kill()
      } else stderr.push(chunk)
    })
    const abort = () => child.kill()
    signal.addEventListener('abort', abort, { once: true })
    const timer = setTimeout(() => {
      timedOut = true
      child.kill()
    }, TRANSCRIPTION_TIMEOUT_MS)
    try {
      const outcome = await new Promise<{ code: number | null; error?: Error }>((resolve) => {
        child.once('error', (error) => resolve({ code: null, error }))
        child.once('close', (code) => resolve({ code }))
      })
      if (signal.aborted) throw new AgentError('SPEECH_CANCELLED', '语音识别已取消', 409)
      if (timedOut) throw new AgentError('SPEECH_TIMEOUT', '语音识别超时', 504)
      if (overflow || outcome.error || outcome.code !== 0) return null
      let text: string
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(stdout))
      } catch {
        return null
      }
      return parseOutput(text, durationMs)
    } finally {
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      if (child.exitCode === null) child.kill()
    }
  }

  private setStatus(status: SpeechStatus) {
    if (this.disposed) return
    this.currentStatus = status
    void Promise.resolve(this.statusChanged(structuredClone(status))).catch(() => undefined)
  }

  private async readPreferredVariant(): Promise<SpeechRuntimeVariant> {
    try {
      const value = JSON.parse(await readFile(join(this.root, 'runtime-variant.json'), 'utf8')) as {
        variant?: unknown
      }
      return value.variant === 'generic' ? 'generic' : 'avx2'
    } catch {
      return 'avx2'
    }
  }

  private async writePreferredVariant(variant: SpeechRuntimeVariant) {
    await mkdir(this.root, { recursive: true })
    const path = join(this.root, 'runtime-variant.json')
    const temporary = `${path}.${randomUUID()}.tmp`
    await writeFile(temporary, `${JSON.stringify({ variant })}\n`, { encoding: 'utf8', flag: 'wx' })
    await rm(path, { force: true }).catch(() => undefined)
    await import('node:fs/promises').then(({ rename }) => rename(temporary, path))
  }
}
