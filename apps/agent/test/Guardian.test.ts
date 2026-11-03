import { describe, expect, test } from 'bun:test'
import type { ToolInvocation } from '../src/Domain'
import {
  applyGuardianPolicy,
  GuardianCircuitBreaker,
  guardianActionHash,
  guardianActionSensitivity,
  guardianFallbackDecision,
  guardianFastPathEligible,
  guardianReview,
  guardianScopeClass,
  guardianVerdictSchema,
  shouldScoreGuardianAction,
} from '../src/permission/Guardian'

const verdict = (overrides: Record<string, unknown> = {}) =>
  guardianVerdictSchema.parse({
    decision: 'allow',
    risk: 'low',
    user_authorization: 'high',
    confidence: 'high',
    categories: [],
    requested_scope_valid: true,
    reason: '常规操作',
    ...overrides,
  })

const invocation = (overrides: Record<string, unknown> = {}) =>
  ({
    id: 'tool-1',
    threadID: 'thread-1',
    turnID: 'turn-1',
    agentID: 'agent-1',
    name: 'Bash',
    input: { command: 'npm test' },
    permissionConfig: {
      sandboxMode: 'workspace-write',
      approvalPolicy: 'on-request',
      approvalsReviewer: 'auto_review',
    },
    taskMode: 'chat',
    toolPolicy: {
      capabilities: { filesystem: 'none', network: 'none', process: true },
    },
    ...overrides,
  }) as unknown as ToolInvocation

describe('Guardian policy', () => {
  test('critical risk is never auto-approved', () => {
    expect(
      applyGuardianPolicy({
        verdict: verdict({ risk: 'critical', user_authorization: 'high' }),
        staticRisk: 'critical',
        staticCategories: ['destructive'],
        retryAuthorized: true,
      }),
    ).toMatchObject({ decision: 'deny', risk: 'critical' })
  })

  test('high risk requires at least medium authorization', () => {
    expect(
      applyGuardianPolicy({
        verdict: verdict({ risk: 'high', user_authorization: 'low' }),
        staticRisk: 'low',
        staticCategories: [],
        retryAuthorized: false,
      }),
    ).toMatchObject({ decision: 'deny', risk: 'high' })
    expect(
      applyGuardianPolicy({
        verdict: verdict({ risk: 'high', user_authorization: 'medium' }),
        staticRisk: 'low',
        staticCategories: [],
        retryAuthorized: false,
      }),
    ).toMatchObject({ decision: 'allow', risk: 'high' })
  })

  test('low risk can pass without explicit authorization, medium risk cannot', () => {
    expect(
      applyGuardianPolicy({
        verdict: verdict({ risk: 'low', user_authorization: 'unknown' }),
        staticRisk: 'low',
        staticCategories: [],
        retryAuthorized: false,
      }),
    ).toMatchObject({ decision: 'allow' })
    expect(
      applyGuardianPolicy({
        verdict: verdict({ risk: 'medium', user_authorization: 'unknown' }),
        staticRisk: 'low',
        staticCategories: [],
        retryAuthorized: false,
      }),
    ).toMatchObject({ decision: 'ask' })
  })

  test('low confidence allow degrades to ask and invalid scope denies', () => {
    expect(
      applyGuardianPolicy({
        verdict: verdict({ confidence: 'medium', risk: 'medium', user_authorization: 'high' }),
        staticRisk: 'low',
        staticCategories: [],
        retryAuthorized: false,
      }),
    ).toMatchObject({ decision: 'ask' })
    expect(
      applyGuardianPolicy({
        verdict: verdict({ requested_scope_valid: false }),
        staticRisk: 'low',
        staticCategories: [],
        retryAuthorized: false,
      }),
    ).toMatchObject({ decision: 'deny' })
  })
})

describe('Guardian circuit breaker', () => {
  test('opens after three consecutive denials and resets on a non-denial', () => {
    const breaker = new GuardianCircuitBreaker()
    expect(breaker.record('t', 'turn', 'deny').tripped).toBe(false)
    expect(breaker.record('t', 'turn', 'deny').tripped).toBe(false)
    expect(breaker.record('t', 'turn', 'deny').tripped).toBe(true)
    expect(breaker.check('t', 'turn').open).toBe(true)
    breaker.record('t', 'turn2', 'allow')
    expect(breaker.check('t', 'turn2').open).toBe(false)
  })

  test('a new turn starts with a closed circuit', () => {
    const breaker = new GuardianCircuitBreaker()
    breaker.record('t', 'turn-1', 'deny')
    breaker.record('t', 'turn-1', 'deny')
    breaker.record('t', 'turn-1', 'deny')
    expect(breaker.check('t', 'turn-1').open).toBe(true)
    expect(breaker.check('t', 'turn-2').open).toBe(false)
  })
})

describe('Guardian action identity', () => {
  test('stable hash ignores object key order', () => {
    const first = invocation({ input: { command: 'npm test', cwd: '/repo' } })
    const second = invocation({ input: { cwd: '/repo', command: 'npm test' } })
    expect(guardianActionHash(first)).toBe(guardianActionHash(second))
  })

  test('scope-bound hashing survives the reviewer input rewrite', () => {
    const scope = {
      affectedPaths: [{ path: 'src/a.ts', operation: 'update' as const }],
      fingerprint: 'scope-fingerprint',
      ruleRequiresApproval: true,
    }
    const original = invocation({ authorizationScope: scope })
    const rewritten = invocation({
      authorizationScope: scope,
      input: {
        patchHash: scope.fingerprint,
        affectedPaths: scope.affectedPaths,
        summary: null,
      },
    })
    expect(guardianActionHash(original)).toBe(guardianActionHash(rewritten))
  })

  test('read-only tools stay off the fast path', () => {
    expect(
      guardianFastPathEligible(
        invocation({
          name: 'Read',
          toolPolicy: { capabilities: { filesystem: 'read', network: 'none', process: false } },
        }),
      ),
    ).toBe(false)
    expect(guardianFastPathEligible(invocation({ input: { command: 'git status' } }))).toBe(true)
    expect(guardianFastPathEligible(invocation())).toBe(false)
    expect(
      guardianFastPathEligible(
        invocation({
          permissionConfig: {
            sandboxMode: 'workspace-write',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'user',
          },
        }),
      ),
    ).toBe(false)
    expect(shouldScoreGuardianAction(invocation({ input: { command: 'git status' } }))).toBe(
      guardianFastPathEligible(invocation({ input: { command: 'git status' } })),
    )
  })

  test('the fast path is excluded for user intent and elevated surfaces', () => {
    const benign = invocation({ input: { command: 'git status' } })
    expect(guardianFastPathEligible(benign)).toBe(true)
    // Newly requested permissions are an elevation.
    expect(
      guardianFastPathEligible(
        invocation({
          input: {
            command: 'git status',
            additionalPermissions: { writePaths: ['C:\\outside'] },
          },
        }),
      ),
    ).toBe(false)
    // Forced approvals from hooks, skills, rules or host-confirmed grants.
    for (const permissionFacts of [
      { hookRequiresApproval: true },
      { skillScript: true },
      { ruleRequiresApproval: true },
      { denyReason: 'hard deny' },
      { approvalCategories: ['rules'] as const },
      { forcedApproval: true },
      { ruleEffect: 'ask' as const },
      { ruleEffect: 'deny' as const },
      { ruleIDs: ['rule-1'] },
    ]) {
      expect(guardianFastPathEligible(invocation({ permissionFacts }))).toBe(false)
    }
    // Protected resources.
    expect(guardianFastPathEligible(invocation({ grantsForbidden: true }))).toBe(false)
    // Ask rules and host-confirmed computer grants live on the authorization scope.
    expect(
      guardianFastPathEligible(
        invocation({
          authorizationScope: {
            affectedPaths: [],
            fingerprint: 'scope',
            ruleRequiresApproval: true,
          },
        }),
      ),
    ).toBe(false)
    expect(
      guardianFastPathEligible(
        invocation({
          authorizationScope: {
            affectedPaths: [],
            fingerprint: 'scope',
            ruleRequiresApproval: true,
            computerApp: { name: 'App', allowPersistentApproval: false },
          },
        }),
      ),
    ).toBe(false)
    // Always-review tools, resumed SDK preflights and human-authorized retries.
    expect(
      guardianFastPathEligible(
        invocation({
          toolPolicy: {
            capabilities: { filesystem: 'none', network: 'none', process: true },
            approvalStrategy: 'always-review',
          },
        }),
      ),
    ).toBe(false)
    expect(guardianFastPathEligible(invocation({ durableApproval: true }))).toBe(false)
    expect(
      guardianFastPathEligible(
        invocation({ retryAuthorization: { reviewId: 'review-1', fingerprint: 'fp' } }),
      ),
    ).toBe(false)
    // Stricter approval policies keep the synchronous decision path.
    for (const approvalPolicy of ['never', 'untrusted', { type: 'granular' } as const]) {
      expect(
        guardianFastPathEligible(
          invocation({
            permissionConfig: {
              sandboxMode: 'workspace-write',
              approvalPolicy,
              approvalsReviewer: 'auto_review',
            },
          }),
        ),
      ).toBe(false)
    }
    // Full access and request_permissions are never auto-approved.
    expect(
      guardianFastPathEligible(
        invocation({
          permissionConfig: {
            sandboxMode: 'danger-full-access',
            approvalPolicy: 'on-request',
            approvalsReviewer: 'auto_review',
          },
        }),
      ),
    ).toBe(false)
    expect(
      guardianFastPathEligible(
        invocation({
          name: 'request_permissions',
          permissionFacts: { approvalCategories: ['requestPermissions'] },
        }),
      ),
    ).toBe(false)
  })

  test('trajectory reuse is limited to benign shell and read actions', () => {
    expect(guardianScopeClass(invocation())).toBe('shell')
    expect(
      guardianScopeClass(
        invocation({
          name: 'Write',
          toolPolicy: {
            capabilities: { filesystem: 'workspace-write', network: 'none', process: false },
          },
        }),
      ),
    ).toBe('file-write')
    expect(guardianActionSensitivity(invocation())).toEqual({
      scope: 'shell',
      sensitive: true,
    })
    expect(guardianActionSensitivity(invocation({ input: { command: 'git status' } }))).toEqual({
      scope: 'shell',
      sensitive: false,
    })
    expect(
      guardianActionSensitivity(invocation({ input: { command: 'git push --force' } })),
    ).toEqual({ scope: 'shell', sensitive: true })
    expect(
      guardianActionSensitivity(
        invocation({
          name: 'Write',
          input: { file_path: 'src/a.ts' },
          toolPolicy: {
            capabilities: { filesystem: 'workspace-write', network: 'none', process: false },
          },
        }),
      ),
    ).toEqual({ scope: 'file-write', sensitive: true })
  })
})

describe('Guardian fallback policy', () => {
  const fallback = (overrides: Record<string, unknown> = {}) =>
    guardianFallbackDecision({
      risk: 'high',
      status: 'unavailable',
      reason: 'Guardian 不可用',
      approvalPolicy: 'on-request',
      ...overrides,
    })

  test('on-request degrades to a human question, never to an allow', () => {
    expect(fallback()).toMatchObject({
      decision: 'ask',
      fallbackReason: 'Guardian 不可用',
      guardian: { status: 'unavailable', source: 'fallback', risk: 'high' },
    })
  })

  test('never and untrusted deny instead of waiting for approval', () => {
    expect(fallback({ approvalPolicy: 'never' })).toMatchObject({ decision: 'deny' })
    expect(fallback({ approvalPolicy: 'untrusted' })).toMatchObject({ decision: 'deny' })
  })

  test('an open circuit denies even under on-request', () => {
    expect(fallback({ status: 'circuit_open', reason: '本轮已中断' })).toMatchObject({
      decision: 'deny',
      reason: '本轮已中断',
    })
  })

  test('granular policies deny disabled approval categories and ask otherwise', () => {
    const policy = {
      type: 'granular' as const,
      sandboxApproval: true,
      rules: false,
      skillApproval: true,
      requestPermissions: true,
      mcpTools: true,
      mcpElicitations: true,
    }
    expect(
      fallback({ approvalPolicy: policy, approvalCategories: ['sandboxApproval'] }),
    ).toMatchObject({ decision: 'ask' })
    expect(fallback({ approvalPolicy: policy, approvalCategories: ['rules'] })).toMatchObject({
      decision: 'deny',
    })
    // Without host-derived categories we cannot prove the category is enabled,
    // so we fail closed to a human question instead of denying outright.
    expect(fallback({ approvalPolicy: policy })).toMatchObject({ decision: 'ask' })
  })
})

describe('Guardian review metadata', () => {
  test('carries the authorization snapshot used for the verdict', () => {
    expect(
      guardianReview({
        status: 'completed',
        source: 'model',
        risk: 'low',
        userAuthorization: 'high',
        confidence: 'high',
        categories: [],
        rationale: 'ok',
        authorizationVersion: 'version-1',
      }),
    ).toMatchObject({ authorizationVersion: 'version-1' })
  })
})
