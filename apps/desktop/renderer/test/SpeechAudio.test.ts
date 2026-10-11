import { describe, expect, test } from 'bun:test'
import {
  DICTATION_SAMPLE_RATE,
  encodePcm16Wav,
} from '../src/features/session/composer/SpeechAudio.js'

describe('听写 WAV 编码', () => {
  test('输出 16kHz 单声道 PCM16 RIFF 数据', () => {
    const wav = encodePcm16Wav(new Float32Array([-1, 0, 1]))
    const bytes = new Uint8Array(wav)
    const view = new DataView(wav)

    expect(new TextDecoder().decode(bytes.subarray(0, 4))).toBe('RIFF')
    expect(new TextDecoder().decode(bytes.subarray(8, 12))).toBe('WAVE')
    expect(view.getUint16(20, true)).toBe(1)
    expect(view.getUint16(22, true)).toBe(1)
    expect(view.getUint32(24, true)).toBe(DICTATION_SAMPLE_RATE)
    expect(view.getUint16(34, true)).toBe(16)
    expect(view.getUint32(40, true)).toBe(6)
    expect(view.getInt16(44, true)).toBe(-32768)
    expect(view.getInt16(46, true)).toBe(0)
    expect(view.getInt16(48, true)).toBe(32767)
  })
})
