import { describe, expect, test } from 'bun:test'
import type { RenderTurnEntry } from '@pidex/session-view'
import { deriveConversationTurnNavItems } from '../src/features/session/conversation/TurnNavigationModel.js'
import {
  markdownToTurnPreview,
  shouldShowTurnNavigation,
} from '../src/features/session/conversation/ConversationTurnNavRail.js'
import { ConversationTurnRowRegistry } from '../src/features/session/conversation/UseConversationTurnRowVisibility.js'

type NavTurn = Pick<
  RenderTurnEntry,
  'id' | 'userItems' | 'userInputs' | 'turn' | 'assistantResultItems' | 'patchItems'
>

function navTurn({
  assistantTexts = [],
  files = [],
  id,
  userTexts = [],
}: {
  assistantTexts?: string[]
  files?: string[][]
  id: string
  userTexts?: string[]
}): RenderTurnEntry {
  const inputs = userTexts.map((content, index) => ({ id: `${id}-input-${index}`, content }))
  return {
    id,
    turn: { status: 'completed' },
    userItems: inputs,
    userInputs: userTexts.map((content, index) => ({
      id: `${id}-input-${index}`,
      content,
    })),
    assistantResultItems: assistantTexts.map((text, index) => ({
      id: `${id}-assistant-${index}`,
      text,
    })),
    patchItems: files.map((paths, patchIndex) => ({
      id: `${id}-patch-${patchIndex}`,
      files: paths.map((path) => ({ path })),
    })),
  } as NavTurn as RenderTurnEntry
}

describe('canonical conversation navigation', () => {
  test('matches Codex turn navigation visibility boundaries', () => {
    expect(shouldShowTurnNavigation(3, 200)).toBe(false)
    expect(shouldShowTurnNavigation(4, 47.99)).toBe(false)
    expect(shouldShowTurnNavigation(4, 48)).toBe(true)
  })

  test('creates a compact plain-text turn preview from Markdown', () => {
    expect(markdownToTurnPreview('# 标题\n\n- 第一项\n- `code` [链接](https://example.com)')).toBe(
      '标题 第一项 code 链接',
    )
  })

  test('derives canonical turn navigation text and unique file outputs', () => {
    const navItems = deriveConversationTurnNavItems([
      navTurn({
        id: 'turn-1',
        userTexts: ['修改主题', '同时整理高对比主题'],
        assistantTexts: ['已完成 token 调整', '并更新组件样式'],
        files: [
          ['src/Theme.ts', 'src\\components\\Button.tsx'],
          ['SRC/THEME.TS', 'src/components/Button.tsx', 'src/panel.tsx'],
        ],
      }),
      navTurn({
        id: 'turn-2',
        userTexts: ['   '],
        assistantTexts: ['', '  '],
        files: [['']],
      }),
    ])

    expect(navItems).toMatchObject([
      {
        id: 'turn-1-input-0',
        turnId: 'turn-1',
        rowIndex: 0,
        userText: '修改主题',
        isRunning: false,
      },
      {
        id: 'turn-1-input-1',
        turnId: 'turn-1',
        rowIndex: 0,
        userText: '同时整理高对比主题',
        isRunning: false,
      },
      {
        id: 'turn-2-input-0',
        turnId: 'turn-2',
        rowIndex: 1,
        userText: '',
        assistantText: null,
        outputs: [],
      },
    ])
    expect(navItems[0]!.assistantText).toBe('已完成 token 调整\n并更新组件样式')
    expect(navItems[0]!.outputs).toEqual([
      { type: 'file', label: 'Theme.ts', path: 'src/Theme.ts' },
      { type: 'file', label: 'Button.tsx', path: 'src\\components\\Button.tsx' },
      { type: 'file', label: 'panel.tsx', path: 'src/panel.tsx' },
    ])
    expect(navItems[1]!.outputs).toBe(navItems[0]!.outputs)
  })

  test('excludes goal continuation and emphasizes only the last visible running input', () => {
    const entry = navTurn({ id: 'running', userTexts: ['', '追加要求', '系统继续'] })
    entry.turn = { ...entry.turn, status: 'running' }
    entry.userItems[0] = { ...entry.userItems[0]!, attachmentIds: ['attachment-1'] }
    entry.userItems[2] = { ...entry.userItems[2]!, origin: 'goal-continuation' }
    expect(deriveConversationTurnNavItems([entry])).toMatchObject([
      { id: 'running-input-0', userText: '', isRunning: false },
      { id: 'running-input-1', userText: '追加要求', isRunning: true },
    ])
  })

  test('keeps canonical turn ids stable while older history changes row indexes', () => {
    const recentTurns = [
      navTurn({ id: 'turn-2', userTexts: ['第二轮'] }),
      navTurn({ id: 'turn-3', userTexts: ['第三轮'] }),
    ]

    expect(deriveConversationTurnNavItems(recentTurns)).toMatchObject([
      { id: 'turn-2-input-0', rowIndex: 0 },
      { id: 'turn-3-input-0', rowIndex: 1 },
    ])
    expect(
      deriveConversationTurnNavItems([
        navTurn({ id: 'turn-1', userTexts: ['第一轮'] }),
        ...recentTurns,
      ]),
    ).toMatchObject([
      { id: 'turn-1-input-0', rowIndex: 0 },
      { id: 'turn-2-input-0', rowIndex: 1 },
      { id: 'turn-3-input-0', rowIndex: 2 },
    ])
  })

  test('observes and unobserves only explicitly registered turn rows', () => {
    const observed: HTMLElement[] = []
    const unobserved: HTMLElement[] = []
    const unregistered: string[] = []
    const registry = new ConversationTurnRowRegistry((id) => unregistered.push(id))
    const observer = {
      observe: (node: HTMLElement) => observed.push(node),
      unobserve: (node: HTMLElement) => unobserved.push(node),
    }
    const first = {} as HTMLElement
    const replacement = {} as HTMLElement
    const second = {} as HTMLElement

    registry.setObserver(observer)
    registry.register('turn-1', first, new Set(['turn-1', 'turn-2']))
    registry.register('turn-2', second, new Set(['turn-1', 'turn-2']))
    registry.register('turn-1', replacement, new Set(['turn-1', 'turn-2']))
    registry.retain(new Set(['turn-1']))
    registry.register('turn-1', null, new Set(['turn-1']))

    expect(observed).toEqual([first, second, replacement])
    expect(unobserved).toEqual([first, second, replacement])
    expect(unregistered).toEqual(['turn-1', 'turn-2', 'turn-1'])
  })
})
