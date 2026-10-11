import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { arrayBufferToBase64 } from '../../../utils/BinaryEncoding.js'
import { useSpeechStatus } from '../../speech/UseSpeechStatus.js'
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

export type ComposerDictationState = {
  phase: ComposerDictationPhase
  elapsedMs: number
  error: string | null
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
  const [state, setState] = useState<ComposerDictationState>({
    phase: 'idle',
    elapsedMs: 0,
    error: null,
  })
  const recorderRef = useRef<MediaRecorder | null>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const contextRef = useRef<AudioContext | null>(null)
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

  const releaseCapture = useCallback(() => {
    clearTimers()
    if (streamRef.current) stopMediaStream(streamRef.current)
    streamRef.current = null
    recorderRef.current = null
  }, [clearTimers])

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
    setState({ phase: 'idle', elapsedMs: 0, error: null })
  }, [releaseCapture])

  const stop = useCallback(() => {
    clearTimers()
    const recorder = recorderRef.current
    if (recorder?.state === 'recording') recorder.stop()
  }, [clearTimers])

  const start = useCallback(async () => {
    if (!enabled) return
    if (speech.status?.state !== 'ready') {
      setState({
        phase: 'error',
        elapsedMs: 0,
        error: speech.status?.error?.message ?? '语音模型尚未准备好。',
      })
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || !globalThis.MediaRecorder) {
      setState({
        phase: 'error',
        elapsedMs: 0,
        error: '当前环境不支持麦克风录音。',
      })
      return
    }

    const generation = generationRef.current.begin()
    setState({ phase: 'starting', elapsedMs: 0, error: null })
    try {
      const settings = await desktopClient.getDesktopSettings()
      const preferredDeviceId = settings['desktop.voice.preferredInputDeviceId']
      const acquired = await acquireDictationStream(navigator.mediaDevices, preferredDeviceId)
      const stream = acquired.stream
      const preferredDeviceUnavailable = acquired.usedFallback
      if (!generationRef.current.isCurrent(generation)) {
        stopMediaStream(stream)
        return
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
        setState((current) => ({ ...current, phase: 'processing', error: null }))
        void transcribeRecordingRef.current(
          new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }),
          generation,
        )
      }
      recorder.onerror = () => {
        releaseCapture()
        if (!generationRef.current.isCurrent(generation)) return
        setState({ phase: 'error', elapsedMs: 0, error: '麦克风录音失败。' })
      }
      recorder.start(250)
      const startedAt = Date.now()
      setState({
        phase: 'recording',
        elapsedMs: 0,
        error: preferredDeviceUnavailable ? '首选麦克风不可用，已改用系统默认设备。' : null,
      })
      timerRef.current = setInterval(() => {
        setState((current) => ({
          ...current,
          elapsedMs: Date.now() - startedAt,
        }))
      }, 250)
      timeoutRef.current = setTimeout(stop, speech.status.maxDurationMs || DEFAULT_MAX_DURATION_MS)
    } catch (cause) {
      releaseCapture()
      if (!generationRef.current.isCurrent(generation)) return
      setState({ phase: 'error', elapsedMs: 0, error: captureError(cause) })
    }
  }, [enabled, releaseCapture, speech.status, stop])

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
        if (result.text.trim()) transcriptRef.current(result.text.trim())
        setState({ phase: 'idle', elapsedMs: 0, error: null })
      } catch (cause) {
        if (!generationRef.current.isCurrent(generation)) return
        operationIdRef.current = null
        setState({ phase: 'error', elapsedMs: 0, error: errorMessage(cause) })
      }
    },
    [speech.status?.maxAudioBytes],
  )
  transcribeRecordingRef.current = transcribeRecording

  const toggle = useCallback(() => {
    if (recorderRef.current?.state === 'recording') stop()
    else if (state.phase === 'starting' || state.phase === 'processing') cancel()
    else void start()
  }, [cancel, start, state.phase, stop])

  const previousDraftKeyRef = useRef(draftKey)
  useEffect(() => {
    if (previousDraftKeyRef.current === draftKey) return
    previousDraftKeyRef.current = draftKey
    cancel()
  }, [cancel, draftKey])

  useEffect(
    () => () => {
      generationRef.current.invalidate()
      const recorder = recorderRef.current
      if (recorder) {
        recorder.ondataavailable = null
        recorder.onstop = null
        if (recorder.state !== 'inactive') recorder.stop()
      }
      releaseCapture()
      const context = contextRef.current
      if (context) void context.close().catch(() => {})
      const operationId = operationIdRef.current
      if (operationId) {
        void desktopClient.cancelSpeech(operationId).catch(() => {})
      }
    },
    [releaseCapture],
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
    toggle,
    cancel,
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
