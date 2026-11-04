import { describe, expect, test } from 'bun:test'
import { resolveSubagentRole } from '../src/features/session/subagents/SubagentRole.js'

describe('subagent role resolution', () => {
  test('explicit role always wins, including explicit general', () => {
    expect(resolveSubagentRole({ role: 'backend', displayName: 'Frontend', task: 'test' })).toBe(
      'backend',
    )
    expect(resolveSubagentRole({ role: 'general', displayName: 'Frontend', task: 'UI 组件' })).toBe(
      'general',
    )
  })

  test('displayName wins over task', () => {
    expect(resolveSubagentRole({ displayName: 'Frontend', task: '调用 API 并补测试' })).toBe(
      'frontend',
    )
  })

  test('falls back to task keywords, then general', () => {
    expect(resolveSubagentRole({ displayName: 'Agent 3', task: '整理项目文档' })).toBe('docs')
    // 固定顺序中 devops（发布）先于 docs（文档）。
    expect(resolveSubagentRole({ displayName: 'Agent 3', task: '整理发布文档' })).toBe('devops')
    expect(resolveSubagentRole({ displayName: 'Agent 3', task: '随便看看' })).toBe('general')
    expect(resolveSubagentRole({})).toBe('general')
  })

  test('applies the fixed conflict order inside one field', () => {
    // 任务同时命中前端与测试：qa 在固定顺序中优先于 frontend。
    expect(resolveSubagentRole({ displayName: 'Worker 1', task: '前端调用 API 并补测试' })).toBe(
      'qa',
    )
  })

  test('matches case-insensitively with word boundaries', () => {
    expect(resolveSubagentRole({ task: 'REACT 组件重构' })).toBe('frontend')
    // build 不应命中 ui；specification 不应命中 ci / spec。
    expect(resolveSubagentRole({ task: 'build the project' })).toBe('general')
    expect(resolveSubagentRole({ task: 'write the specification' })).toBe('general')
    // 短词需独立成词。
    expect(resolveSubagentRole({ task: 'tune the DB indexes' })).toBe('backend')
    expect(resolveSubagentRole({ task: 'dbx tooling' })).toBe('general')
    // 允许连字符与下划线分隔。
    expect(resolveSubagentRole({ task: 'own the front-end shell' })).toBe('frontend')
  })

  test('does not treat explorer or worker as functional roles', () => {
    expect(resolveSubagentRole({ displayName: 'Explorer 2' })).toBe('general')
    expect(resolveSubagentRole({ displayName: 'Worker 1' })).toBe('general')
  })
})
