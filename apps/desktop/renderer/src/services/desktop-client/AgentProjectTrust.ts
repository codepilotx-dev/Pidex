import type { Project } from '@pidex/shared'
import type { createAgentRpcClient } from '../AgentRpcClient.js'

type Dependencies = {
  rpc: Pick<ReturnType<typeof createAgentRpcClient>, 'call'>
}

export function createAgentProjectTrust({ rpc }: Dependencies) {
  const trustedPaths = new Set<string>()

  return {
    async ensure(project: Project): Promise<Project> {
      for (const { availability, path } of project.folders) {
        if (availability !== 'available' || trustedPaths.has(path)) continue
        const trust = await rpc.call('project/trust/read', { cwd: path })
        if (trust.trustLevel === 'untrusted') {
          await rpc.call('project/trust/update', {
            cwd: path,
            trustLevel: 'trusted',
          })
        }
        trustedPaths.add(path)
      }
      return project
    },
    clear(): void {
      trustedPaths.clear()
    },
  }
}
