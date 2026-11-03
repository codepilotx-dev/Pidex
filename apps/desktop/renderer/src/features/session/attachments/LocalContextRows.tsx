import type { LocalContextReference } from '@pidex/shared/thread'
import { AttachmentFilePill, AttachmentFileRow } from './AttachmentRowPrimitives.js'

export function LocalContextRows({
  references,
  onOpen,
  onRemove,
}: {
  references: readonly LocalContextReference[]
  onOpen?: (reference: LocalContextReference) => void
  onRemove?: (referenceId: string) => void
}): React.ReactNode {
  if (!references.length) return null
  return (
    <AttachmentFileRow ariaLabel="本地上下文">
      {references.map((reference) => (
        <AttachmentFilePill
          error={reference.status === 'missing'}
          key={reference.id}
          name={reference.name}
          path={reference.path}
          onOpen={onOpen ? () => onOpen(reference) : undefined}
          onRemove={onRemove ? () => onRemove(reference.id) : undefined}
        />
      ))}
    </AttachmentFileRow>
  )
}
