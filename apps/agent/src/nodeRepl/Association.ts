/**
 * Trusted host-managed MCP associations.
 *
 * The host owns this mapping. A plugin manifest may only *declare* a component;
 * it can never grant itself a host-provided server. Only the official bundled
 * plugin receives the computer-control bridge, and a third-party manifest that
 * declares the same server name is ignored.
 */
export const NODE_REPL_SERVER_NAME = 'node_repl'
export const NODE_REPL_PLUGIN_ID = 'computer-use'
export const NODE_REPL_TOOL_NAME = `mcp__${NODE_REPL_SERVER_NAME}__js`

export type HostManagedMcpDeclaration = {
  server: string
  title: string
  description: string
}

const ASSOCIATIONS: Record<string, readonly HostManagedMcpDeclaration[]> = {
  [NODE_REPL_PLUGIN_ID]: [
    {
      server: NODE_REPL_SERVER_NAME,
      title: 'Node REPL',
      description: '宿主提供的 JavaScript 执行入口，电脑控制只通过它调用。',
    },
  ],
}

/** Declarations a plugin is allowed to surface, keyed on trusted source and id. */
export const hostManagedMcpDeclarations = (
  pluginId: string,
  source: string,
): readonly HostManagedMcpDeclaration[] =>
  source === 'bundled' ? (ASSOCIATIONS[pluginId] ?? []) : []

/** True only when the host association says this plugin owns this server. */
export const isTrustedHostMcpServer = (pluginId: string, source: string, server: string) =>
  hostManagedMcpDeclarations(pluginId, source).some((entry) => entry.server === server)
