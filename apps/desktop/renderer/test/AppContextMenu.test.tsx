import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  AppContextMenu,
  resolveAppContextMenuActions,
} from '../src/components/ui/AppContextMenu.js'

describe('AppContextMenu 惰性动作', () => {
  test('关闭时不构建动作、不渲染菜单条目', () => {
    let builds = 0
    const html = renderToStaticMarkup(
      createElement(AppContextMenu, {
        actions: () => {
          builds += 1
          return [{ kind: 'item', label: '菜单动作', onSelect: () => {} }]
        },
        layout: 'flex',
        trigger: createElement('button', null, '触发'),
      }),
    )
    expect(builds).toBe(0)
    expect(html).not.toContain('role="menu"')
    expect(html).not.toContain('菜单动作')
  })

  test('打开时每次解析都取最新构建结果，关闭时返回空', () => {
    let label = '第一版'
    const builder = () => [{ kind: 'item' as const, label, onSelect: () => {} }]
    expect(resolveAppContextMenuActions(builder, false)).toEqual([])
    expect(resolveAppContextMenuActions(builder, true)).toHaveLength(1)
    label = '最新状态'
    const rebuilt = resolveAppContextMenuActions(builder, true)
    expect(rebuilt).toHaveLength(1)
    expect((rebuilt[0] as { label: string }).label).toBe('最新状态')
  })

  test('数组输入保持兼容且不被复制', () => {
    const actions = [{ kind: 'item' as const, label: '数组动作', onSelect: () => {} }]
    expect(resolveAppContextMenuActions(actions, true)).toBe(actions)
    expect(resolveAppContextMenuActions(actions, false)).toEqual([])
  })
})
