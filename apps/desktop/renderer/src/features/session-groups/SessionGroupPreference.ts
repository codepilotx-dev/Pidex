const KEY = 'pidex.last-session-group-id'

export function readPreferredSessionGroupId(): string | null {
  try {
    return globalThis.localStorage?.getItem(KEY) || null
  } catch {
    return null
  }
}

export function writePreferredSessionGroupId(groupId: string | null): void {
  try {
    if (groupId) globalThis.localStorage?.setItem(KEY, groupId)
    else globalThis.localStorage?.removeItem(KEY)
  } catch {
    // Preferences are best-effort; creating a chat must remain available.
  }
}
