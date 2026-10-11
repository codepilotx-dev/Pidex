import { describe, expect, test } from 'bun:test'
import { openTargetIconSrc, KNOWN_OPEN_TARGET_IDS } from '../src/components/ui/OpenTargetIcon.js'
import {
  EDITOR_OPEN_TARGET_PRIORITY,
  OPEN_TARGET_STORED_SENTINELS,
  resolvePreferredOpenTarget,
} from '../src/services/desktop-client/OpenTargetSelection.js'

describe('open target icon mapping', () => {
  test('known target ids map to the packaged /open-targets/*.png assets', () => {
    expect(KNOWN_OPEN_TARGET_IDS).toEqual([
      'vscode',
      'vscode-insiders',
      'visual-studio',
      'cursor',
      'windsurf',
      'github-desktop',
      'file-explorer',
      'terminal',
      'intellij',
    ])
    expect(openTargetIconSrc('vscode')).toBe('/open-targets/vscode.png')
    expect(openTargetIconSrc('vscode-insiders')).toBe('/open-targets/vscode-insiders.png')
    expect(openTargetIconSrc('visual-studio')).toBe('/open-targets/visual-studio.png')
    expect(openTargetIconSrc('cursor')).toBe('/open-targets/cursor.png')
    expect(openTargetIconSrc('windsurf')).toBe('/open-targets/windsurf.png')
    expect(openTargetIconSrc('github-desktop')).toBe('/open-targets/github-desktop.png')
    expect(openTargetIconSrc('file-explorer')).toBe('/open-targets/file-explorer.png')
    expect(openTargetIconSrc('terminal')).toBe('/open-targets/microsoft-terminal.png')
    expect(openTargetIconSrc('intellij')).toBe('/open-targets/intellij.png')
  })

  test('unknown target ids have no packaged icon', () => {
    expect(openTargetIconSrc('default-app')).toBeNull()
    expect(openTargetIconSrc('auto')).toBeNull()
    expect(openTargetIconSrc('random-app')).toBeNull()
  })
})

describe('resolvePreferredOpenTarget', () => {
  const target = (id: string) => ({ id })

  test('keeps a stored target that is still available', () => {
    const targets = [target('cursor'), target('file-explorer')]
    expect(resolvePreferredOpenTarget(targets, 'cursor')?.id).toBe('cursor')
  })

  test('migrates sentinel and unknown stored ids by editor priority', () => {
    const targets = [target('file-explorer'), target('intellij'), target('vscode')]
    for (const storedId of [...OPEN_TARGET_STORED_SENTINELS, 'unknown-target']) {
      expect(resolvePreferredOpenTarget(targets, storedId)?.id).toBe('vscode')
    }
  })

  test('uses the highest-priority installed editor when higher ones are missing', () => {
    const targets = [target('file-explorer'), target('cursor')]
    expect(resolvePreferredOpenTarget(targets, 'default-app')?.id).toBe('cursor')
    expect(EDITOR_OPEN_TARGET_PRIORITY[0]).toBe('vscode')
  })

  test('falls back to File Explorer when no editor is installed', () => {
    expect(resolvePreferredOpenTarget([target('file-explorer')], 'auto')?.id).toBe('file-explorer')
    expect(resolvePreferredOpenTarget([], 'auto')).toBeUndefined()
  })

  test('never auto-selects GitHub Desktop or Windows Terminal', () => {
    const targets = [target('github-desktop'), target('terminal'), target('file-explorer')]
    expect(resolvePreferredOpenTarget(targets, 'default-app')?.id).toBe('file-explorer')
  })
})
