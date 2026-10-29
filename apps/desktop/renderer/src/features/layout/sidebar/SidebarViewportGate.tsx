import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  type ReactNode,
} from 'react'

/** 订阅一个元素的视口可见性；返回退订函数。 */
type SidebarViewportGate = (
  element: Element,
  setVisible: (visible: boolean) => void,
) => () => void

const SidebarViewportGateContext = createContext<SidebarViewportGate | null>(null)

// 600px 预启用带：拖动自动滚动接近边缘前条目已恢复可用，正常滚动不会遇到未启用的行。
const VIEWPORT_MARGIN = '600px 0px'

export function SidebarViewportGateProvider({ children }: { children: ReactNode }): ReactNode {
  const callbacksRef = useRef(new Map<Element, (visible: boolean) => void>())
  const observerRef = useRef<IntersectionObserver | null>(null)

  const subscribe = useCallback<SidebarViewportGate>((element, setVisible) => {
    callbacksRef.current.set(element, setVisible)
    // IO 惰性创建：首次订阅发生在行元素挂载的 ref 阶段，此时创建安全。
    observerRef.current ??= new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          callbacksRef.current.get(entry.target)?.(entry.isIntersecting)
        }
      },
      {
        // root 留空：视口取浏览器窗口，并被祖先滚动容器/折叠区分的 overflow 裁剪，
        // 滚出侧栏或收起分组内的行自动判为不可见，无需引用 ScrollArea 的 ref。
        root: null,
        rootMargin: VIEWPORT_MARGIN,
      },
    )
    observerRef.current.observe(element)
    return () => {
      callbacksRef.current.delete(element)
      observerRef.current?.unobserve(element)
    }
  }, [])

  useEffect(
    () => () => {
      observerRef.current?.disconnect()
      observerRef.current = null
      callbacksRef.current.clear()
    },
    [],
  )

  return (
    <SidebarViewportGateContext.Provider value={subscribe}>
      {children}
    </SidebarViewportGateContext.Provider>
  )
}

/** 无 provider 时返回 null，调用方保持始终启用（fail-open）。 */
export function useSidebarViewportGate(): SidebarViewportGate | null {
  return useContext(SidebarViewportGateContext)
}
