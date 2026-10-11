import { describe, expect, test } from 'bun:test'
import { defaultDesktopStoredSettings } from '../shared/SettingsSchema.js'
import { createDesktopClient } from '../src/services/desktop-client/index.js'

type OpenTargetWireTarget = {
  targetId: string
  label: string
  kind: 'file-explorer' | 'terminal' | 'editor'
  iconDataUrl?: string
}

function createHarness(options: { targets: OpenTargetWireTarget[]; defaultOpenTargetId?: string }) {
  const opened: Array<{ path: string; targetId: string }> = []
  let settings = {
    ...defaultDesktopStoredSettings(),
    defaultOpenTargetId: options.defaultOpenTargetId ?? 'auto',
  }
  const client = createDesktopClient({
    window: {
      DesktopBridge: {
        pickWorkspaceDirectory: async () => null,
        getDesktopSettings: async () => settings,
        saveDesktopSettings: async (value) => {
          settings = value as typeof settings
          return settings
        },
        listExternalOpenTargets: async () => options.targets,
        openPathWithTarget: async (path, targetId) => {
          opened.push({ path, targetId })
        },
        revealPathInFolder: async () => undefined,
      },
    },
  })
  return { client, settings: () => settings, opened }
}

describe('desktop external open client', () => {
  test('maps the Electron targetId wire shape and keeps a valid stored preference', async () => {
    const harness = createHarness({
      defaultOpenTargetId: 'cursor',
      targets: [
        {
          targetId: 'cursor',
          label: 'Cursor',
          kind: 'editor',
          iconDataUrl: 'data:image/png;base64,cursor',
        },
        {
          targetId: 'file-explorer',
          label: 'File Explorer',
          kind: 'file-explorer',
        },
      ],
    })

    await expect(harness.client.listExternalOpenTargets('C:\\workspace')).resolves.toEqual([
      {
        id: 'cursor',
        label: 'Cursor',
        kind: 'editor',
        iconDataUrl: 'data:image/png;base64,cursor',
        preferred: true,
      },
      {
        id: 'file-explorer',
        label: 'File Explorer',
        kind: 'file-explorer',
        preferred: false,
      },
    ])

    await harness.client.openPathWithDefaultTarget('C:\\workspace')
    expect(harness.opened).toEqual([{ path: 'C:\\workspace', targetId: 'cursor' }])

    await harness.client.openPathWithTarget('C:\\workspace\\README.md', 'file-explorer')
    expect(harness.settings().defaultOpenTargetId).toBe('file-explorer')
    expect(harness.opened.at(-1)).toEqual({
      path: 'C:\\workspace\\README.md',
      targetId: 'file-explorer',
    })
  })

  test('default-app / auto / unknown / uninstalled stored ids migrate by editor priority', async () => {
    const targets: OpenTargetWireTarget[] = [
      { targetId: 'cursor', label: 'Cursor', kind: 'editor' },
      { targetId: 'file-explorer', label: 'File Explorer', kind: 'file-explorer' },
    ]
    for (const storedId of ['default-app', 'auto', 'unknown-target']) {
      const harness = createHarness({ targets, defaultOpenTargetId: storedId })
      const listed = await harness.client.listExternalOpenTargets('C:\\workspace')
      expect(listed.map((target) => target.preferred)).toEqual([true, false])
      expect(harness.settings().defaultOpenTargetId).toBe('cursor')
    }

    // 已保存目标已卸载时按编辑器优先级选择其余编辑器
    const uninstalled = createHarness({
      defaultOpenTargetId: 'cursor',
      targets: [
        { targetId: 'vscode', label: 'Visual Studio Code', kind: 'editor' },
        { targetId: 'file-explorer', label: 'File Explorer', kind: 'file-explorer' },
      ],
    })
    const listed = await uninstalled.client.listExternalOpenTargets('C:\\workspace')
    expect(listed.find((target) => target.preferred)?.id).toBe('vscode')
    expect(uninstalled.settings().defaultOpenTargetId).toBe('vscode')
  })

  test('falls back to File Explorer without editors and never auto-selects GitHub Desktop or Terminal', async () => {
    const noEditor = createHarness({
      defaultOpenTargetId: 'default-app',
      targets: [{ targetId: 'file-explorer', label: 'File Explorer', kind: 'file-explorer' }],
    })
    const listed = await noEditor.client.listExternalOpenTargets('C:\\workspace')
    expect(listed).toEqual([
      { id: 'file-explorer', label: 'File Explorer', kind: 'file-explorer', preferred: true },
    ])
    expect(noEditor.settings().defaultOpenTargetId).toBe('file-explorer')

    const withTools = createHarness({
      defaultOpenTargetId: 'auto',
      targets: [
        { targetId: 'github-desktop', label: 'GitHub Desktop', kind: 'editor' },
        { targetId: 'terminal', label: 'Windows Terminal', kind: 'terminal' },
        { targetId: 'file-explorer', label: 'File Explorer', kind: 'file-explorer' },
      ],
    })
    const withToolsListed = await withTools.client.listExternalOpenTargets('C:\\workspace')
    expect(withToolsListed.find((target) => target.preferred)?.id).toBe('file-explorer')
    expect(withTools.settings().defaultOpenTargetId).toBe('file-explorer')
  })

  test('openPathWithDefaultTarget uses the normalized target and errors when none is available', async () => {
    const harness = createHarness({
      defaultOpenTargetId: 'default-app',
      targets: [
        { targetId: 'windsurf', label: 'Windsurf', kind: 'editor' },
        { targetId: 'file-explorer', label: 'File Explorer', kind: 'file-explorer' },
      ],
    })
    await harness.client.openPathWithDefaultTarget('C:\\workspace')
    expect(harness.opened).toEqual([{ path: 'C:\\workspace', targetId: 'windsurf' }])

    const empty = createHarness({ targets: [] })
    await expect(empty.client.openPathWithDefaultTarget('C:\\workspace')).rejects.toThrow(
      '没有可用的外部打开方式',
    )
  })
})
