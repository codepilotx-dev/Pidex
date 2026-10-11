import type { RpcResult } from '@pidex/agent-protocol'
import type { DesktopUserMessageInput } from '../../../shared/Types.js'

export async function importLocalContextReferences(
  sessionId: string,
  input: DesktopUserMessageInput,
  callImport: (sessionId: string, paths: string[]) => Promise<RpcResult<'context/path/import'>>,
): Promise<string[]> {
  const retained = [...new Set((input.retainedContextReferenceIds ?? []).filter(Boolean))]
  const paths = [
    ...new Set(
      (input.attachments ?? [])
        .filter((attachment) => attachment.storage === 'local-path' && attachment.path)
        .map((attachment) => attachment.path),
    ),
  ]
  if (!paths.length) return retained
  const response = await callImport(sessionId, paths)
  return [...new Set([...retained, ...response.references.map((reference) => reference.id)])]
}
