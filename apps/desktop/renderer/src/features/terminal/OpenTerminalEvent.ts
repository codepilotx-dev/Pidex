import type { DesktopTerminalSnapshot } from '@pidex/shared/desktop-terminal-ipc'

export const OPEN_TERMINAL_EVENT = 'pidex-open-integrated-terminal'

export type OpenTerminalEventDetail = {
  threadId: string
  snapshot?: DesktopTerminalSnapshot
}
