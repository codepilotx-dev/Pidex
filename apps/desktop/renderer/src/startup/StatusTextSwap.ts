import { getEffectiveReducedMotion } from '../hooks/UsePrefersReducedMotion.js'

// 单行状态窗的文字滑动参数，与 CodingHeadingTransition 的两段 WAAPI 行为一致：
// 旧文案上滑（80ms）、新文案从下方滑入（80ms）。快速连续更新时进行中的
// 退出动画只落定最新文案，不排队中间状态；reduced-motion 下直接替换文字。
const STATUS_SWAP_EASE = 'cubic-bezier(0.23, 1, 0.32, 1)'
const STATUS_EXIT_MS = 80
const STATUS_ENTER_MS = 80

type StatusTextSwapState = {
  pending: string | null
  exit: Animation | null
}

const stateByElement = new WeakMap<HTMLElement, StatusTextSwapState>()

/**
 * 将元素内文案切换为 nextText：当前内容上滑退出后，新内容从下方滑入。
 * 供静态 splash handoff 与 React FullScreenWhaleLoading 共同调用；
 * onSettled 在新文案落定后触发一次（React 侧据此同步渲染状态）。
 */
export function swapStatusText(
  element: HTMLElement,
  nextText: string,
  onSettled?: () => void,
): void {
  const state = stateByElement.get(element) ?? { pending: null, exit: null }
  stateByElement.set(element, state)

  if (getEffectiveReducedMotion()) {
    state.exit?.cancel()
    state.exit = null
    state.pending = null
    // 文案未变化时不写 DOM：静态 splash handoff 用 MutationObserver 观察状态窗，
    // 重复写入会再次触发自己，形成死循环并饿死定时器与 load 事件。
    if (element.textContent !== nextText) element.textContent = nextText
    onSettled?.()
    return
  }

  if (state.exit) {
    // 退出动画进行中：只更新待落定文案，由 onfinish 统一落到最新状态。
    state.pending = nextText
    return
  }
  if (element.textContent === nextText) {
    onSettled?.()
    return
  }

  state.pending = nextText
  const animation = element.animate(
    [
      { opacity: 1, transform: 'translateY(0)' },
      { opacity: 0, transform: 'translateY(-4px)' },
    ],
    { duration: STATUS_EXIT_MS, easing: STATUS_SWAP_EASE, fill: 'forwards' },
  )
  state.exit = animation
  animation.onfinish = (): void => {
    state.exit = null
    const settled = state.pending
    if (settled === null) return
    state.pending = null
    animation.cancel()
    element.textContent = settled
    element.animate(
      [
        { opacity: 0, transform: 'translateY(4px)' },
        { opacity: 1, transform: 'translateY(0)' },
      ],
      { duration: STATUS_ENTER_MS, easing: STATUS_SWAP_EASE },
    )
    onSettled?.()
  }
}
