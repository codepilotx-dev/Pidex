const WAV_HEADER_BYTES = 44
export const DICTATION_SAMPLE_RATE = 16_000

export async function audioBlobToPcm16Wav(
  blob: Blob,
  onContextCreated?: (context: AudioContext | null) => void,
): Promise<ArrayBuffer> {
  const AudioContextConstructor = globalThis.AudioContext
  if (!AudioContextConstructor || !globalThis.OfflineAudioContext) {
    throw new Error('当前环境不支持音频转码。')
  }

  const context = new AudioContextConstructor()
  onContextCreated?.(context)
  try {
    const decoded = await context.decodeAudioData(await blob.arrayBuffer())
    const frameCount = Math.max(1, Math.ceil(decoded.duration * DICTATION_SAMPLE_RATE))
    const offline = new OfflineAudioContext(1, frameCount, DICTATION_SAMPLE_RATE)
    const source = offline.createBufferSource()
    source.buffer = decoded
    source.connect(offline.destination)
    source.start()
    const rendered = await offline.startRendering()
    return encodePcm16Wav(rendered.getChannelData(0), DICTATION_SAMPLE_RATE)
  } finally {
    onContextCreated?.(null)
    await context.close().catch(() => {})
  }
}

export function encodePcm16Wav(
  samples: Float32Array,
  sampleRate = DICTATION_SAMPLE_RATE,
): ArrayBuffer {
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + samples.length * 2)
  const view = new DataView(buffer)

  writeAscii(view, 0, 'RIFF')
  view.setUint32(4, buffer.byteLength - 8, true)
  writeAscii(view, 8, 'WAVE')
  writeAscii(view, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  writeAscii(view, 36, 'data')
  view.setUint32(40, samples.length * 2, true)

  for (let index = 0; index < samples.length; index += 1) {
    const sample = Math.max(-1, Math.min(1, samples[index] ?? 0))
    view.setInt16(
      WAV_HEADER_BYTES + index * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    )
  }
  return buffer
}

function writeAscii(view: DataView, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    view.setUint8(offset + index, value.charCodeAt(index))
  }
}
