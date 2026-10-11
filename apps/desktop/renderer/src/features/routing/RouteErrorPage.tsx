import { useEffect, type ReactNode } from 'react'
import { useRouteError } from 'react-router-dom'
import { Button } from '../../components/ui/Button.js'

const DYNAMIC_MODULE_RELOAD_KEY = 'pidex.route.dynamic-module-reload'
const DYNAMIC_MODULE_RELOAD_COOLDOWN_MS = 30_000

const DYNAMIC_MODULE_LOAD_ERROR_PATTERN =
  /(?:failed to fetch|error loading) dynamically imported module|importing a module script failed|load failed for module with source/i

export function isDynamicModuleLoadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : typeof error === 'string' ? error : ''
  return DYNAMIC_MODULE_LOAD_ERROR_PATTERN.test(message)
}

type ReloadStorage = Pick<Storage, 'getItem' | 'setItem'>

export function claimDynamicModuleReload(
  error: unknown,
  storage: ReloadStorage | undefined,
  now = Date.now(),
): boolean {
  if (!isDynamicModuleLoadError(error) || !storage) return false

  try {
    const lastReloadAt = Number(storage.getItem(DYNAMIC_MODULE_RELOAD_KEY))
    if (lastReloadAt && now - lastReloadAt < DYNAMIC_MODULE_RELOAD_COOLDOWN_MS) {
      return false
    }

    storage.setItem(DYNAMIC_MODULE_RELOAD_KEY, String(now))
    return true
  } catch {
    return false
  }
}

type RouteErrorPageContentProps = {
  error: unknown
}

export function RouteErrorPageContent({ error }: RouteErrorPageContentProps): ReactNode {
  const isDynamicModuleError = isDynamicModuleLoadError(error)

  return (
    <main
      className="not-found-page tw:grid tw:w-full tw:min-w-0 tw:min-h-full tw:content-center tw:justify-items-center tw:gap-3 tw:p-5 tw:bg-app-canvas tw:text-center tw:text-app-text"
      data-startup-surface-ready="true"
      role="alert"
    >
      <span aria-hidden="true" className="tw:text-app-text-meta tw:type-title-xl">
        !
      </span>
      <h1 className="tw:m-0 tw:text-app-text tw:type-title-sm">
        {isDynamicModuleError ? '界面模块未加载完成' : '页面暂时无法显示'}
      </h1>
      <p className="tw:m-0 tw:max-w-[440px] tw:text-app-text-soft tw:type-body-sm">
        {isDynamicModuleError
          ? '应用可能正在更新，请重新加载后继续。'
          : '应用遇到临时问题，请重新加载后继续。'}
      </p>
      <Button color="secondary" onClick={() => window.location.reload()}>
        重新加载
      </Button>
    </main>
  )
}

export function RouteErrorPage(): ReactNode {
  const error = useRouteError()

  useEffect(() => {
    try {
      if (claimDynamicModuleReload(error, window.sessionStorage)) {
        queueMicrotask(() => window.location.reload())
      }
    } catch {
      // Accessing sessionStorage itself can fail under restricted policies.
    }
  }, [error])

  return <RouteErrorPageContent error={error} />
}
