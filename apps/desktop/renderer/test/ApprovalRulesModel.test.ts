import { describe, expect, test } from 'bun:test'
import type { PermissionRule } from '@pidex/shared/thread'
import {
  approvalRuleEditorValuesFromRule,
  approvalRuleScopeDescription,
  approvalRuleScopeOptions,
  applyApprovalRuleRevoke,
  applyApprovalRuleUpsert,
  buildApprovalRuleInput,
  canEditApprovalRule,
  countApprovalRulesByEffect,
  createApprovalRuleEditorValues,
  filterApprovalRules,
  isApprovalRuleVersionConflict,
} from '../src/features/session/approvals/ApprovalRulesModel.js'

function rule(
  overrides: Partial<PermissionRule> & Pick<PermissionRule, 'id' | 'effect' | 'match'>,
) {
  return {
    scope: 'chat',
    source: 'chat',
    editable: true,
    ...overrides,
  } as PermissionRule
}

const rules: PermissionRule[] = [
  rule({
    id: 'allow-tool',
    effect: 'allow',
    match: { kind: 'tool', tool: 'Bash' },
    version: '1',
  }),
  rule({
    id: 'ask-network',
    effect: 'ask',
    scope: 'user',
    source: 'user',
    match: { kind: 'network', domain: 'example.com' },
    version: 'user:2',
  }),
  rule({
    id: 'deny-command',
    effect: 'deny',
    scope: 'project',
    source: 'project',
    match: { kind: 'command', command: 'git push', argv: ['git', 'push'] },
    version: 'project:3',
  }),
  rule({
    id: 'legacy-mcp',
    effect: 'allow',
    match: { kind: 'mcp', server: 'filesystem', tool: 'read_file' },
    source: 'legacy',
    editable: true,
  }),
]

describe('approval rule dialog state transitions', () => {
  test('groups rules by Allow/Ask/Deny tabs and filters with search', () => {
    expect(filterApprovalRules(rules, 'allow', '').map((entry) => entry.id)).toEqual([
      'allow-tool',
      'legacy-mcp',
    ])
    expect(filterApprovalRules(rules, 'ask', '').map((entry) => entry.id)).toEqual(['ask-network'])
    expect(filterApprovalRules(rules, 'deny', '').map((entry) => entry.id)).toEqual([
      'deny-command',
    ])
    expect(filterApprovalRules(rules, 'ask', 'example').map((entry) => entry.id)).toEqual([
      'ask-network',
    ])
    expect(filterApprovalRules(rules, 'deny', 'git push').map((entry) => entry.id)).toEqual([
      'deny-command',
    ])
    expect(filterApprovalRules(rules, 'allow', 'filesystem read')).toHaveLength(1)
    expect(filterApprovalRules(rules, 'deny', 'example')).toHaveLength(0)
    expect(countApprovalRulesByEffect(rules)).toEqual({ allow: 2, ask: 1, deny: 1 })
  })

  test('new rules default to the current chat and project scope needs a project chat', () => {
    expect(createApprovalRuleEditorValues('allow').scope).toBe('chat')
    expect(approvalRuleScopeOptions(false).map((option) => option.value)).toEqual(['chat', 'user'])
    expect(approvalRuleScopeOptions(true).map((option) => option.value)).toEqual([
      'chat',
      'user',
      'project',
    ])
    const projectValues = createApprovalRuleEditorValues('deny', {
      scope: 'project',
      matchKind: 'tool',
      tool: 'Bash',
    })
    expect(buildApprovalRuleInput(projectValues, { isProjectChat: false }).error).toContain(
      '不能创建项目规则',
    )
    const allowed = buildApprovalRuleInput(projectValues, { isProjectChat: true })
    expect(allowed.error).toBeNull()
    expect(allowed.input).toMatchObject({ effect: 'deny', scope: 'project' })
  })

  test('upsert replaces edited rules and prepends new ones; revoke removes', () => {
    const inserted = rule({
      id: 'new-deny',
      effect: 'deny',
      match: { kind: 'tool', tool: 'Write' },
    })
    const afterInsert = applyApprovalRuleUpsert(rules, inserted)
    expect(afterInsert[0]?.id).toBe('new-deny')
    expect(afterInsert).toHaveLength(rules.length + 1)

    const edited: PermissionRule = {
      ...rules[0]!,
      effect: 'deny',
      match: { kind: 'tool', tool: 'Bash' },
      version: '9',
    }
    const afterEdit = applyApprovalRuleUpsert(rules, edited)
    expect(afterEdit).toHaveLength(rules.length)
    expect(afterEdit.find((entry) => entry.id === 'allow-tool')).toMatchObject({
      effect: 'deny',
      version: '9',
    })

    const afterRevoke = applyApprovalRuleRevoke(rules, 'ask-network')
    expect(afterRevoke.map((entry) => entry.id)).not.toContain('ask-network')
    expect(afterRevoke).toHaveLength(rules.length - 1)
  })

  test('detects version conflicts from the wire error shapes', () => {
    expect(isApprovalRuleVersionConflict({ errorCode: 'CONFLICT' })).toBe(true)
    expect(isApprovalRuleVersionConflict({ data: { code: 'CONFLICT' } })).toBe(true)
    expect(isApprovalRuleVersionConflict(new Error('规则版本已变化，请刷新后重试'))).toBe(true)
    expect(isApprovalRuleVersionConflict(new Error('CONFLICT: 规则已被删除'))).toBe(true)
    expect(isApprovalRuleVersionConflict(new Error('网络错误'))).toBe(false)
    expect(isApprovalRuleVersionConflict(null)).toBe(false)
  })

  test('legacy grants display as allow/source legacy and stay revocable only', () => {
    const legacy = rules.find((entry) => entry.source === 'legacy')!
    expect(canEditApprovalRule(legacy)).toBe(false)
    expect(canEditApprovalRule(rules[0]!)).toBe(true)
    expect(approvalRuleScopeDescription(legacy)).toContain('旧授权')
    expect(approvalRuleScopeDescription(legacy)).toContain('仅可撤销')
  })
})

describe('approval rule editor conversion', () => {
  test('builds tool, file, network and MCP matches from editor values', () => {
    const tool = buildApprovalRuleInput(
      createApprovalRuleEditorValues('allow', { matchKind: 'tool', tool: 'Bash' }),
      { isProjectChat: false },
    )
    expect(tool.input).toEqual({
      effect: 'allow',
      scope: 'chat',
      match: { kind: 'tool', tool: 'Bash' },
    })

    const file = buildApprovalRuleInput(
      createApprovalRuleEditorValues('deny', {
        matchKind: 'file',
        fileAccess: 'read',
        filePath: 'C:\\repo',
      }),
      { isProjectChat: false },
    )
    expect(file.input?.match).toEqual({ kind: 'file', access: 'read', path: 'C:\\repo' })

    const relative = buildApprovalRuleInput(
      createApprovalRuleEditorValues('deny', {
        matchKind: 'file',
        filePath: 'relative/path',
      }),
      { isProjectChat: false },
    )
    expect(relative.error).toContain('绝对路径')

    const network = buildApprovalRuleInput(
      createApprovalRuleEditorValues('allow', {
        matchKind: 'network',
        domain: 'Example.COM',
      }),
      { isProjectChat: false },
    )
    expect(network.input?.match).toEqual({ kind: 'network', domain: 'example.com' })
    expect(
      buildApprovalRuleInput(
        createApprovalRuleEditorValues('allow', { matchKind: 'network', domain: '*.example.com' }),
        { isProjectChat: false },
      ).error,
    ).toContain('精确域名')

    const mcp = buildApprovalRuleInput(
      createApprovalRuleEditorValues('ask', { matchKind: 'mcp', mcpServer: 'filesystem' }),
      { isProjectChat: false },
    )
    expect(mcp.input?.match).toEqual({ kind: 'mcp', server: 'filesystem' })
    const mcpTool = buildApprovalRuleInput(
      createApprovalRuleEditorValues('ask', {
        matchKind: 'mcp',
        mcpServer: 'filesystem',
        mcpTool: 'read_file',
      }),
      { isProjectChat: false },
    )
    expect(mcpTool.input?.match).toEqual({
      kind: 'mcp',
      server: 'filesystem',
      tool: 'read_file',
    })
  })

  test('command rules support exact commands and explicit argv prefixes', () => {
    const exact = buildApprovalRuleInput(
      createApprovalRuleEditorValues('allow', {
        matchKind: 'command',
        command: '  git status  ',
        commandMode: 'exact',
      }),
      { isProjectChat: false },
    )
    expect(exact.input?.match).toEqual({ kind: 'command', command: 'git status' })

    const prefix = buildApprovalRuleInput(
      createApprovalRuleEditorValues('allow', {
        matchKind: 'command',
        command: 'git push',
        commandMode: 'prefix',
        argvText: 'git\npush\n',
      }),
      { isProjectChat: false },
    )
    expect(prefix.input?.match).toEqual({
      kind: 'command',
      command: 'git push',
      argv: ['git', 'push'],
    })

    const emptyArgv = buildApprovalRuleInput(
      createApprovalRuleEditorValues('allow', {
        matchKind: 'command',
        command: 'git push',
        commandMode: 'prefix',
        argvText: '\n\n',
      }),
      { isProjectChat: false },
    )
    expect(emptyArgv.error).toContain('参数前缀')
  })

  test('editing an existing rule preserves its identity and argv prefix', () => {
    const values = approvalRuleEditorValuesFromRule(rules[2]!)
    expect(values.effect).toBe('deny')
    expect(values.scope).toBe('project')
    expect(values.matchKind).toBe('command')
    expect(values.commandMode).toBe('prefix')
    expect(values.argvText).toBe('git\npush')
    const built = buildApprovalRuleInput(values, { id: rules[2]!.id, isProjectChat: true })
    expect(built.input).toMatchObject({
      id: 'deny-command',
      effect: 'deny',
      scope: 'project',
    })
  })
})

test('编辑精确命令时保留宿主绑定的执行目录', () => {
  const source = rule({
    id: 'cwd-rule',
    effect: 'allow',
    scope: 'project',
    source: 'project',
    match: { kind: 'command', command: 'bun run test', cwd: 'C:/projects/a' },
  })
  const values = approvalRuleEditorValuesFromRule(source)
  const result = buildApprovalRuleInput(values, { id: source.id, isProjectChat: true })
  expect(result.input?.match).toEqual(source.match)
})
