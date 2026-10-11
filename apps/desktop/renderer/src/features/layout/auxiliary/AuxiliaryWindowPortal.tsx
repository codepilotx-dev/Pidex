import type React from 'react'
import { createContext, useContext, useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AuxiliaryWindowEntry } from './AuxiliaryWindowService.js'
import { AuxiliaryTitlebar } from './AuxiliaryTitlebar.js'

export interface AuxiliaryWindowContextValue {
  readonly window: Window
  readonly document: Document
  readonly isAuxiliary: boolean
  readonly dockBack: () => void
}

const AuxiliaryWindowContext = createContext<AuxiliaryWindowContextValue | null>(null)

export function useAuxiliaryWindowContext(): AuxiliaryWindowContextValue | null {
  return useContext(AuxiliaryWindowContext)
}

export interface AuxiliaryWindowPortalProps {
  entry: AuxiliaryWindowEntry
  title: string
  icon?: React.ReactNode
  onDockBack: () => void
  children: React.ReactNode
}

export function AuxiliaryWindowPortal({
  entry,
  title,
  icon,
  onDockBack,
  children,
}: AuxiliaryWindowPortalProps): React.ReactNode {
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    return () => setMounted(false)
  }, [])

  if (!mounted || !entry.container) {
    return null
  }

  const contextValue: AuxiliaryWindowContextValue = {
    window: entry.window,
    document: entry.window.document,
    isAuxiliary: true,
    dockBack: onDockBack,
  }

  return createPortal(
    <AuxiliaryWindowContext.Provider value={contextValue}>
      <div className="auxiliary-window-shell tw:flex tw:flex-col tw:h-full tw:w-full tw:bg-app-canvas tw:text-app-text tw:overflow-hidden">
        <AuxiliaryTitlebar icon={icon} onDockBack={onDockBack} title={title} />
        <main className="auxiliary-window-content tw:flex-1 tw:min-h-0 tw:overflow-hidden tw:flex tw:flex-col">
          {children}
        </main>
      </div>
    </AuxiliaryWindowContext.Provider>,
    entry.container,
  )
}
