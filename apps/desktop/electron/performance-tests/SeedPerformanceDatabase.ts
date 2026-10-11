import { DEFAULT_PERMISSION_CONFIG } from '@pidex/shared/thread'
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { tmpdir } from 'node:os'
import { AgentDatabase } from '../../../agent/src/storage/database/AgentDatabase.js'

const dataDirectory = resolve(process.argv[2] ?? '')
const metadataPath = resolve(process.argv[3] ?? '')
const normalizedTemp = resolve(tmpdir()).toLowerCase()
if (
  !dataDirectory.toLowerCase().startsWith(normalizedTemp) ||
  !dataDirectory.includes('pidex-electron-performance-')
) {
  throw new Error('Performance fixture must be created under an isolated temp directory')
}
if (!metadataPath.toLowerCase().startsWith(dataDirectory.toLowerCase())) {
  throw new Error('Performance fixture metadata must remain inside its temp directory')
}

await mkdir(dataDirectory, { recursive: true })
const database = new AgentDatabase({
  historyPath: join(dataDirectory, 'history.sqlite'),
  profilePath: join(dataDirectory, 'profile.sqlite'),
})
const model = {
  providerID: 'openai',
  id: 'performance-fixture',
} as never
const threadIds: string[] = []

try {
  for (let sessionIndex = 0; sessionIndex < 100; sessionIndex += 1) {
    const workspaceRoot = join(
      dataDirectory,
      'performance-workspaces',
      `session-${String(sessionIndex + 1).padStart(3, '0')}`,
    )
    const cwd = join(workspaceRoot, 'work')
    const outputDirectory = join(workspaceRoot, 'outputs')
    await mkdir(cwd, { recursive: true })
    await mkdir(outputDirectory, { recursive: true })
    const thread = database.createThread({
      title: `性能会话 ${String(sessionIndex + 1).padStart(3, '0')}`,
      workspace: {
        kind: 'projectless',
        workspaceRoot,
        cwd,
        outputDirectory,
      },
    })
    threadIds.push(thread.id)
    const turnCount = sessionIndex === 0 ? 500 : 10
    for (let turnIndex = 0; turnIndex < turnCount; turnIndex += 1) {
      const turn = database.createTurn(
        thread.id,
        {
          content: `第 ${turnIndex + 1} 轮：检查真实 Electron 性能路径 ` + `${sessionIndex + 1}。`,
          model,
          permissionConfig: DEFAULT_PERMISSION_CONFIG,
          strategy: 'queue',
          taskMode: 'chat',
        },
        'completed',
      )
      database.upsertItemWithEvent(
        thread.id,
        {
          id: `${turn.turnID}:assistant`,
          turnID: turn.turnID,
          agentID: turn.agentID,
          type: 'text',
          status: 'completed',
          data: {
            placement: 'result',
            text:
              `会话 ${sessionIndex + 1} 的第 ${turnIndex + 1} 轮完成。\n\n` +
              '- 固定的 Electron 性能数据\n- 不访问真实用户目录',
          },
          createdAt: Date.now(),
          updatedAt: Date.now(),
        },
        'item/completed',
      )
      database.updateTurnStatus(turn.turnID, 'completed')
    }
  }
} finally {
  database.close()
}

await Bun.write(
  metadataPath,
  `${JSON.stringify({ primaryThreadId: threadIds[0], threadIds }, null, 2)}\n`,
)
