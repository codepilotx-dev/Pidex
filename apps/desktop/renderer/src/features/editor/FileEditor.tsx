import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { redo, redoDepth, selectAll, undo, undoDepth } from '@codemirror/commands'
import { useEffect, useRef } from 'react'
import type React from 'react'
import { useEditCommands } from '../../components/ui/EditCommandProvider.js'
import { cx } from '../../utils/Cx.js'
import { useDesktopTheme } from '../theme/ThemeContext.js'
import {
  createCodeMirrorExtensions,
  createCodeMirrorSourceExtensions,
  loadCodeMirrorLanguage,
} from './CodeMirrorSetup.js'
import { loadCodeMirrorTheme } from './CodeMirrorTheme.js'
import { createMarkdownRichExtensions } from './MarkdownRichExtensions.js'

const CODE_FONT_FALLBACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

export type FileEditorViewState = {
  scrollTop: number
  scrollLeft: number
  anchor: number
  head: number
}

export function readEditorSelectedText(state: EditorState): string {
  return state.selection.ranges.map(({ from, to }) => state.sliceDoc(from, to)).join('\n')
}

export function clampEditorSelection(position: number, length: number): number {
  return Math.max(0, Math.min(Math.trunc(position), length))
}

export type FileEditorProps = {
  ariaLabel?: string
  className?: string
  error?: string | null
  language?: string
  onChange: (value: string) => void
  onSave?: () => void | Promise<void>
  onSelectionChange?: (text: string) => void
  viewState?: FileEditorViewState
  onViewStateChange?: (state: FileEditorViewState) => void
  path?: string
  presentation?: 'source' | 'markdown-rich'
  readonly?: boolean
  revealLine?: number | null
  saving?: boolean
  value: string
}

export function FileEditor({
  ariaLabel = '文件编辑器',
  className,
  error,
  language,
  onChange,
  onSave,
  onSelectionChange,
  viewState,
  onViewStateChange,
  path,
  presentation = 'source',
  readonly = false,
  revealLine,
  saving = false,
  value,
}: FileEditorProps): React.ReactNode {
  const { registerTarget } = useEditCommands()
  const { activeTheme, codeThemeId, draft, resolvedVariant } = useDesktopTheme()
  const configuredCodeFont = activeTheme.theme.fonts.code?.trim()
  const codeFontFamily = configuredCodeFont
    ? `${configuredCodeFont}, ${CODE_FONT_FALLBACK}`
    : CODE_FONT_FALLBACK
  const codeFontSize = draft.settings.fontSizes.code
  const hostRef = useRef<HTMLDivElement>(null)
  const viewRef = useRef<EditorView | null>(null)
  const onChangeRef = useRef(onChange)
  const onSaveRef = useRef(onSave)
  const onSelectionChangeRef = useRef(onSelectionChange)
  const onViewStateChangeRef = useRef(onViewStateChange)
  const initialViewStateRef = useRef(viewState)
  const applyingExternalValueRef = useRef(false)
  const readonlyRef = useRef(readonly)
  const readonlyCompartmentRef = useRef(new Compartment())
  const languageCompartmentRef = useRef(new Compartment())
  const presentationCompartmentRef = useRef(new Compartment())
  const themeCompartmentRef = useRef(new Compartment())
  const themeRequestRef = useRef(0)

  onChangeRef.current = onChange
  onSaveRef.current = onSave
  onSelectionChangeRef.current = onSelectionChange
  onViewStateChangeRef.current = onViewStateChange
  readonlyRef.current = readonly

  useEffect(() => {
    if (!hostRef.current) {
      return
    }

    const readonlyCompartment = readonlyCompartmentRef.current
    const languageCompartment = languageCompartmentRef.current
    const presentationCompartment = presentationCompartmentRef.current
    const themeCompartment = themeCompartmentRef.current
    const snapshot = initialViewStateRef.current
    const view = new EditorView({
      parent: hostRef.current,
      state: EditorState.create({
        doc: value,
        selection: snapshot
          ? {
              anchor: clampEditorSelection(snapshot.anchor, value.length),
              head: clampEditorSelection(snapshot.head, value.length),
            }
          : undefined,
        extensions: [
          EditorView.updateListener.of((update) => {
            if (update.selectionSet || update.docChanged) {
              onSelectionChangeRef.current?.(readEditorSelectedText(update.state))
            }
          }),
          ...createCodeMirrorExtensions({
            onChange: (nextValue) => {
              if (!applyingExternalValueRef.current) {
                onChangeRef.current(nextValue)
              }
            },
            onSave: () => {
              void onSaveRef.current?.()
            },
          }),
          readonlyCompartment.of([
            EditorState.readOnly.of(readonly),
            EditorView.editable.of(!readonly),
          ]),
          EditorView.contentAttributes.of({ 'aria-label': ariaLabel }),
          languageCompartment.of([]),
          presentationCompartment.of(createPresentationExtensions(presentation)),
          themeCompartment.of([]),
        ],
      }),
    })
    viewRef.current = view
    if (snapshot) {
      view.requestMeasure({
        read: () => snapshot,
        write: () => {
          view.scrollDOM.scrollTop = snapshot.scrollTop
          view.scrollDOM.scrollLeft = snapshot.scrollLeft
        },
      })
      onSelectionChangeRef.current?.(readEditorSelectedText(view.state))
    }
    const unregisterEditTarget = registerTarget(view.contentDOM, {
      get readonly() {
        return readonlyRef.current
      },
      getCapabilities: () => {
        const selection = view.state.selection
        const hasSelection = selection.ranges.some((range) => !range.empty)
        const entireDocumentSelected =
          selection.ranges.length === 1 &&
          selection.main.from === 0 &&
          selection.main.to === view.state.doc.length
        return {
          undo: !readonlyRef.current && undoDepth(view.state) > 0,
          redo: !readonlyRef.current && redoDepth(view.state) > 0,
          cut: !readonlyRef.current && hasSelection,
          copy: hasSelection,
          paste: !readonlyRef.current,
          delete: !readonlyRef.current && hasSelection,
          selectAll: view.state.doc.length > 0 && !entireDocumentSelected,
        }
      },
      focus: () => view.focus(),
      perform: (action) => {
        if (action === 'undo') return undo(view)
        if (action === 'redo') return redo(view)
        if (action === 'delete') {
          if (view.state.selection.ranges.every((range) => range.empty)) {
            return false
          }
          view.dispatch(view.state.replaceSelection(''))
          return true
        }
        if (action === 'selectAll') return selectAll(view)
        return false
      },
    })

    return () => {
      onViewStateChangeRef.current?.({
        scrollTop: view.scrollDOM.scrollTop,
        scrollLeft: view.scrollDOM.scrollLeft,
        anchor: view.state.selection.main.anchor,
        head: view.state.selection.main.head,
      })
      unregisterEditTarget()
      viewRef.current = null
      view.destroy()
    }
  }, [registerTarget])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    const currentValue = view.state.doc.toString()
    if (currentValue === value) {
      return
    }
    applyingExternalValueRef.current = true
    try {
      view.dispatch({
        changes: { from: 0, to: currentValue.length, insert: value },
      })
    } finally {
      applyingExternalValueRef.current = false
    }
  }, [value])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    view.dispatch({
      effects: readonlyCompartmentRef.current.reconfigure([
        EditorState.readOnly.of(readonly),
        EditorView.editable.of(!readonly),
      ]),
    })
  }, [readonly])

  useEffect(() => {
    const view = viewRef.current
    let active = true
    if (!view) {
      return
    }

    void loadCodeMirrorLanguage(path, language).then((extension) => {
      if (!active || viewRef.current !== view) {
        return
      }
      view.dispatch({
        effects: languageCompartmentRef.current.reconfigure(extension),
      })
    })

    return () => {
      active = false
    }
  }, [language, path])

  useEffect(() => {
    const view = viewRef.current
    if (!view) {
      return
    }
    view.dispatch({
      effects: presentationCompartmentRef.current.reconfigure(
        createPresentationExtensions(presentation),
      ),
    })
    view.requestMeasure()
  }, [presentation])

  useEffect(() => {
    const view = viewRef.current
    const request = ++themeRequestRef.current
    if (!view) {
      return
    }

    void loadCodeMirrorTheme({
      codeThemeId,
      fontFamily: codeFontFamily,
      fontSize: codeFontSize,
      variant: resolvedVariant,
    })
      .then((extension) => {
        if (request !== themeRequestRef.current || viewRef.current !== view) {
          return
        }
        view.dispatch({
          effects: themeCompartmentRef.current.reconfigure(extension),
        })
        view.requestMeasure()
      })
      .catch(() => undefined)
  }, [codeFontFamily, codeFontSize, codeThemeId, resolvedVariant])

  useEffect(() => {
    const view = viewRef.current
    if (!view || revealLine == null) {
      return
    }
    const lineNumber = Math.max(1, Math.min(Math.trunc(revealLine), view.state.doc.lines))
    const line = view.state.doc.line(lineNumber)
    view.dispatch({
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    })
  }, [path, revealLine])

  return (
    <section
      className={cx(
        'file-editor tw:relative tw:h-full tw:min-h-0 tw:min-w-0 tw:overflow-hidden tw:bg-app-editor tw:text-app-text',
        className,
      )}
      data-presentation={presentation}
      data-readonly={readonly || undefined}
    >
      <div ref={hostRef} className="file-editor-host tw:size-full" />
      {saving || error ? (
        <div
          className="file-editor-status tw:absolute tw:right-4 tw:bottom-4 tw:z-2 tw:flex tw:max-w-[calc(100%-32px)] tw:items-center tw:gap-1 tw:overflow-hidden tw:truncate tw:rounded-lg tw:border tw:border-app-border tw:bg-app-raised tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-soft tw:shadow-none tw:data-[error]:border-[color-mix(in_srgb,var(--cpx-sys-color-danger)_35%,transparent)] tw:data-[error]:text-app-danger"
          data-error={Boolean(error) || undefined}
          role={error ? 'alert' : 'status'}
        >
          {error ? `保存失败：${error}` : '正在保存…'}
        </div>
      ) : null}
    </section>
  )
}

function createPresentationExtensions(presentation: 'source' | 'markdown-rich') {
  return [
    EditorView.editorAttributes.of({
      'data-editor-presentation': presentation,
    }),
    presentation === 'markdown-rich'
      ? createMarkdownRichExtensions()
      : createCodeMirrorSourceExtensions(),
  ]
}
