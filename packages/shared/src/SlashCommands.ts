export type SharedSlashCommandId = 'plan' | 'grill' | 'goal' | 'status'

export type SharedSlashCommandArgumentMode = 'none' | 'optional-text'

export type SharedSlashCommandDefinition = {
  id: SharedSlashCommandId
  trigger: string
  argumentMode: SharedSlashCommandArgumentMode
}

export const SHARED_SLASH_COMMANDS = {
  plan: {
    id: 'plan',
    trigger: 'plan',
    argumentMode: 'optional-text',
  },
  goal: { id: 'goal', trigger: 'goal', argumentMode: 'optional-text' },
  grill: {
    id: 'grill',
    trigger: 'grill',
    argumentMode: 'optional-text',
  },
  status: {
    id: 'status',
    trigger: 'status',
    argumentMode: 'none',
  },
} as const satisfies Record<SharedSlashCommandId, SharedSlashCommandDefinition>

export function parsePlanTaskFromInput(input: string): string | null {
  return /^\/plan\s+([\s\S]*\S)\s*$/iu.exec(input)?.[1] ?? null
}

export function parseGrillTaskFromInput(input: string): string | null {
  return /^\/grill\s+([\s\S]*\S)\s*$/iu.exec(input)?.[1] ?? null
}

export function parseGoalTaskFromInput(input: string): string | null {
  return /^\/goal\s+([\s\S]*\S)\s*$/iu.exec(input)?.[1] ?? null
}
