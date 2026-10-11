import { useCallback, useEffect, useState } from 'react'
import { loadDesktopTerminalClient } from '../../../services/desktop-client/index.js'
import { OPEN_TERMINAL_EVENT } from '../../terminal/OpenTerminalEvent.js'
import type {
  WorkbenchPanelTarget,
  WorkbenchTabDescriptor,
  WorkbenchTabId,
  WorkbenchTabsState,
} from '../dock/RightDockState.js'

export type IntegratedTerminalToggleAction =
  'unavailable' | 'hide-bottom' | 'move-to-bottom' | 'open-bottom'

export function resolveIntegratedTerminalToggleAction(
  threadId: string | null,
  state: WorkbenchTabsState,
  available = true,
): IntegratedTerminalToggleAction {
  if (!threadId || !available) return 'unavailable'
  const hasTerminalInRight = state.right.tabIds.some(
    (id) =>
      id === 'terminal' || id.startsWith('terminal:') || state.tabsById[id]?.kind === 'terminal',
  )
  if (hasTerminalInRight) return 'move-to-bottom'
  const isTerminalActiveInBottom =
    state.bottom.open &&
    state.bottom.activeTabId != null &&
    (state.bottom.activeTabId === 'terminal' ||
      state.bottom.activeTabId.startsWith('terminal:') ||
      state.tabsById[state.bottom.activeTabId]?.kind === 'terminal')
  if (isTerminalActiveInBottom) return 'hide-bottom'
  return 'open-bottom'
}

export function useIntegratedTerminalController({
  threadId,
  state,
  openPanelTab,
  movePanelTab,
  togglePanel,
  enabled = true,
}: {
  threadId: string | null
  state: WorkbenchTabsState
  openPanelTab: (target: WorkbenchPanelTarget, tab: WorkbenchTabDescriptor, index?: number) => void
  movePanelTab: (
    source: WorkbenchPanelTarget,
    target: WorkbenchPanelTarget,
    tabId: WorkbenchTabId,
    index?: number,
  ) => void
  togglePanel: (target: WorkbenchPanelTarget) => void
  enabled?: boolean
}) {
  const [terminalClientAvailable, setTerminalClientAvailable] = useState(false)
  const effectiveThreadId = threadId || 'home'

  useEffect(() => {
    let disposed = false
    void loadDesktopTerminalClient()
      .then((client) => {
        if (!disposed) setTerminalClientAvailable(client.available)
      })
      .catch(() => {
        if (!disposed) setTerminalClientAvailable(false)
      })
    return () => {
      disposed = true
    }
  }, [])

  const terminalAvailable = terminalClientAvailable && enabled

  const openIntegratedTerminal = useCallback((): void => {
    if (!effectiveThreadId || !terminalAvailable) return
    const rightTerminalId = state.right.tabIds.find(
      (id) =>
        id === 'terminal' || id.startsWith('terminal:') || state.tabsById[id]?.kind === 'terminal',
    )
    if (rightTerminalId) {
      movePanelTab('right', 'bottom', rightTerminalId)
    } else if (state.bottom.tabIds.length > 0) {
      if (!state.bottom.open) {
        togglePanel('bottom')
      }
    } else {
      openPanelTab('bottom', {
        id: 'terminal:1',
        kind: 'terminal',
        terminalId: '1',
        title: '终端 1',
      })
    }
    focusTerminalAfterLayout(effectiveThreadId)
  }, [
    effectiveThreadId,
    movePanelTab,
    openPanelTab,
    state.bottom.open,
    state.bottom.tabIds.length,
    state.right.tabIds,
    state.tabsById,
    terminalAvailable,
    togglePanel,
  ])

  const toggleIntegratedTerminal = useCallback((): void => {
    const action = resolveIntegratedTerminalToggleAction(
      effectiveThreadId,
      state,
      terminalAvailable,
    )
    if (action === 'unavailable') return
    if (action === 'hide-bottom') {
      togglePanel('bottom')
      return
    }
    openIntegratedTerminal()
  }, [effectiveThreadId, openIntegratedTerminal, state, terminalAvailable, togglePanel])

  useEffect(() => {
    const onOpen = (event: Event): void => {
      const requestedThreadId = (event as CustomEvent<{ threadId?: string }>).detail?.threadId
      if (
        requestedThreadId === threadId ||
        requestedThreadId === effectiveThreadId ||
        (!requestedThreadId && !threadId)
      ) {
        openIntegratedTerminal()
      }
    }
    window.addEventListener(OPEN_TERMINAL_EVENT, onOpen)
    return () => window.removeEventListener(OPEN_TERMINAL_EVENT, onOpen)
  }, [effectiveThreadId, openIntegratedTerminal, threadId])

  return {
    terminalAvailable,
    terminalVisible:
      state.bottom.open &&
      state.bottom.activeTabId != null &&
      (state.bottom.activeTabId === 'terminal' ||
        state.bottom.activeTabId.startsWith('terminal:') ||
        state.tabsById[state.bottom.activeTabId]?.kind === 'terminal'),
    openIntegratedTerminal,
    toggleIntegratedTerminal,
  }
}

export function isTerminalKeyboardTarget(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest('[data-terminal-keyboard-capture]') !== null
}

function focusTerminalAfterLayout(threadId: string | null): void {
  const targetId = threadId || 'home'
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      const terminal = document.querySelector<HTMLElement>(
        `[data-terminal-keyboard-capture][data-thread-id="${CSS.escape(targetId)}"] .xterm-helper-textarea`,
      )
      terminal?.focus()
    })
  })
}
