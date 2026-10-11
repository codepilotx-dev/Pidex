import {
  autocompletion,
  closeBrackets,
  closeBracketsKeymap,
  completionKeymap,
} from '@codemirror/autocomplete'
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands'
import { bracketMatching, indentOnInput, LanguageDescription } from '@codemirror/language'
import { languages } from '@codemirror/language-data'
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search'
import { EditorState, type Extension } from '@codemirror/state'
import {
  crosshairCursor,
  drawSelection,
  dropCursor,
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  highlightSpecialChars,
  keymap,
  lineNumbers,
  rectangularSelection,
} from '@codemirror/view'

export type CodeMirrorSetupOptions = {
  onChange?: (value: string) => void
  onSave?: () => void
}

export function createCodeMirrorExtensions({
  onChange,
  onSave,
}: CodeMirrorSetupOptions): Extension[] {
  return [
    highlightSpecialChars(),
    history(),
    drawSelection(),
    dropCursor(),
    EditorState.allowMultipleSelections.of(true),
    indentOnInput(),
    bracketMatching(),
    closeBrackets(),
    autocompletion(),
    rectangularSelection(),
    crosshairCursor(),
    highlightSelectionMatches(),
    keymap.of([
      {
        key: 'Mod-s',
        preventDefault: true,
        run: () => {
          onSave?.()
          return true
        },
      },
      ...closeBracketsKeymap,
      ...defaultKeymap,
      ...searchKeymap,
      ...historyKeymap,
      ...completionKeymap,
      indentWithTab,
    ]),
    EditorView.lineWrapping,
    EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        onChange?.(update.state.doc.toString())
      }
    }),
  ]
}

export function createCodeMirrorSourceExtensions(): Extension[] {
  return [lineNumbers(), highlightActiveLineGutter(), highlightActiveLine()]
}

export async function loadCodeMirrorLanguage(path?: string, language?: string): Promise<Extension> {
  if (
    language?.toLowerCase() === 'markdown' ||
    (path != null && /\.(?:md|markdown|mdown|mdx|mkd)$/iu.test(path))
  ) {
    const { markdown, markdownLanguage } = await import('@codemirror/lang-markdown')
    return markdown({
      base: markdownLanguage,
      codeLanguages: languages,
    })
  }
  const description = language
    ? LanguageDescription.matchLanguageName(languages, language, true)
    : path
      ? LanguageDescription.matchFilename(languages, path)
      : null

  return description ? description.load() : []
}
