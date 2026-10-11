import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { NewSessionSuggestions } from '../src/features/session/NewSessionSuggestionPanel.js'
import type { NewSessionTaskSuggestion } from '../src/features/session/NewSessionSuggestions.js'

const suggestions = Array.from({ length: 5 }, (_, index) => ({
  id: `suggestion:${index + 1}`,
  categoryId: 'codex-create',
  label: `建议 ${index + 1}`,
  prompt: `执行建议 ${index + 1}`,
})) satisfies NewSessionTaskSuggestion[]

describe('NewSessionSuggestions', () => {
  test('Coding 根建议在渲染边界最多显示四张卡片', () => {
    const html = renderToStaticMarkup(
      <NewSessionSuggestions
        state={{ kind: 'root' }}
        suggestions={suggestions}
        onSelectSuggestion={() => {}}
        onSelectCategory={() => {}}
        onSelectTask={() => {}}
        onShowAll={() => {}}
        onShowSuggestions={() => {}}
      />,
    )

    expect(html.match(/new-session-suggestion-card/g)).toHaveLength(4)
    expect(html).toContain('建议 4')
    expect(html).not.toContain('建议 5')
  })
})
