import { describe, expect, test } from 'bun:test'
import { nestedSelectorBlock, transitionProperties } from '../scripts/StyleAnimationContracts.js'

describe('style animation contracts', () => {
  test('scopes nested selector lookup to the requested parent block', () => {
    const source = `
      .other {
        &__content { will-change: transform; }
      }
      .canonical-turn-activity {
        &__content { overflow: hidden; }
      }
    `

    expect(nestedSelectorBlock(source, '.canonical-turn-activity', '&__content')).toContain(
      'overflow: hidden',
    )
    expect(nestedSelectorBlock(source, '.canonical-turn-activity', '&__content')).not.toContain(
      'will-change',
    )
  })

  test('reports every transition property without splitting easing functions', () => {
    expect(
      transitionProperties(`
        .progress {
          transition: transform 160ms cubic-bezier(0.2, 0, 0, 1);
        }
      `),
    ).toEqual(['transform'])
    expect(
      transitionProperties(`
        .progress {
          transition: transform 160ms ease, height 160ms ease;
        }
      `),
    ).toEqual(['transform', 'height'])
  })
})
