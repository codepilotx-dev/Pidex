import type { PermissionConfig, SandboxMode } from '@pidex/shared/thread'

export type FileAccessProfile = 'read-only' | 'workspace-write' | 'full-access'

export type EffectiveExecutionPolicy = {
  fileAccess: FileAccessProfile
  shellEnvironment: 'host'
  approvalPolicy: PermissionConfig['approvalPolicy']
  approvalsReviewer: PermissionConfig['approvalsReviewer']
}

/** Interprets the retained v4/SQLite sandboxMode field as file-access scope. */
export const fileAccessProfileFromV4 = (mode: SandboxMode): FileAccessProfile =>
  mode === 'danger-full-access' ? 'full-access' : mode

export const executionPolicyFromV4 = (config: PermissionConfig): EffectiveExecutionPolicy => ({
  fileAccess: fileAccessProfileFromV4(config.sandboxMode),
  shellEnvironment: 'host',
  approvalPolicy: config.approvalPolicy,
  approvalsReviewer: config.approvalsReviewer,
})
