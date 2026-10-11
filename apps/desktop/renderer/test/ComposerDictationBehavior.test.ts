import { describe, expect, test } from 'bun:test'
import { EditorState, TextSelection } from 'prosemirror-state'
import { history, undo } from 'prosemirror-history'
import {
  composerSchema,
  insertTextTransaction,
} from '../src/features/session/composer/ComposerEditor.js'
import {
  acquireDictationStream,
  DictationGeneration,
  stopMediaStream,
} from '../src/features/session/composer/UseComposerDictation.js'
import { isDictationShortcut } from '../src/features/session/composer/UseComposerDictation.js'

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
    expect(isDictationShortcut({ ...event, isComposing: true })).toBe(false)
    expect(isDictationShortcut({ ...event, keyCode: 229 })).toBe(false)
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
