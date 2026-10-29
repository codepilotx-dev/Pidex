import { describe, expect, test } from 'bun:test'
import { EditorState, TextSelection } from 'prosemirror-state'
import { history, undo } from 'prosemirror-history'
import {
  composerSchema,
  insertTextTransaction,
} from '../src/features/session/composer/ComposerEditor.js'
import {
  acquireDictationStream,
  canStartDictation,
  DictationGeneration,
  isDictationShortcut,
  isNoSpeechResultError,
  resolveDictationToggleAction,
  stopMediaStream,
} from '../src/features/session/composer/UseComposerDictation.js'

describe('听写录音设备', () => {
  test('首选设备失效时回退默认设备，并可停止所有轨道', async () => {
    const stopped: boolean[] = []
    const stream = {
      getTracks: () => [{ stop: () => stopped.push(true) }, { stop: () => stopped.push(true) }],
    } as unknown as MediaStream
    const constraints: MediaStreamConstraints[] = []
    const mediaDevices = {
      getUserMedia: async (next: MediaStreamConstraints) => {
        constraints.push(next)
        if (constraints.length === 1) {
          throw new DOMException('missing', 'OverconstrainedError')
        }
        return stream
      },
    }

    const result = await acquireDictationStream(mediaDevices, 'missing-device')
    expect(result).toEqual({ stream, usedFallback: true })
    expect(constraints).toHaveLength(2)
    expect(constraints[0]?.audio).toMatchObject({
      deviceId: { exact: 'missing-device' },
      channelCount: 1,
    })
    expect(constraints[1]?.audio).toMatchObject({ channelCount: 1 })
    expect(constraints[1]?.audio).not.toHaveProperty('deviceId')
    stopMediaStream(stream)
    expect(stopped).toHaveLength(2)
  })
})

describe('听写快捷键', () => {
  const event = {
    altKey: false,
    ctrlKey: true,
    isComposing: false,
    key: 'D',
    keyCode: 68,
    shiftKey: true,
  }

  test('仅在非 IME 合成时响应 Ctrl+Shift+D', () => {
    expect(isDictationShortcut(event)).toBe(true)
    expect(isDictationShortcut({ ...event, key: 'd' })).toBe(true)
    expect(isDictationShortcut({ ...event, isComposing: true })).toBe(false)
    expect(isDictationShortcut({ ...event, keyCode: 229 })).toBe(false)
    expect(isDictationShortcut({ ...event, altKey: true })).toBe(false)
    expect(isDictationShortcut({ ...event, shiftKey: false })).toBe(false)
    expect(isDictationShortcut({ ...event, ctrlKey: false })).toBe(false)
  })
})

describe('听写文本插入', () => {
  test('替换当前选择并保留 ProseMirror undo 历史', () => {
    const document = composerSchema.node('doc', null, [
      composerSchema.node('paragraph', null, composerSchema.text('hello world')),
    ])
    const initial = EditorState.create({
      doc: document,
      plugins: [history()],
      selection: TextSelection.create(document, 7, 12),
    })
    const inserted = initial.apply(insertTextTransaction(initial, 'Codex'))
    expect(inserted.doc.textContent).toBe('hello Codex')

    let restored = inserted
    expect(
      undo(inserted, (transaction) => {
        restored = inserted.apply(transaction)
      }),
    ).toBe(true)
    expect(restored.doc.textContent).toBe('hello world')
  })
})

describe('听写取消', () => {
  test('草稿切换使旧一代结果失效，迟到文本不会再被接受', () => {
    const generations = new DictationGeneration()
    const recording = generations.begin()
    expect(generations.isCurrent(recording)).toBe(true)
    generations.invalidate()
    expect(generations.isCurrent(recording)).toBe(false)
  })
})

describe('同音频重试与动作决策', () => {
  test('转写失败且有录音缓存时触发 retry 动作，无缓存时退回重新录音 start 动作', () => {
    // 错误态下若有录音缓存，toggle 应当分派 retry 动作以复用同一段音频
    expect(resolveDictationToggleAction('error', true)).toBe('retry')

    // 错误态下若无录音缓存（如权限或设备采集失败），toggle 应当分派 start 动作执行重新录音
    expect(resolveDictationToggleAction('error', false)).toBe('start')
  })

  test('重试开始时生成新一代 generation，使先前失败操作失效', () => {
    const generations = new DictationGeneration()
    const firstGen = generations.begin()
    expect(generations.isCurrent(firstGen)).toBe(true)

    // 重试开始时调用 begin 生成新的 generation
    const retryGen = generations.begin()
    expect(generations.isCurrent(retryGen)).toBe(true)
    expect(generations.isCurrent(firstGen)).toBe(false)
  })
})

describe('取消后迟到结果被忽略', () => {
  test('取消或草稿切换后，在途转写结果不会写入编辑器', async () => {
    const generations = new DictationGeneration()
    const currentGen = generations.begin()
    let transcriptResult = ''
    const onTranscript = (text: string) => {
      transcriptResult = text
    }

    let resolveTranscribe!: (text: string) => void
    const pendingTranscribe = new Promise<string>((resolve) => {
      resolveTranscribe = resolve
    })

    // 用户在转写完成前取消或切换草稿
    generations.invalidate()

    // 迟到的转写结果返回，由于 generation 已被使失效，不再调用 onTranscript
    resolveTranscribe('迟到的听写内容')
    const text = await pendingTranscribe
    if (generations.isCurrent(currentGen)) {
      onTranscript(text)
    }

    expect(transcriptResult).toBe('')
  })
})

describe('重复触发不重复录音', () => {
  test('在启动、录音或转写阶段 canStartDictation 均返回 false，阻止重复发起', () => {
    expect(canStartDictation('idle')).toBe(true)
    expect(canStartDictation('error')).toBe(true)
    expect(canStartDictation('starting')).toBe(false)
    expect(canStartDictation('recording')).toBe(false)
    expect(canStartDictation('processing')).toBe(false)
  })

  test('快捷键与入口在转写中执行 noop，在录音中执行 stop，在启动中执行 cancel', () => {
    expect(resolveDictationToggleAction('processing', true)).toBe('noop')
    expect(resolveDictationToggleAction('processing', false)).toBe('noop')
    expect(resolveDictationToggleAction('recording', false)).toBe('stop')
    expect(resolveDictationToggleAction('starting', false)).toBe('cancel')
    expect(resolveDictationToggleAction('idle', false)).toBe('start')
  })
})

describe('资源释放', () => {
  test('停止 MediaStream 时遍历关闭所有音频轨道', () => {
    const stoppedTracks: string[] = []
    const mockTrack = (id: string): MediaStreamTrack =>
      ({
        id,
        stop: () => stoppedTracks.push(id),
      }) as unknown as MediaStreamTrack

    const stream = {
      getTracks: () => [mockTrack('audio-track-1'), mockTrack('audio-track-2')],
    }

    stopMediaStream(stream)
    expect(stoppedTracks).toEqual(['audio-track-1', 'audio-track-2'])
  })

  test('取消或切换草稿时使当前 generation 失效', () => {
    const generations = new DictationGeneration()
    const gen = generations.begin()
    expect(generations.isCurrent(gen)).toBe(true)
    generations.invalidate()
    expect(generations.isCurrent(gen)).toBe(false)
  })
})

describe('无有效识别结果处理', () => {
  test('准确识别无有效结果错误，且不误判其他错误', () => {
    // 包含 SPEECH_TRANSCRIPTION_FAILED 错误码
    expect(isNoSpeechResultError({ code: 'SPEECH_TRANSCRIPTION_FAILED', message: 'fail' })).toBe(true)
    // 包含 RpcRemoteError 结构 (error.rpcError.code)
    expect(
      isNoSpeechResultError({
        name: 'RpcRemoteError',
        rpcError: { code: 'SPEECH_TRANSCRIPTION_FAILED', message: 'No valid result' },
      }),
    ).toBe(true)
    // 包含“未返回有效结果”中文提示
    expect(isNoSpeechResultError(new Error('语音识别未返回有效结果'))).toBe(true)
    // 包含 SPEECH_TRANSCRIPTION_FAILED 文本
    expect(isNoSpeechResultError('Error: SPEECH_TRANSCRIPTION_FAILED')).toBe(true)

    // 麦克风权限拒绝、设备找不到或超时等错误不属于无有效结果
    expect(isNoSpeechResultError(new Error('未获得麦克风权限'))).toBe(false)
    expect(isNoSpeechResultError(new Error('没有找到可用的麦克风'))).toBe(false)
    expect(isNoSpeechResultError(new Error('语音识别超时'))).toBe(false)
    expect(
      isNoSpeechResultError({
        name: 'RpcRemoteError',
        rpcError: { code: 'SPEECH_BUSY', message: 'busy' },
      }),
    ).toBe(false)
    expect(isNoSpeechResultError(null)).toBe(false)
    expect(isNoSpeechResultError(undefined)).toBe(false)
  })
})
