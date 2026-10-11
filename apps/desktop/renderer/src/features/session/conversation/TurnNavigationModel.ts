import type { RenderTurnEntry } from '@pidex/session-view'
import { normalizePathForComparison } from '../../../utils/PathUtils.js'
import { desktopUserMessageInputToPreviewText } from '../../../../shared/DesktopUserMessage.js'

export type ConversationTurnNavOutput = {
  type: 'file'
  label: string
  path: string
}

export type ConversationTurnNavItem = {
  id: string
  turnId: string
  rowIndex: number
  isRunning: boolean
  userText: string
  assistantText: string | null
  outputs: ConversationTurnNavOutput[]
}

export function deriveConversationTurnNavItems(
  turns: readonly RenderTurnEntry[],
): ConversationTurnNavItem[] {
  return turns.flatMap((turn, rowIndex) => {
    const assistantText = turn.assistantResultItems
      .map((item) => item.text)
      .join('\n')
      .trim()

    const inputs = turn.userItems.filter((input) => input.origin !== 'goal-continuation')
    const outputs = collectFileOutputs(turn)
    return inputs.map((input, index) => ({
      id: input.id,
      turnId: turn.id,
      rowIndex,
      isRunning:
        [
          'running',
          'waiting-permission',
          'waiting-question',
          'waiting-subagents',
          'queued',
        ].includes(turn.turn.status) && index === inputs.length - 1,
      userText: (input.skills?.length
        ? desktopUserMessageInputToPreviewText({ text: input.content, skills: input.skills })
        : input.content
      ).trim(),
      assistantText: assistantText || null,
      outputs,
    }))
  })
}

function collectFileOutputs(turn: RenderTurnEntry): ConversationTurnNavOutput[] {
  const outputs: ConversationTurnNavOutput[] = []
  const seenPaths = new Set<string>()

  for (const patch of turn.patchItems) {
    for (const file of patch.files) {
      const path = file.path.trim()
      const normalizedPath = normalizePathForCompare(path)
      if (!normalizedPath || seenPaths.has(normalizedPath)) continue
      seenPaths.add(normalizedPath)
      outputs.push({
        type: 'file',
        label: fileName(path),
        path,
      })
    }
  }

  return outputs
}

function normalizePathForCompare(path: string): string {
  return normalizePathForComparison(path)
}

function fileName(path: string): string {
  return path.replace(/\\/gu, '/').split('/').at(-1) || path
}
