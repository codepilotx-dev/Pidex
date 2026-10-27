import { afterEach, describe, expect, test } from 'bun:test'
import { createStartupShell, SPLASH_STALL_MS } from '../src/startup/StartupSplashHandoff.js'

const originalWindow = globalThis.window
const originalDocument = globalThis.document

afterEach(() => {
  globalThis.window = originalWindow
  globalThis.document = originalDocument
})

function fixture() {
  const timers = new Map<number, { callback: () => void; ms: number }>()
  const frames: Array<() => void> = []
  const label = { textContent: '正在启动…' }
  const actions = { hidden: true }
  const detail = { textContent: '' }
  let removed = 0
  let nextTimer = 0
  globalThis.document = {
    documentElement: { dataset: { reduceMotion: 'on' } },
    getElementById: (id: string) =>
      id === 'startup-actions' ? actions : id === 'startup-detail' ? detail : null,
  } as unknown as Document
  globalThis.window = {
    setTimeout: (callback: () => void, ms: number) => {
      timers.set(++nextTimer, { callback, ms })
      return nextTimer
    },
    clearTimeout: (id: number) => timers.delete(id),
    requestAnimationFrame: (callback: () => void) => {
      frames.push(callback)
      return frames.length
    },
    matchMedia: () => ({ matches: true }),
  } as unknown as Window & typeof globalThis
  const splash = {
    querySelector: () => label,
    remove: () => removed++,
    removeAttribute: () => {},
    setAttribute: () => {},
    classList: { add: () => {} },
  } as unknown as HTMLElement
  const shell = createStartupShell(splash)
  return {
    shell,
    actions,
    label,
    detail,
    removed: () => removed,
    flush: () => frames.splice(0).forEach((callback) => callback()),
    stall: () =>
      [...timers.values()]
        .filter((timer) => timer.ms === SPLASH_STALL_MS)
        .forEach((timer) => timer.callback()),
  }
}

describe('单次启动交接', () => {
  test('首屏已提交仍需等待阻塞加载结束，下一帧只退出一次', () => {
    const f = fixture()
    const release = f.shell.loading('正在读取模型配置…')
    f.shell.ready()
    f.flush()
    expect(f.removed()).toBe(0)
    release()
    f.flush()
    f.shell.ready()
    f.flush()
    expect(f.removed()).toBe(1)
  })
  test('20 秒只显示恢复入口，不撤掉加载页', () => {
    const f = fixture()
    f.stall()
    expect(f.actions.hidden).toBe(false)
    expect(f.detail.textContent).toContain('继续等待')
    expect(f.removed()).toBe(0)
  })
  test('资源失败留在启动壳，错误页提交后正常交接', () => {
    const f = fixture()
    f.shell.fail('界面模块加载失败')
    expect(f.label.textContent).toBe('界面模块加载失败')
    expect(f.actions.hidden).toBe(false)
    expect(f.removed()).toBe(0)
    f.shell.ready()
    f.flush()
    expect(f.removed()).toBe(1)
  })
})
