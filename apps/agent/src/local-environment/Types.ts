export const LOCAL_ENVIRONMENT_SCHEMA_VERSION = 1 as const

export type SupportedEnvironmentPlatform = 'windows' | 'macos' | 'linux'

export type PlatformCommand = {
  script: string
  windows?: string | undefined
  macos?: string | undefined
  linux?: string | undefined
}

export type LocalEnvironmentAction = {
  name: string
  icon?: string | undefined
  command: string
  windows?: string | undefined
  macos?: string | undefined
  linux?: string | undefined
}

export type LocalEnvironmentConfig = {
  schema_version: typeof LOCAL_ENVIRONMENT_SCHEMA_VERSION
  name: string
  setup?: PlatformCommand | undefined
  cleanup?: PlatformCommand | undefined
  actions: LocalEnvironmentAction[]
}

export type EnvironmentDelta = {
  revision: number
  set: Record<string, string>
  unset: string[]
}

export type LocalEnvironmentOperationKind = 'setup' | 'cleanup'
export type LocalEnvironmentOperationStatus = 'running' | 'succeeded' | 'failed'

export type LocalEnvironmentOperation = {
  operationId: string
  kind: LocalEnvironmentOperationKind
  status: LocalEnvironmentOperationStatus
  revision: number
  startedAt: number
  completedAt: number | null
  exitCode: number | null
  errorCode: 'LOCAL_ENVIRONMENT_COMMAND_FAILED' | null
}

export const currentEnvironmentPlatform = (): SupportedEnvironmentPlatform => {
  if (process.platform === 'win32') return 'windows'
  if (process.platform === 'darwin') return 'macos'
  return 'linux'
}

export const resolvePlatformCommand = (
  command: PlatformCommand | LocalEnvironmentAction,
  platform: SupportedEnvironmentPlatform,
) => command[platform] ?? ('script' in command ? command.script : command.command)
