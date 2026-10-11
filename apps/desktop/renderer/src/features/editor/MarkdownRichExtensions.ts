import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { syntaxTree } from '@codemirror/language'
import {
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from '@codemirror/state'
import {
  Decoration,
  type DecorationSet,
  EditorView,
  ViewPlugin,
  type ViewUpdate,
  WidgetType,
} from '@codemirror/view'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { MermaidRenderer } from '../markdown/MermaidRenderer.js'
import { CodeBlock } from '../syntax/CodeBlock.js'

type RichDecorationSets = {
  atomic: DecorationSet
  decorations: DecorationSet
}

type MarkdownSyntaxNode = {
  readonly from: number
  readonly name: string
  readonly parent: MarkdownSyntaxNode | null
  readonly to: number
  getChild(name: string): MarkdownSyntaxNode | null
  getChildren(name: string): MarkdownSyntaxNode[]
}

const hiddenMarker = Decoration.replace({})
const setRichDecorationSets = StateEffect.define<RichDecorationSets>()
const richDecorationField = StateField.define<RichDecorationSets>({
  create: () => ({
    atomic: Decoration.none,
    decorations: Decoration.none,
  }),
  update: (value, transaction) => {
    for (const effect of transaction.effects) {
      if (effect.is(setRichDecorationSets)) {
        return effect.value
      }
    }
    return value
  },
  provide: (field) => [
    EditorView.decorations.from(field, (value) => value.decorations),
    EditorView.atomicRanges.of((view) => view.state.field(field).atomic),
  ],
})
const mermaidRoots = new WeakMap<HTMLElement, Root>()
const mermaidObservers = new WeakMap<HTMLElement, ResizeObserver>()
const codeBlockRoots = new WeakMap<HTMLElement, Root>()
const codeBlockObservers = new WeakMap<HTMLElement, ResizeObserver>()

const headingClasses = new Map<string, string>([
  ['ATXHeading1', 'cm-md-rich-h1'],
  ['SetextHeading1', 'cm-md-rich-h1'],
  ['ATXHeading2', 'cm-md-rich-h2'],
  ['SetextHeading2', 'cm-md-rich-h2'],
  ['ATXHeading3', 'cm-md-rich-h3'],
  ['ATXHeading4', 'cm-md-rich-h4'],
  ['ATXHeading5', 'cm-md-rich-h5'],
  ['ATXHeading6', 'cm-md-rich-h6'],
])

const hiddenMarkerNames = new Set([
  'HeaderMark',
  'EmphasisMark',
  'CodeMark',
  'CodeInfo',
  'LinkMark',
])

/**
 * Presents a Markdown syntax tree as lightweight rich text without changing
 * the document or mounting executable HTML. The source marks remain available
 * whenever a selection enters their containing Markdown construct.
 */
export function createMarkdownRichExtensions(): Extension {
  return [
    EditorView.editorAttributes.of({ class: 'cm-markdown-rich' }),
    markdownRichTheme,
    richDecorationField,
    markdownRichPlugin,
  ]
}

const markdownRichPlugin = ViewPlugin.fromClass(
  class {
    private updateQueued = false

    constructor(view: EditorView) {
      this.queueUpdate(view)
    }

    update(update: ViewUpdate): void {
      const hasExternalEffect = update.transactions.some((transaction) =>
        transaction.effects.some((effect) => !effect.is(setRichDecorationSets)),
      )
      if (
        update.docChanged ||
        update.focusChanged ||
        update.viewportChanged ||
        update.selectionSet ||
        hasExternalEffect ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.queueUpdate(update.view)
      }
    }

    private queueUpdate(view: EditorView): void {
      if (this.updateQueued) {
        return
      }
      this.updateQueued = true
      queueMicrotask(() => {
        this.updateQueued = false
        if (!view.dom.isConnected) {
          return
        }
        view.dispatch({
          effects: setRichDecorationSets.of(buildRichDecorations(view)),
        })
      })
    }
  },
)

function buildRichDecorations(view: EditorView): RichDecorationSets {
  const decorationRanges: Range<Decoration>[] = []
  const atomicRanges: Range<Decoration>[] = []
  const seenDecorations = new Set<string>()
  const seenAtomicRanges = new Set<string>()
  const tree = syntaxTree(view.state)

  for (const visibleRange of view.visibleRanges) {
    tree.iterate({
      from: visibleRange.from,
      to: visibleRange.to,
      enter: (reference) => {
        const node = reference.node as MarkdownSyntaxNode
        const headingClass = headingClasses.get(node.name)
        if (headingClass) {
          addLineDecoration(
            view.state,
            node.from,
            `cm-md-rich-heading ${headingClass}`,
            decorationRanges,
            seenDecorations,
          )
        }

        if (
          hiddenMarkerNames.has(node.name) ||
          (node.name === 'URL' && node.parent?.name === 'Link')
        ) {
          const parent = node.parent
          if (parent && !selectionEntersNode(view, parent)) {
            const key = `${node.from}:${node.to}`
            if (!seenAtomicRanges.has(key)) {
              seenAtomicRanges.add(key)
              const range = hiddenMarker.range(node.from, node.to)
              atomicRanges.push(range)
              decorationRanges.push(range)
            }
          }
          return
        }

        if (node.name === 'ListMark') {
          addListMarkDecoration(
            view,
            node,
            decorationRanges,
            atomicRanges,
            seenDecorations,
            seenAtomicRanges,
          )
          return
        }

        switch (node.name) {
          case 'Emphasis':
            addMarkDecoration(node, 'cm-md-rich-emphasis', decorationRanges, seenDecorations)
            break
          case 'StrongEmphasis':
            addMarkDecoration(node, 'cm-md-rich-strong', decorationRanges, seenDecorations)
            break
          case 'Strikethrough':
            addMarkDecoration(node, 'cm-md-rich-strikethrough', decorationRanges, seenDecorations)
            break
          case 'InlineCode':
            addMarkDecoration(node, 'cm-md-rich-inline-code', decorationRanges, seenDecorations)
            break
          case 'Link':
          case 'Autolink':
            addMarkDecoration(node, 'cm-md-rich-link', decorationRanges, seenDecorations)
            break
          case 'Blockquote':
            addBlockquoteDecoration(view, node, visibleRange, decorationRanges, seenDecorations)
            break
          case 'ListItem':
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-list-item',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'HorizontalRule':
            addLineDecoration(
              view.state,
              node.from,
              'cm-md-rich-horizontal-rule',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'FencedCode':
            if (
              addMermaidDecoration(
                view,
                node,
                decorationRanges,
                atomicRanges,
                seenDecorations,
                seenAtomicRanges,
              )
            ) {
              return false
            }
            if (
              addCodeBlockDecoration(
                view,
                node,
                decorationRanges,
                atomicRanges,
                seenDecorations,
                seenAtomicRanges,
              )
            ) {
              return false
            }
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-code-block',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'CodeBlock':
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-code-block',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'Table':
            if (
              addTableDecoration(
                view,
                node,
                decorationRanges,
                atomicRanges,
                seenDecorations,
                seenAtomicRanges,
              )
            ) {
              return false
            }
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-table',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'TableHeader':
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-table-header',
              decorationRanges,
              seenDecorations,
            )
            break
          case 'TableRow':
            addVisibleLineDecorations(
              view,
              node,
              visibleRange,
              'cm-md-rich-table-row',
              decorationRanges,
              seenDecorations,
            )
            break
        }
      },
    })
  }

  return {
    atomic: Decoration.set(atomicRanges, true),
    decorations: Decoration.set(decorationRanges, true),
  }
}

function addListMarkDecoration(
  view: EditorView,
  node: MarkdownSyntaxNode,
  decorationRanges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  seenDecorations: Set<string>,
  seenAtomicRanges: Set<string>,
): void {
  const parent = node.parent
  if (!parent || selectionEntersNode(view, parent)) {
    return
  }
  const source = view.state.doc.sliceString(node.from, node.to).trim()
  const label = /^\d+[.)]$/u.test(source) ? source : '•'
  const key = `list-mark:${node.from}:${node.to}:${label}`
  if (seenDecorations.has(key)) {
    return
  }
  seenDecorations.add(key)
  const decoration = Decoration.replace({
    widget: new MarkdownListMarkWidget(label),
  }).range(node.from, node.to)
  decorationRanges.push(decoration)
  if (!seenAtomicRanges.has(key)) {
    seenAtomicRanges.add(key)
    atomicRanges.push(decoration)
  }
}

class MarkdownListMarkWidget extends WidgetType {
  constructor(private readonly label: string) {
    super()
  }

  override eq(other: MarkdownListMarkWidget): boolean {
    return this.label === other.label
  }

  override toDOM(view: EditorView): HTMLElement {
    const marker = view.dom.ownerDocument.createElement('span')
    marker.className = 'cm-md-rich-list-marker'
    marker.textContent = this.label
    return marker
  }
}

function addTableDecoration(
  view: EditorView,
  node: MarkdownSyntaxNode,
  decorationRanges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  seenDecorations: Set<string>,
  seenAtomicRanges: Set<string>,
): boolean {
  if (selectionEntersNode(view, node)) {
    return false
  }
  const table = parseMarkdownTable(view.state.doc.sliceString(node.from, node.to))
  if (!table) {
    return false
  }
  const from = view.state.doc.lineAt(node.from).from
  const to = view.state.doc.lineAt(node.to).to
  const key = `table:${from}:${to}`
  if (seenDecorations.has(key)) {
    return true
  }
  seenDecorations.add(key)
  const decoration = Decoration.replace({
    block: true,
    widget: new MarkdownTableWidget(table, from),
  }).range(from, to)
  decorationRanges.push(decoration)
  if (!seenAtomicRanges.has(key)) {
    seenAtomicRanges.add(key)
    atomicRanges.push(decoration)
  }
  return true
}

type MarkdownTableData = {
  alignments: Array<'center' | 'left' | 'right' | null>
  headers: string[]
  rows: string[][]
}

function parseMarkdownTable(source: string): MarkdownTableData | null {
  const lines = source
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean)
  if (lines.length < 2) {
    return null
  }
  const headers = splitMarkdownTableRow(lines[0] ?? '')
  const separators = splitMarkdownTableRow(lines[1] ?? '')
  if (
    headers.length === 0 ||
    separators.length !== headers.length ||
    separators.some((cell) => !/^:?-{3,}:?$/u.test(cell.replace(/\s+/gu, '')))
  ) {
    return null
  }
  const alignments = separators.map((cell) => {
    const marker = cell.replace(/\s+/gu, '')
    if (marker.startsWith(':') && marker.endsWith(':')) return 'center'
    if (marker.endsWith(':')) return 'right'
    if (marker.startsWith(':')) return 'left'
    return null
  })
  const rows = lines.slice(2).map((line) => {
    const cells = splitMarkdownTableRow(line)
    return headers.map((_, index) => cells[index] ?? '')
  })
  return { alignments, headers, rows }
}

function splitMarkdownTableRow(line: string): string[] {
  const source = line.replace(/^\s*\|/u, '').replace(/\|\s*$/u, '')
  const cells: string[] = []
  let cell = ''
  let escaped = false
  let codeDelimiterLength = 0
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? ''
    if (escaped) {
      cell += character
      escaped = false
      continue
    }
    if (character === '\\') {
      escaped = true
      continue
    }
    if (character === '`') {
      let length = 1
      while (source[index + length] === '`') length += 1
      codeDelimiterLength = codeDelimiterLength === length ? 0 : codeDelimiterLength || length
      cell += '`'.repeat(length)
      index += length - 1
      continue
    }
    if (character === '|' && codeDelimiterLength === 0) {
      cells.push(cell.trim())
      cell = ''
      continue
    }
    cell += character
  }
  if (escaped) cell += '\\'
  cells.push(cell.trim())
  return cells
}

class MarkdownTableWidget extends WidgetType {
  private readonly signature: string

  constructor(
    private readonly table: MarkdownTableData,
    private readonly sourceFrom: number,
  ) {
    super()
    this.signature = JSON.stringify(table)
  }

  override eq(other: MarkdownTableWidget): boolean {
    return this.signature === other.signature
  }

  override toDOM(view: EditorView): HTMLElement {
    const wrapper = view.dom.ownerDocument.createElement('div')
    wrapper.className = 'cm-md-rich-table-widget'
    wrapper.title = '点击编辑 Markdown 表格'
    const table = view.dom.ownerDocument.createElement('table')
    const headerRow = table.createTHead().insertRow()
    this.table.headers.forEach((header, index) => {
      const cell = view.dom.ownerDocument.createElement('th')
      cell.textContent = header
      applyTableAlignment(cell, this.table.alignments[index])
      headerRow.append(cell)
    })
    const body = table.createTBody()
    this.table.rows.forEach((row) => {
      const tableRow = body.insertRow()
      this.table.headers.forEach((_, index) => {
        const cell = tableRow.insertCell()
        cell.textContent = row[index] ?? ''
        applyTableAlignment(cell, this.table.alignments[index])
      })
    })
    wrapper.append(table)
    wrapper.addEventListener('pointerdown', (event) => {
      event.preventDefault()
      view.dispatch({ selection: { anchor: this.sourceFrom } })
      view.focus()
    })
    return wrapper
  }
}

function applyTableAlignment(
  cell: HTMLTableCellElement,
  alignment: MarkdownTableData['alignments'][number] | undefined,
): void {
  if (alignment) {
    cell.style.textAlign = alignment
  }
}

function addMermaidDecoration(
  view: EditorView,
  node: MarkdownSyntaxNode,
  decorationRanges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  seenDecorations: Set<string>,
  seenAtomicRanges: Set<string>,
): boolean {
  const info = node.getChild('CodeInfo')
  if (
    !info ||
    view.state.doc.sliceString(info.from, info.to).trim().split(/\s+/u, 1)[0]?.toLowerCase() !==
      'mermaid' ||
    selectionEntersNode(view, node)
  ) {
    return false
  }
  const definition = node
    .getChildren('CodeText')
    .map((child) => view.state.doc.sliceString(child.from, child.to))
    .join('')
  const from = view.state.doc.lineAt(node.from).from
  const to = view.state.doc.lineAt(node.to).to
  const key = `mermaid:${from}:${to}`
  if (seenDecorations.has(key)) return true
  seenDecorations.add(key)
  const decoration = Decoration.replace({
    block: true,
    widget: new MermaidBlockWidget(definition),
  }).range(from, to)
  decorationRanges.push(decoration)
  if (!seenAtomicRanges.has(key)) {
    seenAtomicRanges.add(key)
    atomicRanges.push(decoration)
  }
  return true
}

class MermaidBlockWidget extends WidgetType {
  constructor(private readonly definition: string) {
    super()
  }

  override eq(other: MermaidBlockWidget): boolean {
    return this.definition === other.definition
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = view.dom.ownerDocument.createElement('div')
    host.className = 'cm-md-rich-mermaid'
    const root = createRoot(host)
    mermaidRoots.set(host, root)
    root.render(
      React.createElement(MermaidRenderer, {
        definition: this.definition,
      }),
    )
    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => view.requestMeasure())
    observer?.observe(host)
    if (observer) {
      mermaidObservers.set(host, observer)
    }
    queueMicrotask(() => view.requestMeasure())
    return host
  }

  override destroy(dom: HTMLElement): void {
    mermaidObservers.get(dom)?.disconnect()
    mermaidObservers.delete(dom)
    const root = mermaidRoots.get(dom)
    mermaidRoots.delete(dom)
    queueMicrotask(() => root?.unmount())
  }
}

function addCodeBlockDecoration(
  view: EditorView,
  node: MarkdownSyntaxNode,
  decorationRanges: Range<Decoration>[],
  atomicRanges: Range<Decoration>[],
  seenDecorations: Set<string>,
  seenAtomicRanges: Set<string>,
): boolean {
  const info = node.getChild('CodeInfo')
  const rawInfo = info ? view.state.doc.sliceString(info.from, info.to).trim() : ''
  const language = rawInfo.split(/\s+/u, 1)[0] ?? ''
  if (language.toLowerCase() === 'mermaid') {
    return false
  }

  const startLine = view.state.doc.lineAt(node.from)
  const endLine = view.state.doc.lineAt(node.to)

  let code = ''
  if (startLine.number < endLine.number) {
    const firstCodeLine = view.state.doc.line(startLine.number + 1)
    const lastCodeLine = view.state.doc.line(endLine.number - 1)
    if (firstCodeLine.number <= lastCodeLine.number) {
      code = view.state.doc.sliceString(firstCodeLine.from, lastCodeLine.to)
    }
  }

  const from = startLine.from
  const to = endLine.to
  const key = `code-block:${from}:${to}`
  if (seenDecorations.has(key)) return true
  seenDecorations.add(key)

  const decoration = Decoration.replace({
    block: true,
    widget: new CodeBlockWidget(code, language, from, to),
  }).range(from, to)

  decorationRanges.push(decoration)
  if (!seenAtomicRanges.has(key)) {
    seenAtomicRanges.add(key)
    atomicRanges.push(decoration)
  }
  return true
}

class CodeBlockWidget extends WidgetType {
  constructor(
    private readonly code: string,
    private readonly language: string,
    private readonly sourceFrom: number,
    private readonly sourceTo: number,
  ) {
    super()
  }

  override eq(other: CodeBlockWidget): boolean {
    return (
      this.code === other.code &&
      this.language === other.language &&
      this.sourceFrom === other.sourceFrom &&
      this.sourceTo === other.sourceTo
    )
  }

  override toDOM(view: EditorView): HTMLElement {
    const host = view.dom.ownerDocument.createElement('div')
    host.className = 'cm-md-rich-code-block-widget'
    const root = createRoot(host)
    codeBlockRoots.set(host, root)

    const handleChangeLanguage = (newLanguage: string): void => {
      if (view.state.readOnly) return
      queueMicrotask(() => {
        if (!view.dom.isConnected) return
        const startLine = view.state.doc.lineAt(this.sourceFrom)
        const lineText = startLine.text
        const fenceMatch = lineText.match(/^(\s*)(`{3,}|~{3,})(.*)$/)
        if (fenceMatch) {
          const indent = fenceMatch[1] ?? ''
          const marker = fenceMatch[2] ?? '```'
          const fromPos = startLine.from + indent.length + marker.length
          const toPos = startLine.to
          view.dispatch({
            changes: { from: fromPos, to: toPos, insert: newLanguage },
          })
        }
      })
    }

    const handleChangeCode = (newCode: string): void => {
      if (view.state.readOnly) return
      queueMicrotask(() => {
        if (!view.dom.isConnected) return
        const startLine = view.state.doc.lineAt(this.sourceFrom)
        const endLine = view.state.doc.lineAt(this.sourceTo)
        let codeStartPos = startLine.to + 1
        let codeEndPos = startLine.to + 1
        if (startLine.number < endLine.number) {
          const firstCodeLine = view.state.doc.line(startLine.number + 1)
          const lastCodeLine = view.state.doc.line(endLine.number - 1)
          if (firstCodeLine.number <= lastCodeLine.number) {
            codeStartPos = firstCodeLine.from
            codeEndPos = lastCodeLine.to
          }
        }
        view.dispatch({
          changes: { from: codeStartPos, to: codeEndPos, insert: newCode },
        })
      })
    }

    root.render(
      React.createElement(CodeBlock, {
        code: this.code,
        language: this.language,
        onChangeCode: view.state.readOnly ? undefined : handleChangeCode,
        onChangeLanguage: view.state.readOnly ? undefined : handleChangeLanguage,
      }),
    )

    const observer =
      typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(() => view.requestMeasure())
    observer?.observe(host)
    if (observer) {
      codeBlockObservers.set(host, observer)
    }
    queueMicrotask(() => view.requestMeasure())
    return host
  }

  override destroy(dom: HTMLElement): void {
    codeBlockObservers.get(dom)?.disconnect()
    codeBlockObservers.delete(dom)
    const root = codeBlockRoots.get(dom)
    codeBlockRoots.delete(dom)
    queueMicrotask(() => root?.unmount())
  }
}

function selectionEntersNode(view: EditorView, node: MarkdownSyntaxNode): boolean {
  if (!view.hasFocus) {
    return false
  }
  return view.state.selection.ranges.some((range) =>
    range.empty
      ? range.head >= node.from && range.head <= node.to
      : range.from < node.to && range.to > node.from,
  )
}

function selectionEntersRange(view: EditorView, from: number, to: number): boolean {
  if (!view.hasFocus) {
    return false
  }
  return view.state.selection.ranges.some((range) =>
    range.empty ? range.head >= from && range.head <= to : range.from < to && range.to > from,
  )
}

type MarkdownAlertType = 'note' | 'tip' | 'important' | 'warning' | 'caution'

const ALERT_SVGS: Record<MarkdownAlertType, string> = {
  note: `<svg width="${APP_ICON_SIZE}" height="${APP_ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>`,
  tip: `<svg width="${APP_ICON_SIZE}" height="${APP_ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/><path d="M9 18h6"/><path d="M10 22h4"/></svg>`,
  important: `<svg width="${APP_ICON_SIZE}" height="${APP_ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
  warning: `<svg width="${APP_ICON_SIZE}" height="${APP_ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z"/><line x1="12" x2="12" y1="9" y2="13"/><line x1="12" x2="12.01" y1="17" y2="17"/></svg>`,
  caution: `<svg width="${APP_ICON_SIZE}" height="${APP_ICON_SIZE}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="7.86 2 16.14 2 22 7.86 22 16.14 16.14 22 7.86 22 2 16.14 2 7.86 7.86 2"/><line x1="12" x2="12" y1="8" y2="12"/><line x1="12" x2="12.01" y1="16" y2="16"/></svg>`,
}

const ALERT_TITLES: Record<MarkdownAlertType, string> = {
  note: 'Note',
  tip: 'Tip',
  important: 'Important',
  warning: 'Warning',
  caution: 'Caution',
}

class AlertHeaderWidget extends WidgetType {
  constructor(private readonly alertType: MarkdownAlertType) {
    super()
  }

  override eq(other: AlertHeaderWidget): boolean {
    return this.alertType === other.alertType
  }

  override toDOM(): HTMLElement {
    const el = document.createElement('div')
    el.className = `cm-md-rich-alert-header cm-md-rich-alert-header--${this.alertType}`
    const iconSpan = document.createElement('span')
    iconSpan.className = 'cm-md-rich-alert-icon'
    iconSpan.innerHTML = ALERT_SVGS[this.alertType] ?? ''
    const titleSpan = document.createElement('span')
    titleSpan.className = 'cm-md-rich-alert-title'
    titleSpan.textContent = ALERT_TITLES[this.alertType] ?? this.alertType
    el.append(iconSpan, titleSpan)
    return el
  }
}

function addBlockquoteDecoration(
  view: EditorView,
  node: MarkdownSyntaxNode,
  visibleRange: { from: number; to: number },
  decorationRanges: Range<Decoration>[],
  seenDecorations: Set<string>,
): void {
  const startLine = view.state.doc.lineAt(node.from)
  const endLine = view.state.doc.lineAt(node.to)

  const alertMatch = startLine.text.match(
    /^\s*>\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\](?:\s*|$)/i,
  )
  if (!alertMatch) {
    addVisibleLineDecorations(
      view,
      node,
      visibleRange,
      'cm-md-rich-blockquote',
      decorationRanges,
      seenDecorations,
    )
    return
  }

  const alertType = alertMatch[1].toLowerCase() as MarkdownAlertType
  const alertClass = `cm-md-rich-alert cm-md-rich-alert--${alertType}`

  for (let lineNumber = startLine.number; lineNumber <= endLine.number; lineNumber += 1) {
    const line = view.state.doc.line(lineNumber)
    if (line.to < visibleRange.from || line.from > visibleRange.to) {
      continue
    }
    const key = `line:${line.from}:${alertClass}`
    if (!seenDecorations.has(key)) {
      seenDecorations.add(key)
      decorationRanges.push(
        Decoration.line({
          attributes: { class: alertClass },
        }).range(line.from),
      )
    }
  }

  if (!selectionEntersRange(view, startLine.from, startLine.to)) {
    const key = `alert-header:${startLine.from}:${startLine.to}`
    if (!seenDecorations.has(key)) {
      seenDecorations.add(key)
      decorationRanges.push(
        Decoration.replace({
          widget: new AlertHeaderWidget(alertType),
        }).range(startLine.from, startLine.to),
      )
    }
  }
}

function addMarkDecoration(
  node: MarkdownSyntaxNode,
  className: string,
  ranges: Range<Decoration>[],
  seen: Set<string>,
): void {
  if (node.from === node.to) return
  const key = `mark:${className}:${node.from}:${node.to}`
  if (seen.has(key)) return
  seen.add(key)
  ranges.push(Decoration.mark({ class: className }).range(node.from, node.to))
}

function addVisibleLineDecorations(
  view: EditorView,
  node: MarkdownSyntaxNode,
  visibleRange: { from: number; to: number },
  className: string,
  ranges: Range<Decoration>[],
  seen: Set<string>,
): void {
  const from = Math.max(node.from, visibleRange.from)
  const to = Math.min(node.to, visibleRange.to)
  if (from > to) return
  let line = view.state.doc.lineAt(from)
  while (line.from <= to) {
    addLineDecoration(view.state, line.from, className, ranges, seen)
    if (line.to >= to || line.number >= view.state.doc.lines) break
    line = view.state.doc.line(line.number + 1)
  }
}

function addLineDecoration(
  state: EditorState,
  position: number,
  className: string,
  ranges: Range<Decoration>[],
  seen: Set<string>,
): void {
  const lineFrom = state.doc.lineAt(position).from
  const key = `line:${className}:${lineFrom}`
  if (seen.has(key)) return
  seen.add(key)
  ranges.push(Decoration.line({ class: className }).range(lineFrom))
}

export const markdownRichThemeSpec = {
  '&.cm-markdown-rich': {
    color: 'var(--cpx-sys-color-fg-primary)',
    backgroundColor: 'var(--cpx-sys-color-surface-canvas)',
  },
  '&.cm-markdown-rich .cm-content': {
    font: 'var(--cpx-sys-type-reading)',
    padding: '24px',
  },
  '&.cm-markdown-rich .cm-md-rich-heading': {
    color: 'var(--cpx-sys-color-fg-primary)',
    letterSpacing: '-0.015em',
  },
  '&.cm-markdown-rich .cm-md-rich-h1': {
    font: 'var(--cpx-sys-type-heading-xl)',
  },
  '&.cm-markdown-rich .cm-md-rich-h2': {
    font: 'var(--cpx-sys-type-heading-lg)',
  },
  '&.cm-markdown-rich .cm-md-rich-h3': {
    font: 'var(--cpx-sys-type-heading-sm)',
  },
  '&.cm-markdown-rich .cm-md-rich-h4, &.cm-markdown-rich .cm-md-rich-h5, &.cm-markdown-rich .cm-md-rich-h6':
    {
      font: 'var(--cpx-sys-type-row-title)',
    },
  '&.cm-markdown-rich .cm-md-rich-emphasis': {
    fontStyle: 'italic',
  },
  '&.cm-markdown-rich .cm-md-rich-strong': {
    fontWeight: 'var(--cpx-sys-font-weight-bold)',
  },
  '&.cm-markdown-rich .cm-md-rich-strikethrough': {
    textDecoration: 'line-through',
  },
  '&.cm-markdown-rich .cm-md-rich-inline-code': {
    padding: '0.08em 0.3em',
    borderRadius: '0',
    color: 'var(--cm-editor-foreground, var(--cpx-sys-color-fg-primary))',
    backgroundColor:
      'color-mix(in srgb, var(--cm-editor-background, var(--cpx-comp-modal-preformat-bg)) 88%, var(--cpx-sys-color-fg-primary) 12%)',
    font: 'var(--cpx-sys-type-code)',
  },
  '&.cm-markdown-rich .cm-md-rich-link': {
    color: 'var(--cpx-sys-color-accent)',
    textDecoration: 'underline',
    textDecorationColor: 'color-mix(in srgb, var(--cpx-sys-color-accent) 55%, transparent)',
    textUnderlineOffset: '0.16em',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-blockquote': {
    boxSizing: 'border-box',
    borderLeft: '3px solid var(--cpx-sys-color-border-strong)',
    paddingLeft: '12px',
    color: 'var(--cpx-sys-color-fg-secondary)',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-alert': {
    boxSizing: 'border-box',
    borderLeft: '3.5px solid var(--cpx-sys-color-border-default)',
    paddingLeft: '12px',
    color: 'var(--cpx-sys-color-fg-primary)',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-alert--note': {
    borderLeftColor: 'var(--cpx-sys-color-accent)',
    background: 'color-mix(in srgb, var(--cpx-sys-color-accent) 6%, transparent)',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-alert--tip': {
    borderLeftColor: 'var(--cpx-sys-color-success)',
    background: 'color-mix(in srgb, var(--cpx-sys-color-success) 6%, transparent)',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-alert--important': {
    borderLeftColor: '#a855f7',
    background: 'color-mix(in srgb, #a855f7 6%, transparent)',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-alert--warning': {
    borderLeftColor: 'var(--cpx-sys-color-warning)',
    background: 'color-mix(in srgb, var(--cpx-sys-color-warning) 6%, transparent)',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-alert--caution': {
    borderLeftColor: 'var(--cpx-sys-color-danger)',
    background: 'color-mix(in srgb, var(--cpx-sys-color-danger) 6%, transparent)',
  },
  '&.cm-markdown-rich .cm-md-rich-alert-header': {
    display: 'inline-flex',
    alignItems: 'center',
    gap: '6px',
    fontWeight: '600',
    fontSize: 'var(--cpx-sys-font-size-sm)',
    userSelect: 'none',
  },
  '&.cm-markdown-rich .cm-md-rich-alert-header--note': {
    color: 'var(--cpx-sys-color-accent)',
  },
  '&.cm-markdown-rich .cm-md-rich-alert-header--tip': {
    color: 'var(--cpx-sys-color-success)',
  },
  '&.cm-markdown-rich .cm-md-rich-alert-header--important': {
    color: '#a855f7',
  },
  '&.cm-markdown-rich .cm-md-rich-alert-header--warning': {
    color: 'var(--cpx-sys-color-warning)',
  },
  '&.cm-markdown-rich .cm-md-rich-alert-header--caution': {
    color: 'var(--cpx-sys-color-danger)',
  },
  '&.cm-markdown-rich .cm-md-rich-alert-icon': {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    verticalAlign: 'middle',
  },
  '&.cm-markdown-rich .cm-md-rich-list-marker': {
    display: 'inline-block',
    width: '1.25em',
    color: 'var(--cpx-sys-color-fg-secondary)',
    fontFamily: 'var(--cpx-sys-font-family-sans)',
    fontWeight: '500',
    textAlign: 'center',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-horizontal-rule': {
    minHeight: '1lh',
    borderTop: '1px solid var(--cpx-sys-color-border-default)',
    color: 'transparent',
    transform: 'translateY(0.5lh)',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-code-block': {
    boxSizing: 'border-box',
    paddingInline: '12px',
    color: 'var(--cm-editor-foreground, var(--cpx-sys-color-fg-primary))',
    backgroundColor: 'var(--cpx-sys-color-surface-editor)',
    font: 'var(--cpx-sys-type-code)',
  },
  '&.cm-markdown-rich .cm-line:not(.cm-md-rich-code-block) + .cm-line.cm-md-rich-code-block, &.cm-markdown-rich .cm-line.cm-md-rich-code-block:first-child':
    {
      borderTopLeftRadius: 'var(--cpx-sys-radius-lg)',
      borderTopRightRadius: 'var(--cpx-sys-radius-lg)',
    },
  '&.cm-markdown-rich .cm-line.cm-md-rich-code-block:not(:has(+ .cm-line.cm-md-rich-code-block))': {
    borderBottomLeftRadius: 'var(--cpx-sys-radius-lg)',
    borderBottomRightRadius: 'var(--cpx-sys-radius-lg)',
  },
  '&.cm-markdown-rich .cm-md-rich-code-block-widget': {
    display: 'block',
    boxSizing: 'border-box',
    margin: '14px 0',
  },
  '&.cm-markdown-rich .cm-md-rich-code-block-widget .md-code-block': {
    margin: '0',
  },
  '&.cm-markdown-rich .cm-md-rich-mermaid': {
    display: 'block',
    boxSizing: 'border-box',
    margin: '12px 24px',
    padding: '12px',
    border: '1px solid var(--cpx-sys-color-border-default)',
    borderRadius: '0',
    backgroundColor:
      'var(--cm-editor-background, var(--cpx-sys-color-surface-editor, var(--cpx-sys-color-surface-canvas)))',
    overflow: 'auto',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-table': {
    boxSizing: 'border-box',
    borderBottom: '1px solid var(--cpx-sys-color-border-default)',
    paddingInline: '8px',
    fontVariantNumeric: 'tabular-nums',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-table-header': {
    backgroundColor: 'var(--cpx-comp-surface-fog)',
    fontWeight: 'var(--cpx-sys-font-weight-medium)',
  },
  '&.cm-markdown-rich .cm-line.cm-md-rich-table-row': {
    backgroundColor: 'var(--cpx-sys-color-surface-editor)',
  },
  '&.cm-markdown-rich .cm-md-rich-table-widget': {
    display: 'block',
    boxSizing: 'border-box',
    marginBlock: '12px',
    borderRadius: '0',
    backgroundColor: 'var(--cpx-sys-color-surface-editor)',
    overflowX: 'auto',
  },
  '&.cm-markdown-rich .cm-md-rich-table-widget table': {
    width: '100%',
    borderCollapse: 'collapse',
    backgroundColor: 'var(--cpx-sys-color-surface-editor)',
    color: 'var(--cpx-sys-color-fg-primary)',
    font: 'var(--cpx-sys-type-body)',
  },
  '&.cm-markdown-rich .cm-md-rich-table-widget th, &.cm-markdown-rich .cm-md-rich-table-widget td':
    {
      minWidth: '96px',
      padding: '8px 10px',
      border: '1px solid var(--cpx-sys-color-border-default)',
      verticalAlign: 'top',
    },
  '&.cm-markdown-rich .cm-md-rich-table-widget th': {
    backgroundColor: 'var(--cpx-sys-color-surface-raised)',
    fontWeight: 'var(--cpx-sys-font-weight-medium)',
  },
  '&.cm-markdown-rich .cm-md-rich-table-widget td': {
    backgroundColor: 'var(--cpx-sys-color-surface-editor)',
  },
} as const

const markdownRichTheme = EditorView.theme(markdownRichThemeSpec)
