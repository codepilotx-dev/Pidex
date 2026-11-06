import { describe, expect, test } from 'bun:test'
import { EditorState } from 'prosemirror-state'
import { defaultDesktopStoredSettings, normalizeDesktopStoredSettings } from '../shared/SettingsSchema.js'
import {
  ComposerPredictionController,
  resolveComposerPredictionKeyAction,
  selectLatestCompletedTurnId,
} from '../src/features/session/composer/ComposerPrediction.js'
import {
  composerDocumentToProseMirrorDocument,
  insertTextTransaction,
} from '../src/features/session/composer/ComposerEditor.js'
import { composerDocumentFromProseMirrorDocument } from '../src/features/session/composer/ComposerEditor.js'

const gate = (
  overrides: Partial<Parameters<ComposerPredictionController['sync']>[0]> = {},
): Parameters<ComposerPredictionController['sync']>[0] => ({
  enabled: true,
  threadId: 'thread:1',
  turnId: 'turn:1',
  inputEmpty: true,
  ...overrides,
})

/** 用空文档构造真实 EditorState，验证 Tab 接受写入的是可撤销的文档事务。 */
const emptyState = () =>
  EditorState.create({
    doc: composerDocumentToProseMirrorDocument({ text: '', tokens: [] }),
    selection: undefined,
  })

describe('composer 输入预测设置', () => {
  test('默认关闭，缺失或非布尔值都归一化为 false', () => {
    expect(defaultDesktopStoredSettings()['desktop.composer_predictions']).toBe(false)
    expect(
      normalizeDesktopStoredSettings({})['desktop.composer_predictions'],
    ).toBe(false)
    expect(
      normalizeDesktopStoredSettings({ 'desktop.composer_predictions': 'yes' })[
        'desktop.composer_predictions'
      ],
    ).toBe(false)
    expect(
      normalizeDesktopStoredSettings({ 'desktop.composer_predictions': true })[
        'desktop.composer_predictions'
      ],
    ).toBe(true)
  })
})

describe('ComposerPredictionController', () => {
  test('关闭设置时不发起请求', () => {
    const controller = new ComposerPredictionController()
    expect(controller.sync(gate({ enabled: false }))).toBeNull()
    expect(controller.prediction).toBeNull()
  })

  test('同一轮次只请求一次', () => {
    const controller = new ComposerPredictionController()
    const first = controller.sync(gate())
    expect(first).toEqual({ sequence: expect.any(Number), threadId: 'thread:1', turnId: 'turn:1' })
    expect(controller.sync(gate())).toBeNull()
  })

  test('新轮次会重新请求', () => {
    const controller = new ComposerPredictionController()
    controller.sync(gate())
    expect(controller.sync(gate({ turnId: 'turn:2' }))?.turnId).toBe('turn:2')
  })

  test('输入变化后迟到的响应不会覆盖非空草稿', () => {
    const controller = new ComposerPredictionController()
    const request = controller.sync(gate())!
    controller.sync(gate({ inputEmpty: false }))
    expect(controller.accept(request.sequence, '旧的预测', false)).toBe(false)
    expect(controller.prediction).toBeNull()
  })

  test('序号落后的迟到响应被丢弃', () => {
    const controller = new ComposerPredictionController()
    const first = controller.sync(gate())!
    controller.dismiss()
    const second = controller.sync(gate({ turnId: 'turn:2' }))!
    expect(second.sequence).toBeGreaterThan(first.sequence)
    expect(controller.accept(first.sequence, '过期结果', true)).toBe(false)
    expect(controller.accept(second.sequence, '最新结果', true)).toBe(true)
    expect(controller.prediction).toBe('最新结果')
  })

  test('Escape 关闭后同一轮次不再自动弹出', () => {
    const controller = new ComposerPredictionController()
    const request = controller.sync(gate())!
    controller.accept(request.sequence, '建议', true)
    controller.dismiss()
    expect(controller.sync(gate())).toBeNull()
    expect(controller.sync(gate({ turnId: 'turn:2' }))?.turnId).toBe('turn:2')
  })
})

describe('输入预测按键裁决', () => {
  const base = {
    key: 'Tab',
    shiftKey: false,
    composing: false,
    menuOpen: false,
    prediction: '继续补齐测试',
    inputEmpty: true,
  }

  test('Tab 接受，Escape 关闭', () => {
    expect(resolveComposerPredictionKeyAction(base)).toEqual({ type: 'accept' })
    expect(resolveComposerPredictionKeyAction({ ...base, key: 'Escape' })).toEqual({
      type: 'dismiss',
    })
  })

  test('没有预测、输入非空或菜单打开时不拦截按键', () => {
    expect(resolveComposerPredictionKeyAction({ ...base, prediction: null })).toBeNull()
    expect(resolveComposerPredictionKeyAction({ ...base, inputEmpty: false })).toBeNull()
    expect(resolveComposerPredictionKeyAction({ ...base, menuOpen: true })).toBeNull()
  })

  test('输入法组合期间与 Shift+Tab 不拦截', () => {
    expect(resolveComposerPredictionKeyAction({ ...base, composing: true })).toBeNull()
    expect(resolveComposerPredictionKeyAction({ ...base, shiftKey: true })).toBeNull()
  })

  test('Tab 接受只把文字写入草稿，不产生提交', () => {
    const state = emptyState()
    const transaction = insertTextTransaction(state, '继续补齐测试')
    const next = state.apply(transaction)
    expect(composerDocumentFromProseMirrorDocument(next.doc).text).toBe('继续补齐测试')
    // 事务只改动文档，没有任何提交意图标记（提交由 Enter/快捷键单独裁决）。
    expect(transaction.docChanged).toBe(true)
  })
})

describe('selectLatestCompletedTurnId', () => {
  test('只有最近一轮成功完成时返回轮次 ID', () => {
    const events = [{ metadata: { turnId: 'turn:1' } }, { metadata: { turnId: 'turn:2' } }]
    expect(selectLatestCompletedTurnId(events, 'completed')).toBe('turn:2')
    expect(selectLatestCompletedTurnId(events, 'failed')).toBeNull()
    expect(selectLatestCompletedTurnId(events, 'running')).toBeNull()
    expect(selectLatestCompletedTurnId(events, null)).toBeNull()
  })
})
