import type { DesktopClientEnvironment } from './Types.js'

export function defaultDesktopClientEnvironment(): DesktopClientEnvironment {
  return {
    window: typeof window === 'undefined' ? undefined : window,
    localStorage: getDefaultLocalStorage(),
    fetch: typeof fetch === 'undefined' ? undefined : (input, init) => fetch(input, init),
    eventSourceFactory:
      typeof EventSource === 'undefined'
        ? undefined
        : (url) => new EventSource(url, { withCredentials: true }),
  }
}

export function getDefaultLocalStorage(): Storage | undefined {
  return typeof window === 'undefined' ? undefined : window.localStorage
}
