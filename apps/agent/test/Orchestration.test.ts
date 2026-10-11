import { afterEach, describe, expect, test } from 'bun:test'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { removeFixturePaths } from './FixtureCleanup'
import { Model, Provider } from '@pidex/model-schema'
import { AgentDatabase } from '../src/storage/database/AgentDatabase'
import { isMainAgentRequestUserInputEnabled } from '../src/orchestration/AgentRuntimeTypes'

const paths: string[] = []
afterEach(async () => removeFixturePaths(paths.splice(0)))

describe('单主 Agent 编排', () => {
  test('问题卡默认只在 Plan 调查阶段开放，设置开启后覆盖普通执行阶段', () => {
    expect(isMainAgentRequestUserInputEnabled({ taskMode: 'plan' })).toBe(true)
    expect(isMainAgentRequestUserInputEnabled({ taskMode: 'chat' })).toBe(false)
    expect(
      isMainAgentRequestUserInputEnabled({ taskMode: 'chat', defaultModeRequestUserInput: true }),
    ).toBe(true)
  })

  test('每个 Turn 只有一个 main 根 Agent，并复用线程级 Session', () => {
    const path = join(tmpdir(), `pidex-main-agent-${crypto.randomUUID()}.sqlite`)
    paths.push(path)
    const db = new AgentDatabase(path)
    const thread = db.createThread()
    const input = {
      content: '修复登录表单校验',
      model: Model.Ref.make({ providerID: Provider.ID.make('openai'), id: Model.ID.make('gpt-5') }),
      permissionConfig: {
        sandboxMode: 'workspace-write',
        approvalPolicy: 'on-request',
        approvalsReviewer: 'user',
      },
      strategy: 'queue',
      taskMode: 'chat',
    } as const
    const first = db.createTurn(thread.id, input)
    const second = db.createTurn(thread.id, { ...input, content: '继续修复' })

    const agents = db.sqlite
      .query(
        'SELECT id, turn_id, parent_agent_id, profile, session_id, depth FROM agent_executions ORDER BY created_at',
      )
      .all()
    expect(agents).toEqual([
      {
        id: first.agentID,
        turn_id: first.turnID,
        parent_agent_id: null,
        profile: 'main',
        session_id: `${thread.id}:main`,
        depth: 0,
      },
      {
        id: second.agentID,
        turn_id: second.turnID,
        parent_agent_id: null,
        profile: 'main',
        session_id: `${thread.id}:main`,
        depth: 0,
      },
    ])
    expect(db.claimTurnExecution(first.turnID)?.id).toBe(first.agentID)
    expect(db.claimTurnExecution(first.turnID)).toBeNull()
    db.close()
  })
})
