import { ComputerHostRpcMethods } from './Computer'
import { BrowserHostRpcMethods } from './Browser'
import { RpcMethods } from './index'
import { TerminalRpcMethods } from './Terminal'
import { LocalEnvironmentHostRpcMethods } from './LocalEnvironment'

export const HostRpcMethods = {
  ...ComputerHostRpcMethods,
  ...BrowserHostRpcMethods,
  ...TerminalRpcMethods,
  ...LocalEnvironmentHostRpcMethods,
} as const

/** Server-only runtime method table. Renderer clients must use RpcMethods. */
export const AllRpcMethods = {
  ...RpcMethods,
  ...HostRpcMethods,
} as const
