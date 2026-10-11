export const SIDECAR_CONNECT_STAGES = [
  'select-connection',
  'managed-origin',
  'managed-ready',
  'resolve-command',
  'resolve-environment',
  'spawn-process',
  'close-stdin',
  'await-ready-message',
  'probe-ready',
  'validate-connection',
] as const

export type SidecarConnectStage = (typeof SIDECAR_CONNECT_STAGES)[number]

export class SidecarTerminationError extends Error {
  readonly code = 'SIDECAR_TERMINATION_UNCONFIRMED'

  constructor() {
    super('无法确认旧 Agent 进程已经退出')
    this.name = 'SidecarTerminationError'
  }
}

export const SIDECAR_FAILURE_CODES = [
  'E2BIG',
  'EACCES',
  'EINVAL',
  'ENAMETOOLONG',
  'ENOENT',
  'ENOMEM',
  'EPERM',
  'ERR_INVALID_ARG_TYPE',
  'ERR_INVALID_ARG_VALUE',
  'ERR_INVALID_URL',
] as const

export type SidecarFailureCode = (typeof SIDECAR_FAILURE_CODES)[number]

const stageSet = new Set<string>(SIDECAR_CONNECT_STAGES)
const failureCodeSet = new Set<string>(SIDECAR_FAILURE_CODES)

export function isSidecarConnectStage(value: unknown): value is SidecarConnectStage {
  return typeof value === 'string' && stageSet.has(value)
}

export function isSidecarFailureCode(value: unknown): value is SidecarFailureCode {
  return typeof value === 'string' && failureCodeSet.has(value)
}

export function readSidecarFailureCode(error: unknown): SidecarFailureCode | 'unknown' {
  if (!error || typeof error !== 'object' || !('code' in error)) return 'unknown'
  return isSidecarFailureCode(error.code) ? error.code : 'unknown'
}
