export function isDevToolsShortcut(
  input: Pick<Electron.Input, 'type' | 'key' | 'isAutoRepeat'>,
): boolean {
  return input.type === 'keyDown' && input.key === 'F12' && !input.isAutoRepeat
}
