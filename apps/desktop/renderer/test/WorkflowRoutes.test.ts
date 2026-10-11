import { describe, expect, test } from 'bun:test'
import { legacyWorkflowRedirectPath } from '../src/features/routing/WorkflowRoutes.js'

describe('legacy workflow redirect', () => {
  test('保留所选 Workflow 标识', () => {
    expect(legacyWorkflowRedirectPath('/session-groups/workflow%3A1', '')).toBe(
      '/workflows/workflow%3A1',
    )
  })

  test('保留 query', () => {
    expect(legacyWorkflowRedirectPath('/session-groups', '?tab=context&from=deep-link')).toBe(
      '/workflows?tab=context&from=deep-link',
    )
  })

  test('同时保留标识与 query', () => {
    expect(legacyWorkflowRedirectPath('/session-groups/workflow%3A1', '?step=3')).toBe(
      '/workflows/workflow%3A1?step=3',
    )
  })

  test('不误改其他路径', () => {
    expect(legacyWorkflowRedirectPath('/threads/thread%3A1', '?x=1')).toBe(
      '/threads/thread%3A1?x=1',
    )
  })
})
