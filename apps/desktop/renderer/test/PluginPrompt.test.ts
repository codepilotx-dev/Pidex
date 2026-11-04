import { expect, test } from 'bun:test'
import { desktopClient } from '../src/services/desktop-client/index.js'
import { composerDraftStore } from '../src/features/session/composer/ComposerDraftStore.js'
import { preparePluginPrompt } from '../src/features/plugins/PluginPrompt.js'
import type { PluginCatalogItem } from '../src/features/plugins/PluginCatalog.js'

test('prompt setup installs then enables, keeps failures on the page and protects existing drafts', async () => {
  const item: PluginCatalogItem = {
    id: 'demo',
    name: 'Demo',
    description: '',
    category: 'manageable',
    actionKind: 'install',
    iconName: 'plugin',
    tone: 'creative',
    status: 'not-installed',
    installed: false,
    enabled: false,
    canInstall: true,
  }
  const install = desktopClient.installPlugin
  const enable = desktopClient.setPluginEnabled
  const originalDraft = composerDraftStore.get('home')
  const calls: string[] = []
  try {
    composerDraftStore.clear('home')
    desktopClient.installPlugin = async () => {
      calls.push('install')
      return { pluginId: 'demo', generation: 1, updatedAt: 1 }
    }
    desktopClient.setPluginEnabled = async () => {
      calls.push('enable')
      return {
        id: 'demo',
        name: 'Demo',
        version: '1.0.0',
        description: '',
        developerName: 'Pidex',
        category: 'Demo',
        source: 'installed',
        installationPolicy: 'AVAILABLE',
        installed: true,
        enabled: true,
        status: 'ready',
        capabilities: [],
        skills: [],
      }
    }
    await preparePluginPrompt(item, 'hello')
    expect(calls).toEqual(['install', 'enable'])
    expect(composerDraftStore.get('home').document.text).toBe('[@Demo](plugin://demo) hello')
    await expect(preparePluginPrompt(item, 'again')).rejects.toThrow('已有草稿')
    expect(calls).toHaveLength(2)
    composerDraftStore.clear('home')
    calls.length = 0
    await preparePluginPrompt({ ...item, installed: true }, 'hello')
    expect(calls).toEqual(['enable'])
    composerDraftStore.clear('home')
    calls.length = 0
    desktopClient.installPlugin = async () => {
      calls.push('failed')
      throw new Error('下载失败')
    }
    await expect(preparePluginPrompt(item, 'hello')).rejects.toThrow('下载失败')
    expect(calls).toEqual(['failed'])
    expect(composerDraftStore.get('home').document.text).toBe('')
  } finally {
    desktopClient.installPlugin = install
    desktopClient.setPluginEnabled = enable
    composerDraftStore.set('home', originalDraft)
  }
})
