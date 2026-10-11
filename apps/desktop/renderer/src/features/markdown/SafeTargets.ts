import { parseThreadDeepLink } from '@pidex/shared/thread-reference'
import type { MarkdownFileReference } from './Types.js'

export type SafeMarkdownTarget =
  | { kind: 'external'; url: string }
  | { kind: 'anchor'; href: string }
  | { kind: 'thread'; threadId: string }
  | ({ kind: 'file' } & MarkdownFileReference)
  | { kind: 'unsafe' }

const WINDOWS_PATH = /^[a-zA-Z]:[\\/]/
const RELATIVE_PATH = /^(?:\.{1,2}[\\/])/
const UNIX_PATH = /^\//
const BARE_FILE_PATH =
  /^(?![a-zA-Z][a-zA-Z\d+.-]*:)(?:[^<>"|?*\r\n]+[\\/])?[^<>"|?*\r\n]+\.[a-zA-Z\d]{1,12}(?:(?:#L\d+(?:-L?\d+)?)|(?::\d+(?::\d+)?))?$/u

export function classifyMarkdownTarget(target: string): SafeMarkdownTarget {
  const value = target.trim()
  if (!value) return { kind: 'unsafe' }
  if (value.startsWith('#')) return { kind: 'anchor', href: value }
  if (WINDOWS_PATH.test(value) || RELATIVE_PATH.test(value) || UNIX_PATH.test(value)) {
    return { kind: 'file', ...parseMarkdownFileReference(value) }
  }
  if (BARE_FILE_PATH.test(value)) {
    return { kind: 'file', ...parseMarkdownFileReference(value) }
  }

  const threadId = parseThreadDeepLink(value)
  if (threadId !== null) {
    return { kind: 'thread', threadId }
  }

  try {
    const url = new URL(value)
    if (url.protocol === 'https:') {
      return { kind: 'external', url: url.href }
    }
    if (url.protocol === 'file:') {
      return {
        kind: 'file',
        ...parseMarkdownFileReference(`${decodeFileUrl(url)}${url.hash}`),
      }
    }
  } catch {
    return { kind: 'unsafe' }
  }
  return { kind: 'unsafe' }
}

export function isSafeHttpsMediaSource(source: string): boolean {
  try {
    return new URL(source).protocol === 'https:'
  } catch {
    return false
  }
}

export function mediaKindForUrl(source: string): 'audio' | 'image' | 'video' | null {
  if (!isSafeHttpsMediaSource(source)) return null
  const pathname = new URL(source).pathname.toLowerCase()
  if (/\.(?:avif|gif|jpe?g|png|svg|webp)$/u.test(pathname)) return 'image'
  if (/\.(?:m4a|mp3|oga|ogg|wav)$/u.test(pathname)) return 'audio'
  if (/\.(?:m4v|mp4|ogv|webm)$/u.test(pathname)) return 'video'
  return null
}

export function isLikelyFileReference(value: string): boolean {
  const target = classifyMarkdownTarget(value)
  return target.kind === 'file'
}

export function parseMarkdownFileReference(value: string): MarkdownFileReference {
  const source = value.trim()
  const hashMatch = /#L(\d+)(?:C(\d+))?(?:-L?(\d+)(?:C(\d+))?)?$/iu.exec(source)
  if (hashMatch?.index !== undefined) {
    return compactReference({
      path: source.slice(0, hashMatch.index),
      line: positiveInteger(hashMatch[1]),
      column: positiveInteger(hashMatch[2]),
      endLine: positiveInteger(hashMatch[3]),
      endColumn: positiveInteger(hashMatch[4]),
    })
  }

  const colonMatch = /:(\d+)(?::(\d+))?$/u.exec(source)
  if (colonMatch?.index !== undefined) {
    return compactReference({
      path: source.slice(0, colonMatch.index),
      line: positiveInteger(colonMatch[1]),
      column: positiveInteger(colonMatch[2]),
    })
  }
  return { path: source }
}

function decodeFileUrl(url: URL): string {
  const pathname = decodeURIComponent(url.pathname)
  if (/^\/[a-zA-Z]:\//u.test(pathname)) return pathname.slice(1)
  return pathname
}

function compactReference(reference: MarkdownFileReference): MarkdownFileReference {
  return Object.fromEntries(
    Object.entries(reference).filter(([, value]) => value !== undefined),
  ) as MarkdownFileReference
}

function positiveInteger(value: string | undefined): number | undefined {
  if (!value) return undefined
  const parsed = Number.parseInt(value, 10)
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined
}
