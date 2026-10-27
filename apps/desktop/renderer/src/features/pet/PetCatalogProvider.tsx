import { createContext, useContext, useState, type ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { usePetSettingsController } from './UsePetSettingsController.js'

const PetCatalogContext = createContext<ReturnType<typeof usePetSettingsController> | null>(null)

export function PetCatalogProvider({ children }: { children: ReactNode }): ReactNode {
  const location = useLocation()
  const [error, setError] = useState<string | null>(null)
  const controller = usePetSettingsController({
    enabled: location.pathname === '/pets' || location.pathname === '/settings/pets',
    onError: setError,
  })
  return (
    <PetCatalogContext.Provider value={controller}>
      <GlobalErrorModal message={error} onDismiss={() => setError(null)} />
      {children}
    </PetCatalogContext.Provider>
  )
}

export function usePetCatalogController(): ReturnType<typeof usePetSettingsController> {
  const controller = useContext(PetCatalogContext)
  if (!controller) throw new Error('宠物市场需要 PetCatalogProvider')
  return controller
}
