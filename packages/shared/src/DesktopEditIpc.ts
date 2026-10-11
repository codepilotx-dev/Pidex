export const DESKTOP_EDIT_IPC_CHANNELS = {
  perform: 'desktop-edit:perform',
} as const

export const DESKTOP_EDIT_ACTIONS = [
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'delete',
  'selectAll',
] as const

export type DesktopEditAction = (typeof DESKTOP_EDIT_ACTIONS)[number]

export interface DesktopEditIpcBridge {
  performEditAction(action: DesktopEditAction): Promise<void>
}
