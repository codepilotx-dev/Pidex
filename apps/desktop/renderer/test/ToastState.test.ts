import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import {
  createToastStore,
  calculateCardTransform,
  toastExpiryDelayMs,
} from '../src/components/toast/ToastState.js'

describe('toastState & transform calculations', () => {
  describe('calculateCardTransform', () => {
    it('returns stacked offsets when collapsed', () => {
      // 索引 0（顶层）：y=0, scale=1, zIndex=50, opacity=1
      const card0 = calculateCardTransform(0, false)
      expect(card0.y).toBe(0)
      expect(card0.scale).toBe(1)
      expect(card0.zIndex).toBe(50)
      expect(card0.opacity).toBe(1)
      expect(card0.pointerEvents).toBe('auto')

      // 索引 1（第 2 层）：y=10, scale=0.95, zIndex=49, opacity=0.9
      const card1 = calculateCardTransform(1, false)
      expect(card1.y).toBe(10)
      expect(card1.scale).toBe(0.95)
      expect(card1.zIndex).toBe(49)
      expect(card1.opacity).toBe(0.9)
      expect(card1.pointerEvents).toBe('auto')

      // 索引 2（第 3 层）：y=20, scale=0.90, zIndex=48, opacity=0.75
      const card2 = calculateCardTransform(2, false)
      expect(card2.y).toBe(20)
      expect(card2.scale).toBe(0.9)
      expect(card2.zIndex).toBe(48)
      expect(card2.opacity).toBe(0.75)
      expect(card2.pointerEvents).toBe('auto')

      // 索引 3 及以后：隐藏
      const card3 = calculateCardTransform(3, false)
      expect(card3.opacity).toBe(0)
      expect(card3.pointerEvents).toBe('none')
    })

    it('returns expanded offsets with height summation when expanded', () => {
      const heights = [40, 50, 60]
      const gap = 8
      const headerHeight = 28

      const card0 = calculateCardTransform(0, true, heights, gap, headerHeight)
      expect(card0.y).toBe(headerHeight) // 28
      expect(card0.scale).toBe(1)
      expect(card0.opacity).toBe(1)

      const card1 = calculateCardTransform(1, true, heights, gap, headerHeight)
      expect(card1.y).toBe(headerHeight + 40 + gap) // 28 + 40 + 8 = 76
      expect(card1.scale).toBe(1)
      expect(card1.opacity).toBe(1)

      const card2 = calculateCardTransform(2, true, heights, gap, headerHeight)
      expect(card2.y).toBe(headerHeight + 40 + gap + 50 + gap) // 76 + 50 + 8 = 134
      expect(card2.scale).toBe(1)
      expect(card2.opacity).toBe(1)
    })

    it('defaults headerHeight to 0 when omitted in expanded mode', () => {
      const heights = [40, 50, 60]
      const card0 = calculateCardTransform(0, true, heights)
      expect(card0.y).toBe(0)
    })
  })

  describe('createToastStore - 自动消失规则与多条机制', () => {
    let store: ReturnType<typeof createToastStore>

    beforeEach(() => {
      store = createToastStore({ defaultDurationMs: 50, dedupeWindowMs: 20 })
    })

    afterEach(() => {
      store._clearTimer()
    })

    it('单条 Toast 会在倒计时后自动消失', async () => {
      const id = store.show({ message: '单个消息' })
      expect(store.getState().toasts.length).toBe(1)

      await new Promise((r) => setTimeout(r, 80))
      expect(store.getState().toasts.length).toBe(0)
    })

    it('存活 Toast > 1 时，取消自动消失（保持常驻）', async () => {
      store.show({ message: '消息一' })
      store.show({ message: '消息二' })
      expect(store.getState().toasts.length).toBe(2)

      // 超过默认 50ms 持续等待
      await new Promise((r) => setTimeout(r, 90))
      // 仍然有 2 条，不会自动消失！
      expect(store.getState().toasts.length).toBe(2)
    })

    it('手动关闭至剩 1 条时，恢复最后 1 条的自动消失倒计时', async () => {
      const id1 = store.show({ message: '消息一' })
      const id2 = store.show({ message: '消息二' })
      expect(store.getState().toasts.length).toBe(2)

      // 关掉其中 1 条
      store.dismiss(id2)
      expect(store.getState().toasts.length).toBe(1)

      // 剩下的 1 条在 50ms 后自动消失
      await new Promise((r) => setTimeout(r, 80))
      expect(store.getState().toasts.length).toBe(0)
    })

    it('鼠标悬停时暂停自动消失倒计时，移开后恢复', async () => {
      store.show({ message: '消息一' })
      store.setHovered(true)

      // 悬停中等待 70ms，不应消失
      await new Promise((r) => setTimeout(r, 70))
      expect(store.getState().toasts.length).toBe(1)

      // 移开鼠标
      store.setHovered(false)
      // 移开后等待 70ms，自动消失
      await new Promise((r) => setTimeout(r, 70))
      expect(store.getState().toasts.length).toBe(0)
    })

    it('短时间相同内容去重，更新时间戳而不产生重复卡片', () => {
      store.show({ message: '相同错误', tone: 'error' })
      store.show({ message: '相同错误', tone: 'error' })
      expect(store.getState().toasts.length).toBe(1)

      // 不同内容正常产生新卡片
      store.show({ message: '不同错误', tone: 'error' })
      expect(store.getState().toasts.length).toBe(2)
    })

    it('超出最大保留数量（如 5 条）时，最早的 Toast 自动出栈', () => {
      const customStore = createToastStore({ maxToasts: 3 })
      customStore.show({ message: '消息 1' })
      customStore.show({ message: '消息 2' })
      customStore.show({ message: '消息 3' })
      expect(customStore.getState().toasts.length).toBe(3)

      customStore.show({ message: '消息 4' })
      expect(customStore.getState().toasts.length).toBe(3)
      // 最新的在 index 0，最早的消息 1 已被弹出
      expect(customStore.getState().toasts[0]?.message).toBe('消息 4')
      expect(customStore.getState().toasts[2]?.message).toBe('消息 2')
    })

    it('dismissAll 清空全部并触发各自的 onDismiss 回调', () => {
      let dismissed1 = false
      let dismissed2 = false
      store.show({
        message: '一',
        onDismiss: () => {
          dismissed1 = true
        },
      })
      store.show({
        message: '二',
        onDismiss: () => {
          dismissed2 = true
        },
      })
      expect(store.getState().toasts.length).toBe(2)

      store.dismissAll()
      expect(store.getState().toasts.length).toBe(0)
      expect(dismissed1).toBe(true)
      expect(dismissed2).toBe(true)
    })
  })

  describe('动作期限', () => {
    it('按到期时间返回剩余毫秒，已过期归零，无期限返回 undefined', () => {
      const now = 1_000
      expect(toastExpiryDelayMs(undefined, now)).toBeUndefined()
      expect(toastExpiryDelayMs(now + 250, now)).toBe(250)
      expect(toastExpiryDelayMs(now, now)).toBe(0)
      expect(toastExpiryDelayMs(now - 250, now)).toBe(0)
    })

    it('show 保留 expiresAt 供卡片到点禁用动作', () => {
      const store = createToastStore({ defaultDurationMs: 50 })
      const expiresAt = Date.now() + 1_000
      store.show({ message: '项目已移除', tone: 'status', appearance: 'action', expiresAt })

      expect(store.getState().toasts[0]?.expiresAt).toBe(expiresAt)
      store._clearTimer()
    })

    it('重新 show 同一 id 且未带期限时清除旧期限', () => {
      const store = createToastStore({ defaultDurationMs: 50 })
      store.show({ id: 'undo', message: '项目已移除', expiresAt: Date.now() + 1_000 })
      store.show({ id: 'undo', message: '项目已移除' })

      expect(store.getState().toasts[0]?.expiresAt).toBeUndefined()
      store._clearTimer()
    })
  })
})
