import type React from 'react'
import { ProviderEditorForm, type ProviderEditorFormProps } from './ProviderEditorForm.js'

export type ProviderEditorDialogProps = Omit<
  ProviderEditorFormProps,
  'embedded' | 'connectionSection' | 'onDelete'
>

export function ProviderEditorDialog(props: ProviderEditorDialogProps): React.ReactNode {
  return <ProviderEditorForm {...props} />
}
