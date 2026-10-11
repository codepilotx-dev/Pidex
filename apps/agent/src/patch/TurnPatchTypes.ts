export type TurnPatchApplyState = 'applied' | 'undone'

export type TurnPatchMutationFile = {
  operation: 'create' | 'update' | 'delete'
  path: string
  beforeContent: string | null
  afterContent: string | null
  beforeSha256: string | null
  afterSha256: string | null
}

export type TurnPatchMutationBatch = {
  threadID: string
  turnID: string
  agentID: string
  toolCallID: string
  files: readonly TurnPatchMutationFile[]
}

export type StoredTurnPatchSet = {
  threadID: string
  turnID: string
  itemID: string
  applyState: TurnPatchApplyState
  actionVersion: number
  evidenceComplete: boolean
}

export type StoredTurnPatchBatch = {
  ordinal: number
  toolCallID: string
  files: TurnPatchMutationFile[]
}

export type StoredTurnPatchToolBatch = StoredTurnPatchBatch & {
  threadID: string
  turnID: string
}
