import { expect, test } from 'bun:test'
import { RENDERER_CAPABILITIES } from '../src/services/desktop-client/AgentSessionClient.js'

// 验收 P1（模型参数保存必现失败）的根因之一是 Renderer 未申请该能力，
// 导致 provider/modelPreferences/* 被 CAPABILITY_REQUIRED 拒绝；锁住协商清单防回归。
test('renderer negotiates the model runtime preference capability', () => {
  expect(RENDERER_CAPABILITIES).toContain('model.preferences.v1')
})
