import { history, redo, redoDepth, undo, undoDepth } from 'prosemirror-history'
import { baseKeymap, splitBlock } from 'prosemirror-commands'
import { keymap } from 'prosemirror-keymap'
import { Schema, type Node as ProseMirrorNode } from 'prosemirror-model'
import { AllSelection, EditorState, NodeSelection, TextSelection } from 'prosemirror-state'
import type { Transaction } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { useEditCommands } from '../../../components/ui/EditCommandProvider.js'
import type { ComposerDocument, ComposerDocumentToken } from './ComposerTypes.js'
import { composerDocumentsEqual } from './ComposerSkillToken.js'

export const composerSchema = new Schema({
  nodes: {
    doc: { content: 'paragraph+' },
    paragraph: { content: 'inline*', toDOM: () => ['p', 0] },
    text: { group: 'inline' },
    skill_token: {
      atom: true,
      attrs: {
        id: { default: '' },
        name: { default: '' },
        label: { default: '' },
        value: { default: '' },
      },
      group: 'inline',
      inline: true,
      selectable: true,
      toDOM: (node) => {
        const name = String(node.attrs.name || node.attrs.label)
        return [
          'span',
          {
            'aria-label': `技能 ${node.attrs.label}`,
            'data-composer-token': 'skill',
            'data-token-id': node.attrs.id,
            'data-token-skill': node.attrs.label,
            contenteditable: 'false',
            role: 'link',
            tabindex: '0',
            class: 'composer-inline-skill-token',
          },
          [
            'span',
            {
              'aria-hidden': 'true',
              class: 'composer-inline-skill-token-fallback-icon',
            },
            '✦',
          ],
          ['span', { class: 'composer-inline-skill-token-label' }, String(node.attrs.label)],
        ]
      },
    },
    context_token: {
      atom: true,
      attrs: {
        id: { default: '' },
        kind: { default: 'thread' },
        label: { default: '' },
        value: { default: '' },
      },
      group: 'inline',
      inline: true,
      selectable: true,
      toDOM: (node) => [
        'span',
        {
          'aria-label': `${node.attrs.kind === 'browser' ? '网页' : node.attrs.kind === 'plugin' ? '插件' : '任务'}引用 ${node.attrs.label}`,
          'data-composer-token': node.attrs.kind,
          'data-token-id': node.attrs.id,
          contenteditable: 'false',
          class: 'composer-inline-context-token',
        },
        [
          'span',
          {
            'aria-hidden': 'true',
            class: 'composer-inline-context-token-icon',
          },
          node.attrs.kind === 'browser' ? '◎' : '@',
        ],
        ['span', { class: 'composer-inline-context-token-label' }, String(node.attrs.label)],
      ],
    },
  },
})

export type ComposerEditorHandle = {
  focus: () => void
  insertText: (text: string) => void
  replaceTextRange: (start: number, end: number, text: string) => void
  replaceTextRangeWithToken: (start: number, end: number, token: ComposerDocumentToken) => void
}

export type ComposerEditorProps = {
  value: string
  document?: ComposerDocument
  placeholder: string
  ariaControls?: string
  ariaDescribedBy?: string
  ariaActiveDescendant?: string
  ariaExpanded: boolean
  onChange: (value: string) => void
  onDocumentChange?: (document: ComposerDocument) => void
  onTokenActivate?: (token: ComposerDocumentToken) => void
  onSelectionChange: (offset: number) => void
  onCompositionChange: (composing: boolean) => void
  onKeyDown: (event: KeyboardEvent) => boolean
  onPasteFiles?: (files: FileList) => boolean
  onBlur?: () => void
}

export const ComposerEditor = forwardRef<ComposerEditorHandle, ComposerEditorProps>(
  function ComposerEditor(
    {
      value,
      document,
      placeholder,
      ariaControls,
      ariaDescribedBy,
      ariaActiveDescendant,
      ariaExpanded,
      onChange,
      onDocumentChange,
      onTokenActivate,
      onSelectionChange,
      onCompositionChange,
      onKeyDown,
      onPasteFiles,
      onBlur,
    },
    forwardedRef,
  ) {
    const { registerTarget } = useEditCommands()
    const mountRef = useRef<HTMLDivElement | null>(null)
    const viewRef = useRef<EditorView | null>(null)
    const callbacksRef = useRef({
      onChange,
      onDocumentChange,
      onTokenActivate,
      onSelectionChange,
      onCompositionChange,
      onKeyDown,
      onPasteFiles,
      onBlur,
    })

    callbacksRef.current = {
      onChange,
      onDocumentChange,
      onTokenActivate,
      onSelectionChange,
      onCompositionChange,
      onKeyDown,
      onPasteFiles,
      onBlur,
    }

    useImperativeHandle(
      forwardedRef,
      () => ({
        focus: () => viewRef.current?.focus(),
        insertText: (text) => {
          const view = viewRef.current
          if (!view || !text) return
          view.dispatch(insertTextTransaction(view.state, text).scrollIntoView())
          view.focus()
        },
        replaceTextRange: (start, end, text) => {
          const view = viewRef.current
          if (!view) return
          const from = positionAtTextOffset(view.state.doc, start)
          const to = positionAtTextOffset(view.state.doc, end)
          view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView())
          view.focus()
        },
        replaceTextRangeWithToken: (start, end, token) => {
          const view = viewRef.current
          if (!view) return
          const from = positionAtTextOffset(view.state.doc, start)
          const to = positionAtTextOffset(view.state.doc, end)
          const node = composerTokenNode(token)
          const transaction = view.state.tr.replaceWith(from, to, node)
          view.dispatch(
            transaction
              .setSelection(TextSelection.create(transaction.doc, from + node.nodeSize))
              .scrollIntoView(),
          )
          view.focus()
        },
      }),
      [],
    )

    useEffect(() => {
      const mount = mountRef.current
      if (!mount) return

      const initialDocument = composerDocumentToProseMirrorDocument(
        document ?? { text: value, tokens: [] },
      )
      const state = EditorState.create({
        doc: initialDocument,
        selection: TextSelection.create(initialDocument, positionAtTextOffset(initialDocument, 0)),
        plugins: [
          history(),
          keymap({
            'Shift-Enter': splitBlock,
            'Mod-z': undo,
            'Mod-Shift-z': redo,
            'Mod-y': redo,
          }),
          keymap(baseKeymap),
        ],
      })

      const view = new EditorView(mount, {
        state,
        attributes: {
          'aria-label': '消息输入框',
          role: 'combobox',
          'aria-autocomplete': 'list',
          spellcheck: 'true',
          class: 'composer-editor-content',
        },
        dispatchTransaction(transaction) {
          const nextState = view.state.apply(transaction)
          view.updateState(nextState)
          const documentChanged = transaction.steps.length > 0
          if (documentChanged) {
            const nextDocument = composerDocumentFromProseMirrorDocument(nextState.doc)
            if (callbacksRef.current.onDocumentChange) {
              callbacksRef.current.onDocumentChange(nextDocument)
            } else {
              callbacksRef.current.onChange(nextDocument.text)
            }
          }
          if (transaction.selectionSet || documentChanged) {
            callbacksRef.current.onSelectionChange(
              textOffsetAtPosition(nextState, nextState.selection.from),
            )
          }
        },
        handleKeyDown: (_view, event) => {
          if (
            (event.key === 'Enter' || event.key === ' ') &&
            view.state.selection instanceof NodeSelection
          ) {
            const token = composerTokenFromNode(view.state.selection.node)
            if (token && callbacksRef.current.onTokenActivate) {
              event.preventDefault()
              callbacksRef.current.onTokenActivate(token)
              return true
            }
          }
          return callbacksRef.current.onKeyDown(event)
        },
        handleClickOn: (_view, _pos, node) => {
          const token = composerTokenFromNode(node)
          if (!token || !callbacksRef.current.onTokenActivate) return false
          callbacksRef.current.onTokenActivate(token)
          return true
        },
        handlePaste: (_view, event) => {
          const files = event.clipboardData?.files
          return files && files.length > 0
            ? (callbacksRef.current.onPasteFiles?.(files) ?? false)
            : false
        },
        handleDOMEvents: {
          blur: () => {
            if (window.document.hasFocus()) callbacksRef.current.onBlur?.()
            return false
          },
          compositionstart: () => {
            callbacksRef.current.onCompositionChange(true)
            return false
          },
          compositionend: () => {
            callbacksRef.current.onCompositionChange(false)
            queueMicrotask(() => {
              const current = viewRef.current
              if (current) {
                callbacksRef.current.onSelectionChange(
                  textOffsetAtPosition(current.state, current.state.selection.from),
                )
              }
            })
            return false
          },
        },
      })

      viewRef.current = view
      const unregisterEditTarget = registerTarget(view.dom, {
        getCapabilities: () => {
          const selection = view.state.selection
          return {
            undo: undoDepth(view.state) > 0,
            redo: redoDepth(view.state) > 0,
            cut: !selection.empty,
            copy: !selection.empty,
            paste: true,
            delete: !selection.empty,
            selectAll: view.state.doc.content.size > 0 && !(selection instanceof AllSelection),
          }
        },
        focus: () => view.focus(),
        perform: (action) => {
          if (action === 'undo') return undo(view.state, view.dispatch)
          if (action === 'redo') return redo(view.state, view.dispatch)
          if (action === 'delete') {
            if (view.state.selection.empty) return false
            view.dispatch(view.state.tr.deleteSelection().scrollIntoView())
            return true
          }
          if (action === 'selectAll') {
            view.dispatch(
              view.state.tr.setSelection(new AllSelection(view.state.doc)).scrollIntoView(),
            )
            return true
          }
          return false
        },
      })
      return () => {
        unregisterEditTarget()
        viewRef.current = null
        view.destroy()
      }
      // The view owns its lifetime; callback changes flow through callbacksRef.
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [registerTarget])

    useEffect(() => {
      const view = viewRef.current
      const nextDocument = document ?? { text: value, tokens: [] }
      if (
        !view ||
        composerDocumentsEqual(
          composerDocumentFromProseMirrorDocument(view.state.doc),
          nextDocument,
        )
      )
        return

      const previousOffset = textOffsetAtPosition(view.state, view.state.selection.from)
      const nextProseMirrorDocument = composerDocumentToProseMirrorDocument(nextDocument)
      const nextState = EditorState.create({
        doc: nextProseMirrorDocument,
        plugins: view.state.plugins,
        selection: TextSelection.create(
          nextProseMirrorDocument,
          positionAtTextOffset(nextProseMirrorDocument, previousOffset),
        ),
      })
      view.updateState(nextState)
    }, [document, value])

    useEffect(() => {
      const dom = viewRef.current?.dom
      if (!dom) return
      dom.setAttribute('data-placeholder', placeholder)
      const nextDocument = document ?? { text: value, tokens: [] }
      dom.classList.toggle(
        'is-empty',
        nextDocument.text.length === 0 && nextDocument.tokens.length === 0,
      )
      dom.setAttribute('aria-expanded', String(ariaExpanded))
      dom.setAttribute('aria-haspopup', 'menu')
      setOptionalAttribute(dom, 'aria-controls', ariaControls)
      setOptionalAttribute(dom, 'aria-describedby', ariaDescribedBy)
      setOptionalAttribute(dom, 'aria-activedescendant', ariaActiveDescendant)
    }, [
      ariaActiveDescendant,
      ariaControls,
      ariaDescribedBy,
      ariaExpanded,
      placeholder,
      document,
      value,
    ])

    return <div className="composer-editor" ref={mountRef} />
  },
)

export function composerDocumentToProseMirrorDocument(document: ComposerDocument) {
  const lines = document.text.split('\n')
  const tokens = document.tokens
    .map((token, index) => ({ token, index }))
    .sort((left, right) => left.token.from - right.token.from || left.index - right.index)
  let tokenIndex = 0
  let textOffset = 0
  const paragraphs = lines.map((line, index) => {
    const content: ProseMirrorNode[] = []
    let lineOffset = 0
    const lineEnd = textOffset + line.length
    while (tokenIndex < tokens.length) {
      const next = tokens[tokenIndex]
      if (!next || (next.token.from > lineEnd && index < lines.length - 1)) break
      const localOffset = Math.max(0, Math.min(line.length, next.token.from - textOffset))
      if (localOffset > lineOffset) {
        content.push(composerSchema.text(line.slice(lineOffset, localOffset)))
      }
      content.push(composerTokenNode(next.token))
      lineOffset = localOffset
      tokenIndex += 1
    }
    if (lineOffset < line.length) content.push(composerSchema.text(line.slice(lineOffset)))
    textOffset = lineEnd + (index < lines.length - 1 ? 1 : 0)
    return composerSchema.nodes.paragraph.create(null, content)
  })
  return composerSchema.nodes.doc.create(null, paragraphs)
}

export function insertTextTransaction(state: EditorState, text: string): Transaction {
  return state.tr.insertText(text, state.selection.from, state.selection.to)
}

export function composerDocumentFromProseMirrorDocument(doc: EditorState['doc']): ComposerDocument {
  const lines: string[] = []
  const tokens: ComposerDocumentToken[] = []
  let textOffset = 0

  doc.forEach((paragraph, paragraphIndex) => {
    let line = ''
    paragraph.forEach((node) => {
      const token = composerTokenFromNode(node)
      if (token) {
        tokens.push({
          ...token,
          from: textOffset + line.length,
          to: textOffset + line.length,
        })
        return
      }
      line += node.textContent
    })
    lines.push(line)
    textOffset += line.length
    if (paragraphIndex < doc.childCount - 1) textOffset += 1
  })

  return { text: lines.join('\n'), tokens }
}

function textFromDocument(doc: EditorState['doc']): string {
  return composerDocumentFromProseMirrorDocument(doc).text
}

function composerTokenFromNode(node: ProseMirrorNode): ComposerDocumentToken | null {
  if (node.type.name === 'context_token') {
    const kind =
      node.attrs.kind === 'browser' || node.attrs.kind === 'plugin' ? node.attrs.kind : 'thread'
    return {
      id: String(node.attrs.id),
      kind,
      label: String(node.attrs.label),
      value: String(node.attrs.value),
      from: 0,
      to: 0,
    }
  }
  if (node.type.name !== 'skill_token') return null
  return {
    id: String(node.attrs.id),
    kind: 'skill',
    name: String(node.attrs.name || node.attrs.label),
    label: String(node.attrs.label),
    value: String(node.attrs.value),
    from: 0,
    to: 0,
  }
}

function composerTokenNode(token: ComposerDocumentToken): ProseMirrorNode {
  if (token.kind === 'skill') {
    return composerSchema.nodes.skill_token.create({
      id: token.id,
      name: token.name ?? token.label,
      label: token.label,
      value: token.value,
    })
  }
  if (token.kind === 'thread' || token.kind === 'browser' || token.kind === 'plugin') {
    return composerSchema.nodes.context_token.create({
      id: token.id,
      kind: token.kind,
      label: token.label,
      value: token.value,
    })
  }
  throw new Error(`Unsupported Composer token kind: ${token.kind}`)
}

function textOffsetAtPosition(state: EditorState, position: number): number {
  return state.doc.textBetween(0, position, '\n').length
}

function positionAtTextOffset(doc: EditorState['doc'], offset: number): number {
  let remaining = Math.max(0, offset)
  let result = 1

  doc.forEach((paragraph, paragraphOffset) => {
    if (remaining < 0) return
    let inlinePosition = paragraphOffset + 1

    paragraph.forEach((node) => {
      if (remaining < 0) return
      const token = composerTokenFromNode(node)
      if (token) {
        inlinePosition += node.nodeSize
        return
      }

      const length = node.textContent.length
      if (remaining <= length) {
        result = inlinePosition + remaining
        remaining = -1
        return
      }
      remaining -= length
      inlinePosition += node.nodeSize
    })

    if (remaining < 0) return
    if (remaining === 0) {
      result = inlinePosition
      remaining = -1
      return
    }

    remaining -= 1
    result = paragraphOffset + paragraph.nodeSize - 1
  })

  return Math.min(result, doc.content.size)
}

function setOptionalAttribute(element: HTMLElement, name: string, value: string | undefined): void {
  if (value) element.setAttribute(name, value)
  else element.removeAttribute(name)
}
