import type { PermissionConfig } from '@pidex/shared/thread'
import type { TaskMode } from '../Domain'

/** Plan mode is a hard runtime ceiling, independent of the thread's saved baseline. */
export const resolveEffectivePermissionConfig = (
  taskMode: TaskMode,
  configured: PermissionConfig,
): PermissionConfig =>
  taskMode === 'plan'
    ? {
        ...configured,
        sandboxMode: 'read-only',
        approvalPolicy:
          configured.approvalPolicy === 'on-failure' ? 'on-request' : configured.approvalPolicy,
      }
    : configured
