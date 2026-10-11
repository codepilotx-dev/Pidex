import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import type { RenderTurnEntry } from '@pidex/session-view'
import { ModelSwitchDivider } from '../src/features/session/timeline/ModelSwitchDivider.js'
import { ConversationItemContext } from '../src/features/session/timeline/ConversationItemContext.js'

type TurnModel = RenderTurnEntry['turn']['model']
const a: TurnModel = {
  providerID: 'minimax' as TurnModel['providerID'],
  id: 'MiniMax-M3' as TurnModel['id'],
}
const b: TurnModel = {
  providerID: 'deepseek' as TurnModel['providerID'],
  id: 'deepseek-v4-pro' as TurnModel['id'],
}
const render = (previousModel: TurnModel | undefined, model: TurnModel) =>
  renderToStaticMarkup(<ModelSwitchDivider previousModel={previousModel} model={model} />)

describe('model switch divider', () => {
  test('does not mark the first visible turn or an unchanged model', () => {
    expect(render(undefined, a)).toBe('')
    expect(render(a, { ...a })).toBe('')
    expect(render(a, { ...a, variant: 'high' as TurnModel['variant'] })).toBe('')
  })

  test('marks model changes within a provider and provider changes with the same model id', () => {
    expect(render(a, { ...a, id: b.id })).toContain(
      '模型已切换 minimax/MiniMax-M3 → minimax/deepseek-v4-pro',
    )
    expect(render(a, { ...a, providerID: b.providerID })).toContain(
      '模型已切换 minimax/MiniMax-M3 → deepseek/MiniMax-M3',
    )
  })

  test('uses catalog display names and falls back to missing provider IDs', () => {
    const markup = renderToStaticMarkup(
      <ConversationItemContext.Provider
        value={{
          modelProviderNames: { minimax: 'MiniMax' },
          canCopyFileReferenceContents: () => false,
          onCopyFileReferenceContents: () => undefined,
          onOpenFileReference: () => undefined,
          onSubmitEditedUserMessage: async () => undefined,
          sessionStatus: 'idle',
          workspacePath: null,
        }}
      >
        <ModelSwitchDivider previousModel={a} model={b} />
      </ConversationItemContext.Provider>,
    )
    expect(markup).toContain('模型已切换 MiniMax/MiniMax-M3 → deepseek/deepseek-v4-pro')
    expect(markup).toContain('aria-hidden="true"')
  })

  test('A → B → B → A yields only the two actual switches', () => {
    const turns = [a, b, b, a]
    const markup = turns.map((model, index) => render(turns[index - 1], model)).join('')
    expect(markup.match(/class="canonical-model-switch-divider"/g)).toHaveLength(2)
    expect(markup).toContain('minimax/MiniMax-M3 → deepseek/deepseek-v4-pro')
    expect(markup).toContain('deepseek/deepseek-v4-pro → minimax/MiniMax-M3')
  })
})
