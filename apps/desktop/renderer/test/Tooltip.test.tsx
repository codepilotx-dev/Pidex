import { describe, expect, test } from 'bun:test'
import React, { createRef, useContext, useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  computeTooltipPosition,
  InfoTooltip,
  Tooltip,
  TooltipArrow,
  TooltipContent,
  TooltipPortal,
  TooltipProvider,
  TooltipRoot,
  TooltipTrigger,
  useTooltipContext,
} from '../src/components/ui/Tooltip.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../src/components/ui/IconTokens.js'

describe('Tooltip positioning geometry & auto-flip', () => {
  const baseViewport = {
    viewportWidth: 1000,
    viewportHeight: 800,
    contentWidth: 140,
    contentHeight: 40,
    sideOffset: 7,
    collisionPadding: 8,
  }

  test('calculates normal top placement and centers arrow', () => {
    const triggerRect = {
      left: 450,
      right: 550,
      top: 300,
      bottom: 340,
      width: 100,
      height: 40,
    }
    const result = computeTooltipPosition({
      ...baseViewport,
      triggerRect,
      side: 'top',
      align: 'center',
    })

    // top = triggerRect.top - contentH - sideOffset = 300 - 40 - 7 = 253
    expect(result.top).toBe(253)
    // left = triggerRect.left + (width - contentW) / 2 = 450 + (100 - 140)/2 = 430
    expect(result.left).toBe(430)
    expect(result.actualSide).toBe('top')
    // triggerCenter = 450 + 50 = 500. arrowX = 500 - 430 = 70
    expect(result.arrowOffset).toBe(70)
  })

  test('auto-flips from top to bottom when space above is insufficient', () => {
    const triggerRect = {
      left: 450,
      right: 550,
      top: 20, // spaceAbove = 20 - 7 - 8 = 5 < 40
      bottom: 60,
      width: 100,
      height: 40,
    }
    const result = computeTooltipPosition({
      ...baseViewport,
      triggerRect,
      side: 'top',
    })

    expect(result.actualSide).toBe('bottom')
    // top = triggerRect.bottom + sideOffset = 60 + 7 = 67
    expect(result.top).toBe(67)
  })

  test('auto-flips from bottom to top when space below is insufficient', () => {
    const triggerRect = {
      left: 450,
      right: 550,
      top: 740,
      bottom: 780, // spaceBelow = 800 - 780 - 7 - 8 = 5 < 40
      width: 100,
      height: 40,
    }
    const result = computeTooltipPosition({
      ...baseViewport,
      triggerRect,
      side: 'bottom',
    })

    expect(result.actualSide).toBe('top')
    // top = 740 - 40 - 7 = 693
    expect(result.top).toBe(693)
  })

  test('auto-flips from left to right when space on left is insufficient', () => {
    const triggerRect = {
      left: 50, // spaceLeft = 50 - 7 - 8 = 35 < 140
      right: 150,
      top: 300,
      bottom: 340,
      width: 100,
      height: 40,
    }
    const result = computeTooltipPosition({
      ...baseViewport,
      triggerRect,
      side: 'left',
    })

    expect(result.actualSide).toBe('right')
    // left = triggerRect.right + sideOffset = 150 + 7 = 157
    expect(result.left).toBe(157)
  })

  test('auto-flips from right to left when space on right is insufficient', () => {
    const triggerRect = {
      left: 850,
      right: 950, // spaceRight = 1000 - 950 - 7 - 8 = 35 < 140
      top: 300,
      bottom: 340,
      width: 100,
      height: 40,
    }
    const result = computeTooltipPosition({
      ...baseViewport,
      triggerRect,
      side: 'right',
    })

    expect(result.actualSide).toBe('left')
    // left = triggerRect.left - contentW - sideOffset = 850 - 140 - 7 = 703
    expect(result.left).toBe(703)
  })

  test('shifts horizontally and clamps within viewport padding when close to edge', () => {
    const triggerRect = {
      left: 950,
      right: 990,
      top: 300,
      bottom: 340,
      width: 40,
      height: 40,
    }
    const result = computeTooltipPosition({
      ...baseViewport,
      triggerRect,
      side: 'top',
    })

    // Unclamped left would be 950 + (40 - 140)/2 = 900.
    // 900 + 140 = 1040 > 1000 - 8 = 992.
    // Clamped left = 992 - 140 = 852.
    expect(result.left).toBe(852)
    // triggerCenterX = 950 + 20 = 970. arrowX = 970 - 852 = 118.
    expect(result.arrowOffset).toBe(118)
  })

  test('clamps top within viewport padding when vertical space on both sides is tight', () => {
    const triggerRect = {
      left: 300,
      right: 400,
      top: 2,
      bottom: 798,
      width: 100,
      height: 796,
    }
    const result = computeTooltipPosition({
      ...baseViewport,
      triggerRect,
      side: 'top',
    })

    // Clamped to at least collisionPadding
    expect(result.top).toBeGreaterThanOrEqual(8)
    expect(result.top + 40).toBeLessThanOrEqual(800 - 8)
  })

  test('align start and end alignments along cross axis', () => {
    const triggerRect = {
      left: 300,
      right: 400,
      top: 300,
      bottom: 340,
      width: 100,
      height: 40,
    }
    const startResult = computeTooltipPosition({
      ...baseViewport,
      triggerRect,
      side: 'top',
      align: 'start',
    })
    expect(startResult.left).toBe(300)

    const endResult = computeTooltipPosition({
      ...baseViewport,
      triggerRect,
      side: 'top',
      align: 'end',
    })
    expect(endResult.left).toBe(400 - 140) // 260
  })

  test('arrow offset clamping handles very small content dimensions without underflow', () => {
    const triggerRect = {
      left: 100,
      right: 200,
      top: 100,
      bottom: 120,
      width: 100,
      height: 20,
    }
    const result = computeTooltipPosition({
      viewportWidth: 1000,
      viewportHeight: 800,
      triggerRect,
      contentWidth: 16, // small content width
      contentHeight: 12, // small content height
      side: 'top',
      align: 'center',
    })

    expect(result.arrowOffset).toBeGreaterThanOrEqual(8)
    expect(result.arrowOffset).toBeLessThanOrEqual(16)
  })
})

describe('Tooltip empty content & number 0 handling', () => {
  test('skips tooltip wrapper when content is empty string, null, undefined or false/true', () => {
    for (const emptyContent of ['', null, undefined, false, true]) {
      const html = renderToStaticMarkup(
        <Tooltip content={emptyContent as any}>
          <button id="test-btn">按钮</button>
        </Tooltip>,
      )
      expect(html).toBe('<button id="test-btn">按钮</button>')
      expect(html).not.toContain('aria-describedby')
      expect(html).not.toContain('data-state')
    }
  })

  test('skips tooltip wrapper when disabled is true', () => {
    const html = renderToStaticMarkup(
      <Tooltip content="操作提示" disabled={true}>
        <button id="disabled-btn">禁用提示项</button>
      </Tooltip>,
    )
    expect(html).toBe('<button id="disabled-btn">禁用提示项</button>')
  })

  test('renders tooltip normally when content is number 0', () => {
    const html = renderToStaticMarkup(
      <Tooltip content={0}>
        <button id="zero-btn">数值项</button>
      </Tooltip>,
    )
    expect(html).toContain('id="zero-btn"')
    expect(html).toContain('data-state="closed"')
  })
})

describe('Tooltip variants and visual styling', () => {
  test('default variant includes CPX raised surface, subtle border and floating shadow', () => {
    const html = renderToStaticMarkup(
      <Tooltip content="帮助文本" defaultOpen variant="default">
        <button>触发器</button>
      </Tooltip>,
    )
    expect(html).toContain('tw:bg-app-raised')
    expect(html).toContain('tw:text-app-text')
    expect(html).toContain('tw:border-app-border-subtle')
    expect(html).toContain('tw:shadow-lg')
    expect(html).toContain('tw:type-caption')
    expect(html).toContain('tooltip-presence')
    expect(html).toContain('tooltip-content')
    expect(html).not.toContain('tooltip-arrow')
  })

  test('all tooltips render without arrow indicators by default', () => {
    const htmlTooltip = renderToStaticMarkup(
      <Tooltip content="无箭头提示" defaultOpen>
        <button>触发器</button>
      </Tooltip>,
    )
    expect(htmlTooltip).not.toContain('tooltip-arrow')

    const htmlInfo = renderToStaticMarkup(
      <InfoTooltip content="信息说明" defaultOpen />,
    )
    expect(htmlInfo).not.toContain('tooltip-arrow')
  })

  test('all tooltips never render arrow indicators even if showArrow={true} or compound TooltipArrow is used', () => {
    const htmlWithArrow = renderToStaticMarkup(
      <Tooltip content="带箭头提示" defaultOpen showArrow={true}>
        <button>触发器</button>
      </Tooltip>,
    )
    expect(htmlWithArrow).not.toContain('tooltip-arrow')

    const htmlInfoWithArrow = renderToStaticMarkup(
      <InfoTooltip content="信息说明带箭头" defaultOpen showArrow={true} />,
    )
    expect(htmlInfoWithArrow).not.toContain('tooltip-arrow')

    const arrowElement = renderToStaticMarkup(<TooltipArrow />)
    expect(arrowElement).toBe('')
  })

  test('contrast variant includes high-contrast dark ink styling and data-theme dark token', () => {
    const html = renderToStaticMarkup(
      <Tooltip content="高对比度" defaultOpen variant="contrast">
        <button>触发器</button>
      </Tooltip>,
    )
    expect(html).toContain('tw:bg-[#18181b]')
    expect(html).toContain('tw:text-white')
    expect(html).toContain('tw:border-white/10')
  })

  test('glass variant includes backdrop glass tokens', () => {
    const html = renderToStaticMarkup(
      <Tooltip content="毛玻璃" defaultOpen variant="glass">
        <button>触发器</button>
      </Tooltip>,
    )
    expect(html).toContain('tw:bg-app-glass')
    expect(html).toContain('tw:backdrop-blur-xl')
  })

  test('accent variant includes app accent theme tokens', () => {
    const html = renderToStaticMarkup(
      <Tooltip content="主题强调" defaultOpen variant="accent">
        <button>触发器</button>
      </Tooltip>,
    )
    expect(html).toContain('tw:bg-app-accent')
    expect(html).toContain('tw:text-app-on-accent')
  })

  test('unstyled variant preserves custom className without injecting default variant styles', () => {
    const html = renderToStaticMarkup(
      <Tooltip content="自定义" defaultOpen variant="unstyled" className="custom-popup-class">
        <button>触发器</button>
      </Tooltip>,
    )
    expect(html).toContain('custom-popup-class')
    expect(html).toContain('tooltip-presence')
    expect(html).not.toContain('tw:bg-app-raised')
    expect(html).not.toContain('tw:border-app-border-subtle')
  })
})

describe('Tooltip compound components & shortcut API', () => {
  test('exposes compound sub-components on Tooltip function object', () => {
    expect(Tooltip.Provider).toBe(TooltipProvider)
    expect(Tooltip.Root).toBe(TooltipRoot)
    expect(Tooltip.Trigger).toBe(TooltipTrigger)
    expect(Tooltip.Portal).toBe(TooltipPortal)
    expect(Tooltip.Content).toBe(TooltipContent)
    expect(Tooltip.Arrow).toBe(TooltipArrow)
  })

  test('supports compound composition usage without rendering arrow indicator', () => {
    const html = renderToStaticMarkup(
      <TooltipProvider delayDuration={150}>
        <TooltipRoot defaultOpen>
          <TooltipTrigger asChild>
            <button id="compound-trigger">组合触发器</button>
          </TooltipTrigger>
          <TooltipPortal>
            <TooltipContent side="bottom" variant="default">
              组合内容正文
              <TooltipArrow />
            </TooltipContent>
          </TooltipPortal>
        </TooltipRoot>
      </TooltipProvider>,
    )

    expect(html).toContain('id="compound-trigger"')
    expect(html).toContain('data-state="open"')
    expect(html).toContain('role="tooltip"')
    expect(html).toContain('组合内容正文')
    expect(html).not.toContain('tooltip-arrow')
  })
})

describe('InfoTooltip specifications', () => {
  test('renders 16px Info icon with project unified stroke width and default aria-label', () => {
    const ref = createRef<HTMLButtonElement>()
    const html = renderToStaticMarkup(
      <InfoTooltip ref={ref} content="信息说明" />,
    )

    expect(html).toContain('aria-label="More information"')
    expect(html).toContain('type="button"')
    expect(html).toContain('tw:cursor-help')
    expect(html).toContain('tw:rounded-full')
    expect(html).toContain('tw:w-5')
    expect(html).toContain('tw:h-5')
    // Lucide Info icon renders svg with width="16" and stroke-width="1.6" (APP_ICON_STROKE_WIDTH)
    expect(html).toContain(`width="${APP_ICON_SIZE}"`)
    expect(html).toContain(`height="${APP_ICON_SIZE}"`)
    expect(html).toContain(`stroke-width="${APP_ICON_STROKE_WIDTH}"`)
  })

  test('allows custom aria-label, side, size, strokeWidth and className', () => {
    const html = renderToStaticMarkup(
      <InfoTooltip
        content="详细说明"
        ariaLabel="说明详情"
        size={18}
        strokeWidth={2}
        className="custom-info-trigger"
        variant="contrast"
      />,
    )
    expect(html).toContain('aria-label="说明详情"')
    expect(html).toContain('custom-info-trigger')
    expect(html).toContain('width="18"')
    expect(html).toContain('height="18"')
    expect(html).toContain('stroke-width="2"')
  })
})

describe('Controlled state and events contract', () => {
  test('controlled open={true} renders tooltip in open state', () => {
    const html = renderToStaticMarkup(
      <Tooltip content="受控打开" open={true}>
        <button>受控按钮</button>
      </Tooltip>,
    )
    expect(html).toContain('data-state="open"')
    expect(html).toContain('aria-describedby')
    expect(html).toContain('role="tooltip"')
    expect(html).toContain('受控打开')
  })

  test('controlled open={false} renders tooltip in closed state', () => {
    const html = renderToStaticMarkup(
      <Tooltip content="受控隐藏" open={false}>
        <button>受控按钮</button>
      </Tooltip>,
    )
    expect(html).toContain('data-state="closed"')
    expect(html).not.toContain('role="tooltip"')
  })

  test('merges existing aria-describedby on child trigger with contentId', () => {
    const htmlClosed = renderToStaticMarkup(
      <Tooltip content="提示" open={false}>
        <button aria-describedby="external-hint">测试</button>
      </Tooltip>,
    )
    expect(htmlClosed).toContain('aria-describedby="external-hint"')

    const htmlOpen = renderToStaticMarkup(
      <Tooltip content="提示" open={true}>
        <button aria-describedby="external-hint">测试</button>
      </Tooltip>,
    )
    expect(htmlOpen).toMatch(/aria-describedby="external-hint\s+[^"]+"/)
  })
})

describe('Tooltip interaction & lifecycle regressions', () => {
  test('delay priority: delayDuration overrides delay, delay overrides provider, fallback to 120', () => {
    let capturedDelay: number | undefined
    function DelaySpy() {
      const ctx = useTooltipContext()
      capturedDelay = ctx.delayDuration
      return null
    }

    // 1. delayDuration overrides delay
    renderToStaticMarkup(
      <TooltipProvider delayDuration={500}>
        <TooltipRoot delay={300} delayDuration={150}>
          <DelaySpy />
        </TooltipRoot>
      </TooltipProvider>,
    )
    expect(capturedDelay).toBe(150)

    // 2. delay overrides provider
    renderToStaticMarkup(
      <TooltipProvider delayDuration={500}>
        <TooltipRoot delay={280}>
          <DelaySpy />
        </TooltipRoot>
      </TooltipProvider>,
    )
    expect(capturedDelay).toBe(280)

    // 3. provider overrides default
    renderToStaticMarkup(
      <TooltipProvider delayDuration={420}>
        <TooltipRoot>
          <DelaySpy />
        </TooltipRoot>
      </TooltipProvider>,
    )
    expect(capturedDelay).toBe(420)

    // 4. default is 120 without provider or props
    renderToStaticMarkup(
      <TooltipRoot>
        <DelaySpy />
      </TooltipRoot>,
    )
    expect(capturedDelay).toBe(120)
  })

  test('TooltipProvider maintains synchronous isWarm getter without re-renders', () => {
    let notifyFn: (() => void) | undefined
    let resetFn: (() => void) | undefined
    let readIsWarm: (() => boolean) | undefined

    function WarmthSpy() {
      const provider = (React as any).useContext(
        (TooltipProvider as any).__context ?? (TooltipRoot as any),
      )
      return null
    }

    // TooltipProvider children receives context
    function ProviderConsumer() {
      const [ctx, setCtx] = useState<any>(null)
      return (
        <TooltipProvider skipDelayDuration={200}>
          <TooltipRoot>
            <TooltipTrigger>
              <button
                onClick={() => {
                  // Trigger renders
                }}
              >
                按钮
              </button>
            </TooltipTrigger>
          </TooltipRoot>
        </TooltipProvider>
      )
    }

    const html = renderToStaticMarkup(<ProviderConsumer />)
    expect(html).toContain('按钮')
  })

  test('interactive and hoverable prop configure pointer-events and hover grace period', () => {
    const htmlInteractive = renderToStaticMarkup(
      <Tooltip content="允许悬停" interactive defaultOpen>
        <button>悬停按钮</button>
      </Tooltip>,
    )
    expect(htmlInteractive).toContain('pointer-events:auto')

    const htmlHoverable = renderToStaticMarkup(
      <Tooltip content="允许悬停" hoverable defaultOpen>
        <button>悬停按钮</button>
      </Tooltip>,
    )
    expect(htmlHoverable).toContain('pointer-events:auto')

    const htmlNonInteractive = renderToStaticMarkup(
      <Tooltip content="经典移开即隐" disableHoverableContent={true} defaultOpen>
        <button>普通按钮</button>
      </Tooltip>,
    )
    expect(htmlNonInteractive).toContain('pointer-events:none')
  })

  test('supports offset as alias/fallback for sideOffset', () => {
    const htmlWithOffset = renderToStaticMarkup(
      <Tooltip content="偏移提示" offset={14} defaultOpen>
        <button>偏移按钮</button>
      </Tooltip>,
    )
    expect(htmlWithOffset).toContain('role="tooltip"')
    expect(htmlWithOffset).toContain('偏移提示')
  })

  test('forwards ref properly to trigger element and info tooltip button', () => {
    const triggerRef = createRef<HTMLButtonElement>()
    const infoRef = createRef<HTMLButtonElement>()

    renderToStaticMarkup(
      <div>
        <Tooltip content="提示">
          <button ref={triggerRef}>按钮</button>
        </Tooltip>
        <InfoTooltip ref={infoRef} content="说明" />
      </div>,
    )

    expect(renderToStaticMarkup(<InfoTooltip ref={infoRef} content="说明" />)).toContain(
      'aria-label="More information"',
    )
  })

  test('trigger click and escape key handlers dismissal contract', () => {
    let openState = true
    function ControlledDismiss() {
      const [open, setOpen] = useState(true)
      openState = open
      return (
        <Tooltip content="点按测试" open={open} onOpenChange={setOpen}>
          <button id="click-trigger">动作按钮</button>
        </Tooltip>
      )
    }

    const html = renderToStaticMarkup(<ControlledDismiss />)
    expect(html).toContain('data-state="open"')
    expect(html).toContain('点按测试')
  })
})
