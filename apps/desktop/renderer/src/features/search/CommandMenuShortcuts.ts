export type CommandMenuShortcut =
  | { type: 'open-menu' }
  | { type: 'focus-query' }
  | { type: 'create-task' }
  | { type: 'open-folder' }
  | { type: 'search-files' }
  | { type: 'select-task'; index: number }

export type CommandMenuShortcutEvent = Pick<
  KeyboardEvent,
  | 'altKey'
  | 'ctrlKey'
  | 'defaultPrevented'
  | 'isComposing'
  | 'key'
  | 'keyCode'
  | 'metaKey'
  | 'repeat'
  | 'shiftKey'
>

export function resolveCommandMenuShortcut(
  event: CommandMenuShortcutEvent,
  {
    hasOtherDialogOpen = false,
    hasWorkspace,
    menuOpen,
    taskCount,
  }: {
    hasOtherDialogOpen?: boolean
    hasWorkspace: boolean
    menuOpen: boolean
    taskCount: number
  },
): CommandMenuShortcut | null {
  if (
    event.defaultPrevented ||
    event.repeat ||
    event.isComposing ||
    event.keyCode === 229 ||
    !event.ctrlKey ||
    event.metaKey ||
    event.altKey ||
    hasOtherDialogOpen
  ) {
    return null
  }

  const key = event.key.toLowerCase()
  if ((!event.shiftKey && key === 'k') || (event.shiftKey && key === 'p')) {
    return { type: menuOpen ? 'focus-query' : 'open-menu' }
  }

  if (event.shiftKey) return null
  if (key === 'n') return { type: 'create-task' }
  if (key === 'o') return { type: 'open-folder' }
  if (key === 'p') {
    return hasWorkspace ? { type: 'search-files' } : null
  }

  if (!menuOpen || !/^[1-9]$/.test(key)) return null
  const index = Number(key) - 1
  return index < taskCount ? { type: 'select-task', index } : null
}
