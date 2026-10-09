export const RENDERER_DATA_EPOCH = 3

const DATA_EPOCH_KEY = 'pidex.dataEpoch'
const TRANSIENT_PREFIXES = ['conversation.ui-state.', 'pidex.subagent.scroll.']

function transientKeys(storage: Storage): string[] {
  const keys: string[] = []
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index)
    if (
      key &&
      key !== DATA_EPOCH_KEY &&
      TRANSIENT_PREFIXES.some((prefix) => key.startsWith(prefix))
    ) {
      keys.push(key)
    }
  }
  return keys
}

function removeTransientKeys(storage: Storage): void {
  for (const key of transientKeys(storage)) storage.removeItem(key)
}

export function ensureRendererDataEpoch(
  localStorage: Storage | undefined,
  sessionStorage: Storage | undefined,
): boolean {
  if (!localStorage) return false
  const epoch = String(RENDERER_DATA_EPOCH)
  if (localStorage.getItem(DATA_EPOCH_KEY) === epoch) return false

  removeTransientKeys(localStorage)
  if (sessionStorage) removeTransientKeys(sessionStorage)
  localStorage.setItem(DATA_EPOCH_KEY, epoch)
  return true
}

export function initializeRendererDataEpoch(): void {
  if (typeof window === 'undefined') return
  try {
    ensureRendererDataEpoch(window.localStorage, window.sessionStorage)
  } catch {
    // Storage can be disabled or full. The desktop client still works in-memory.
  }
}
