import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import {
  COMPOSER_READY_SELECTOR,
  FULL_SCREEN_LOADING_SELECTOR,
  installStartupSplashHandoff,
  resolveSplashDisposition,
  SPLASH_FAILSAFE_MS,
  SURFACE_READY_SELECTOR,
} from '../src/startup/StartupSplashHandoff.js'

// 控制器按真实 DOM API 编写；测试用最小假 DOM 替换全局，驱动 MutationObserver、
// hashchange 与定时器，覆盖 ready 判定、镜像、透明窗口例外与 fail-safe。

type FakeAnimation = {
  canceled: boolean
  onfinish: (() => void) | null
  cancel(): void
}

type FakeSpan = {
  textContent: string
  animations: FakeAnimation[]
  animate(frames: unknown, options: unknown): FakeAnimation
}

function createFakeSpan(initial = ''): FakeSpan {
  const span: FakeSpan = {
    textContent: initial,
    animations: [],
    animate() {
      const animation: FakeAnimation = {
        canceled: false,
        onfinish: null,
        cancel() {
          animation.canceled = true
        },
      }
      span.animations.push(animation)
      return animation
    },
  }
  return span
}

type FakeSplash = {
  attributes: Record<string, string>
  classes: Set<string>
  classList: { add(className: string): void }
  status: FakeSpan
  removed: boolean
  removeCalls: number
  remove(): void
  removeAttribute(name: string): void
  setAttribute(name: string, value: string): void
  hasAttribute(name: string): boolean
  querySelector(selector: string): FakeSpan | null
}

function createFakeSplash(): FakeSplash {
  const splash: FakeSplash = {
    attributes: {},
    classes: new Set(),
    classList: {
      add(className) {
        splash.classes.add(className)
      },
    },
    status: createFakeSpan('正在加载桌面界面…'),
    removed: false,
    removeCalls: 0,
    remove() {
      splash.removed = true
      splash.removeCalls += 1
    },
    removeAttribute(name) {
      delete splash.attributes[name]
    },
    setAttribute(name, value) {
      splash.attributes[name] = value
    },
    hasAttribute(name) {
      return name in splash.attributes
    },
    querySelector(selector) {
      return selector === '.full-screen-whale-loader__status' ? splash.status : null
    },
  }
  return splash
}

type HandoffState = {
  hash: string
  reduced: boolean
  composerPresent: boolean
  surfaceReady: boolean
  loaderPresent: boolean
  loaderLabel: string | null
}

type FakeWindow = {
  location: { hash: string }
  addEventListener(type: string, listener: () => void): void
  removeEventListener(type: string): void
  setTimeout(callback: () => void, ms: number): number
  clearTimeout(id: number): void
  matchMedia(query: string): { matches: boolean }
  fireHashchange(): void
  fireTimeout(ms: number): void
  timerCount(): number
}

type FakeDocument = {
  documentElement: { dataset: Record<string, string | undefined> }
  getElementById(id: string): FakeSplash | null
  querySelector(selector: string): { getAttribute(name: string): string | null } | null
}

class FakeMutationObserver {
  static instances: FakeMutationObserver[] = []

  callback: () => void
  options: {
    childList: boolean
    subtree: boolean
    attributes: boolean
    attributeFilter: string[]
  } | null = null
  disconnected = false

  constructor(callback: () => void) {
    this.callback = callback
    FakeMutationObserver.instances.push(this)
  }

  observe(
    _target: unknown,
    options: {
      childList: boolean
      subtree: boolean
      attributes: boolean
      attributeFilter: string[]
    },
  ): void {
    this.options = options
  }

  disconnect(): void {
    this.disconnected = true
  }

  fire(): void {
    if (!this.disconnected) this.callback()
  }
}

function setup(state: Partial<HandoffState> = {}): {
  splash: FakeSplash
  state: HandoffState
  fakeWindow: FakeWindow
  fakeDocument: FakeDocument
  fireMutation(): void
} {
  const fullState: HandoffState = {
    hash: '#/',
    reduced: false,
    composerPresent: false,
    surfaceReady: false,
    loaderPresent: false,
    loaderLabel: null,
    ...state,
  }
  const splash = createFakeSplash()
  const fakeDocument: FakeDocument = {
    documentElement: { dataset: { reduceMotion: undefined } },
    getElementById(id) {
      return id === 'startup-splash' ? splash : null
    },
    querySelector(selector) {
      if (selector === COMPOSER_READY_SELECTOR) {
        return fullState.composerPresent ? { getAttribute: () => null } : null
      }
      if (selector === SURFACE_READY_SELECTOR) {
        return fullState.surfaceReady ? { getAttribute: () => null } : null
      }
      if (selector === FULL_SCREEN_LOADING_SELECTOR) {
        return fullState.loaderPresent
          ? {
              getAttribute(name: string) {
                return name === 'data-loading-label' ? fullState.loaderLabel : null
              },
            }
          : null
      }
      return null
    },
  }
  const listeners = new Map<string, () => void>()
  const timers = new Map<number, { callback: () => void; ms: number }>()
  let nextTimerId = 1
  const fakeWindow: FakeWindow = {
    location: { hash: fullState.hash },
    addEventListener(type, listener) {
      listeners.set(type, listener)
    },
    removeEventListener(type) {
      listeners.delete(type)
    },
    setTimeout(callback, ms) {
      const id = nextTimerId
      nextTimerId += 1
      timers.set(id, { callback, ms })
      return id
    },
    clearTimeout(id) {
      timers.delete(id)
    },
    matchMedia(query) {
      return { matches: query === '(prefers-reduced-motion: reduce)' && fullState.reduced }
    },
    fireHashchange() {
      listeners.get('hashchange')?.()
    },
    fireTimeout(ms) {
      for (const [id, timer] of timers) {
        if (timer.ms === ms) {
          timers.delete(id)
          timer.callback()
          return
        }
      }
    },
    timerCount() {
      return timers.size
    },
  }
  return {
    splash,
    state: fullState,
    fakeWindow,
    fakeDocument,
    fireMutation() {
      FakeMutationObserver.instances.at(-1)?.fire()
    },
  }
}

const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document')
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window')
const originalMutationObserver = Object.getOwnPropertyDescriptor(globalThis, 'MutationObserver')

beforeEach(() => {
  FakeMutationObserver.instances = []
})

afterEach(() => {
  for (const [name, descriptor] of [
    ['document', originalDocument],
    ['window', originalWindow],
    ['MutationObserver', originalMutationObserver],
  ] as const) {
    if (descriptor) {
      Object.defineProperty(globalThis, name, descriptor)
    } else {
      Reflect.deleteProperty(globalThis, name)
    }
  }
})

function installWith(environment: { fakeWindow: FakeWindow; fakeDocument: FakeDocument }): void {
  Object.defineProperty(globalThis, 'document', {
    value: environment.fakeDocument,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'window', {
    value: environment.fakeWindow,
    configurable: true,
  })
  Object.defineProperty(globalThis, 'MutationObserver', {
    value: FakeMutationObserver,
    configurable: true,
  })
}

describe('resolveSplashDisposition', () => {
  test('deep-link hashes alone are never readiness evidence', () => {
    for (const hash of ['#/setup', '#/models', '#/threads/abc-1', '#/']) {
      expect(
        resolveSplashDisposition({
          hash,
          composerReady: false,
          surfaceReady: false,
          loaderPresent: false,
          loaderLabel: null,
        }),
      ).toEqual({ kind: 'wait' })
    }
  })

  test('ready marker and real composer finish the splash', () => {
    expect(
      resolveSplashDisposition({
        hash: '#/setup',
        composerReady: false,
        surfaceReady: true,
        loaderPresent: false,
        loaderLabel: null,
      }),
    ).toEqual({ kind: 'finish' })
    expect(
      resolveSplashDisposition({
        hash: '#/new',
        composerReady: true,
        surfaceReady: false,
        loaderPresent: false,
        loaderLabel: null,
      }),
    ).toEqual({ kind: 'finish' })
  })

  test('loader marker only mirrors the stage label', () => {
    expect(
      resolveSplashDisposition({
        hash: '#/setup',
        composerReady: false,
        surfaceReady: false,
        loaderPresent: true,
        loaderLabel: '正在打开模型设置…',
      }),
    ).toEqual({ kind: 'mirror', label: '正在打开模型设置…' })
  })

  test('pet overlay uses the transparent-window exception', () => {
    expect(
      resolveSplashDisposition({
        hash: '#/pet-overlay',
        composerReady: true,
        surfaceReady: true,
        loaderPresent: false,
        loaderLabel: null,
      }),
    ).toEqual({ kind: 'remove-immediately' })
  })
})

describe('installStartupSplashHandoff', () => {
  test('deep links stay covered while nothing reports readiness', () => {
    for (const hash of ['#/setup', '#/models', '#/threads/abc-1']) {
      const environment = setup({ hash })
      installWith(environment)
      installStartupSplashHandoff()
      expect(environment.splash.removed).toBe(false)
      expect(environment.splash.classes.has('full-screen-whale-loader--exiting')).toBe(false)
    }
  })

  test('/new shell without an input-ready editor keeps waiting', () => {
    const environment = setup({
      hash: '#/new',
      loaderPresent: true,
      loaderLabel: '正在准备模型设置…',
      reduced: true,
    })
    installWith(environment)
    installStartupSplashHandoff()

    expect(environment.splash.removed).toBe(false)
    expect(environment.splash.status.textContent).toBe('正在准备模型设置…')

    environment.state.composerPresent = true
    environment.fireMutation()
    // reduced-motion 下交接为直接移除。
    expect(environment.splash.removed).toBe(true)
  })

  test('loader marker only mirrors status and hides the static layer from the a11y tree', () => {
    const environment = setup({
      hash: '#/setup',
      loaderPresent: true,
      loaderLabel: '正在打开模型设置…',
      reduced: true,
    })
    installWith(environment)
    installStartupSplashHandoff()

    expect(environment.splash.removed).toBe(false)
    expect(environment.splash.status.textContent).toBe('正在打开模型设置…')
    expect(environment.splash.attributes['aria-hidden']).toBe('true')

    environment.state.loaderLabel = '正在读取模型配置…'
    environment.fireMutation()
    expect(environment.splash.status.textContent).toBe('正在读取模型配置…')
  })

  test('mirroring swaps text with the vertical animation and settles on the latest label', () => {
    const environment = setup({
      hash: '#/setup',
      loaderPresent: true,
      loaderLabel: '正在读取模型配置…',
    })
    installWith(environment)
    installStartupSplashHandoff()

    expect(environment.splash.status.textContent).toBe('正在加载桌面界面…')
    expect(environment.splash.status.animations.length).toBe(1)

    environment.state.loaderLabel = '正在读取桌面设置…'
    environment.fireMutation()
    environment.state.loaderLabel = '正在准备模型设置…'
    environment.fireMutation()
    environment.splash.status.animations[0]!.onfinish?.()

    expect(environment.splash.status.textContent).toBe('正在准备模型设置…')
    expect(environment.splash.status.animations.length).toBe(2)
    expect(environment.splash.status.animations[0]!.canceled).toBe(true)
  })

  test('ready marker finishes with a fade; finish is idempotent', () => {
    const environment = setup({ hash: '#/setup', surfaceReady: true })
    installWith(environment)
    installStartupSplashHandoff()

    expect(environment.splash.attributes['aria-busy']).toBeUndefined()
    expect(environment.splash.classes.has('full-screen-whale-loader--exiting')).toBe(true)
    expect(environment.splash.removed).toBe(false)

    // 再次触发 ready（观察器已断开，不再生效），重复调用也不重复淡出。
    environment.state.composerPresent = true
    environment.fireMutation()
    environment.fakeWindow.fireHashchange()
    expect(environment.splash.removeCalls).toBe(0)

    environment.fakeWindow.fireTimeout(240)
    expect(environment.splash.removed).toBe(true)
    expect(environment.splash.removeCalls).toBe(1)
  })

  test('reduced-motion finishes without fade', () => {
    const environment = setup({
      hash: '#/new',
      composerPresent: true,
      reduced: true,
    })
    installWith(environment)
    installStartupSplashHandoff()

    expect(environment.splash.removed).toBe(true)
    expect(environment.splash.classes.has('full-screen-whale-loader--exiting')).toBe(false)
  })

  test('pet overlay removes the splash immediately', () => {
    const environment = setup({ hash: '#/pet-overlay', surfaceReady: true })
    installWith(environment)
    installStartupSplashHandoff()

    expect(environment.splash.removed).toBe(true)
    expect(environment.splash.classes.has('full-screen-whale-loader--exiting')).toBe(false)
    expect(environment.fakeWindow.timerCount()).toBe(0)
  })

  test('hashchange to the pet overlay follows the transparent-window exception', () => {
    const environment = setup({ hash: '#/' })
    installWith(environment)
    installStartupSplashHandoff()
    expect(environment.splash.removed).toBe(false)

    environment.fakeWindow.location.hash = '#/pet-overlay'
    environment.fakeWindow.fireHashchange()
    expect(environment.splash.removed).toBe(true)
  })

  test('20s fail-safe finishes even when nothing reports ready', () => {
    const environment = setup({ hash: '#/new' })
    installWith(environment)
    installStartupSplashHandoff()
    expect(environment.splash.removed).toBe(false)

    environment.fakeWindow.fireTimeout(SPLASH_FAILSAFE_MS)
    expect(environment.splash.classes.has('full-screen-whale-loader--exiting')).toBe(true)
    environment.fakeWindow.fireTimeout(240)
    expect(environment.splash.removed).toBe(true)
  })

  test('observer watches loader labels and ready markers as attributes', () => {
    const environment = setup({ hash: '#/' })
    installWith(environment)
    installStartupSplashHandoff()

    const observer = FakeMutationObserver.instances.at(-1)!
    expect(observer.options).toMatchObject({
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['data-loading-label', 'data-startup-surface-ready'],
    })
  })
})
