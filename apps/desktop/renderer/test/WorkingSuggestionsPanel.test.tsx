import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { WorkingSuggestionsPanel } from '../src/features/session/WorkingSuggestionsPanel.js'
import {
  returnToWorkingSuggestionTemplates,
  selectWorkingContextualSuggestion,
  selectWorkingSuggestionCategory,
  showContextualWorkingSuggestions,
  showWorkingSuggestionTemplates,
  syncWorkingSuggestionState,
} from '../src/features/session/WorkingSuggestions.js'

const contextualSuggestions = [
  { id: 'failed', label: '继续处理失败任务', prompt: '继续处理失败任务' },
  { id: 'changes', label: '整理当前工作区改动', prompt: '整理当前工作区改动' },
  { id: 'next', label: '规划项目下一步', prompt: '规划项目下一步' },
] as const

const panelHandlers = {
  suggestions: contextualSuggestions,
  onSelectSuggestion: () => {},
  onShowTemplates: () => {},
  onShowSuggestions: () => {},
  onSelectCategory: () => {},
  onSelectTask: () => {},
  onBack: () => {},
}

describe('WorkingSuggestionsPanel structure', () => {
  test('第一层渲染平面列表，不再使用卡片网格', () => {
    const html = renderToStaticMarkup(
      <WorkingSuggestionsPanel state={{ kind: 'root' }} {...panelHandlers} />,
    )
    expect(html).not.toContain('new-session-suggestion-card')
    expect(html).not.toContain('new-session-suggestion-grid')
    expect(html).toContain('new-session-suggestion-row')
    expect(html.match(/working-suggestion-row/g)).toHaveLength(4)
    expect(html).toContain('查看工作模板')
  })

  test('模板层三个分类具有正确的可访问名称', () => {
    const html = renderToStaticMarkup(
      <WorkingSuggestionsPanel state={{ kind: 'templates' }} {...panelHandlers} />,
    )
    for (const label of ['创建文件或搭建网站', '调研并规划后续步骤', '自动处理日常和重复性工作']) {
      expect(html).toContain(`<span>${label}</span>`)
    }
  })

  test('上下文根层渲染三条真实建议，并限制外部结果最多三条', () => {
    const html = renderToStaticMarkup(
      <WorkingSuggestionsPanel
        state={{ kind: 'root' }}
        {...panelHandlers}
        suggestions={[
          ...contextualSuggestions,
          { id: 'extra', label: '不应显示', prompt: '不应显示' },
        ]}
      />,
    )
    for (const suggestion of contextualSuggestions) {
      expect(html).toContain(`<span>${suggestion.label}</span>`)
    }
    expect(html).not.toContain('不应显示')
    expect(html).toContain('查看工作模板')
  })

  test('模板层提供返回建议入口与三个分类', () => {
    const html = renderToStaticMarkup(
      <WorkingSuggestionsPanel state={{ kind: 'templates' }} {...panelHandlers} />,
    )
    expect(html).toContain('aria-label="工作模板"')
    expect(html).toContain('返回建议')
    expect(html.match(/working-suggestion-row/g)).toHaveLength(3)
  })

  test('第二层渲染分类标题、返回入口与任务平面列表', () => {
    const html = renderToStaticMarkup(
      <WorkingSuggestionsPanel
        state={selectWorkingSuggestionCategory('create', '创建')}
        {...panelHandlers}
      />,
    )
    expect(html).not.toContain('new-session-suggestion-card')
    expect(html).not.toContain('new-session-suggestion-grid')
    expect(html).not.toContain('new-session-suggestions')
    expect(html).not.toContain('is-follow-up')
    expect(html).toContain('的建议任务')
    expect(html).toContain('返回')
    expect(html).toContain('创建文件或搭建网站')
    for (const label of ['创建新文档', '创建新电子表格', '创建新演示文稿', '创建新网站']) {
      expect(html).toContain(`<span>${label}</span>`)
    }
  })

  test('hidden 状态不渲染任何内容', () => {
    const html = renderToStaticMarkup(
      <WorkingSuggestionsPanel
        state={{ kind: 'hidden', reason: 'prompt-filled' }}
        {...panelHandlers}
      />,
    )
    expect(html).toBe('')
  })
})

describe('Working contextual suggestion state', () => {
  test('模板页与上下文建议页可往返，空草稿不会把模板页重置', () => {
    const templates = showWorkingSuggestionTemplates()
    expect(templates).toEqual({ kind: 'templates' })
    expect(syncWorkingSuggestionState(templates, '')).toEqual(templates)
    expect(showContextualWorkingSuggestions()).toEqual({ kind: 'root' })
  })

  test('上下文建议只生成预填结果和本地规划 chip', () => {
    expect(selectWorkingContextualSuggestion(contextualSuggestions[0])).toEqual({
      state: { kind: 'hidden', reason: 'prompt-filled' },
      prompt: '继续处理失败任务',
      plugin: null,
    })
  })

  test('分类返回模板页时清除系统 starter 并保留用户补写', () => {
    const category = selectWorkingSuggestionCategory('create', '创建')
    expect(returnToWorkingSuggestionTemplates(category, '创建一个项目说明')).toEqual({
      state: { kind: 'templates' },
      composerValue: '一个项目说明',
    })
  })
})
