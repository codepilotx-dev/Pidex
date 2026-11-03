import type { PermissionConfig } from '@pidex/shared/thread'
import type { TaskMode } from '../Domain'

/**
 * Collaboration modes constrain task behavior: Plan and Grill must investigate
 * instead of implementing. They do not replace the user's file-access scope or
 * approval policy. A mode-specific read-only rewrite would silently change the
 * configured preset, so the effective config is exactly the stored config;
 * mutation is still blocked by tool exposure and the final execution gate.
 */
export const resolveEffectivePermissionConfig = (
  _taskMode: TaskMode,
  configured: PermissionConfig,
): PermissionConfig => configured
