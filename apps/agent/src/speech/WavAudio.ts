import { AgentError } from '../Domain'
import { SPEECH_MAX_AUDIO_BYTES, SPEECH_MAX_DURATION_MS } from './SpeechCatalog'

const ascii = (bytes: Uint8Array, offset: number, length: number) =>
  new TextDecoder('ascii').decode(bytes.subarray(offset, offset + length))

export const decodeSpeechWav = (base64: string) => {
  if (!base64 || !/^[A-Za-z0-9+/]*={0,2}$/.test(base64) || base64.length % 4 !== 0) {
    throw new AgentError('SPEECH_AUDIO_INVALID', '录音数据不是有效 Base64', 400)
  }
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0
  if ((base64.length / 4) * 3 - padding > SPEECH_MAX_AUDIO_BYTES) {
    throw new AgentError('SPEECH_AUDIO_TOO_LARGE', '录音超过 4 MiB 上限', 413)
  }
  const bytes = new Uint8Array(Buffer.from(base64, 'base64'))
  if (bytes.byteLength > SPEECH_MAX_AUDIO_BYTES) {
    throw new AgentError('SPEECH_AUDIO_TOO_LARGE', '录音超过 4 MiB 上限', 413)
  }
  if (bytes.byteLength < 44 || ascii(bytes, 0, 4) !== 'RIFF' || ascii(bytes, 8, 4) !== 'WAVE') {
    throw new AgentError('SPEECH_AUDIO_INVALID', '录音不是有效的 RIFF/WAVE 文件', 400)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const riffSize = view.getUint32(4, true) + 8
  if (riffSize > bytes.byteLength || riffSize < 44)
    throw new AgentError('SPEECH_AUDIO_INVALID', 'WAV 长度字段无效', 400)
  let offset = 12
  let format: { encoding: number; channels: number; sampleRate: number; bits: number } | null = null
  let dataBytes = -1
  while (offset + 8 <= riffSize) {
    const id = ascii(bytes, offset, 4)
    const length = view.getUint32(offset + 4, true)
    const start = offset + 8
    const end = start + length
    if (end > riffSize) throw new AgentError('SPEECH_AUDIO_INVALID', 'WAV chunk 长度无效', 400)
    if (id === 'fmt ' && length >= 16) {
      format = {
        encoding: view.getUint16(start, true),
        channels: view.getUint16(start + 2, true),
        sampleRate: view.getUint32(start + 4, true),
        bits: view.getUint16(start + 14, true),
      }
    }
    if (id === 'data') dataBytes = length
    offset = end + (length % 2)
  }
  if (
    !format ||
    format.encoding !== 1 ||
    format.channels !== 1 ||
    format.sampleRate !== 16_000 ||
    format.bits !== 16 ||
    dataBytes < 0 ||
    dataBytes % 2 !== 0
  ) {
    throw new AgentError('SPEECH_AUDIO_INVALID', '仅支持 PCM16、16 kHz、单声道 WAV', 400)
  }
  const durationMs = Math.round(dataBytes / 32)
  if (durationMs > SPEECH_MAX_DURATION_MS) {
    throw new AgentError('SPEECH_DURATION_LIMIT', '录音时长超过 120 秒上限', 413)
  }
  return { bytes, durationMs }
}
