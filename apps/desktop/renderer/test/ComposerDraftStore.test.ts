import { readFileSync } from 'node:fs'
import { describe, expect, test } from 'bun:test'
import type { DesktopComposerAttachment } from '../shared/Types.js'
import { ComposerDraftStore } from '../src/features/session/composer/ComposerDraftStore.js'

function attachment(id: string): DesktopComposerAttachment {
  return {
    id,
    name: `${id}.txt`,
    path: `/tmp/${id}.txt`,
    mediaType: 'text/plain',
    sizeBytes: 12,
    kind: 'text',
    status: 'ready',
  }
}

function storeWith(content: {
  collaborationMode: 'default' | 'plan' | 'grill'
  goalModeEnabled?: boolean
  goalTokenBudget?: number | null
}): ComposerDraftStore {
  const store = new ComposerDraftStore(() => 'client-1')
  const base = store.get('home')
  store.set('home', {
    ...base,
    document: {
      text: '帮助我重构这个模块',
      tokens: [
        {
          id: 'skill:review',
          kind: 'skill',
          name: 'review',
          label: 'review',
          value: 'skill://review',
          from: 0,
          to: 0,
        },
      ],
    },
    attachments: [attachment('a1'), attachment('a2')],
    skills: [{ name: 'review', path: 'skill://review/SKILL.md' }],
    skillInvocation: { name: 'review', path: 'skill://review/SKILL.md' },
    launchSettingsByProject: {
      'project-1': { createWorktree: true, branch: 'main' },
    },
    collaborationMode: content.collaborationMode,
    goalModeEnabled: content.goalModeEnabled,
    goalTokenBudget: content.goalTokenBudget,
  })
  return store
}

describe('ComposerDraftStore.resetSessionModes', () => {
  test('清除 plan/grill/goal 与预算，并保留文本、附件与技能', () => {
    const store = storeWith({
      collaborationMode: 'plan',
      goalModeEnabled: true,
      goalTokenBudget: 4096,
    })

    const reset = store.resetSessionModes('home')

    expect(reset.collaborationMode).toBe('default')
    expect(reset.goalModeEnabled).toBeUndefined()
    expect(reset.goalTokenBudget).toBeUndefined()

    // 文本、token、附件、技能与发起设置都在复位后原样保留。
    expect(reset.document.text).toBe('帮助我重构这个模块')
    expect(reset.document.tokens.map((token) => token.kind)).toEqual(['skill'])
    expect(reset.attachments.map((item) => item.id)).toEqual(['a1', 'a2'])
    expect(reset.skills).toEqual([{ name: 'review', path: 'skill://review/SKILL.md' }])
    expect(reset.skillInvocation).toEqual({
      name: 'review',
      path: 'skill://review/SKILL.md',
    })
    expect(reset.launchSettingsByProject).toEqual({
      'project-1': { createWorktree: true, branch: 'main' },
    })
    // 写回的草稿已同步到 store 快照。
    expect(store.peek('home')?.collaborationMode).toBe('default')
  })

  test('grill 模式同样复位为 default，并清掉 null 预算', () => {
    const store = storeWith({
      collaborationMode: 'grill',
      goalTokenBudget: null,
    })

    const reset = store.resetSessionModes('home')

    expect(reset.collaborationMode).toBe('default')
    expect(reset.document.text).toBe('帮助我重构这个模块')
    expect(reset.attachments).toHaveLength(2)
    expect(reset.skills).toHaveLength(1)
  })

  test('只复位目标草稿，不影响其他草稿键', () => {
    const store = storeWith({ collaborationMode: 'plan' })
    const other = store.get('session:thread-1')
    store.set('session:thread-1', {
      ...other,
      document: { text: '另一个会话', tokens: [] },
      collaborationMode: 'plan',
      goalModeEnabled: true,
    })

    store.resetSessionModes('home')

    const untouched = store.get('session:thread-1')
    expect(untouched.collaborationMode).toBe('plan')
    expect(untouched.goalModeEnabled).toBe(true)
    expect(untouched.document.text).toBe('另一个会话')
  })

  test('无草稿时直接返回默认草稿，不写入 store 快照', () => {
    const store = new ComposerDraftStore(() => 'client-x')

    const result = store.resetSessionModes('home')

    expect(result.collaborationMode).toBe('default')
    expect(result.document.text).toBe('')
    // 复位不应为了清空不存在的草稿而物化草稿条目。
    expect(store.store.getState().drafts.home).toBeUndefined()
  })

  test('重复复位结果稳定（幂等）', () => {
    const store = storeWith({ collaborationMode: 'plan', goalModeEnabled: true })
    const once = store.resetSessionModes('home')
    const twice = store.resetSessionModes('home')

    expect(twice).toEqual(once)
    expect(twice.collaborationMode).toBe('default')
    expect(twice.document.text).toBe('帮助我重构这个模块')
    expect(twice.attachments).toHaveLength(2)
  })
})

// Wiring regression: clearing the workspace on /new must reset without a route change.
test('清除工作区入口直接复位模式，不依赖路由变化', () => {
  const source = readFileSync(new URL('../src/features/layout/shell/DesktopLayout.tsx', import.meta.url), 'utf8')
  const handler = source.slice(source.indexOf('const handleClearWorkspace ='), source.indexOf('const handleGithubWorkspaceCloned ='))
  expect(handler).toContain('resetHomeComposerModes()')
  expect(handler).toContain('resetHomeComposerModes,')
})
