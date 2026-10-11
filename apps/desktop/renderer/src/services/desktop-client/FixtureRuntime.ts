// Small stateless Browser Mock fallbacks shared with the Agent client. Keep
// these separate from FixtureShared.ts so Electron startup does not parse the
// much larger mock thread-history projection.
import type {
  DesktopAuthStatus,
  DesktopPermissionMode,
  DesktopRuntimeStatus,
} from '../../../shared/Types.js'
import type { PermissionConfig } from '@pidex/shared/thread'
import { permissionModeFromPermissionConfig } from '../AgentThreadAdapter.js'

export function permissionModeFromDesktopConfig(config: PermissionConfig): DesktopPermissionMode {
  return permissionModeFromPermissionConfig(config)
}

export function mockRuntimeStatus(): DesktopRuntimeStatus {
  return {
    runtimeKind: 'rust-sidecar',
    runtimePreference: 'auto',
    runtimeSelectionSource: 'default',
    agentExecutablePath: '',
    agentExecutableExists: false,
    configDirectoryPath: '',
    toolchainEnabled: true,
    toolchainRoot: null,
    managedToolchainRoot: '',
    packagedToolchainRoot: '',
    toolchainPathEntries: [],
    toolchainBinaries: [],
  }
}

export function mockAuthStatus(): DesktopAuthStatus {
  return {
    authenticated: false,
    method: 'none',
    email: null,
    organizationName: null,
  }
}

export async function bridgeWindowMaximized(): Promise<boolean> {
  return (await window.DesktopBridge?.isMaximized()) ?? false
}
