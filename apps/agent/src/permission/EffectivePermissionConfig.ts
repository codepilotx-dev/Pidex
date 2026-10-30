import { isReadOnlyTaskMode, type PermissionConfig } from '@pidex/shared/thread'
import type { TaskMode } from '../Domain'

/**
 * Plan and Grill are hard runtime ceilings, independent of the thread's saved
 * baseline: requirements are settled before any code or external state changes.
 */
export const resolveEffectivePermissionConfig = (
  taskMode: TaskMode,
  configured: PermissionConfig,
): PermissionConfig =>
  isReadOnlyTaskMode(taskMode)
    ? {
        ...configured,
        sandboxMode: 'read-only',
        approvalPolicy:
          configured.approvalPolicy === 'on-failure' ? 'on-request' : configured.approvalPolicy,
      }
    : configured
