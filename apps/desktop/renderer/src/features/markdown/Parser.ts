import { marked, type Token, type Tokens } from 'marked'
import { LruCache } from './Lru.js'
import { completePendingMarkdown, segmentStreamingMarkdown } from './Streaming.js'
import type {
  MarkdownDirectiveToken,
  MarkdownMathToken,
  MarkdownParseResult,
  MarkdownRenderBlock,
  MarkdownStreamingCodeToken,
  MarkdownStreamingTextToken,
  MarkdownToken,
} from './Types.js'

/** 超过该长度的未完成文本块在流式期间不再反复执行完整 Markdown 解析。 */
export const STREAMING_RICH_PENDING_MAX_CHARACTERS = 4 * 1024
export const STREAMING_TEXT_CHUNK_CHARACTERS = 4 * 1024
import { normalizeDirectiveName } from './Directives.js'

const TOKEN_CACHE = new LruCache<string, MarkdownToken[]>(100, {
  maxWeight: 2 * 1024 * 1024,
  weigh: (source) => new TextEncoder().encode(source).byteLength,
})
const BLOCK_START = /^(?: {0,3})(:{1,3}[a-zA-Z][\w-]*|\$\$)[^\r\n]*(?:\r?\n|$)/m

export function parseMarkdown(text: string, streaming = false): MarkdownParseResult {
  const source = text ?? ''
  if (!streaming) {
    return {
      tokens: lexWithCache(source),
      stableText: source,
      pendingText: '',
    }
  }

  const segment = segmentStreamingMarkdown(source)
  const tokens = [...lexWithCache(segment.stableText)]
  if (segment.kind === 'code') {
    const pendingCode: MarkdownStreamingCodeToken = {
      type: 'streaming_code',
      raw: segment.pendingText,
      lang: segment.language,
      text: segment.code,
    }
    tokens.push(pendingCode)
  } else if (segment.pendingText) {
    if (segment.pendingText.length > STREAMING_RICH_PENDING_MAX_CHARACTERS) {
      for (
        let offset = 0;
        offset < segment.pendingText.length;
        offset += STREAMING_TEXT_CHUNK_CHARACTERS
      ) {
        const text = segment.pendingText.slice(offset, offset + STREAMING_TEXT_CHUNK_CHARACTERS)
        const pendingText: MarkdownStreamingTextToken = {
          type: 'streaming_text',
          raw: text,
          text,
        }
        tokens.push(pendingText)
      }
    } else {
      tokens.push(...lexMarkdown(completePendingMarkdown(segment.pendingText)))
    }
  }
  return {
    tokens,
    stableText: segment.stableText,
    pendingText: segment.pendingText,
  }
}

export function buildMarkdownBlocks(
  text: string,
  streaming = false,
  previous: readonly MarkdownRenderBlock[] = [],
  previousText = '',
): MarkdownRenderBlock[] {
  const source = text ?? ''
  const canReuse = source.startsWith(previousText)
  const parsed = parseMarkdown(source, streaming)
  const stableLength = parsed.stableText.length
  const candidates: MarkdownRenderBlock[] = []
  let rawOffset = 0

  for (const token of parsed.tokens) {
    const raw = token.raw ?? ''
    const invisible = token.type === 'space' || token.type === 'def'
    if (invisible && candidates.length > 0) {
      const prior = candidates[candidates.length - 1]
      prior.raw += raw
      rawOffset += raw.length
      continue
    }
    const state = rawOffset + raw.length <= stableLength ? 'stable' : 'pending'
    const index = candidates.length
    const candidate: MarkdownRenderBlock = {
      id: `block:${index}`,
      raw,
      tokens: [token],
      state,
      visibleText: visibleTextForToken(token),
    }
    candidates.push(candidate)
    rawOffset += raw.length
  }
  const pendingIndex = candidates.findLastIndex((block) => block.state === 'pending')
  if (pendingIndex >= 0 && parsed.pendingText) {
    // Pending tokens are produced from a parse-only completed copy. Keep the
    // block identity/source tied to the model output, never to synthetic
    // delimiters (or to the label-only fallback used for partial links).
    if (candidates[pendingIndex].tokens[0]?.type !== 'streaming_text') {
      candidates[pendingIndex].raw = parsed.pendingText
    }
  }
  return candidates.map((candidate, index) => {
    const old = canReuse ? previous[index] : undefined
    return old && old.raw === candidate.raw && old.state === candidate.state ? old : candidate
  })
}

function visibleTextForToken(token: MarkdownToken): string {
  if (token.type === 'streaming_code' || token.type === 'streaming_text') return token.text
  if ('tokens' in token && Array.isArray(token.tokens)) {
    return token.tokens.map((child) => visibleTextForToken(child)).join('')
  }
  if (token.type === 'list') {
    return token.items
      .flatMap((item) => item.tokens)
      .map((child) => visibleTextForToken(child))
      .join('')
  }
  if (token.type === 'table') {
    return [...token.header, ...token.rows.flat()]
      .flatMap((cell) => cell.tokens)
      .map((child) => visibleTextForToken(child))
      .join('')
  }
  if ('text' in token && typeof token.text === 'string') return token.text
  return token.raw ?? ''
}

export function lexMarkdown(text: string): MarkdownToken[] {
  if (!text) return []
  const tokens: MarkdownToken[] = []
  let remaining = text

  while (remaining) {
    const blockMatch = BLOCK_START.exec(remaining)
    if (!blockMatch || blockMatch.index === undefined) {
      tokens.push(...lexMarked(remaining))
      break
    }
    if (blockMatch.index > 0) {
      tokens.push(...lexMarked(remaining.slice(0, blockMatch.index)))
      remaining = remaining.slice(blockMatch.index)
    }

    if (blockMatch[1] === '$$') {
      const math = readMathBlock(remaining)
      if (!math) {
        tokens.push(...lexMarked(remaining))
        break
      }
      tokens.push(math.token)
      remaining = remaining.slice(math.length)
      continue
    }

    const directive = readDirectiveBlock(remaining)
    if (!directive) {
      tokens.push(...lexMarked(remaining))
      break
    }
    tokens.push(directive.token)
    remaining = remaining.slice(directive.length)
  }

  return tokens
}

export function lexWithCache(text: string): MarkdownToken[] {
  if (!text) return []
  const cached = TOKEN_CACHE.get(text)
  if (cached) return cached
  const tokens = lexMarkdown(text)
  TOKEN_CACHE.set(text, tokens)
  return tokens
}

function lexMarked(text: string): MarkdownToken[] {
  const tokens = marked.lexer(text, {
    breaks: true,
    gfm: true,
  }) as Token[]
  return tokens.map((token) => addInlineMath(token))
}

function addInlineMath(token: Token): MarkdownToken {
  if ('tokens' in token && Array.isArray(token.tokens)) {
    token.tokens = splitInlineMathTokens(token.tokens)
  }
  if (token.type === 'list') {
    token.items = token.items.map((item) => ({
      ...item,
      tokens: item.tokens.map((child) => addInlineMath(child) as Token),
    }))
  }
  if (token.type === 'table') {
    token.header = token.header.map((cell) => ({
      ...cell,
      tokens: splitInlineMathTokens(cell.tokens),
    }))
    token.rows = token.rows.map((row) =>
      row.map((cell) => ({
        ...cell,
        tokens: splitInlineMathTokens(cell.tokens),
      })),
    )
  }
  return token
}

function splitInlineMathTokens(tokens: Token[]): Token[] {
  const result: Token[] = []
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]
    if (token.type === 'escape' && (token.raw === '\\(' || token.raw === '\\[')) {
      const closingRaw = token.raw === '\\(' ? '\\)' : '\\]'
      const closingIndex = tokens.findIndex(
        (candidate, candidateIndex) =>
          candidateIndex > index && candidate.type === 'escape' && candidate.raw === closingRaw,
      )
      if (closingIndex > index) {
        result.push({
          type: 'math',
          raw: tokens
            .slice(index, closingIndex + 1)
            .map((candidate) => candidate.raw)
            .join(''),
          text: tokens
            .slice(index + 1, closingIndex)
            .map((candidate) => candidate.raw)
            .join(''),
          display: token.raw === '\\[',
        } as unknown as Token)
        index = closingIndex
        continue
      }
    }

    if (
      token.type !== 'text' ||
      (!token.text.includes('$') && !token.text.includes('\\(') && !token.text.includes('\\['))
    ) {
      result.push(addInlineMath(token) as Token)
      continue
    }
    const pieces = splitInlineMath(token.text)
    for (const piece of pieces) result.push(piece as Token)
  }
  return result
}

function splitInlineMath(text: string): Array<Token | MarkdownMathToken> {
  const result: Array<Token | MarkdownMathToken> = []
  const pattern = /(?<!\\)\$(?!\$)(.+?)(?<!\\)\$|\\\((.+?)\\\)|\\\[([\s\S]+?)\\\]/gu
  let cursor = 0
  for (const match of text.matchAll(pattern)) {
    if (match.index === undefined) continue
    if (match.index > cursor) {
      result.push(textToken(text.slice(cursor, match.index)))
    }
    result.push({
      type: 'math',
      raw: match[0],
      text: match[1] ?? match[2] ?? match[3] ?? '',
      display: match[3] !== undefined,
    })
    cursor = match.index + match[0].length
  }
  if (cursor < text.length) result.push(textToken(text.slice(cursor)))
  return result.length > 0 ? result : [textToken(text)]
}

function readMathBlock(source: string): { length: number; token: MarkdownMathToken } | null {
  const match = /^\$\$[^\S\r\n]*(?:\r?\n)?([\s\S]*?)(?:\r?\n)?\$\$[^\S\r\n]*(?:\r?\n|$)/u.exec(
    source,
  )
  if (!match) return null
  return {
    length: match[0].length,
    token: {
      type: 'math',
      raw: match[0],
      text: match[1],
      display: true,
    },
  }
}

function readDirectiveBlock(
  source: string,
): { length: number; token: MarkdownDirectiveToken } | null {
  const inline =
    /^(:{1,2})([a-zA-Z][\w-]*)(?:\{((?:[^}"']|"[^"]*"|'[^']*')*)\})?(?:[ \t]+([^\r\n]*))?[ \t]*(?:\r?\n|$)/u.exec(
      source,
    )
  if (inline) {
    const name = normalizeDirectiveName(inline[2])
    return {
      length: inline[0].length,
      token: {
        type: 'directive',
        raw: inline[0],
        name,
        argument: inline[4]?.trim() ?? '',
        attributes: parseDirectiveAttributes(inline[3] ?? ''),
        text: '',
        tokens: [],
      },
    }
  }

  const opener = /^:::([a-zA-Z][\w-]*)(?:[ \t]+([^\r\n]*))?[ \t]*(?:\r?\n|$)/u.exec(source)
  if (!opener) return null
  const bodyStart = opener[0].length
  const closer = /(?:^|\r?\n):::[ \t]*(?:\r?\n|$)/mu
  const bodyAndRest = source.slice(bodyStart)
  const closeMatch = closer.exec(bodyAndRest)
  if (!closeMatch || closeMatch.index === undefined) return null
  const leadingNewline = closeMatch[0].startsWith('\n')
    ? 1
    : closeMatch[0].startsWith('\r\n')
      ? 2
      : 0
  const body = bodyAndRest.slice(0, closeMatch.index + leadingNewline)
  const rawLength = bodyStart + closeMatch.index + closeMatch[0].length
  const name = normalizeDirectiveName(opener[1])
  return {
    length: rawLength,
    token: {
      type: 'directive',
      raw: source.slice(0, rawLength),
      name,
      argument: opener[2]?.trim() ?? '',
      attributes: {},
      text: body,
      tokens: lexMarkdown(body),
    },
  }
}

function parseDirectiveAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  let cursor = 0
  while (cursor < source.length) {
    while (cursor < source.length && isAttributeWhitespace(source[cursor])) {
      cursor += 1
    }
    if (!isAsciiLetter(source.charCodeAt(cursor))) {
      cursor += 1
      continue
    }
    const keyStart = cursor
    cursor += 1
    while (cursor < source.length && isAttributeNameCode(source.charCodeAt(cursor))) {
      cursor += 1
    }
    const key = source.slice(keyStart, cursor).toLowerCase()
    if (source[cursor] !== '=') continue
    cursor += 1
    if (cursor >= source.length) continue

    const quote = source[cursor] === '"' || source[cursor] === "'" ? source[cursor] : null
    if (quote) cursor += 1
    let value = ''
    let closed = quote === null
    while (cursor < source.length) {
      const char = source[cursor]
      if (quote && char === quote) {
        cursor += 1
        closed = true
        break
      }
      if (!quote && isAttributeWhitespace(char)) break
      if (quote && char === '\\' && cursor + 1 < source.length) {
        const escaped = source[cursor + 1]
        value += escaped === '"' || escaped === "'" || escaped === '\\' ? escaped : '\\' + escaped
        cursor += 2
        continue
      }
      value += char
      cursor += 1
    }
    if (closed && (quote !== null || value.length > 0)) {
      attributes[key] = value
    }
  }
  return attributes
}

function isAsciiLetter(code: number): boolean {
  return (code >= 65 && code <= 90) || (code >= 97 && code <= 122)
}

function isAttributeNameCode(code: number): boolean {
  return isAsciiLetter(code) || (code >= 48 && code <= 57) || code === 45 || code === 95
}

function isAttributeWhitespace(char: string | undefined): boolean {
  return char === ' ' || char === '\t' || char === '\r' || char === '\n' || char === '\f'
}

function textToken(text: string): Tokens.Text {
  return { type: 'text', raw: text, text }
}

export function clearMarkdownTokenCache(): void {
  TOKEN_CACHE.clear()
}
