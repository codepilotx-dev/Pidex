import type React from 'react'
import { useSessionDisplayField } from '../state/SessionDisplayStore.js'
import type { SessionInputBinding } from '../state/UseSessionState.js'
import { DesktopComposer, type DesktopComposerProps } from './DesktopComposer.js'

export type SessionBoundComposerProps = Omit<DesktopComposerProps, 'input'> & {
  inputBinding: SessionInputBinding
}

export function SessionBoundComposer({
  inputBinding,
  ...props
}: SessionBoundComposerProps): React.ReactNode {
  const input = useSessionDisplayField(inputBinding.store, (state) => state.input)
  return <DesktopComposer {...props} input={input} onInputChange={inputBinding.replace} />
}
