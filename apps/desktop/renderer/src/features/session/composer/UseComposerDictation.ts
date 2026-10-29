import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { arrayBufferToBase64 } from '../../../utils/BinaryEncoding.js'
import { useSpeechStatus } from '../../speech/UseSpeechStatus.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import type { ComposerDraftKey } from './ComposerTypes.js'
import { audioBlobToPcm16Wav } from './SpeechAudio.js'
import { errorMessageOf as errorMessage } from '@pidex/shared/errors'

const DEFAULT_MAX_DURATION_MS = 120_000

export function isDictationShortcut(
  event: Pick<KeyboardEvent, 'altKey' | 'ctrlKey' | 'isComposing' | 'key' | 'keyCode' | 'shiftKey'>,
): boolean {
  return (
    !event.isComposing &&
    event.keyCode !== 229 &&
    event.ctrlKey &&
    event.shiftKey &&
    !event.altKey &&
    event.key.toLowerCase() === 'd'
  )
}

export type ComposerDictationPhase = 'idle' | 'starting' | 'recording' | 'processing' | 'error'

export function canStartDictation(phase: ComposerDictationPhase): boolean {
  return phase !== 'starting' && phase !== 'recording' && phase !== 'processing'
}

export type DictationToggleAction = 'start' | 'stop' | 'cancel' | 'retry' | 'noop'

export function resolveDictationToggleAction(
  phase: ComposerDictationPhase,
  canRetry: boolean,
): DictationToggleAction {
  switch (phase) {
    case 'recording':
      return 'stop'
    case 'starting':
      return 'cancel'
    case 'processing':
      return 'noop'
    case 'error':
      return canRetry ? 'retry' : 'start'
    case 'idle':
    default:
      return 'start'
  }
}

export type ComposerDictationState = {
  phase: ComposerDictationPhase
  elapsedMs: number
  error: string | null
  canRetry: boolean
}

type UseComposerDictationOptions = {
  enabled: boolean
  draftKey: ComposerDraftKey
  onTranscript: (text: string) => void
}

export function useComposerDictation({
  enabled,
  draftKey,
  onTranscript,
}: UseComposerDictationOptions) {
  const speech = useSpeechStatus()
  const prefersReduced = usePrefersReducedMotion()
  const prefersReducedRef = useRef(prefersReduced)
  prefersReducedRef.current = prefersReduced
  const [state, setState] = useState<ComposerDictationState>({
    phase: 'idle',
    elapsedMs: 0,
    error: null,
    canRetry: false,
  })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
  const waveformContextRef = useRef<AudioContext | null>(null)
  const analyserRef = useRef<AnalyserNode | null>(null)
  const animationFrameRef = useRef<number | null>(null)
  const frameTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const canvasColorRef = useRef('currentColor')
  const lastDrawTimeRef = useRef(0)
  const dataArrayRef = useRef<Uint8Array<ArrayBuffer> | null>(null)
  const cachedAudioBlobRef = useRef<Blob | null>(null)
  const operationIdRef = useRef<string | null>(null)
  const generationRef = useRef(new DictationGeneration())
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const transcriptRef = useRef(onTranscript)
  const transcribeRecordingRef = useRef<(blob: Blob, generation: number) => Promise<void>>(
    async () => {},
  )
  transcriptRef.current = onTranscript

  const clearTimers = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    if (timeoutRef.current) clearTimeout(timeoutRef.current)
    timerRef.current = null
    timeoutRef.current = null
  }, [])

  const stopWaveform = useCallback(() => {
    if (animationFrameRef.current !== null) {
      if (typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(animationFrameRef.current)
      }
      animationFrameRef.current = null
    }
    if (frameTimeoutRef.current !== null) {
      clearTimeout(frameTimeoutRef.current)
      frameTimeoutRef.current = null
    }
    const wfContext = waveformContextRef.current
    waveformContextRef.current = null
    if (wfContext) {
      void wfContext.close().catch(() => {})
    }
    analyserRef.current = null
    lastDrawTimeRef.current = 0
  }, [])

  const releaseCapture = useCallback(() => {
    clearTimers()
    stopWaveform()
    if (streamRef.current) stopMediaStream(streamRef.current)
    streamRef.current = null
    recorderRef.current = null
  }, [clearTimers, stopWaveform])

  const drawWaveform = useCallback(() => {
    const canvas = canvasRef.current
    const analyser = analyserRef.current
    if (!canvas || !analyser) return

    const now = typeof performance !== 'undefined' ? performance.now() : Date.now()
    const isReduced = prefersReducedRef.current
    lastDrawTimeRef.current = now

    const ctx = canvas.getContext('2d')
    if (ctx) {
      const width = canvas.width
      const height = canvas.height
      ctx.clearRect(0, 0, width, height)

      const bufferLength = analyser.frequencyBinCount
      if (!dataArrayRef.current || dataArrayRef.current.length !== bufferLength) {
        dataArrayRef.current = new Uint8Array(new ArrayBuffer(bufferLength))
      }
      const dataArray = dataArrayRef.current
      analyser.getByteFrequencyData(dataArray)

      ctx.fillStyle = canvasColorRef.current

      const barCount = 12
      const barWidth = 2
      const barGap = 2
      const totalBarsWidth = barCount * barWidth + (barCount - 1) * barGap
      const startX = Math.max(0, (width - totalBarsWidth) / 2)
      const step = Math.max(1, Math.floor(bufferLength / barCount))

      for (let i = 0; i < barCount; i++) {
        const dataIndex = Math.min(i * step, bufferLength - 1)
        const rawVal = dataArray[dataIndex] ?? 0
        const norm = rawVal / 255
        // Under reduced motion: dampen dynamic amplitude variation to smooth subtle wave
        const factor = isReduced ? Math.max(0.18, 0.2 + norm * 0.35) : Math.max(0.15, norm)
        const barHeight = Math.max(2, Math.min(height, height * factor))
        const x = startX + i * (barWidth + barGap)
        const y = (height - barHeight) / 2

        ctx.beginPath()
        if (typeof ctx.roundRect === 'function') {
          ctx.roundRect(x, y, barWidth, barHeight, 1)
        } else {
          ctx.rect(x, y, barWidth, barHeight)
        }
        ctx.fill()
      }
    }

    // Throttled schedule: sleep between frames (~30 FPS in normal mode, ~8 FPS under reduced motion)
    // to avoid high-refresh display CPU spin.
    const minInterval = isReduced ? 120 : 32
    if (frameTimeoutRef.current !== null) {
      clearTimeout(frameTimeoutRef.current)
      frameTimeoutRef.current = null
    }
    frameTimeoutRef.current = setTimeout(() => {
      frameTimeoutRef.current = null
      if (typeof requestAnimationFrame === 'function') {
        animationFrameRef.current = requestAnimationFrame(drawWaveform)
      } else {
        drawWaveform()
      }
    }, minInterval)
  }, [])

  const startWaveformLoop = useCallback(() => {
    stopWaveform()
    if (typeof requestAnimationFrame === 'function') {
      animationFrameRef.current = requestAnimationFrame(drawWaveform)
    }
  }, [drawWaveform, stopWaveform])

  const bindWaveformCanvas = useCallback(
    (canvas: HTMLCanvasElement | null) => {
      canvasRef.current = canvas
      if (canvas) {
        try {
          if (typeof window !== 'undefined') {
            canvasColorRef.current = window.getComputedStyle(canvas).color || 'currentColor'
          }
        } catch {
          // ignore
        }
        if (analyserRef.current) {
          startWaveformLoop()
        }
      } else {
        stopWaveform()
      }
    },
    [startWaveformLoop, stopWaveform],
  )

  const cancel = useCallback(() => {
    generationRef.current.invalidate()
    const recorder = recorderRef.current
    if (recorder) {
      recorder.ondataavailable = null
      recorder.onstop = null
      if (recorder.state !== 'inactive') recorder.stop()
    }
    releaseCapture()
    const context = contextRef.current
    contextRef.current = null
    if (context) void context.close().catch(() => {})
    const operationId = operationIdRef.current
    operationIdRef.current = null
    if (operationId) {
      void desktopClient.cancelSpeech(operationId).catch(() => {})
    }
    cachedAudioBlobRef.current = null
    setState({ phase: 'idle', elapsedMs: 0, error: null, canRetry: false })
  }, [releaseCapture])

  const stop = useCallback(() => {
    clearTimers()
    stopWaveform()
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }, [clearTimers, stopWaveform])

  const start = useCallback(async () => {
    if (!enabled) return
    if (!canStartDictation(state.phase)) {
      return
    }
    if (speech.status?.state !== 'ready') {
      setState({
        phase: 'error',
        elapsedMs: 0,
        error: speech.status?.error?.message ?? '语音模型尚未准备好。',
        canRetry: false,
      })
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      setState({
        phase: 'error',
        elapsedMs: 0,
        error: '当前环境不支持麦克风录音。',
        canRetry: false,
      })
      return
    }

    cachedAudioBlobRef.current = null
    const generation = generationRef.current.begin()
    setState({ phase: 'starting', elapsedMs: 0, error: null, canRetry: false })
    try {
      const settings = await desktopClient.getDesktopSettings().catch(() => ({} as Record<string, string>))
      const preferredDeviceId = settings['desktop.voice.preferredInputDeviceId'] ?? ''
      const acquired = await acquireDictationStream(navigator.mediaDevices, preferredDeviceId)
      const stream = acquired.stream
      const preferredDeviceUnavailable = acquired.usedFallback
      if (!generationRef.current.isCurrent(generation)) {
        stopMediaStream(stream)
        return
      }

      try {
        const AudioCtx =
          globalThis.AudioContext ||
          (globalThis as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
        if (AudioCtx) {
          const audioCtx = new AudioCtx()
          waveformContextRef.current = audioCtx
          const source = audioCtx.createMediaStreamSource(stream)
          const analyser = audioCtx.createAnalyser()
          analyser.fftSize = 64
          analyser.smoothingTimeConstant = 0.5
          source.connect(analyser)
          analyserRef.current = analyser
          startWaveformLoop()
        }
      } catch {
        // Fallback gracefully if Web Audio Analyser is unavailable
      }

      const chunks: Blob[] = []
      streamRef.current = stream
      const recorder = new MediaRecorder(stream, mediaRecorderOptions())
      recorderRef.current = recorder
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunks.push(event.data)
      }
      recorder.onstop = () => {
        releaseCapture()
        if (!generationRef.current.isCurrent(generation)) return
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' })
        if (blob.size === 0) {
          cachedAudioBlobRef.current = null
          setState({ phase: 'idle', elapsedMs: 0, error: null, canRetry: false })
          return
        }
        cachedAudioBlobRef.current = blob
        setState({ phase: 'processing', elapsedMs: 0, error: null, canRetry: false })
        void transcribeRecordingRef.current(blob, generation)
      }
      recorder.onerror = () => {
        releaseCapture()
        if (!generationRef.current.isCurrent(generation)) return
        cachedAudioBlobRef.current = null
        setState({ phase: 'error', elapsedMs: 0, error: '麦克风录音失败。', canRetry: false })
      }
      recorder.start(1000)
      const startedAt = Date.now()
      setState({
        phase: 'recording',
        elapsedMs: 0,
        error: preferredDeviceUnavailable ? '首选麦克风不可用，已改用系统默认设备。' : null,
        canRetry: false,
      })
      timerRef.current = setInterval(() => {
        setState((current) => ({
          ...current,
          elapsedMs: Date.now() - startedAt,
        }))
      }, 1000)
      timeoutRef.current = setTimeout(stop, speech.status.maxDurationMs || DEFAULT_MAX_DURATION_MS)
    } catch (cause) {
      releaseCapture()
      if (!generationRef.current.isCurrent(generation)) return
      cachedAudioBlobRef.current = null
      setState({ phase: 'error', elapsedMs: 0, error: captureError(cause), canRetry: false })
    }
  }, [enabled, releaseCapture, speech.status, startWaveformLoop, state.phase, stop])

  const transcribeRecording = useCallback(
    async (blob: Blob, generation: number) => {
      try {
        const wav = await audioBlobToPcm16Wav(blob, (context) => {
          contextRef.current = context
        })
        if (!generationRef.current.isCurrent(generation)) return
        if (speech.status?.maxAudioBytes && wav.byteLength > speech.status.maxAudioBytes) {
          throw new Error('录音内容过长，请缩短后重试。')
        }
        const operationId = crypto.randomUUID()
        operationIdRef.current = operationId
        const result = await desktopClient.transcribeSpeech({
          operationId,
          audio: {
            mediaType: 'audio/wav',
            encoding: 'base64',
            data: arrayBufferToBase64(wav),
          },
        })
        if (!generationRef.current.isCurrent(generation)) return
        operationIdRef.current = null
        cachedAudioBlobRef.current = null
        const text = result?.text?.trim() ?? ''
        if (text) transcriptRef.current(text)
        setState({ phase: 'idle', elapsedMs: 0, error: null, canRetry: false })
      } catch (cause) {
        if (!generationRef.current.isCurrent(generation)) return
        operationIdRef.current = null
        cachedAudioBlobRef.current = null
        if (isNoSpeechResultError(cause)) {
          setState({ phase: 'idle', elapsedMs: 0, error: null, canRetry: false })
          return
        }
        setState({
          phase: 'error',
          elapsedMs: 0,
          error: errorMessage(cause),
          canRetry: false,
        })
      }
    },
    [speech.status?.maxAudioBytes],
  )
  transcribeRecordingRef.current = transcribeRecording

  const retry = useCallback(async () => {
    if (!canStartDictation(state.phase)) {
      return
    }
    const blob = cachedAudioBlobRef.current
    if (!blob) {
      void start()
      return
    }
    const generation = generationRef.current.begin()
    setState({ phase: 'processing', elapsedMs: 0, error: null, canRetry: false })
    await transcribeRecordingRef.current(blob, generation)
  }, [start, state.phase])

  const toggle = useCallback(() => {
    const action = resolveDictationToggleAction(
      state.phase,
      Boolean(cachedAudioBlobRef.current),
    )
    switch (action) {
      case 'stop':
        stop()
        break
      case 'cancel':
        cancel()
        break
      case 'retry':
        void retry()
        break
      case 'start':
        void start()
        break
      case 'noop':
      default:
        break
    }
  }, [cancel, retry, start, state.phase, stop])

  const previousDraftKeyRef = useRef(draftKey)
  useEffect(() => {
    if (previousDraftKeyRef.current === draftKey) return
    previousDraftKeyRef.current = draftKey
    cancel()
  }, [cancel, draftKey])

  const previousEnabledRef = useRef(enabled)
  useEffect(() => {
    if (previousEnabledRef.current === enabled) return
    previousEnabledRef.current = enabled
    if (!enabled) cancel()
  }, [cancel, enabled])

  useEffect(
    () => () => {
      cancel()
    },
    [cancel],
  )

  return {
    ...state,
    status: speech.status,
    available:
      enabled &&
      speech.status !== null &&
      (speech.status.state === 'ready' ||
        state.phase === 'starting' ||
        state.phase === 'recording' ||
        state.phase === 'processing'),
    canRetry: state.canRetry,
    start,
    stop,
    cancel,
    retry,
    toggle,
    bindWaveformCanvas,
  }
}

function mediaRecorderOptions(): MediaRecorderOptions | undefined {
  for (const mimeType of ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus']) {
    if (MediaRecorder.isTypeSupported(mimeType)) return { mimeType }
  }
  return undefined
}

export class DictationGeneration {
  #current = 0

  begin(): number {
    this.#current += 1
    return this.#current
  }

  invalidate(): void {
    this.#current += 1
  }

  isCurrent(generation: number): boolean {
    return this.#current === generation
  }
}

function audioConstraints(deviceId: string): MediaTrackConstraints {
  return {
    ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
    channelCount: 1,
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
  }
}

export async function acquireDictationStream(
  mediaDevices: Pick<MediaDevices, 'getUserMedia'>,
  preferredDeviceId: string,
): Promise<{ stream: MediaStream; usedFallback: boolean }> {
  try {
    return {
      stream: await mediaDevices.getUserMedia({
        audio: audioConstraints(preferredDeviceId),
      }),
      usedFallback: false,
    }
  } catch (cause) {
    if (!preferredDeviceId || !isUnavailableDeviceError(cause)) throw cause
    return {
      stream: await mediaDevices.getUserMedia({
        audio: audioConstraints(''),
      }),
      usedFallback: true,
    }
  }
}

export function stopMediaStream(stream: Pick<MediaStream, 'getTracks'>): void {
  for (const track of stream.getTracks()) track.stop()
}

function isUnavailableDeviceError(error: unknown): boolean {
  return (
    error instanceof DOMException &&
    (error.name === 'OverconstrainedError' || error.name === 'NotFoundError')
  )
}

function captureError(error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') return '未获得麦克风权限，请在系统设置中允许访问。'
    if (error.name === 'NotFoundError') return '没有找到可用的麦克风。'
    if (error.name === 'OverconstrainedError') return '首选麦克风当前不可用，请在设置中重新选择。'
  }
  return errorMessage(error)
}

export function isNoSpeechResultError(error: unknown): boolean {
  if (!error) return false
  if (typeof error === 'object' && error !== null) {
    if ('code' in error && (error as { code?: unknown }).code === 'SPEECH_TRANSCRIPTION_FAILED') {
      return true
    }
    if (
      'rpcError' in error &&
      typeof (error as { rpcError?: unknown }).rpcError === 'object' &&
      (error as { rpcError?: { code?: unknown } }).rpcError?.code === 'SPEECH_TRANSCRIPTION_FAILED'
    ) {
      return true
    }
  }
  const message = errorMessage(error)
  return message.includes('未返回有效结果') || message.includes('SPEECH_TRANSCRIPTION_FAILED')
}
