import { describe, expect, it, beforeEach, afterEach } from 'bun:test'
import {
  createToastStore,
  calculateCardTransform,
  toastExpiryDelayMs,
} from '../src/components/toast/ToastState.js'

describe('toastState & transform calculations', () => {
  describe('calculateCardTransform', () => {
    it('折叠状态下向上堆叠并露出最多 3 张，超出部分隐藏', () => {
      const heights = [40, 50, 60, 44, 44]
      const gap = 8
      const peek = 14
      // totalHeight = 40 + 50 + 60 + 44 + 44 + 4 * 8 = 270
      // frontY = 270 - 40 = 230

      // 索引 0（最前、最下方）：y = 230, scale = 1, zIndex = 50, opacity = 1, pointerEvents = 'auto'
      const card0 = calculateCardTransform(0, false, heights, gap, peek)
      expect(card0.y).toBe(230)
      expect(card0.scale).toBe(1)
      expect(card0.zIndex).toBe(50)
      expect(card0.opacity).toBe(1)
      expect(card0.pointerEvents).toBe('auto')

      // 索引 1（第 2 层）：y = 230 - 14 = 216, scale = 0.95, zIndex = 49, opacity = 1, pointerEvents = 'none'
      const card1 = calculateCardTransform(1, false, heights, gap, peek)
      expect(card1.y).toBe(216)
      expect(card1.scale).toBe(0.95)
      expect(card1.zIndex).toBe(49)
      expect(card1.opacity).toBe(1)
      expect(card1.pointerEvents).toBe('none')

      // 索引 2（第 3 层）：y = 230 - 28 = 202, scale = 0.90, zIndex = 48, opacity = 1, pointerEvents = 'none'
      const card2 = calculateCardTransform(2, false, heights, gap, peek)
      expect(card2.y).toBe(202)
      expect(card2.scale).toBe(0.9)
      expect(card2.zIndex).toBe(48)
      expect(card2.opacity).toBe(1)
      expect(card2.pointerEvents).toBe('none')

      // 索引 3 及以后：隐藏（最多露出 3 层）
      const card3 = calculateCardTransform(3, false, heights, gap, peek)
      expect(card3.opacity).toBe(0)
      expect(card3.pointerEvents).toBe('none')

      const card4 = calculateCardTransform(4, false, heights, gap, peek)
      expect(card4.opacity).toBe(0)
      expect(card4.pointerEvents).toBe('none')
    })

    it('展开状态下向上排列，最新通知保持原位，旧通知向上延伸至顶部', () => {
      const heights = [40, 50, 60]
      const gap = 8
      // totalHeight = 40 + 8 + 50 + 8 + 60 = 166
      // frontY = 166 - 40 = 126

      const card0 = calculateCardTransform(0, true, heights, gap)
      // 最新通知保持在最下方原位（126）
      expect(card0.y).toBe(126)
      expect(card0.scale).toBe(1)
      expect(card0.opacity).toBe(1)
      expect(card0.pointerEvents).toBe('auto')

      // 第二条通知向上排列：126 - 50 - 8 = 68
      const card1 = calculateCardTransform(1, true, heights, gap)
      expect(card1.y).toBe(68)
      expect(card1.scale).toBe(1)
      expect(card1.opacity).toBe(1)
      expect(card1.pointerEvents).toBe('auto')

      // 第三条通知位于最顶部：68 - 60 - 8 = 0
      const card2 = calculateCardTransform(2, true, heights, gap)
      expect(card2.y).toBe(0)
      expect(card2.scale).toBe(1)
      expect(card2.opacity).toBe(1)
      expect(card2.pointerEvents).toBe('auto')
    })

    it('单条通知时折叠与展开位置相同且位于顶部', () => {
      const heights = [44]
      const cardCollapsed = calculateCardTransform(0, false, heights)
      expect(cardCollapsed.y).toBe(0)
      expect(cardCollapsed.scale).toBe(1)
      expect(cardCollapsed.opacity).toBe(1)

      const cardExpanded = calculateCardTransform(0, true, heights)
      expect(cardExpanded.y).toBe(0)
      expect(cardExpanded.scale).toBe(1)
      expect(cardExpanded.opacity).toBe(1)
    })

    it('heights 数组短于 index + 1 时安全计算，不产生负数或 NaN', () => {
      // 只有 1 个高度记录，但请求 index = 2
      const heights = [44]
      const transform = calculateCardTransform(2, true, heights)
      // count 为 3，totalHeight = 44 + 44 + 44 + 16 = 148
      // frontY = 148 - 44 = 104
      // card2 y = 104 - (44 + 8) - (44 + 8) = 0
      expect(transform.y).toBe(0)
      expect(transform.scale).toBe(1)
      expect(transform.opacity).toBe(1)
    })
  })

  describe('createToastStore - 手动关闭规则与容量机制', () => {
    let store: ReturnType<typeof createToastStore>

    beforeEach(() => {
      store = createToastStore({ defaultDurationMs: 50, dedupeWindowMs: 20 })
    })

    afterEach(() => {
      store._clearTimer()
    })

    it('通知取消自动消失，等待用户手动逐条关闭', async () => {
      store.show({ message: '常驻消息', duration: 40 })
      expect(store.getState().toasts.length).toBe(1)

      // 超过原先 40ms/50ms 倒计时，通知依然常驻，不自动消失
      await new Promise((r) => setTimeout(r, 80))
      expect(store.getState().toasts.length).toBe(1)
    })

    it('多条通知均常驻，不自动消失', async () => {
      store.show({ message: '消息一', duration: 30 })
      store.show({ message: '消息二', duration: 30 })
      expect(store.getState().toasts.length).toBe(2)

      await new Promise((r) => setTimeout(r, 80))
      expect(store.getState().toasts.length).toBe(2)
    })

    it('手动 dismiss 关闭单个 Toast 并触发 onDismiss', () => {
      let dismissed1 = false
      let dismissed2 = false
      const id1 = store.show({
        message: '消息一',
        onDismiss: () => {
          dismissed1 = true
        },
      })
      const id2 = store.show({
        message: '消息二',
        onDismiss: () => {
          dismissed2 = true
        },
      })
      expect(store.getState().toasts.length).toBe(2)

      store.dismiss(id1)
      expect(store.getState().toasts.length).toBe(1)
      expect(store.getState().toasts[0]?.id).toBe(id2)
      expect(dismissed1).toBe(true)
      expect(dismissed2).toBe(false)
    })

    it('onDismiss 回调中的重入调用（如弹出后续提示）不会被覆盖丢失', () => {
      let followupId = ''
      const firstId = store.show({
        message: '先导消息',
        onDismiss: () => {
          // 在 onDismiss 中弹出后续消息
          followupId = store.show({ message: '后续消息' })
        },
      })

      expect(store.getState().toasts.length).toBe(1)
      store.dismiss(firstId)

      // 先导消息被移除，但后续消息被成功保留在 store 中，状态未被过时的 filter 覆盖
      expect(store.getState().toasts.length).toBe(1)
      expect(store.getState().toasts[0]?.id).toBe(followupId)
      expect(store.getState().toasts[0]?.message).toBe('后续消息')
    })

    it('保留 showCloseButton 配置并在去重更新时兼容', () => {
      const id = store.show({ message: '默认消息' })
      expect(store.getState().toasts[0]?.showCloseButton).toBe(true)

      const id2 = store.show({ message: '隐藏关闭按钮', showCloseButton: false })
      expect(store.getState().toasts.find((t) => t.id === id2)?.showCloseButton).toBe(false)
    })

    it('短时间相同内容去重，更新时间戳而不产生重复卡片', () => {
      store.show({ message: '相同错误', tone: 'error' })
      store.show({ message: '相同错误', tone: 'error' })
      expect(store.getState().toasts.length).toBe(1)

      // 不同内容正常产生新卡片
      store.show({ message: '不同错误', tone: 'error' })
      expect(store.getState().toasts.length).toBe(2)
    })

    it('超出最大保留数量（如 5 条）时，最早的 Toast 自动出栈并触发 onDismiss', () => {
      let dismissed1 = false
      const customStore = createToastStore({ maxToasts: 3 })
      customStore.show({
        message: '消息 1',
        onDismiss: () => {
          dismissed1 = true
        },
      })
      customStore.show({ message: '消息 2' })
      customStore.show({ message: '消息 3' })
      expect(customStore.getState().toasts.length).toBe(3)

      customStore.show({ message: '消息 4' })
      expect(customStore.getState().toasts.length).toBe(3)
      // 最新的在 index 0，最早的消息 1 已被弹出并触发 onDismiss
      expect(customStore.getState().toasts[0]?.message).toBe('消息 4')
      expect(customStore.getState().toasts[2]?.message).toBe('消息 2')
      expect(dismissed1).toBe(true)
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
