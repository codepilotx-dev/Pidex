import { describe, expect, test } from 'bun:test'
import { containsRelatedTarget, isDomNode } from '../src/utils/DomTargets.js'

/**
 * 回归：PointerEvent/FocusEvent 的 relatedTarget 是 EventTarget，指针移到窗口外或节点卸载时
 * 可能不是 DOM 节点。直接传给 Node.contains 会抛
 * `TypeError: parameter 1 is not of type 'Node'`，并被全局 error 监听弹成常驻通知。
 */
function fakeNode(nodeType = 1): Node {
  return { nodeType, nodeName: 'DIV' } as unknown as Node
}

describe('containsRelatedTarget', () => {
  test('非节点 relatedTarget 不抛错且视为未包含', () => {
    const container = { contains: () => true } as unknown as Node
    expect(containsRelatedTarget(container, null)).toBe(false)
    expect(containsRelatedTarget(container, { not: 'a node' })).toBe(false)
    expect(containsRelatedTarget(container, new EventTarget())).toBe(false)
    expect(containsRelatedTarget(container, 'text')).toBe(false)
    expect(containsRelatedTarget(container, 42)).toBe(false)
  })

  test('容器缺失时视为未包含', () => {
    expect(containsRelatedTarget(null, null)).toBe(false)
    expect(containsRelatedTarget(undefined, fakeNode())).toBe(false)
  })

  test('真实节点交给 container.contains 判定', () => {
    const inner = fakeNode()
    const inside = { contains: (target: Node) => target === inner } as unknown as Node
    const outside = { contains: () => false } as unknown as Node
    expect(containsRelatedTarget(inside, inner)).toBe(true)
    expect(containsRelatedTarget(outside, inner)).toBe(false)
  })
})

describe('isDomNode', () => {
  test('按 nodeType/nodeName 识别节点，不依赖 Node 全局', () => {
    expect(isDomNode(fakeNode())).toBe(true)
    expect(isDomNode(fakeNode(3))).toBe(true)
    expect(isDomNode(null)).toBe(false)
    expect(isDomNode(undefined)).toBe(false)
    expect(isDomNode({})).toBe(false)
    expect(isDomNode({ nodeType: 1 })).toBe(false)
    expect(isDomNode({ nodeName: 'DIV' })).toBe(false)
  })
})
