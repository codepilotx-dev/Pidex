import type React from 'react'
import { RouterProvider } from 'react-router-dom'
import { router } from './Routes.js'
import { DesktopThemeProvider } from './features/theme/DesktopThemeProvider.js'
import { TooltipProvider } from './components/ui/Tooltip.js'
import { AppContextMenu } from './components/ui/AppContextMenu.js'
import { EditCommandProvider } from './components/ui/EditCommandProvider.js'
import { Suspense, useEffect, useState } from 'react'
import { useEverOpened } from './hooks/UsePresenceRetention.js'
import { PageZoomCapsule } from './components/PageZoomCapsule.js'
import { PET_OVERLAY_HASH_PREFIX } from './startup/StartupSplashHandoff.js'
import { GlobalErrorModal } from './components/GlobalErrorModal.js'
import { fullErrorMessage } from './utils/Errors.js'

function isResizeObserverLoopError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return (
    message.includes('ResizeObserver loop completed with undelivered notifications.') ||
    message.includes('ResizeObserver loop limit exceeded')
  )
}

export function App(): React.ReactNode {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const errorModalMounted = useEverOpened(errorMessage !== null)

  useEffect(() => {
    const showError = (error: unknown): void => {
      setErrorMessage(fullErrorMessage(error))
    }
    const handleError = (event: ErrorEvent): void => {
      if (isResizeObserverLoopError(event.error) || isResizeObserverLoopError(event.message)) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      showError(event.error ?? event.message)
    }
    const handleUnhandledRejection = (event: PromiseRejectionEvent): void => {
      if (isResizeObserverLoopError(event.reason)) {
        event.preventDefault()
        return
      }
      event.preventDefault()
      showError(event.reason)
    }
    const handleDesktopError = (event: Event): void => {
      const detail = event instanceof CustomEvent ? event.detail : null
      showError(detail)
    }

    window.addEventListener('error', handleError, true)
    window.addEventListener('unhandledrejection', handleUnhandledRejection, true)
    window.addEventListener('desktop:error', handleDesktopError)
    return () => {
      window.removeEventListener('error', handleError, true)
      window.removeEventListener('unhandledrejection', handleUnhandledRejection, true)
      window.removeEventListener('desktop:error', handleDesktopError)
    }
  }, [])

  return (
    <DesktopThemeProvider>
      <TooltipProvider>
        <EditCommandProvider>
          <AppContextMenu
            actions={[]}
            layout="flex"
            size="md"
            trigger={
              <div className="app-global-context-menu-trigger">
                {errorModalMounted ? (
                  <Suspense fallback={null}>
                    <GlobalErrorModal
                      message={errorMessage}
                      onDismiss={() => setErrorMessage(null)}
                    />
                  </Suspense>
                ) : null}
                {window.location.hash.startsWith(PET_OVERLAY_HASH_PREFIX) ? null : (
                  <PageZoomCapsule />
                )}
                <RouterProvider router={router} />
              </div>
            }
          />
        </EditCommandProvider>
      </TooltipProvider>
    </DesktopThemeProvider>
  )
}
