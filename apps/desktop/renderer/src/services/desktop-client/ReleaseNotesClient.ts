import type { RpcParams, RpcResult } from '@pidex/agent-protocol'
import type { createAgentRpcClient } from '../AgentRpcClient.js'

type AgentRpcCaller = Pick<ReturnType<typeof createAgentRpcClient>, 'call'>

export function listAgentReleaseNotes(
  rpc: AgentRpcCaller,
  currentVersion: string,
  refresh = false,
): Promise<RpcResult<'release-notes/list'>> {
  const params: RpcParams<'release-notes/list'> = {
    currentVersion,
    ...(refresh ? { refresh: true } : {}),
  }
  return rpc.call('release-notes/list', params)
}

export function mockReleaseNotes(currentVersion: string): RpcResult<'release-notes/list'> {
  return {
    source: 'github-releases',
    repository: 'codepilotx-dev/Pidex',
    currentVersion,
    currentReleaseFound: true,
    fetchedAt: '2026-07-27T00:00:00.000Z',
    truncated: false,
    releases: [
      {
        tagName: `v${currentVersion}`,
        name: `Pidex ${currentVersion}`,
        body: [
          '## 新特性',
          '',
          '- 新增从 GitHub Releases 查看当前版本及历史更新日志的页面。',
          '- 更新日志中的远程图片和应用内部指令保持禁用。',
        ].join('\n'),
        htmlUrl: `https://github.com/codepilotx-dev/Pidex/releases/tag/v${currentVersion}`,
        publishedAt: '2026-07-27T00:00:00.000Z',
        prerelease: currentVersion.includes('-'),
      },
      {
        tagName: 'v0.1.0',
        name: 'Pidex 0.1.0',
        body: '## 首个版本\n\n- 提供桌面会话、项目和设置等基础能力。',
        htmlUrl: 'https://github.com/codepilotx-dev/Pidex/releases/tag/v0.1.0',
        publishedAt: '2026-06-01T00:00:00.000Z',
        prerelease: false,
      },
    ],
  }
}
