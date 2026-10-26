export function focusComposerIfAvailable(
  editor: HTMLElement,
  focus: () => void,
  returnFrom?: Element | null,
): void {
  const document = editor.ownerDocument
  const active = document.activeElement
  if (
    !editor.isConnected ||
    !document.hasFocus() ||
    editor.closest('[inert], [hidden]') ||
    (active !== document.body && !editor.contains(active) && active !== returnFrom)
  )
    return
  const dialogs = document.querySelectorAll<HTMLElement>('[role="dialog"], [role="alertdialog"]')
  if ([...dialogs].some((dialog) => !dialog.contains(editor) && dialog.getClientRects().length > 0))
    return
  focus()
}
