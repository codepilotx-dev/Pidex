import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test'
import * as React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import type { Attachment } from '@pidex/shared/thread'
import {
  AttachmentFilePill,
  AttachmentFileRow,
  AttachmentHorizontalRow,
  AttachmentImageTile,
} from '../src/features/session/attachments/AttachmentRowPrimitives.js'
import {
  readAttachmentImage,
  useThreadAttachmentImageSource,
  findScrollContainer,
  _getPendingAttachmentReadsCount,
} from '../src/features/session/attachments/UseThreadAttachmentImageSource.js'
import { desktopClient } from '../src/services/desktop-client/index.js'

function renderAttachmentImageHook(
  attachment: Attachment,
  targetRef?: React.RefObject<Element | null>,
) {
  const internals = (React as unknown as {
    __CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE: {
      H: unknown
    }
  }).__CLIENT_INTERNALS_DO_NOT_USE_OR_WARN_USERS_THEY_CANNOT_UPGRADE

  let registeredEffect: (() => (() => void) | void) | null = null
  let stateValue: unknown = null
  const setStateCalls: unknown[] = []

  const prevDispatcher = internals.H
  internals.H = {
    useState: (initial: unknown) => {
      stateValue = initial
      return [
        stateValue,
        (val: unknown) => {
          stateValue = typeof val === 'function' ? (val as (prev: unknown) => unknown)(stateValue) : val
          setStateCalls.push(stateValue)
        },
      ]
    },
    useEffect: (effect: () => (() => void) | void) => {
      registeredEffect = effect
    },
  }

  try {
    useThreadAttachmentImageSource(attachment, targetRef)
  } finally {
    internals.H = prevDispatcher
  }

  return {
    getState: () => stateValue,
    getSetStateCalls: () => setStateCalls,
    runEffect: () => registeredEffect?.(),
  }
}

describe('文件附件收起态性能与节点收敛', () => {
  test('100 个文件收起时仅存在固定数量的预览图标，计数正确；展开后全部文件可访问', () => {
    const files = Array.from({ length: 100 }, (_, i) => (
      <AttachmentFilePill key={`file-${i}.txt`} name={`file-${i}.txt`} />
    ))

    // 收起态
    const collapsed = renderToStaticMarkup(<AttachmentFileRow ariaLabel="文件附件">{files}</AttachmentFileRow>)

    // 收起态保留前两个完整文件
    expect(collapsed).toContain('file-0.txt')
    expect(collapsed).toContain('file-1.txt')

    // 收起态只挂载两个堆叠预览图标卡片和一个计数标记（共 3 个 stack-card 节点）
    const stackCards = collapsed.match(/attachment-file-row__stack-card/g) || []
    expect(stackCards).toHaveLength(3) // 2 个文件图标预览 + 1 个 +98 标记

    // 其余隐藏附件（file-2 到 file-99）的 Pill 文本与节点在收起态完全未挂载
    expect(collapsed).not.toContain('file-2.txt')
    expect(collapsed).not.toContain('file-4.txt')
    expect(collapsed).not.toContain('file-25.txt')
    expect(collapsed).not.toContain('file-99.txt')

    // 展开按钮与剩余计数正确
    expect(collapsed).toContain('+98')
    expect(collapsed).toContain('展开其余 98 个文件')

    // 展开态挂载全部 100 个文件
    const expanded = renderToStaticMarkup(
      <AttachmentFileRow ariaLabel="文件附件" defaultExpanded>
        {files}
      </AttachmentFileRow>,
    )
    for (let i = 0; i < 100; i++) {
      expect(expanded).toContain(`file-${i}.txt`)
    }
    expect(expanded).toContain('收起文件列表')

    // 展开态的普通文件 Pill 包装层不携带 stack-card 堆叠样式
    const expandedMotionDivsWithStackCard = expanded.match(
      /class="[^"]*tw:relative[^"]*attachment-file-row__stack-card[^"]*"/g,
    )
    expect(expandedMotionDivsWithStackCard).toBeNull()
  })

  test('文件收起态已挂载附件节点数量不随总文件数增长', () => {
    const files10 = Array.from({ length: 10 }, (_, i) => (
      <AttachmentFilePill key={`file-${i}.txt`} name={`file-${i}.txt`} />
    ))
    const files100 = Array.from({ length: 100 }, (_, i) => (
      <AttachmentFilePill key={`file-${i}.txt`} name={`file-${i}.txt`} />
    ))

    const markup10 = renderToStaticMarkup(<AttachmentFileRow ariaLabel="文件附件">{files10}</AttachmentFileRow>)
    const markup100 = renderToStaticMarkup(<AttachmentFileRow ariaLabel="文件附件">{files100}</AttachmentFileRow>)

    // 计算已渲染的 pill 和堆叠卡片节点数
    const countPillsAndStackCards = (html: string) =>
      (html.match(/attachment-file-pill|attachment-file-row__stack-card/g) || []).length

    // 无论 10 个还是 100 个文件，收起态挂载的节点数完全一致
    expect(countPillsAndStackCards(markup100)).toBe(countPillsAndStackCards(markup10))
  })

  test('边界场景：两个及以下文件不呈现堆叠触发按钮', () => {
    const single = renderToStaticMarkup(
      <AttachmentFileRow ariaLabel="单个文件">
        <AttachmentFilePill name="single.txt" />
      </AttachmentFileRow>,
    )
    expect(single).toContain('single.txt')
    expect(single).not.toContain('attachment-file-row__more')
    expect(single).not.toContain('+')

    const twoFiles = renderToStaticMarkup(
      <AttachmentFileRow ariaLabel="两个文件">
        <AttachmentFilePill name="one.txt" />
        <AttachmentFilePill name="two.txt" />
      </AttachmentFileRow>,
    )
    expect(twoFiles).toContain('one.txt')
    expect(twoFiles).toContain('two.txt')
    expect(twoFiles).not.toContain('attachment-file-row__more')
    expect(twoFiles).not.toContain('+')
  })
})

describe('图片附件读取范围与并发控制', () => {
  let originalIntersectionObserver: typeof IntersectionObserver | undefined

  beforeEach(() => {
    originalIntersectionObserver = globalThis.IntersectionObserver
  })

  afterEach(() => {
    globalThis.IntersectionObserver = originalIntersectionObserver!
  })

  test('相同 ID 并发读取去重：共享 Promise 且底层只发起一次读取请求', async () => {
    let callCount = 0
    const readSpy = spyOn(desktopClient, 'readAttachment').mockImplementation(async (id) => {
      callCount++
      await new Promise((resolve) => setTimeout(resolve, 20))
      return {
        attachment: {
          id,
          kind: 'image',
          mediaType: 'image/png',
          name: 'photo.png',
          sizeBytes: 1024,
        },
        data: 'iVBORw0KGgoAAAANSUhEUg==',
        encoding: 'base64',
      }
    })

    const [res1, res2] = await Promise.all([
      readAttachmentImage('img-dedup-1'),
      readAttachmentImage('img-dedup-1'),
    ])

    expect(readSpy).toHaveBeenCalledTimes(1)
    expect(callCount).toBe(1)
    expect(res1).toEqual(res2)
    expect(res1.kind).toBe('ready')
    expect(_getPendingAttachmentReadsCount()).toBe(0)
    readSpy.mockRestore()
  })

  test('失败后可再次读取，并在完成后移除 pending 记录', async () => {
    let callCount = 0
    const readSpy = spyOn(desktopClient, 'readAttachment').mockImplementation(async (id) => {
      callCount++
      if (callCount === 1) {
        throw new Error('网络错误')
      }
      return {
        attachment: {
          id,
          kind: 'image',
          mediaType: 'image/png',
          name: 'photo.png',
          sizeBytes: 1024,
        },
        data: 'iVBORw0KGgoAAAANSUhEUg==',
        encoding: 'base64',
      }
    })

    // 第一次读取失败
    const res1 = await readAttachmentImage('img-retry-1')
    expect(res1.kind).toBe('error')
    expect(_getPendingAttachmentReadsCount()).toBe(0)

    // 第二次读取可以再次触发底层请求并成功
    const res2 = await readAttachmentImage('img-retry-1')
    expect(res2.kind).toBe('ready')
    expect(callCount).toBe(2)
    expect(_getPendingAttachmentReadsCount()).toBe(0)

    readSpy.mockRestore()
  })

  test('离屏不读取：挂载时建立观察器，交叠未发生时不发起读取请求', () => {
    let observedElement: Element | null = null
    let observerCallback: IntersectionObserverCallback | null = null
    let optionsPassed: IntersectionObserverInit | undefined

    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null = null
      readonly rootMargin: string = '200px'
      readonly thresholds: readonly number[] = [0]

      constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
        observerCallback = callback
        optionsPassed = options
      }

      observe(element: Element): void {
        observedElement = element
      }

      unobserve(_element: Element): void {}
      disconnect(): void {}
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }

    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver

    const readSpy = spyOn(desktopClient, 'readAttachment').mockResolvedValue({
      attachment: {
        id: 'img-offscreen-1',
        kind: 'image',
        mediaType: 'image/png',
        name: 'photo.png',
        sizeBytes: 1024,
      },
      data: 'iVBORw0KGgoAAAANSUhEUg==',
      encoding: 'base64',
    })

    const dummyElement = {
      closest: () => null,
      parentElement: null,
    } as unknown as Element
    const targetRef = { current: dummyElement }

    const hook = renderAttachmentImageHook(
      {
        id: 'img-offscreen-1',
        kind: 'image',
        mediaType: 'image/png',
        name: 'photo.png',
        sizeBytes: 1024,
      },
      targetRef,
    )

    // 运行 effect，建立观察器
    const cleanup = hook.runEffect()
    expect(observedElement).toBe(dummyElement)
    expect(optionsPassed?.rootMargin).toBe('200px')

    // 触发非交叠事件 (isIntersecting: false)
    if (observerCallback && observedElement) {
      observerCallback(
        [
          {
            isIntersecting: false,
            target: observedElement,
            intersectionRatio: 0,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: 0,
          },
        ],
        new MockIntersectionObserver(observerCallback),
      )
    }

    expect(readSpy).not.toHaveBeenCalled()
    cleanup?.()
    readSpy.mockRestore()
  })

  test('进入范围后读取：触发交叠后自动发起读取并断开观察器', async () => {
    let observedElement: Element | null = null
    let observerCallback: IntersectionObserverCallback | null = null
    let disconnected = false

    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null = null
      readonly rootMargin: string = '200px'
      readonly thresholds: readonly number[] = [0]

      constructor(callback: IntersectionObserverCallback) {
        observerCallback = callback
      }

      observe(element: Element): void {
        observedElement = element
      }

      unobserve(_element: Element): void {}
      disconnect(): void {
        disconnected = true
      }
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }

    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver

    const readSpy = spyOn(desktopClient, 'readAttachment').mockResolvedValue({
      attachment: {
        id: 'img-enter-1',
        kind: 'image',
        mediaType: 'image/png',
        name: 'photo.png',
        sizeBytes: 1024,
      },
      data: 'iVBORw0KGgoAAAANSUhEUg==',
      encoding: 'base64',
    })

    const dummyElement = {
      closest: () => null,
      parentElement: null,
    } as unknown as Element
    const targetRef = { current: dummyElement }

    const hook = renderAttachmentImageHook(
      {
        id: 'img-enter-1',
        kind: 'image',
        mediaType: 'image/png',
        name: 'photo.png',
        sizeBytes: 1024,
      },
      targetRef,
    )

    const cleanup = hook.runEffect()
    expect(observedElement).toBe(dummyElement)

    // 触发交叠事件 (isIntersecting: true)
    if (observerCallback && observedElement) {
      observerCallback(
        [
          {
            isIntersecting: true,
            target: observedElement,
            intersectionRatio: 1,
            boundingClientRect: {} as DOMRectReadOnly,
            intersectionRect: {} as DOMRectReadOnly,
            rootBounds: null,
            time: 0,
          },
        ],
        new MockIntersectionObserver(observerCallback),
      )
    }

    // 验证观察器已断开，且发起读取请求
    expect(disconnected).toBe(true)
    expect(readSpy).toHaveBeenCalledTimes(1)

    cleanup?.()
    readSpy.mockRestore()
  })

  test('卸载后不更新状态并断开观察器', async () => {
    let disconnected = false
    let resolveRead: (val: unknown) => void = () => {}

    class MockIntersectionObserver implements IntersectionObserver {
      readonly root: Element | Document | null = null
      readonly rootMargin: string = '200px'
      readonly thresholds: readonly number[] = [0]

      observe(_element: Element): void {}
      unobserve(_element: Element): void {}
      disconnect(): void {
        disconnected = true
      }
      takeRecords(): IntersectionObserverEntry[] {
        return []
      }
    }

    globalThis.IntersectionObserver = MockIntersectionObserver as unknown as typeof IntersectionObserver

    const readSpy = spyOn(desktopClient, 'readAttachment').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveRead = () =>
            resolve({
              attachment: {
                id: 'img-unmount-1',
                kind: 'image',
                mediaType: 'image/png',
                name: 'photo.png',
                sizeBytes: 1024,
              },
              data: 'iVBORw0KGgoAAAANSUhEUg==',
              encoding: 'base64',
            })
        }),
    )

    const dummyElement = {
      closest: () => null,
      parentElement: null,
    } as unknown as Element
    const targetRef = { current: dummyElement }

    const hook = renderAttachmentImageHook(
      {
        id: 'img-unmount-1',
        kind: 'image',
        mediaType: 'image/png',
        name: 'photo.png',
        sizeBytes: 1024,
      },
      targetRef,
    )

    const cleanup = hook.runEffect()

    // 卸载组件
    cleanup?.()
    expect(disconnected).toBe(true)

    const callsBeforeResolve = hook.getSetStateCalls().length
    // 在途请求现在完成
    resolveRead(null)
    await new Promise((r) => setTimeout(r, 10))

    // 状态未被更新
    expect(hook.getSetStateCalls().length).toBe(callsBeforeResolve)

    readSpy.mockRestore()
  })

  test('无观察器支持或未传 targetRef 时平稳回退立即读取', async () => {
    // 模拟无 IntersectionObserver 环境
    globalThis.IntersectionObserver = undefined as unknown as typeof IntersectionObserver

    const readSpy = spyOn(desktopClient, 'readAttachment').mockResolvedValue({
      attachment: {
        id: 'img-fallback-1',
        kind: 'image',
        mediaType: 'image/png',
        name: 'photo.png',
        sizeBytes: 1024,
      },
      data: 'iVBORw0KGgoAAAANSUhEUg==',
      encoding: 'base64',
    })

    const hook = renderAttachmentImageHook({
      id: 'img-fallback-1',
      kind: 'image',
      mediaType: 'image/png',
      name: 'photo.png',
      sizeBytes: 1024,
    })

    const cleanup = hook.runEffect()
    expect(readSpy).toHaveBeenCalledTimes(1)
    cleanup?.()
    readSpy.mockRestore()
  })
})

describe('findScrollContainer 滚动根查找', () => {
  test('优先查找 thread-scroll-layout，并在没有声明时回退最近滚动祖先', () => {
    const threadScroll = {
      classList: { contains: (cls: string) => cls === 'thread-scroll-layout' },
      closest: (sel: string) => (sel.includes('thread-scroll-layout') ? threadScroll : null),
      parentElement: null,
    } as unknown as HTMLElement

    const child = {
      closest: (sel: string) => (sel.includes('thread-scroll-layout') ? threadScroll : null),
      parentElement: threadScroll,
    } as unknown as HTMLElement

    expect(findScrollContainer(child)).toBe(threadScroll)
    expect(findScrollContainer(null)).toBeNull()
  })
})
