import type { DesktopEditAction } from '@pidex/shared/desktop-edit-ipc'
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export type EditCommandCapabilities = Record<DesktopEditAction, boolean>

export type EditCommandAdapter = {
  getCapabilities: () => EditCommandCapabilities
  focus: () => void
  perform?: (action: DesktopEditAction) => boolean
  readonly?: boolean
}

export type CapturedEditCommandContext = {
  kind: 'editable' | 'readonly-editor' | 'selection'
  getCapabilities: () => EditCommandCapabilities
  restore: () => void
  adapter?: EditCommandAdapter
}

export type EditCommandActions = {
  captureContext: (target: EventTarget | null) => CapturedEditCommandContext | null
  perform: (action: DesktopEditAction, context?: CapturedEditCommandContext | null) => Promise<void>
  registerTarget: (element: HTMLElement, adapter: EditCommandAdapter) => () => void
}

export type EditCommandState = {
  activeCapabilities: EditCommandCapabilities
  activeContext: CapturedEditCommandContext | null
}

export type EditCommandContextValue = EditCommandState & EditCommandActions

const EMPTY_CAPABILITIES: EditCommandCapabilities = {
  undo: false,
  redo: false,
  cut: false,
  copy: false,
  paste: false,
  delete: false,
  selectAll: false,
}

const EditCommandActionContext = createContext<EditCommandActions>({
  captureContext: () => null,
  perform: async () => undefined,
  registerTarget: () => () => undefined,
})

const EditCommandStateContext = createContext<EditCommandState>({
  activeCapabilities: EMPTY_CAPABILITIES,
  activeContext: null,
})

function areCapabilitiesEqual(a: EditCommandCapabilities, b: EditCommandCapabilities): boolean {
  return (
    a.undo === b.undo &&
    a.redo === b.redo &&
    a.cut === b.cut &&
    a.copy === b.copy &&
    a.paste === b.paste &&
    a.delete === b.delete &&
    a.selectAll === b.selectAll
  )
}

export function EditCommandProvider({ children }: { children: ReactNode }): ReactNode {
  const adaptersRef = useRef(new WeakMap<HTMLElement, EditCommandAdapter>())
  const activeContextRef = useRef<CapturedEditCommandContext | null>(null)
  const activeTargetRef = useRef<EventTarget | null>(null)
  const activeCapabilitiesRef = useRef<EditCommandCapabilities>(EMPTY_CAPABILITIES)

  const [state, setState] = useState<EditCommandState>({
    activeCapabilities: EMPTY_CAPABILITIES,
    activeContext: null,
  })

  const syncCapabilities = useCallback((): void => {
    const current = activeContextRef.current
    const nextCaps = current ? current.getCapabilities() : EMPTY_CAPABILITIES
    if (!areCapabilitiesEqual(activeCapabilitiesRef.current, nextCaps)) {
      activeCapabilitiesRef.current = nextCaps
      setState((prev) => ({
        ...prev,
        activeCapabilities: nextCaps,
      }))
    }
  }, [])

  const updateActiveContext = useCallback(
    (next: CapturedEditCommandContext | null, target?: EventTarget | null): void => {
      activeTargetRef.current = target ?? null
      activeContextRef.current = next
      const nextCaps = next ? next.getCapabilities() : EMPTY_CAPABILITIES
      const capsEqual = areCapabilitiesEqual(activeCapabilitiesRef.current, nextCaps)
      activeCapabilitiesRef.current = nextCaps
      setState((prev) => {
        if (prev.activeContext === next && capsEqual) {
          return prev
        }
        return {
          activeCapabilities: nextCaps,
          activeContext: next,
        }
      })
    },
    [],
  )

  const registerTarget = useCallback(
    (element: HTMLElement, adapter: EditCommandAdapter): (() => void) => {
      adaptersRef.current.set(element, adapter)
      return () => {
        adaptersRef.current.delete(element)
        if (activeContextRef.current?.adapter === adapter) {
          updateActiveContext(null, null)
        }
      }
    },
    [updateActiveContext],
  )

  const captureContext = useCallback(
    (target: EventTarget | null): CapturedEditCommandContext | null => {
      const next = resolveEditCommandContext(target, adaptersRef.current)
      updateActiveContext(next, target)
      return next
    },
    [updateActiveContext],
  )

  const perform = useCallback(
    async (action: DesktopEditAction, context?: CapturedEditCommandContext | null): Promise<void> => {
      const targetContext = context ?? activeContextRef.current
      if (!targetContext?.getCapabilities()[action]) return

      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, 0)
      })
      targetContext.restore()

      if (targetContext.adapter?.perform?.(action)) {
        syncCapabilities()
        return
      }

      const bridge = window.DesktopBridge?.performEditAction
      if (bridge) {
        await bridge(action).catch(() => undefined)
      } else {
        performBrowserEditAction(action)
      }
      syncCapabilities()
    },
    [syncCapabilities],
  )

  useEffect(() => {
    const handleFocusIn = (event: FocusEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-edit-command-preserve-target]')) {
        return
      }
      if (target === activeTargetRef.current && activeContextRef.current) {
        syncCapabilities()
        return
      }
      const next = resolveEditCommandContext(target, adaptersRef.current)
      if (next) updateActiveContext(next, target)
    }

    const handlePointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('[data-edit-command-preserve-target]')) {
        return
      }
      if (target === activeTargetRef.current && activeContextRef.current) {
        syncCapabilities()
        return
      }
      const next = resolveEditCommandContext(target, adaptersRef.current)
      updateActiveContext(next, target)
    }

    document.addEventListener('focusin', handleFocusIn, true)
    document.addEventListener('pointerdown', handlePointerDown, true)
    document.addEventListener('selectionchange', syncCapabilities)
    document.addEventListener('input', syncCapabilities, true)
    return () => {
      document.removeEventListener('focusin', handleFocusIn, true)
      document.removeEventListener('pointerdown', handlePointerDown, true)
      document.removeEventListener('selectionchange', syncCapabilities)
      document.removeEventListener('input', syncCapabilities, true)
    }
  }, [syncCapabilities, updateActiveContext])

  const actionsValue = useMemo<EditCommandActions>(
    () => ({
      captureContext,
      perform,
      registerTarget,
    }),
    [captureContext, perform, registerTarget],
  )

  return (
    <EditCommandActionContext.Provider value={actionsValue}>
      <EditCommandStateContext.Provider value={state}>
        {children}
      </EditCommandStateContext.Provider>
    </EditCommandActionContext.Provider>
  )
}

export function useEditCommandActions(): EditCommandActions {
  return useContext(EditCommandActionContext)
}

export function useEditCommandState(): EditCommandState {
  return useContext(EditCommandStateContext)
}

export function useEditCommands(): EditCommandContextValue {
  const actions = useContext(EditCommandActionContext)
  const state = useContext(EditCommandStateContext)
  return useMemo(
    () => ({
      ...state,
      ...actions,
    }),
    [state, actions],
  )
}

function resolveEditCommandContext(
  target: EventTarget | null,
  adapters: WeakMap<HTMLElement, EditCommandAdapter>,
): CapturedEditCommandContext | null {
  const element =
    target instanceof HTMLElement ? target : target instanceof Node ? target.parentElement : null
  if (!element) return captureDocumentSelection()

  for (
    let candidate: HTMLElement | null = element;
    candidate;
    candidate = candidate.parentElement
  ) {
    const adapter = adapters.get(candidate)
    if (adapter) {
      return {
        kind: adapter.readonly ? 'readonly-editor' : 'editable',
        adapter,
        getCapabilities: adapter.getCapabilities,
        restore: adapter.focus,
      }
    }
  }

  const textControl = element.closest('input, textarea')
  if (textControl instanceof HTMLInputElement || textControl instanceof HTMLTextAreaElement) {
    return captureTextControl(textControl)
  }

  const editable = element.closest<HTMLElement>(
    '[contenteditable="true"], [contenteditable="plaintext-only"]',
  )
  if (editable) return captureContentEditable(editable)

  return captureDocumentSelection()
}

function captureTextControl(
  element: HTMLInputElement | HTMLTextAreaElement,
): CapturedEditCommandContext {
  const selectionStart = element.selectionStart ?? 0
  const selectionEnd = element.selectionEnd ?? selectionStart
  const readonly = element.readOnly || element.disabled
  const password = element instanceof HTMLInputElement && element.type === 'password'

  return {
    kind: readonly ? 'readonly-editor' : 'editable',
    getCapabilities: () => {
      const currentStart = element.selectionStart ?? selectionStart
      const currentEnd = element.selectionEnd ?? selectionEnd
      const hasSelection = currentEnd > currentStart
      const hasValue = element.value.length > 0
      return {
        undo: !readonly && queryCommandEnabled('undo'),
        redo: !readonly && queryCommandEnabled('redo'),
        cut: !readonly && !password && hasSelection,
        copy: !password && hasSelection,
        paste: !readonly,
        delete: !readonly && hasSelection,
        selectAll: hasValue && (currentStart !== 0 || currentEnd !== element.value.length),
      }
    },
    restore: () => {
      element.focus({ preventScroll: true })
      try {
        element.setSelectionRange(selectionStart, selectionEnd)
      } catch {
        // Non-text input types do not expose a restorable selection.
      }
    },
  }
}

function captureContentEditable(element: HTMLElement): CapturedEditCommandContext {
  const selection = window.getSelection()
  const range =
    selection?.rangeCount && element.contains(selection.getRangeAt(0).commonAncestorContainer)
      ? selection.getRangeAt(0).cloneRange()
      : null

  return {
    kind: 'editable',
    getCapabilities: () => ({
      undo: queryCommandEnabled('undo'),
      redo: queryCommandEnabled('redo'),
      cut: Boolean(range && !range.collapsed),
      copy: Boolean(range && !range.collapsed),
      paste: true,
      delete: Boolean(range && !range.collapsed),
      selectAll: element.textContent?.length ? !selectionCoversElement(element) : false,
    }),
    restore: () => {
      element.focus({ preventScroll: true })
      if (!range) return
      const current = window.getSelection()
      current?.removeAllRanges()
      current?.addRange(range)
    },
  }
}

function captureDocumentSelection(): CapturedEditCommandContext | null {
  const selection = window.getSelection()
  if (!selection?.rangeCount || !selection.toString()) return null
  const range = selection.getRangeAt(0).cloneRange()
  return {
    kind: 'selection',
    getCapabilities: () => ({
      ...EMPTY_CAPABILITIES,
      copy: true,
    }),
    restore: () => {
      const current = window.getSelection()
      current?.removeAllRanges()
      current?.addRange(range)
    },
  }
}

function selectionCoversElement(element: HTMLElement): boolean {
  const selection = window.getSelection()
  if (!selection?.rangeCount) return false
  const range = selection.getRangeAt(0)
  const contents = document.createRange()
  contents.selectNodeContents(element)
  return (
    range.compareBoundaryPoints(Range.START_TO_START, contents) <= 0 &&
    range.compareBoundaryPoints(Range.END_TO_END, contents) >= 0
  )
}

function queryCommandEnabled(command: string): boolean {
  try {
    return document.queryCommandEnabled(command)
  } catch {
    return false
  }
}

function performBrowserEditAction(action: DesktopEditAction): void {
  const command = action === 'selectAll' ? 'selectAll' : action
  try {
    document.execCommand(command)
  } catch {
    // Browser previews may reject clipboard commands without a user grant.
  }
}
