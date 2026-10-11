import type { JsonValue } from '@pidex/agent-protocol'

export type EnvironmentActionEditorValue = {
  sourceIndex: number | null
  name: string
  icon: string
  command: string
  windows: string
  macos: string
  linux: string
}

export const EMPTY_ENVIRONMENT_ACTION: EnvironmentActionEditorValue = {
  sourceIndex: null,
  name: '',
  icon: '',
  command: '',
  windows: '',
  macos: '',
  linux: '',
}

export function environmentActionsValue(value: unknown): EnvironmentActionEditorValue[] {
  if (!Array.isArray(value)) return []
  return value.map((entry, sourceIndex) => {
    const record =
      entry && typeof entry === 'object' && !Array.isArray(entry)
        ? (entry as Record<string, unknown>)
        : {}
    return {
      sourceIndex,
      name: stringValue(record.name),
      icon: stringValue(record.icon),
      command: stringValue(record.command),
      windows: stringValue(record.windows),
      macos: stringValue(record.macos),
      linux: stringValue(record.linux),
    }
  })
}

export type EnvironmentPlatformCommand = {
  script: string
  windows?: string
  macos?: string
  linux?: string
}

export type LocalEnvironmentConfigEdit = {
  keyPath: Array<string | number>
  value: JsonValue
}

export function buildEnvironmentConfigEdits(input: {
  original: Readonly<Record<string, unknown>>
  name: string
  setup: EnvironmentPlatformCommand
  cleanup: EnvironmentPlatformCommand
  actions: readonly EnvironmentActionEditorValue[]
}): LocalEnvironmentConfigEdit[] {
  const edits: LocalEnvironmentConfigEdit[] = [
    { keyPath: ['schema_version'], value: 1 },
    { keyPath: ['name'], value: input.name.trim() },
  ]
  appendCommandEdits(edits, 'setup', input.original.setup, input.setup)
  appendCommandEdits(edits, 'cleanup', input.original.cleanup, input.cleanup)

  const serialized = serializeEnvironmentActions(input.actions) as Array<Record<string, JsonValue>>
  const originalActions = Array.isArray(input.original.actions) ? input.original.actions : []
  const retainedIndexes = new Set<number>()
  for (let index = 0; index < input.actions.length; index += 1) {
    const action = input.actions[index]!
    if (action.sourceIndex === null) continue
    if (
      !Number.isSafeInteger(action.sourceIndex) ||
      action.sourceIndex < 0 ||
      action.sourceIndex >= originalActions.length ||
      retainedIndexes.has(action.sourceIndex)
    ) {
      throw new Error('Action 编辑状态已失效，请重新加载配置。')
    }
    retainedIndexes.add(action.sourceIndex)
    appendKnownActionEdits(edits, action.sourceIndex, serialized[index]!)
  }
  for (let index = originalActions.length - 1; index >= 0; index -= 1) {
    if (!retainedIndexes.has(index)) edits.push({ keyPath: ['actions', index], value: null })
  }
  let appendIndex = retainedIndexes.size
  for (let index = 0; index < input.actions.length; index += 1) {
    if (input.actions[index]!.sourceIndex !== null) continue
    edits.push({ keyPath: ['actions', appendIndex], value: serialized[index]! })
    appendIndex += 1
  }
  return edits
}

export function serializeEnvironmentActions(
  actions: readonly EnvironmentActionEditorValue[],
): JsonValue {
  const names = new Set<string>()
  return actions.map((action, index) => {
    const name = action.name.trim()
    const command = action.command.trim()
    if (!name) throw new Error(`Action ${index + 1} 缺少名称。`)
    if (!command) throw new Error(`Action ${name} 缺少默认命令。`)
    const normalizedName = name.toLocaleLowerCase()
    if (names.has(normalizedName)) throw new Error(`Action 名称重复：${name}`)
    names.add(normalizedName)
    return Object.fromEntries(
      Object.entries({
        name,
        icon: action.icon.trim(),
        command,
        windows: action.windows.trim(),
        macos: action.macos.trim(),
        linux: action.linux.trim(),
      }).filter(([, entry]) => entry),
    )
  }) as JsonValue
}

function appendCommandEdits(
  edits: LocalEnvironmentConfigEdit[],
  key: 'setup' | 'cleanup',
  original: unknown,
  value: EnvironmentPlatformCommand,
): void {
  const compact = compactCommand(value)
  if (!compact.script) {
    edits.push({ keyPath: [key], value: null })
    return
  }
  if (!original || typeof original !== 'object' || Array.isArray(original)) {
    edits.push({ keyPath: [key], value: compact })
    return
  }
  for (const field of ['script', 'windows', 'macos', 'linux'] as const) {
    edits.push({ keyPath: [key, field], value: compact[field] ?? null })
  }
}

function appendKnownActionEdits(
  edits: LocalEnvironmentConfigEdit[],
  sourceIndex: number,
  action: Record<string, JsonValue>,
): void {
  for (const field of ['name', 'icon', 'command', 'windows', 'macos', 'linux'] as const) {
    edits.push({ keyPath: ['actions', sourceIndex, field], value: action[field] ?? null })
  }
}

function compactCommand(
  value: EnvironmentPlatformCommand,
): Record<string, JsonValue> & { script: string } {
  return Object.fromEntries(
    Object.entries(value)
      .filter(([, entry]) => typeof entry === 'string' && entry.trim())
      .map(([key, entry]) => [key, entry!.trim()]),
  ) as Record<string, JsonValue> & { script: string }
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}
