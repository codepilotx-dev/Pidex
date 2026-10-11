import { expect, test } from 'bun:test'
import { EditorSelection, EditorState } from '@codemirror/state'
import { clampEditorSelection, readEditorSelectedText } from '../src/features/editor/FileEditor.js'
import { buildFileSelectionPrompt } from '../src/features/layout/dock/RightDockPanels.js'
import { reusePendingSideChatCreation } from '../src/features/layout/dock/UseSideChatController.js'
import {
  applyWorkbenchPanelAction,
  createDefaultWorkbenchTabsState,
} from '../src/features/layout/dock/RightDockState.js'
import { readFileEditorViewState } from '../src/features/layout/tabs/ConversationUiState.js'

test('document selections produce the file reference independently of DOM selection', () => {
  const state = EditorState.create({
    doc: 'first\nsecond',
    extensions: EditorState.allowMultipleSelections.of(true),
    selection: EditorSelection.create([EditorSelection.range(0, 5), EditorSelection.range(6, 12)]),
  })
  expect(
    buildFileSelectionPrompt({ path: 'sample.ts', selectedText: readEditorSelectedText(state) }),
  ).toBe('文件选区：\n- 文件：sample.ts\n\n```ts\nfirst\nsecond\n```')
})

test('side chat creation shares only pending requests with the same parent and reference', async () => {
  const pending = new Map<string, Promise<number>>()
  let resolve!: (value: number) => void
  let calls = 0
  const create = () => {
    calls++
    return new Promise<number>((done) => {
      resolve = done
    })
  }
  const first = reusePendingSideChatCreation(pending, 'parent/reference', create)
  expect(reusePendingSideChatCreation(pending, 'parent/reference', create)).toBe(first)
  const other = reusePendingSideChatCreation(pending, 'parent/other', async () => 2)
  expect(other).not.toBe(first)
  await Promise.resolve()
  expect(calls).toBe(1)
  resolve(1)
  await Promise.all([first, other])
  expect(pending.size).toBe(0)
  expect(await reusePendingSideChatCreation(pending, 'parent/reference', async () => 3)).toBe(3)
  await expect(
    reusePendingSideChatCreation(pending, 'failed', async () => {
      throw new Error('failed')
    }),
  ).rejects.toThrow('failed')
  expect(pending.size).toBe(0)
})

test('file view snapshot survives reopening and cannot recreate a closed tab', () => {
  const tab = {
    id: 'file:sample.ts',
    kind: 'file-preview',
    workspacePath: 'workspace',
    relativePath: 'sample.ts',
    preview: false,
  } as const
  const snapshot = { scrollTop: 120, scrollLeft: 20, anchor: 3, head: 12 }
  let state = applyWorkbenchPanelAction(createDefaultWorkbenchTabsState(), {
    type: 'openTab',
    target: 'right',
    tab,
  })
  state = applyWorkbenchPanelAction(state, {
    type: 'setFileViewState',
    tabId: tab.id,
    viewState: snapshot,
  })
  state = applyWorkbenchPanelAction(state, { type: 'openTab', target: 'right', tab })
  expect(state.tabsById[tab.id]).toMatchObject({ viewState: snapshot })
  expect(readFileEditorViewState(JSON.parse(JSON.stringify(snapshot)))).toEqual(snapshot)
  expect(readFileEditorViewState(undefined)).toBeNull()
  expect(readFileEditorViewState({ ...snapshot, scrollTop: -1 })).toBeNull()
  expect(clampEditorSelection(snapshot.head, 4)).toBe(4)
  state = applyWorkbenchPanelAction(state, { type: 'closeTab', target: 'right', tabId: tab.id })
  expect(
    applyWorkbenchPanelAction(state, {
      type: 'setFileViewState',
      tabId: tab.id,
      viewState: snapshot,
    }),
  ).toBe(state)
  expect(state.tabsById[tab.id]).toBeUndefined()
})
