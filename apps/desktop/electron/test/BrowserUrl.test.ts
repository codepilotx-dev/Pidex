import { describe, expect, test } from 'bun:test'
import {
  isAllowedDesktopBrowserNavigation,
  normalizeDesktopBrowserUrl,
} from '../src/browser/BrowserUrl.js'

describe('desktop browser URL policy', () => {
  test('normalizes host input and allows explicit blank pages', () => {
    expect(normalizeDesktopBrowserUrl('example.com/docs')).toEqual({
      url: 'https://example.com/docs',
      origin: 'https://example.com',
    })
    expect(normalizeDesktopBrowserUrl('localhost:3000')).toMatchObject({
      url: 'http://localhost:3000/',
    })
    expect(normalizeDesktopBrowserUrl('about:blank')).toEqual({
      url: 'about:blank',
      origin: null,
    })
  })

  test('blocks file, script, data and malformed navigation', () => {
    for (const url of [
      'file:///C:/secret.txt',
      'javascript:alert(1)',
      'data:text/html,hello',
      'not a valid host',
    ]) {
      expect(isAllowedDesktopBrowserNavigation(url)).toBe(false)
    }
  })
})
