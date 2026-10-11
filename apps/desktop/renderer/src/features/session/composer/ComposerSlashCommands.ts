import type { DesktopInstalledSkill } from '../../../../shared/Types.js'

export type ComposerSlashCommandId =
  | 'approve'
  | 'model'
  | 'reasoning'
  | 'plan'
  | 'goal'
  | 'review'
  | 'compact'
  | 'mcp'
  | 'status'
  | 'side'
  | 'fork'
  | 'archive'
  | 'project'
  | 'task'

export type ComposerCommandAvailability = {
  visible: boolean
  enabled: boolean
  disabledReason?: string
}

export type ComposerSlashCommand = {
  id: ComposerSlashCommandId
  trigger: string
  title: string
  description: string
  source: 'builtin'
  availability: ComposerCommandAvailability
  execute: () => void | Promise<void>
}

export type ComposerSkillCommand = {
  id: `skill:${string}`
  trigger: string
  title: string
  description: string
  source: 'skill'
  skill: {
    name: string
    path: string
    scope: DesktopInstalledSkill['scope']
    source: DesktopInstalledSkill['source']
  }
}

export type ComposerCommand = ComposerSlashCommand | ComposerSkillCommand

export type ComposerTokenQuery = {
  start: number
  end: number
  query: string
}

export type ParsedSlashInvocation =
  | { kind: 'builtin'; command: ComposerSlashCommand }
  | { kind: 'disabled'; command: ComposerSlashCommand; reason: string }
  | { kind: 'unknown' }

export function planTaskFromInput(input: string): string | null {
  return /^\/plan\s+([\s\S]*\S)\s*$/iu.exec(input)?.[1] ?? null
}

export function skillToComposerCommand(skill: DesktopInstalledSkill): ComposerSkillCommand {
  return {
    id: `skill:${skill.name}`,
    trigger: skill.name,
    title: skill.name,
    description: skill.description,
    source: 'skill',
    skill: {
      name: skill.name,
      path: skill.path,
      scope: skill.scope,
      source: skill.source,
    },
  }
}

export function mergeSlashCommands(
  builtins: readonly ComposerSlashCommand[],
  skills: readonly ComposerSkillCommand[],
): ComposerCommand[] {
  const result: ComposerCommand[] = []
  const triggers = new Set<string>()

  for (const command of builtins) {
    if (!command.availability.visible) continue
    const trigger = normalizeTrigger(command.trigger)
    if (!trigger || triggers.has(trigger)) continue
    triggers.add(trigger)
    result.push(command)
  }

  for (const skill of skills) {
    const trigger = normalizeTrigger(skill.trigger)
    if (!trigger || triggers.has(trigger)) continue
    triggers.add(trigger)
    result.push(skill)
  }

  return result
}

export function filterComposerCommands<T extends ComposerCommand>(
  commands: readonly T[],
  query: string,
): T[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (!normalized) return [...commands]
  return commands.filter((command) =>
    [command.trigger, command.title, command.description]
      .join(' ')
      .toLocaleLowerCase()
      .includes(normalized),
  )
}

export function getActiveSlashCommandQuery(
  input: string,
  selectionStart: number | null,
): ComposerTokenQuery | null {
  if (selectionStart == null || selectionStart <= 0) return null
  const beforeCursor = input.slice(0, selectionStart)
  const match = beforeCursor.match(/(?:^|[\s([{])\/([^\s/]*)$/u)
  if (!match || /^[^\s]/u.test(input.slice(selectionStart))) return null
  const token = match[0]
  const markerOffset = token.lastIndexOf('/')
  return {
    start: selectionStart - token.length + markerOffset,
    end: selectionStart,
    query: match[1] ?? '',
  }
}

export function parseSlashInvocation(
  input: string,
  commands: readonly ComposerSlashCommand[],
): ParsedSlashInvocation {
  const match = input.match(/^\/([^\s/]+)$/u)
  if (!match) return { kind: 'unknown' }
  const trigger = normalizeTrigger(match[1] ?? '')
  const command = commands.find((candidate) => normalizeTrigger(candidate.trigger) === trigger)
  if (!command || !command.availability.visible) return { kind: 'unknown' }
  if (!command.availability.enabled) {
    return {
      kind: 'disabled',
      command,
      reason: command.availability.disabledReason ?? '当前上下文无法使用此命令',
    }
  }
  return { kind: 'builtin', command }
}

export function getActiveSkillTokenQuery(
  input: string,
  selectionStart: number | null,
): ComposerTokenQuery | null {
  if (selectionStart == null || selectionStart <= 0) return null
  const beforeCursor = input.slice(0, selectionStart)
  const match = beforeCursor.match(/(?:^|[\s([{])\$([^\s$]*)$/u)
  if (!match) return null
  const token = match[0]
  const markerOffset = token.lastIndexOf('$')
  const start = selectionStart - token.length + markerOffset
  const end = selectionStart
  if (/^[^\s]/u.test(input.slice(end))) return null
  return {
    start,
    end,
    query: match[1] ?? '',
  }
}

function normalizeTrigger(trigger: string): string {
  return trigger.trim().toLocaleLowerCase()
}
