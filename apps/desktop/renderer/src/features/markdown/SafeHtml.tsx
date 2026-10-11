import React from 'react'

type SafeHtmlActions = {
  openExternal: (url: string) => void
  openFile: (path: string) => void
}

type ParsedNode =
  | { kind: 'text'; text: string }
  | {
      kind: 'element'
      tag: string
      attributes: Record<string, string>
      children: ParsedNode[]
    }

type ElementNode = Extract<ParsedNode, { kind: 'element' }>

const ROOT_TAG = 'markdown-root'
const TOKEN_PATTERN = /<!--[\s\S]*?-->|<\/?[a-zA-Z][^>]*>|[^<]+|</gu
const TAG_PATTERN = /^<\s*(\/?)\s*([a-zA-Z][\w-]*)([^>]*)>$/u
const DROP_WITH_CONTENT_TAGS = new Set(['script', 'style', 'iframe', 'object', 'embed'])
const ALLOWED_TAGS = new Set(['b', 'br', 'del', 'em', 'i', 's', 'strong', 'sub', 'sup', 'u'])
const VOID_TAGS = new Set(['br'])

export function renderSafeHtml(
  html: string,
  keyPrefix: string,
  actions: SafeHtmlActions,
): React.ReactNode {
  const root = parseBasicHtml(html)
  return root.children.map((node, index) =>
    renderParsedNode(node, `${keyPrefix}-${index}`, actions),
  )
}

function parseBasicHtml(html: string): ElementNode {
  const root: ElementNode = {
    kind: 'element',
    tag: ROOT_TAG,
    attributes: {},
    children: [],
  }
  const stack: ElementNode[] = [root]
  const droppedTags: string[] = []

  for (const match of html.matchAll(TOKEN_PATTERN)) {
    const fragment = match[0]
    if (!fragment || fragment.startsWith('<!--')) continue
    const tagMatch = fragment.startsWith('<') ? TAG_PATTERN.exec(fragment) : null
    if (tagMatch) {
      const closing = Boolean(tagMatch[1])
      const tag = tagMatch[2].toLowerCase()
      if (DROP_WITH_CONTENT_TAGS.has(tag)) {
        if (closing) {
          const matchingIndex = droppedTags.lastIndexOf(tag)
          if (matchingIndex !== -1) droppedTags.length = matchingIndex
        } else if (!tagMatch[3].trimEnd().endsWith('/')) {
          droppedTags.push(tag)
        }
        continue
      }
    }
    if (droppedTags.length > 0) continue
    if (!fragment.startsWith('<')) {
      appendText(stack.at(-1)!, fragment)
      continue
    }

    if (!tagMatch) {
      appendText(stack.at(-1)!, fragment)
      continue
    }
    const closing = Boolean(tagMatch[1])
    const tag = tagMatch[2].toLowerCase()
    if (!ALLOWED_TAGS.has(tag)) continue

    if (closing) {
      const matchingIndex = stack.findLastIndex((node) => node.tag === tag)
      if (matchingIndex > 0) stack.length = matchingIndex
      continue
    }

    const element: ElementNode = {
      kind: 'element',
      tag,
      attributes: parseSafeAttributes(tag, tagMatch[3]),
      children: [],
    }
    stack.at(-1)!.children.push(element)
    if (!VOID_TAGS.has(tag) && !fragment.endsWith('/>')) stack.push(element)
  }
  return root
}

function parseSafeAttributes(_tag: string, _source: string): Record<string, string> {
  return {}
}

function renderParsedNode(
  node: ParsedNode,
  key: string,
  actions: SafeHtmlActions,
): React.ReactNode {
  if (node.kind === 'text') return decodeHtmlEntities(node.text)
  const children = node.children.map((child, index) =>
    renderParsedNode(child, `${key}-${index}`, actions),
  )

  void actions
  return React.createElement(node.tag, { key }, children)
}

function appendText(parent: ElementNode, text: string): void {
  const previous = parent.children.at(-1)
  if (previous?.kind === 'text') {
    previous.text += text
  } else {
    parent.children.push({ kind: 'text', text })
  }
}

function decodeHtmlEntities(value: string): string {
  return value.replace(
    /&(?:#(\d+)|#x([\da-f]+)|([a-z]+));/giu,
    (entity, decimal: string, hex: string, named: string) => {
      if (decimal) return String.fromCodePoint(Number.parseInt(decimal, 10))
      if (hex) return String.fromCodePoint(Number.parseInt(hex, 16))
      return (
        {
          amp: '&',
          apos: "'",
          gt: '>',
          lt: '<',
          nbsp: '\u00a0',
          quot: '"',
        }[named.toLowerCase()] ?? entity
      )
    },
  )
}
