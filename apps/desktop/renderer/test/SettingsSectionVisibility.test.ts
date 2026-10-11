import { describe, expect, test } from 'bun:test'
import { SETTINGS_GROUPS } from '../src/features/settings/SettingsRegistry.js'
import {
  resolveSettingsSectionVisibility,
  type SettingsCapabilityState,
} from '../src/features/settings/UseSettingsSectionVisibility.js'

const READY_WITH: SettingsCapabilityState = {
  status: 'ready',
  capabilities: new Set(['speech.transcription.v1', 'computer.use.v1']),
}
const READY_WITHOUT: SettingsCapabilityState = { status: 'ready', capabilities: new Set() }
const UNKNOWN: SettingsCapabilityState = { status: 'unknown', capabilities: null }
const UNAVAILABLE: SettingsCapabilityState = { status: 'unavailable', capabilities: null }

describe('resolveSettingsSectionVisibility', () => {
  test('keeps ungated sections always visible', () => {
    expect(
      resolveSettingsSectionVisibility(undefined, {
        workspacePath: null,
        capabilityState: UNKNOWN,
      }),
    ).toEqual({ visible: true, pending: false })
  })

  test('hides workspace-gated sections without an active workspace before capability resolution', () => {
    const requires = { workspace: true }
    expect(
      resolveSettingsSectionVisibility(requires, { workspacePath: null, capabilityState: UNKNOWN }),
    ).toEqual({ visible: false, pending: false })
    expect(
      resolveSettingsSectionVisibility(requires, {
        workspacePath: 'F:/demo',
        capabilityState: UNKNOWN,
      }),
    ).toEqual({ visible: true, pending: false })
  })

  test('marks capability-gated sections pending while the query is unknown', () => {
    const requires = { capabilities: ['speech.transcription.v1'] as const }
    expect(
      resolveSettingsSectionVisibility(requires, { workspacePath: null, capabilityState: UNKNOWN }),
    ).toEqual({ visible: false, pending: true })
  })

  test('shows capability-gated sections when any required capability is ready', () => {
    const requires = { capabilities: ['browser.host.v1', 'speech.transcription.v1'] as const }
    expect(
      resolveSettingsSectionVisibility(requires, {
        workspacePath: null,
        capabilityState: READY_WITH,
      }),
    ).toEqual({ visible: true, pending: false })
    expect(
      resolveSettingsSectionVisibility(requires, {
        workspacePath: null,
        capabilityState: READY_WITHOUT,
      }),
    ).toEqual({ visible: false, pending: false })
  })

  test('hides capability-gated sections when the runtime cannot report capabilities', () => {
    const requires = { capabilities: ['speech.transcription.v1'] as const }
    expect(
      resolveSettingsSectionVisibility(requires, {
        workspacePath: null,
        capabilityState: UNAVAILABLE,
      }),
    ).toEqual({ visible: false, pending: false })
  })

  test('hides sections failing the workspace gate even when capabilities are pending', () => {
    const requires = { workspace: true, capabilities: ['speech.transcription.v1'] as const }
    expect(
      resolveSettingsSectionVisibility(requires, { workspacePath: null, capabilityState: UNKNOWN }),
    ).toEqual({ visible: false, pending: false })
  })
})

describe('settings registry gating declarations', () => {
  const requiresByRouteId = new Map(
    SETTINGS_GROUPS.flatMap((group) => group.items).map((item) => [item.routeId, item.requires]),
  )

  test('environment entries are consolidated under global Worktrees and PR monitoring has its own page', () => {
    expect(requiresByRouteId.has('environment')).toBe(false)
    expect(requiresByRouteId.has('local-environment')).toBe(false)
    expect(requiresByRouteId.get('worktrees')).toBeUndefined()
    expect(requiresByRouteId.has('code-review')).toBe(true)
  })

  test('capability-scoped sections declare their runtime capabilities', () => {
    expect(requiresByRouteId.get('voice')).toEqual({
      capabilities: ['speech.transcription.v1'],
    })
    expect(requiresByRouteId.get('computer')).toEqual({ capabilities: ['computer.use.v1'] })
    expect(requiresByRouteId.get('browser')).toEqual({
      capabilities: ['browser.host.v1', 'browser.manage.v1'],
    })
  })
})
