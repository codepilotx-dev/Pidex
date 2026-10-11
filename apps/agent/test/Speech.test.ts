import { afterEach, describe, expect, test } from 'bun:test'
import { createHash, randomUUID } from 'node:crypto'
import { access, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import extractZip from 'extract-zip'
import { AgentError } from '../src/Domain'
import { decodeSpeechWav } from '../src/speech/WavAudio'
import { speechHandlers } from '../src/transport/rpc/handlers/Speech'
import { assertSafeSpeechZipEntry, SpeechInstaller } from '../src/speech/SpeechInstaller'
import { SPEECH_ARTIFACTS, SPEECH_EXECUTABLE } from '../src/speech/SpeechCatalog'
import { SpeechTranscriptionService } from '../src/speech/SpeechTranscriptionService'

const roots: string[] = []
const require = createRequire(import.meta.url)
afterEach(async () => {
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
const temporaryRoot = async () => {
  const root = join(process.cwd(), '.tmp-tests', `speech-${randomUUID()}`)
  roots.push(root)
  await mkdir(root, { recursive: true })
  return root
}

const wav = (
  samples: number,
  options: { sampleRate?: number; channels?: number; bits?: number } = {},
) => {
  const sampleRate = options.sampleRate ?? 16_000
  const channels = options.channels ?? 1
  const bits = options.bits ?? 16
  const dataBytes = (samples * channels * bits) / 8
  const bytes = Buffer.alloc(44 + dataBytes)
  bytes.write('RIFF', 0)
  bytes.writeUInt32LE(bytes.length - 8, 4)
  bytes.write('WAVEfmt ', 8)
  bytes.writeUInt32LE(16, 16)
  bytes.writeUInt16LE(1, 20)
  bytes.writeUInt16LE(channels, 22)
  bytes.writeUInt32LE(sampleRate, 24)
  bytes.writeUInt32LE((sampleRate * channels * bits) / 8, 28)
  bytes.writeUInt16LE((channels * bits) / 8, 32)
  bytes.writeUInt16LE(bits, 34)
  bytes.write('data', 36)
  bytes.writeUInt32LE(dataBytes, 40)
  return bytes.toString('base64')
}

describe('speech WAV validation', () => {
  test('accepts PCM16 16 kHz mono and measures duration', () => {
    expect(decodeSpeechWav(wav(16_000)).durationMs).toBe(1000)
  })

  test('rejects invalid format, duration and oversized base64 before decoding', () => {
    expect(() => decodeSpeechWav(wav(100, { sampleRate: 48_000 }))).toThrow('PCM16')
    expect(() => decodeSpeechWav(wav(16_000 * 121))).toThrow('120 秒')
    try {
      decodeSpeechWav('A'.repeat(Math.ceil(4_194_305 / 3) * 4))
      throw new Error('expected failure')
    } catch (cause) {
      expect(cause).toBeInstanceOf(AgentError)
      expect((cause as AgentError).code).toBe('SPEECH_AUDIO_TOO_LARGE')
    }
  })
})

describe('speech RPC handler', () => {
  test('decodes the stable requests and delegates without exposing audio in status', async () => {
    const status = {
      state: 'ready',
      provider: 'sensevoice-llamacpp',
      runtimeVersion: '0.1.9',
      model: 'sensevoice-small-q8',
      variant: 'generic',
      maxDurationMs: 120_000,
      maxAudioBytes: 4_194_304,
    } as const
    const calls: unknown[] = []
    const runtime = {
      dependencies: {
        speech: {
          status: () => status,
          install: async (force: boolean) => {
            calls.push(['install', force])
            return status
          },
          transcribe: async (input: unknown) => {
            calls.push(['transcribe', input])
            return { text: '你好', detectedLanguage: 'zh', durationMs: 1000 }
          },
          cancel: (operationId: string) => {
            calls.push(['cancel', operationId])
            return { cancelled: true }
          },
        },
      },
    }
    expect(await speechHandlers.handle(runtime as never, 'speech/status', {}, {})).toEqual({
      status,
    })
    expect(
      await speechHandlers.handle(runtime as never, 'speech/install', { force: true }, {}),
    ).toEqual({ status })
    expect(
      await speechHandlers.handle(
        runtime as never,
        'speech/transcribe',
        {
          operationId: 'operation:speech:1',
          audio: { mediaType: 'audio/wav', encoding: 'base64', data: 'UklGRg==' },
        },
        {},
      ),
    ).toEqual({ text: '你好', detectedLanguage: 'zh', durationMs: 1000 })
    expect(
      await speechHandlers.handle(
        runtime as never,
        'speech/cancel',
        { operationId: 'operation:speech:1' },
        {},
      ),
    ).toEqual({ cancelled: true })
    expect(calls).toHaveLength(3)
  })
})

describe('speech installer supply-chain guards', () => {
  test('vendored extract-zip is the Pidex security build', async () => {
    const packagePath = require.resolve('extract-zip/package.json')
    const packageJson = JSON.parse(await readFile(packagePath, 'utf8')) as { version?: string }

    expect(packageJson.version).toBe('2.0.2-pidex.1')
    expect(packagePath.replaceAll('\\', '/')).toContain(
      '/node_modules/.bun/extract-zip@file+vendor+extract-zip',
    )
  })

  test('vendored extract-zip rejects relative symlinks that escape the extraction root', async () => {
    const root = await temporaryRoot()
    const archive = join(root, 'symlink-escape.zip')
    const destination = join(root, 'extract')
    const outside = join(root, 'outside.txt')
    const maliciousZip =
      'UEsDBBQAAAAAAAAAAAAFr4RLEQAAABEAAAAJAAAAc2FmZS9saW5rLi4vLi4vb3V0c2lkZS50eHRQSwECHgMUAAAAAAAAAAAABa+ESxEAAAARAAAACQAAAAAAAAAAAAAA/6EAAAAAc2FmZS9saW5rUEsFBgAAAAABAAEANwAAADgAAAAAAA=='
    await writeFile(archive, Buffer.from(maliciousZip, 'base64'))
    await writeFile(outside, 'sentinel', 'utf8')
    await mkdir(destination)

    await expect(extractZip(archive, { dir: destination })).rejects.toThrow(
      'points outside of the target directory',
    )
    expect(await readFile(outside, 'utf8')).toBe('sentinel')
  })

  test('vendored extract-zip rejects absolute symlink targets', async () => {
    const root = await temporaryRoot()
    const archive = join(root, 'absolute-symlink.zip')
    const destination = join(root, 'extract')
    const maliciousZip =
      'UEsDBBQAAAAAAHwDGV1zSK4yDAAAAAwAAAAJAAAAc2FmZS9saW5rL291dHNpZGUudHh0UEsBAhQAFAAAAAAAfAMZXXNIrjIMAAAADAAAAAkAAAAAAAAAAAAAAACgAAAAAHNhZmUvbGlua1BLBQYAAAAAAQABADcAAAAzAAAAAAA='
    await writeFile(archive, Buffer.from(maliciousZip, 'base64'))
    await mkdir(destination)

    await expect(extractZip(archive, { dir: destination })).rejects.toThrow(
      'points outside of the target directory',
    )
  })

  test('vendored extract-zip preserves nested files and onEntry callbacks', async () => {
    const root = await temporaryRoot()
    const archive = join(root, 'normal.zip')
    const destination = join(root, 'extract')
    const normalZip =
      'UEsDBBQAAAAAADEDGV2GphA2BQAAAAUAAAAQAAAAbmVzdGVkL2hlbGxvLnR4dGhlbGxvUEsBAhQAFAAAAAAAMQMZXYamEDYFAAAABQAAABAAAAAAAAAAAAAAAAAAAAAAAG5lc3RlZC9oZWxsby50eHRQSwUGAAAAAAEAAQA+AAAAMwAAAAAA'
    const entries: string[] = []
    await writeFile(archive, Buffer.from(normalZip, 'base64'))

    await extractZip(archive, {
      dir: destination,
      onEntry: (entry) => entries.push(entry.fileName),
    })

    expect(await readFile(join(destination, 'nested', 'hello.txt'), 'utf8')).toBe('hello')
    expect(entries).toEqual(['nested/hello.txt'])
  })

  test('rejects untrusted redirects, checksum mismatch and oversized responses', async () => {
    const root = await temporaryRoot()
    const redirect = new SpeechInstaller(
      root,
      () => undefined,
      async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://evil.example/runtime.zip' },
        }),
    )
    await expect(
      (redirect as any).download(
        SPEECH_ARTIFACTS.generic,
        join(root, 'redirect'),
        undefined,
        () => undefined,
      ),
    ).rejects.toThrow('不受信任')

    const mismatch = new SpeechInstaller(
      root,
      () => undefined,
      async () => new Response('wrong', { status: 200 }),
    )
    await expect(
      (mismatch as any).download(
        SPEECH_ARTIFACTS.generic,
        join(root, 'mismatch'),
        undefined,
        () => undefined,
      ),
    ).rejects.toThrow('SHA-256')

    const oversized = new SpeechInstaller(
      root,
      () => undefined,
      async () =>
        new Response('x', {
          status: 200,
          headers: { 'content-length': String(SPEECH_ARTIFACTS.generic.maximumBytes + 1) },
        }),
    )
    await expect(
      (oversized as any).download(
        SPEECH_ARTIFACTS.generic,
        join(root, 'oversized'),
        undefined,
        () => undefined,
      ),
    ).rejects.toThrow('大小')
  })

  test('rejects traversal and symlink ZIP entries', () => {
    expect(() => assertSafeSpeechZipEntry('C:\\safe', '..\\escape.exe', 0)).toThrow('不安全')
    expect(() => assertSafeSpeechZipEntry('C:\\safe', 'link.exe', 0xa000 << 16)).toThrow('不安全')
  })

  test('passes ZIP validation paths through the PowerShell child environment', async () => {
    if (process.platform !== 'win32') return
    const root = await temporaryRoot()
    const archive = join(root, 'empty.zip')
    const destination = join(root, 'extract')
    await writeFile(archive, Buffer.from('504b0506000000000000000000000000000000000000', 'hex'))
    await mkdir(destination)

    const installer = new SpeechInstaller(root, () => undefined)
    await expect((installer as any).validateZip(archive, destination)).resolves.toBeUndefined()
  })

  test('rejects a tampered executable even when its manifest hash is changed too', async () => {
    const root = await temporaryRoot()
    const installer = new SpeechInstaller(root, () => undefined)
    const files = {
      avx2: installer.runtimePath('avx2'),
      generic: installer.runtimePath('generic'),
      model: installer.modelPath(),
      vad: installer.vadPath(),
    }
    for (const path of Object.values(files)) {
      await mkdir(join(path, '..'), { recursive: true })
      await writeFile(path, 'fixture')
    }
    const fileHash = createHash('sha256').update('fixture').digest('hex')
    const artifacts = {
      avx2: {
        archiveSha256: SPEECH_ARTIFACTS.avx2.sha256,
        fileSha256: fileHash,
        path: `runtime/avx2/${SPEECH_EXECUTABLE}`,
      },
      generic: {
        archiveSha256: SPEECH_ARTIFACTS.generic.sha256,
        fileSha256: fileHash,
        path: `runtime/generic/${SPEECH_EXECUTABLE}`,
      },
      model: {
        archiveSha256: SPEECH_ARTIFACTS.model.sha256,
        fileSha256: fileHash,
        path: 'models/sensevoice-small-q8.gguf',
      },
      vad: {
        archiveSha256: SPEECH_ARTIFACTS.vad.sha256,
        fileSha256: fileHash,
        path: 'models/fsmn-vad.gguf',
      },
    }
    await writeFile(
      join(installer.installRoot(), 'install.json'),
      JSON.stringify({ version: 1, artifacts }),
    )
    expect(await installer.installed()).toBe(false)
  })

  test('restores the previous installation when activation fails', async () => {
    const root = await temporaryRoot()
    const installer = new SpeechInstaller(root, () => undefined)
    await mkdir(installer.installRoot(), { recursive: true })
    const marker = join(installer.installRoot(), 'previous-installation')
    await writeFile(marker, 'keep')

    await expect(
      (installer as any).activate(join(root, 'missing-staging-install')),
    ).rejects.toBeDefined()
    expect(await readFile(marker, 'utf8')).toBe('keep')
  })
})

describe('speech service lifecycle', () => {
  test('falls back from AVX2 once and remembers generic after valid output', async () => {
    const root = await temporaryRoot()
    const service = new SpeechTranscriptionService(root)
    ;(service as any).verifiedInstalled = true
    const variants: string[] = []
    ;(service as any).run = async (variant: string, path: string, durationMs: number) => {
      variants.push(variant)
      await access(path)
      return variant === 'generic' ? { text: '你好', detectedLanguage: 'zh', durationMs } : null
    }

    await expect(
      service.transcribe({
        operationId: 'operation:speech-fallback:1',
        audio: { mediaType: 'audio/wav', encoding: 'base64', data: wav(1600) },
      }),
    ).resolves.toMatchObject({ text: '你好', detectedLanguage: 'zh' })
    expect(variants).toEqual(['avx2', 'generic'])
    expect(JSON.parse(await readFile(join(root, 'runtime-variant.json'), 'utf8'))).toEqual({
      variant: 'generic',
    })
    expect(await readdir(join(root, '.tmp'))).toEqual([])
  })

  test('cancels native work and always removes the temporary WAV', async () => {
    const root = await temporaryRoot()
    const events: unknown[] = []
    const service = new SpeechTranscriptionService(root, (status) => {
      events.push(status)
    })
    ;(service as any).verifiedInstalled = true
    let temporary = ''
    let markStarted!: () => void
    const started = new Promise<void>((resolve) => {
      markStarted = resolve
    })
    ;(service as any).run = async (
      _variant: unknown,
      path: string,
      _duration: number,
      signal: AbortSignal,
    ) => {
      temporary = path
      await access(path)
      markStarted()
      await new Promise<void>((_resolve, reject) =>
        signal.addEventListener(
          'abort',
          () => reject(new AgentError('SPEECH_CANCELLED', 'cancelled', 409)),
          { once: true },
        ),
      )
      return null
    }
    const operationId = 'operation:speech-cancel:1'
    const pending = service.transcribe({
      operationId,
      audio: { mediaType: 'audio/wav', encoding: 'base64', data: wav(1600) },
    })
    await started
    expect(service.cancel(operationId)).toEqual({ cancelled: true })
    await expect(pending).rejects.toMatchObject({ code: 'SPEECH_CANCELLED' })
    await expect(access(temporary)).rejects.toBeDefined()
    expect(await readdir(join(root, '.tmp'))).toEqual([])
    const eventCount = events.length
    await service.dispose()
    ;(service as any).setStatus({ state: 'ready' })
    expect(events).toHaveLength(eventCount)
  })
})
