import { describe, expect, test } from 'bun:test'
import {
  ensureRendererDataEpoch,
  RENDERER_DATA_EPOCH,
} from '../src/services/desktop-client/DataEpoch.js'

class MemoryStorage implements Storage {
  #entries = new Map<string, string>()

  get length(): number {
    return this.#entries.size
  }

  clear(): void {
    this.#entries.clear()
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null
  }

  removeItem(key: string): void {
    this.#entries.delete(key)
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, value)
  }
}

describe('renderer data epoch', () => {
  test('removes transient conversation state but preserves user preferences', () => {
    const local = new MemoryStorage()
    const session = new MemoryStorage()
    local.setItem('pidex.dataEpoch', '2')
    local.setItem('pidex.desktop.rightDockWidth', '600')
    local.setItem('pidex.desktop.bottomPanelHeight', '280')
    local.setItem('pidex.desktop.fileTreeView:c:/workspace', '{"visible":true}')
    local.setItem('pidex.syntax.wrap-v1', 'true')
    local.setItem('pidex.desktop.appearance.v3', '{"mode":"dark"}')
    local.setItem('conversation.ui-state.thread-1', '{}')
    local.setItem('layout.sidebarWidth', '300')
    local.setItem('layout.sidebarCollapsed', 'true')
    local.setItem('claude-code-desktop-settings', '{"provider":"legacy"}')
    local.setItem('other.application.setting', 'keep')
    session.setItem('pidex.subagent.scroll.thread-1', '20')
    session.setItem('pidex.desktop.rightDockWidth', '500')
    session.setItem('other.session.setting', 'keep')

    expect(ensureRendererDataEpoch(local, session)).toBe(true)
    expect(local.getItem('conversation.ui-state.thread-1')).toBeNull()
    expect(local.getItem('pidex.desktop.rightDockWidth')).toBe('600')
    expect(local.getItem('pidex.desktop.bottomPanelHeight')).toBe('280')
    expect(local.getItem('pidex.desktop.fileTreeView:c:/workspace')).toBe('{"visible":true}')
    expect(local.getItem('pidex.syntax.wrap-v1')).toBe('true')
    expect(local.getItem('pidex.desktop.appearance.v3')).toBe('{"mode":"dark"}')
    expect(local.getItem('layout.sidebarWidth')).toBe('300')
    expect(local.getItem('layout.sidebarCollapsed')).toBe('true')
    expect(local.getItem('claude-code-desktop-settings')).toBe('{"provider":"legacy"}')
    expect(local.getItem('other.application.setting')).toBe('keep')
    expect(session.getItem('pidex.subagent.scroll.thread-1')).toBeNull()
    expect(session.getItem('pidex.desktop.rightDockWidth')).toBe('500')
    expect(session.getItem('other.session.setting')).toBe('keep')
    expect(local.getItem('pidex.dataEpoch')).toBe(String(RENDERER_DATA_EPOCH))
    expect(ensureRendererDataEpoch(local, session)).toBe(false)
  })
})
