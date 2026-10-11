import { describe, expect, test } from 'bun:test'
import { buildThreadDeepLink } from '@pidex/shared/thread-reference'
import {
  SESSION_REFERENCE_COPY_ERROR,
  SESSION_REFERENCE_SHORTCUTS,
  SESSION_REFERENCE_SHORTCUT_TARGET_SELECTOR,
  copySessionReference,
  copyThreadDeepLink,
  copyThreadId,
  copyWorkspaceCwd,
  isSessionReferenceShortcutTarget,
  resolveSessionReferenceShortcut,
  type SessionReferenceContext,
  type SessionReferenceCopyDeps,
  type SessionReferencePayload,
} from '../src/features/session/conversation/SessionReferenceActions.js'

type ShortcutEvent = {
  key: string
  code?: string
  ctrlKey: boolean
  metaKey: boolean
  altKey: boolean
  shiftKey: boolean
  repeat?: boolean
  defaultPrevented?: boolean
  isComposing?: boolean
  keyCode?: number
  target?: unknown
}

const CONTEXT: SessionReferenceContext = {
  workspaceCwd: 'F:\\repo\\project',
  threadId: 'session-123',
}

function plainTarget(): unknown {
  return { closest: () => null }
}

function zonedTarget(): unknown {
  return { closest: () => ({}) }
}

function pageKeydown(overrides: Partial<ShortcutEvent>): ShortcutEvent {
  const { target = plainTarget(), ...rest } = overrides
  return {
    key: 'c',
    ctrlKey: false,
    metaKey: false,
    altKey: false,
    shiftKey: false,
    ...rest,
    target,
  }
}

function depsWithWriter(writes: string[]): SessionReferenceCopyDeps {
  return {
    writeText: async (text) => {
      writes.push(text)
    },
    reportError: () => undefined,
  }
}

describe('frozen session reference shortcuts', () => {
  test('freezes exactly Ctrl+Shift+C, Ctrl+Alt+C, and Ctrl+Alt+L', () => {
    expect(SESSION_REFERENCE_SHORTCUTS).toEqual({
      workspaceCwd: 'Ctrl+Shift+C',
      threadId: 'Ctrl+Alt+C',
      threadDeepLink: 'Ctrl+Alt+L',
    })
  })
})

describe('resolveSessionReferenceShortcut', () => {
  test('matches each frozen shortcut on a plain page and resolves the raw context value', () => {
    expect(
      resolveSessionReferenceShortcut(
        pageKeydown({ ctrlKey: true, shiftKey: true, key: 'C' }),
        CONTEXT,
      ),
    ).toEqual({ kind: 'workspaceCwd', workspaceCwd: CONTEXT.workspaceCwd })
    expect(
      resolveSessionReferenceShortcut(pageKeydown({ ctrlKey: true, altKey: true }), CONTEXT),
    ).toEqual({ kind: 'threadId', threadId: CONTEXT.threadId })
    expect(
      resolveSessionReferenceShortcut(
        pageKeydown({ ctrlKey: true, altKey: true, key: 'l' }),
        CONTEXT,
      ),
    ).toEqual({ kind: 'threadDeepLink', threadId: CONTEXT.threadId })
  })

  test('rejects other keys and modifier combinations', () => {
    expect(resolveSessionReferenceShortcut(pageKeydown({ ctrlKey: true }), CONTEXT)).toBeNull()
    expect(
      resolveSessionReferenceShortcut(
        pageKeydown({ ctrlKey: true, shiftKey: true, key: 'l' }),
        CONTEXT,
      ),
    ).toBeNull()
    expect(
      resolveSessionReferenceShortcut(
        pageKeydown({ ctrlKey: true, altKey: true, key: 'd' }),
        CONTEXT,
      ),
    ).toBeNull()
    expect(resolveSessionReferenceShortcut(pageKeydown({ altKey: true }), CONTEXT)).toBeNull()
    expect(
      resolveSessionReferenceShortcut(
        pageKeydown({ ctrlKey: true, shiftKey: true, altKey: true }),
        CONTEXT,
      ),
    ).toBeNull()
  })

  test('respects the platform modifier boundary and never matches meta-only or ctrl+meta', () => {
    expect(
      resolveSessionReferenceShortcut(pageKeydown({ metaKey: true, shiftKey: true }), CONTEXT),
    ).toBeNull()
    expect(
      resolveSessionReferenceShortcut(pageKeydown({ metaKey: true, altKey: true }), CONTEXT),
    ).toBeNull()
    expect(
      resolveSessionReferenceShortcut(
        pageKeydown({ ctrlKey: true, metaKey: true, shiftKey: true }),
        CONTEXT,
      ),
    ).toBeNull()
    expect(
      resolveSessionReferenceShortcut(
        pageKeydown({ ctrlKey: true, metaKey: true, altKey: true, key: 'l' }),
        CONTEXT,
      ),
    ).toBeNull()
  })

  test('ignores defaultPrevented, repeated, and IME composing keydowns', () => {
    const base = { ctrlKey: true, shiftKey: true }
    expect(
      resolveSessionReferenceShortcut(pageKeydown({ ...base, defaultPrevented: true }), CONTEXT),
    ).toBeNull()
    expect(
      resolveSessionReferenceShortcut(pageKeydown({ ...base, repeat: true }), CONTEXT),
    ).toBeNull()
    expect(
      resolveSessionReferenceShortcut(pageKeydown({ ...base, isComposing: true }), CONTEXT),
    ).toBeNull()
    expect(
      resolveSessionReferenceShortcut(pageKeydown({ ...base, keyCode: 229 }), CONTEXT),
    ).toBeNull()
  })

  test('does not intercept inside Composer, inputs, editors, terminals, or modals', () => {
    const zoneMarkers = [
      'input',
      'textarea',
      'select',
      '[contenteditable="true"]',
      '[role="combobox"]',
      '.cm-editor',
      '[data-terminal-keyboard-capture]',
      '[role="dialog"]',
    ]
    for (const marker of zoneMarkers) {
      expect(SESSION_REFERENCE_SHORTCUT_TARGET_SELECTOR).toContain(marker)
    }
    for (const marker of zoneMarkers) {
      const resolved = resolveSessionReferenceShortcut(
        pageKeydown({
          ctrlKey: true,
          shiftKey: true,
          target: zonedTarget(),
        }),
        CONTEXT,
      )
      expect(resolved, `shortcut must not fire inside ${marker}`).toBeNull()
    }
    expect(isSessionReferenceShortcutTarget(zonedTarget())).toBe(true)
    expect(isSessionReferenceShortcutTarget(plainTarget())).toBe(false)
  })
})

describe('copy session reference actions', () => {
  test('writes the raw workspace and thread id plus the shared thread deep link', async () => {
    const writes: string[] = []
    const deps = depsWithWriter(writes)
    await copyWorkspaceCwd(CONTEXT.workspaceCwd, deps)
    await copyThreadId(CONTEXT.threadId, deps)
    await copyThreadDeepLink(CONTEXT.threadId, deps)
    expect(writes).toEqual([
      CONTEXT.workspaceCwd,
      CONTEXT.threadId,
      buildThreadDeepLink(CONTEXT.threadId),
    ])
  })

  test('menu actions and the shortcut resolver reuse the same copySessionReference action', async () => {
    const cases: Array<{
      run: (deps: SessionReferenceCopyDeps) => Promise<void>
      shortcut: ShortcutEvent
    }> = [
      {
        run: (deps) => copyWorkspaceCwd(CONTEXT.workspaceCwd, deps),
        shortcut: pageKeydown({ ctrlKey: true, shiftKey: true }),
      },
      {
        run: (deps) => copyThreadId(CONTEXT.threadId, deps),
        shortcut: pageKeydown({ ctrlKey: true, altKey: true }),
      },
      {
        run: (deps) => copyThreadDeepLink(CONTEXT.threadId, deps),
        shortcut: pageKeydown({ ctrlKey: true, altKey: true, key: 'l' }),
      },
    ]
    for (const { run, shortcut } of cases) {
      const resolved = resolveSessionReferenceShortcut(shortcut, CONTEXT)
      expect(resolved).not.toBeNull()
      const viaMenu: string[] = []
      const viaShortcut: string[] = []
      await run(depsWithWriter(viaMenu))
      await copySessionReference(resolved as SessionReferencePayload, depsWithWriter(viaShortcut))
      expect(viaMenu).toHaveLength(1)
      expect(viaShortcut).toEqual(viaMenu)
    }
  })

  test('reports a fixed safe error on clipboard failure without leaking the copied value', async () => {
    const cases: Array<{
      run: (deps: SessionReferenceCopyDeps) => Promise<void>
      copiedText: string
    }> = [
      {
        run: (deps) => copyWorkspaceCwd(CONTEXT.workspaceCwd, deps),
        copiedText: CONTEXT.workspaceCwd,
      },
      {
        run: (deps) => copyThreadId(CONTEXT.threadId, deps),
        copiedText: CONTEXT.threadId,
      },
      {
        run: (deps) => copyThreadDeepLink(CONTEXT.threadId, deps),
        copiedText: buildThreadDeepLink(CONTEXT.threadId),
      },
    ]
    for (const { run, copiedText } of cases) {
      const reports: unknown[] = []
      await run({
        writeText: async () => {
          throw new Error('clipboard denied')
        },
        reportError: (error) => reports.push(error),
      })
      expect(reports).toHaveLength(1)
      const reported = reports[0] as Error
      expect(reported).toBeInstanceOf(Error)
      expect(reported.message).toBe(SESSION_REFERENCE_COPY_ERROR)
      expect(String(reported)).not.toContain(copiedText)
      expect(String(reported)).not.toContain(CONTEXT.threadId)
    }
  })

  test('reports through the existing desktop:error channel when no reporter is injected', async () => {
    const dispatched: Array<{ type: string; detail: unknown }> = []
    const windowStub = {
      dispatchEvent: (event: Event): boolean => {
        dispatched.push({
          type: event.type,
          detail: (event as CustomEvent).detail,
        })
        return true
      },
    }
    ;(globalThis as { window?: unknown }).window = windowStub
    try {
      await copyThreadId('session-secret-1')
      expect(dispatched).toHaveLength(1)
      expect(dispatched[0]?.type).toBe('desktop:error')
      const reported = dispatched[0]?.detail as Error
      expect(reported).toBeInstanceOf(Error)
      expect(reported.message).toBe(SESSION_REFERENCE_COPY_ERROR)
      expect(String(reported)).not.toContain('session-secret-1')
    } finally {
      delete (globalThis as { window?: unknown }).window
    }
  })
})
