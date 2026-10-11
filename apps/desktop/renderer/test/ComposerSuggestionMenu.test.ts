import { describe, expect, test } from 'bun:test'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { ComposerCommandMenu } from '../src/features/session/composer/ComposerCommandMenu.js'
import {
  buildComposerSuggestionItems,
  filterComposerMenuItems,
  nextEnabledMenuIndex,
  resolveComposerMenuActiveKey,
  composerMenuScrollTop,
} from '../src/features/session/composer/ComposerSuggestionMenu.js'
import { resolveComposerSuggestionRequest } from '../src/features/session/composer/ComposerSuggestionState.js'
import {
  mergeSlashCommands,
  parseSlashInvocation,
  type ComposerSkillCommand,
  type ComposerSlashCommand,
} from '../src/features/session/composer/ComposerSlashCommands.js'
import type { ComposerMenuItem } from '../src/features/session/composer/ComposerCommandMenu.js'
import { computeDropdownMaxHeight } from '../src/features/session/composer/ChatInputDropdown.js'

const item = (key: string, extra: Partial<ComposerMenuItem> = {}): ComposerMenuItem => ({
  key,
  label: key,
  icon: null,
  matchText: key,
  onSelect: () => {},
  ...extra,
})

describe('composer suggestion routing and selection', () => {
  test('超过 50 行的候选使用明确的内联视口高度，覆盖 Virtua 的 100% 默认高度', () => {
    const render = (count: number) =>
      renderToStaticMarkup(
        createElement(ComposerCommandMenu, {
          id: 'menu',
          items: Array.from({ length: count }, (_, index) => item(`item-${index}`)),
          keyword: '',
          activeKey: 'item-0',
          onActiveKeyChange: () => {},
          onItemSelect: () => {},
        }),
      )
    expect(render(51)).toContain(
      'height:calc(var(--composer-suggestion-max-height, 320px) - var(--cpx-sys-space-4))',
    )
    expect(render(51)).not.toContain('height:100%')
    expect(render(50)).toContain('item-49')
    expect(render(50)).not.toContain('chat-input__suggestion-vlist')
  })
  test('裸 / 与 $ 触发候选面板，列表滚动只调整自身并保留锚点可用高度', () => {
    expect(resolveComposerSuggestionRequest('/', 1, false)?.kind).toBe('slash')
    expect(resolveComposerSuggestionRequest('$', 1, false)?.kind).toBe('skill')
    expect(composerMenuScrollTop(40, 120, -20, 12)).toBe(20)
    expect(composerMenuScrollTop(40, 120, 100, 132)).toBe(52)
    expect(composerMenuScrollTop(40, 120, 20, 52)).toBe(40)
    expect(composerMenuScrollTop(0, 120, -20, 12)).toBe(0)
    expect(
      computeDropdownMaxHeight({
        side: 'top',
        anchorTop: 200,
        windowHeight: 800,
        maxCap: 320,
        safetyMargin: 16,
      }),
    ).toBe(184)
    expect(
      computeDropdownMaxHeight({
        side: 'bottom',
        anchorTop: 300,
        windowHeight: 800,
        maxCap: 320,
        safetyMargin: 16,
      }),
    ).toBe(320)
  })
  test('四种文本标记只替换光标前有效范围，IME 与邮件不触发', () => {
    for (const [text, kind] of [
      ['(@文件', 'mention'],
      ['[$skill', 'skill'],
      [' /plan', 'slash'],
    ] as const) {
      const request = resolveComposerSuggestionRequest(text, text.length, false)
      expect(request?.kind).toBe(kind)
      expect(text.slice(request?.start)).toBe(
        text.slice(text.lastIndexOf(text.includes('@') ? '@' : text.includes('$') ? '$' : '/')),
      )
      expect(resolveComposerSuggestionRequest(text, text.length, true)).toBeNull()
    }
    expect(resolveComposerSuggestionRequest('name@example.com', 16, false)).toBeNull()
    expect(resolveComposerSuggestionRequest('/plan', 3, false)).toBeNull()
    expect(resolveComposerSuggestionRequest('@文件\n正文', 6, false)).toBeNull()
  })
  test('名称匹配优先于说明，中文不进行子序列匹配', () => {
    const options = [
      item('说明', { description: 'review' }),
      item('review-long'),
      item('review'),
      item('rvw'),
      item('中间文'),
    ]
    expect(filterComposerMenuItems(options, 'review').map((option) => option.key)).toEqual([
      'review',
      'review-long',
      '说明',
    ])
    expect(filterComposerMenuItems(options, 'rvw').map((option) => option.key)).toEqual([
      'rvw',
      'review-long',
      'review',
    ])
    expect(filterComposerMenuItems(options, '中文')).toEqual([])
  })
  test('移除查看更多，文件仅在统一入口的子面板显示，长列表仍可选择', () => {
    const skills = Array.from({ length: 60 }, (_, index) =>
      item(`skill-${index}`, { section: '技能' }),
    )
    const files = Array.from({ length: 60 }, (_, index) =>
      item(`file-${index}`, { section: '文件和文件夹', categoryOnly: true }),
    )
    const fileStatus = item('loading', {
      section: '文件和文件夹',
      status: 'loading',
      categoryOnly: true,
    })
    const source = [
      item('files', { section: '添加', category: '文件和文件夹' }),
      ...skills,
      ...files,
      fileStatus,
    ]
    let category: string | null = null
    const root = buildComposerSuggestionItems(source, '', null, (value) => {
      category = value
    })
    expect(root).toHaveLength(61)
    expect(root.some((option) => option.label.includes('查看更多'))).toBe(false)
    expect(root.some((option) => option.section === '文件和文件夹')).toBe(false)
    root.find((option) => option.key === 'files')?.onSelect()
    expect(category).toBe('文件和文件夹')
    const submenu = buildComposerSuggestionItems(source, '', category, (value) => {
      category = value
    })
    expect(submenu.filter((option) => option.key.startsWith('file-'))).toHaveLength(60)
    expect(submenu.at(-1)?.status).toBe('loading')
    submenu.find((option) => option.key === 'category:back')?.onSelect()
    expect(category).toBeNull()
    expect(buildComposerSuggestionItems(source, 'skill', null, () => {})).toHaveLength(8)
    expect(buildComposerSuggestionItems(source, 'file-1', null, () => {})).toEqual([])
  })
  test('异步结果保留选中身份、跳过状态与禁用项并循环', () => {
    const source = [
      item('loading', { status: 'loading' }),
      item('disabled', { disabled: true }),
      item('one'),
      item('two'),
    ]
    expect(nextEnabledMenuIndex(source, 3, 1)).toBe(2)
    expect(nextEnabledMenuIndex(source, 2, -1)).toBe(3)
    expect(resolveComposerMenuActiveKey([item('new'), ...source], 'two')).toBe('two')
    expect(resolveComposerMenuActiveKey(source.slice(0, 3), 'two')).toBe('one')
  })
  test('内置命令占用同名 slash，带参数不会变成内置动作', () => {
    const builtin: ComposerSlashCommand = {
      id: 'plan',
      trigger: 'plan',
      title: '计划',
      description: '',
      source: 'builtin',
      availability: { visible: true, enabled: true },
      execute: () => {},
    }
    const skill: ComposerSkillCommand = {
      id: 'skill:plan',
      trigger: 'plan',
      title: 'plan',
      description: '',
      source: 'skill',
      skill: { name: 'plan', path: 'skills/plan', scope: 'user', source: 'user' },
    }
    expect(mergeSlashCommands([builtin], [skill])).toEqual([builtin])
    expect(parseSlashInvocation('/plan', [builtin]).kind).toBe('builtin')
    expect(parseSlashInvocation('/plan task', [builtin]).kind).toBe('unknown')
  })
})
