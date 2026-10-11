import { describe, expect, test } from 'bun:test'
import {
  catalogBrowseParams,
  catalogDetailsParams,
  parseCatalogLocation,
} from '../src/features/plugins/CatalogDetailsDeepLink.js'

describe('catalog details deep links', () => {
  test('selects the detail kind even when tab is omitted', () => {
    expect(parseCatalogLocation(new URLSearchParams('plugin=browser'))).toEqual({
      invalid: false,
      tab: 'plugins',
      target: { id: 'browser', kind: 'plugin', tab: 'plugins' },
    })
    expect(parseCatalogLocation(new URLSearchParams('skill=frontend-design'))).toEqual({
      invalid: false,
      tab: 'skills',
      target: { id: 'frontend-design', kind: 'skill', tab: 'skills' },
    })
  })

  test('rejects conflicting detail parameters', () => {
    expect(
      parseCatalogLocation(new URLSearchParams('plugin=browser&skill=frontend-design')),
    ).toMatchObject({
      invalid: true,
      target: null,
    })
  })

  test('preserves unrelated query parameters while changing catalog location', () => {
    const current = new URLSearchParams('from=settings&tab=plugins&plugin=browser')

    expect(catalogBrowseParams(current, 'skills').toString()).toBe('from=settings&tab=skills')
    expect(
      catalogDetailsParams(current, {
        id: 'frontend-design',
        kind: 'skill',
        tab: 'skills',
      }).toString(),
    ).toBe('from=settings&tab=skills&skill=frontend-design')
  })
})
