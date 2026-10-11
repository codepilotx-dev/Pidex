import { createContext, useContext } from 'react'
import type React from 'react'
import type { ButtonSize } from './Button.js'

const TabStripButtonContext = createContext(false)

export function TabStripButtonProvider({
  children,
}: {
  children: React.ReactNode
}): React.ReactNode {
  return <TabStripButtonContext.Provider value>{children}</TabStripButtonContext.Provider>
}

export function useResolvedButtonSize(size: ButtonSize): ButtonSize {
  const inTabStrip = useContext(TabStripButtonContext)
  return inTabStrip && size === 'toolbar' ? 'tabStripAction' : size
}
