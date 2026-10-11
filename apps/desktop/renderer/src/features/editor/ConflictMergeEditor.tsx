import { Compartment, EditorState } from '@codemirror/state'
import { EditorView } from '@codemirror/view'
import { MergeView } from '@codemirror/merge'
import { useEffect, useRef } from 'react'
import type React from 'react'
import { Button } from '../../components/ui/Button.js'
import { cx } from '../../utils/Cx.js'
import { useDesktopTheme } from '../theme/ThemeContext.js'
import {
  createCodeMirrorExtensions,
  createCodeMirrorSourceExtensions,
  loadCodeMirrorLanguage,
} from './CodeMirrorSetup.js'
import { loadCodeMirrorTheme } from './CodeMirrorTheme.js'

const CODE_FONT_FALLBACK =
  'ui-monospace, "SFMono-Regular", "SF Mono", Menlo, Consolas, "Liberation Mono", monospace'

export type ConflictMergeEditorProps = {
  className?: string
  diskValue: string
  error?: string | null
  language?: string
  localValue: string
  onChangeLocal: (value: string) => void
  onKeepLocal: () => void | Promise<void>
  onUseDisk: () => void
  path?: string
  saving?: boolean
}

export function ConflictMergeEditor({
  className,
  diskValue,
  error,
  language,
  localValue,
  onChangeLocal,
  onKeepLocal,
  onUseDisk,
  path,
  saving = false,
}: ConflictMergeEditorProps): React.ReactNode {
  const { activeTheme, codeThemeId, draft, resolvedVariant } = useDesktopTheme()
  const configuredCodeFont = activeTheme.theme.fonts.code?.trim()
  const codeFontFamily = configuredCodeFont
    ? `${configuredCodeFont}, ${CODE_FONT_FALLBACK}`
    : CODE_FONT_FALLBACK
  const codeFontSize = draft.settings.fontSizes.code
  const hostRef = useRef<HTMLDivElement>(null)
  const mergeRef = useRef<MergeView | null>(null)
  const onChangeRef = useRef(onChangeLocal)
  const onSaveRef = useRef(onKeepLocal)
  const applyingExternalLocalValueRef = useRef(false)
  const diskLanguageCompartmentRef = useRef(new Compartment())
  const localLanguageCompartmentRef = useRef(new Compartment())
  const diskThemeCompartmentRef = useRef(new Compartment())
  const localThemeCompartmentRef = useRef(new Compartment())
  const themeRequestRef = useRef(0)

  onChangeRef.current = onChangeLocal
  onSaveRef.current = onKeepLocal

  useEffect(() => {
    if (!hostRef.current) {
      return
    }
    const merge = new MergeView({
      parent: hostRef.current,
      orientation: 'a-b',
      highlightChanges: true,
      gutter: true,
      a: {
        doc: diskValue,
        extensions: [
          ...createCodeMirrorExtensions({}),
          ...createCodeMirrorSourceExtensions(),
          EditorState.readOnly.of(true),
          EditorView.editable.of(false),
          diskLanguageCompartmentRef.current.of([]),
          diskThemeCompartmentRef.current.of([]),
        ],
      },
      b: {
        doc: localValue,
        extensions: [
          ...createCodeMirrorExtensions({
            onChange: (nextValue) => {
              if (!applyingExternalLocalValueRef.current) {
                onChangeRef.current(nextValue)
              }
            },
            onSave: () => {
              void onSaveRef.current()
            },
          }),
          ...createCodeMirrorSourceExtensions(),
          localLanguageCompartmentRef.current.of([]),
          localThemeCompartmentRef.current.of([]),
        ],
      },
    })
    mergeRef.current = merge

    return () => {
      mergeRef.current = null
      merge.destroy()
    }
  }, [])

  useEffect(() => {
    const merge = mergeRef.current
    if (!merge) {
      return
    }
    replaceDocument(merge.a, diskValue)
  }, [diskValue])

  useEffect(() => {
    const merge = mergeRef.current
    if (!merge) {
      return
    }
    applyingExternalLocalValueRef.current = true
    try {
      replaceDocument(merge.b, localValue)
    } finally {
      applyingExternalLocalValueRef.current = false
    }
  }, [localValue])

  useEffect(() => {
    const merge = mergeRef.current
    let active = true
    if (!merge) {
      return
    }

    void loadCodeMirrorLanguage(path, language).then((extension) => {
      if (!active || mergeRef.current !== merge) {
        return
      }
      merge.b.dispatch({
        effects: localLanguageCompartmentRef.current.reconfigure(extension),
      })
      merge.a.dispatch({
        effects: diskLanguageCompartmentRef.current.reconfigure(extension),
      })
    })

    return () => {
      active = false
    }
  }, [language, path])

  useEffect(() => {
    const merge = mergeRef.current
    const request = ++themeRequestRef.current
    if (!merge) {
      return
    }

    void loadCodeMirrorTheme({
      codeThemeId,
      fontFamily: codeFontFamily,
      fontSize: codeFontSize,
      variant: resolvedVariant,
    })
      .then((extension) => {
        if (request !== themeRequestRef.current || mergeRef.current !== merge) {
          return
        }
        merge.a.dispatch({
          effects: diskThemeCompartmentRef.current.reconfigure(extension),
        })
        merge.b.dispatch({
          effects: localThemeCompartmentRef.current.reconfigure(extension),
        })
        merge.a.requestMeasure()
        merge.b.requestMeasure()
      })
      .catch(() => undefined)
  }, [codeFontFamily, codeFontSize, codeThemeId, resolvedVariant])

  return (
    <section
      className={cx(
        'conflict-merge-editor tw:relative tw:grid tw:h-full tw:min-h-0 tw:min-w-0 tw:grid-rows-[auto_auto_minmax(0,1fr)] tw:overflow-hidden tw:bg-app-editor tw:text-app-text',
        className,
      )}
    >
      <header className="conflict-merge-editor-header tw:flex tw:flex-wrap tw:items-center tw:justify-between tw:gap-x-4 tw:gap-y-2 tw:border-b tw:border-app-border tw:bg-app-panel tw:p-3 tw:shadow-none">
        <div className="tw:grid tw:min-w-0 tw:gap-1">
          <strong className="tw:type-label">文件已在外部更改</strong>
          <span className="tw:type-caption tw:text-app-text-meta">
            左侧为磁盘版本，右侧为本地草稿。
          </span>
        </div>
        <div className="conflict-merge-editor-actions tw:flex tw:flex-wrap tw:gap-2">
          <Button color="secondary" disabled={saving} onClick={onUseDisk}>
            使用磁盘版本
          </Button>
          <Button color="primary" loading={saving} onClick={() => void onKeepLocal()}>
            保留本地版本
          </Button>
        </div>
      </header>
      <div
        className="conflict-merge-editor-labels tw:grid tw:grid-cols-2 tw:border-b tw:border-app-border tw:bg-app-panel tw:type-caption tw:text-app-text-meta tw:max-[720px]:hidden"
        aria-hidden="true"
      >
        <span className="tw:px-3 tw:py-1">磁盘版本</span>
        <span className="tw:border-l tw:border-app-border tw:px-3 tw:py-1">
          本地草稿 / 合并结果
        </span>
      </div>
      <div
        ref={hostRef}
        className="conflict-merge-editor-host tw:min-h-0 tw:min-w-0 tw:overflow-hidden"
      />
      {error ? (
        <div
          className="file-editor-status tw:absolute tw:right-4 tw:bottom-4 tw:z-2 tw:flex tw:max-w-[calc(100%-32px)] tw:items-center tw:gap-1 tw:overflow-hidden tw:truncate tw:rounded-lg tw:border tw:border-app-border tw:bg-app-raised tw:px-2 tw:py-1 tw:type-caption tw:text-app-text-soft tw:shadow-none tw:data-[error]:border-[color-mix(in_srgb,var(--cpx-sys-color-danger)_35%,transparent)] tw:data-[error]:text-app-danger"
          data-error
          role="alert"
        >
          保存失败：{error}
        </div>
      ) : null}
    </section>
  )
}

function replaceDocument(view: EditorView, value: string): void {
  const currentValue = view.state.doc.toString()
  if (currentValue === value) {
    return
  }
  view.dispatch({
    changes: { from: 0, to: currentValue.length, insert: value },
  })
}
