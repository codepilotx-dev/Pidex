import type { LocalContextReference } from '@pidex/shared/thread'
import { AttachmentFilePill, AttachmentHorizontalRow } from './AttachmentRowPrimitives.js'

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
    <AttachmentHorizontalRow ariaLabel="本地上下文" reverse>
      {references.map((reference) => (
        <AttachmentFilePill
          detail={`${reference.kind === 'directory' ? '目录' : '本地文件'} · ${reference.status === 'missing' ? '路径已丢失' : '实时引用'}`}
          error={reference.status === 'missing'}
          key={reference.id}
          name={reference.name}
          onOpen={onOpen ? () => onOpen(reference) : undefined}
          onRemove={onRemove ? () => onRemove(reference.id) : undefined}
        />
      ))}
    </AttachmentHorizontalRow>
  )
}
