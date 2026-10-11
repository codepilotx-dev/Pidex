import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { buildThreadDeepLink, parseThreadDeepLink } from '@pidex/shared/thread-reference'
import { classifyMarkdownTarget } from '../src/features/markdown/SafeTargets.js'
import {
  MARKDOWN_THREAD_NAVIGATION_EVENT,
  handleMarkdownThreadLinkClick,
} from '../src/features/markdown/MarkdownMessage.js'

type CapturedEvent = { type: string; detail: unknown }
let dispatched: CapturedEvent[]

beforeEach(() => {
  dispatched = []
  const windowStub = {
    dispatchEvent: (event: Event): boolean => {
      dispatched.push({
        type: event.type,
        detail: (event as CustomEvent).detail,
      })
      return true
    },
  }
  ;(globalThis as { window?: unknown }).window = windowStub
})

afterEach(() => {
  delete (globalThis as { window?: unknown }).window
})

describe('pidex thread deep links in markdown targets', () => {
  test('classifies valid deep links as internal threads using the shared parser id', () => {
    const ids = ['plain-id-123', 'thread with spaces', 'dir/sub/thread', '会话/你好']
    for (const id of ids) {
      const link = buildThreadDeepLink(id)
      const parsed = parseThreadDeepLink(link)
      if (parsed === null) {
        throw new Error(`expected parseThreadDeepLink to round-trip ${JSON.stringify(id)}`)
      }
      expect(classifyMarkdownTarget(link)).toEqual({
        kind: 'thread',
        threadId: parsed,
      })
    }
  })

  test('never treats wrong scheme, host, query, hash, or extra segments as an internal thread', () => {
    const invalid = [
      'http://threads/abc',
      'https://threads/abc',
      'code-pilot://threads/abc',
      'pidex:threads/abc',
      'pidex:/threads/abc',
      '//threads/abc',
      'pidex://chat/abc',
      'pidex://threads.example/abc',
      'pidex://threads:8080/abc',
      'pidex://threads/abc?tab=open',
      'pidex://threads/abc#section',
      'pidex://user@threads/abc',
      'pidex://user:pass@threads/abc',
      'pidex://threads',
      'pidex://threads/',
      'pidex://threads//',
      'pidex://threads/abc/extra',
      'pidex://threads/abc/',
    ]
    for (const link of invalid) {
      expect(classifyMarkdownTarget(link)).not.toMatchObject({
        kind: 'thread',
      })
    }
  })

  test('keeps https external links, http rejection, file references, and anchors unchanged', () => {
    expect(classifyMarkdownTarget('https://example.com/a')).toEqual({
      kind: 'external',
      url: 'https://example.com/a',
    })
    expect(classifyMarkdownTarget('http://example.com')).toEqual({
      kind: 'unsafe',
    })
    expect(classifyMarkdownTarget('C:\\repo\\file.ts:42')).toEqual({
      kind: 'file',
      path: 'C:\\repo\\file.ts',
      line: 42,
    })
    expect(classifyMarkdownTarget('./src/file.ts#L10-L12')).toEqual({
      kind: 'file',
      path: './src/file.ts',
      line: 10,
      endLine: 12,
    })
    expect(classifyMarkdownTarget('file:///C:/repo/file.ts#L7-L9')).toEqual({
      kind: 'file',
      path: 'C:/repo/file.ts',
      line: 7,
      endLine: 9,
    })
    expect(classifyMarkdownTarget('#section')).toEqual({
      kind: 'anchor',
      href: '#section',
    })
  })
})

describe('markdown thread link navigation', () => {
  test('clicking a valid internal link prevents default and emits a navigation event carrying only the parsed thread id', () => {
    const threadId = '会话 7'
    const link = buildThreadDeepLink(threadId)
    const preventDefault = mock(() => {})

    handleMarkdownThreadLinkClick({ preventDefault }, threadId)

    expect(preventDefault).toHaveBeenCalled()
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]?.type).toBe(MARKDOWN_THREAD_NAVIGATION_EVENT)
    expect(dispatched[0]?.detail).toEqual({ threadId })
    expect(JSON.stringify(dispatched[0])).not.toContain(link)
  })

  test('internal thread links never fall through to the external opener', () => {
    const threadId = 'thread-1'
    handleMarkdownThreadLinkClick({ preventDefault: mock(() => {}) }, threadId)
    expect(dispatched).toHaveLength(1)
    expect(dispatched[0]?.type).toBe(MARKDOWN_THREAD_NAVIGATION_EVENT)
    expect(classifyMarkdownTarget(buildThreadDeepLink(threadId))).toEqual({
      kind: 'thread',
      threadId,
    })
  })
})
