import React from 'react'
import { Brain, ChevronRight } from 'lucide-react'
import { AnimatePresence, motion } from 'motion/react'
import type { Item } from '@pidex/shared/thread'
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '../../../components/ui/Collapsible.js'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'
import { useScrollEdgeState } from '../../../hooks/UseScrollEdgeState.js'
import { useLiveItemTail } from '../state/UseLiveItemTail.js'
import type { ResolvedCanonicalItemDisclosure } from './CanonicalItemRenderer.js'
import {
  commandOutputFollowing,
  commandOutputScrollTop,
  isCommandOutputAtBottom,
} from './ToolCommandCard.js'
import {
  enqueueReasoningLine,
  reasoningLatestLine,
  reasoningPlaybackQueue,
  type ReasoningLine,
} from './ReasoningPresentation.js'

const REASONING_ROLL_INTERVAL_MS = 300 + 500

function ReasoningPreview({ line }: { line: ReasoningLine }): React.ReactNode {
  const reducedMotion = usePrefersReducedMotion()
  const [displayed, setDisplayed] = React.useState(line)
  const current = React.useRef(line)
  const queue = React.useRef<ReasoningLine[]>([])
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)
  const viewport = React.useRef<HTMLSpanElement>(null)
  const content = React.useRef<HTMLSpanElement>(null)
  const edge = useScrollEdgeState(viewport, { axis: 'x', contentRef: content })

  React.useEffect(() => {
    const promote = (next: ReasoningLine): void => {
      current.current = next
      setDisplayed(next)
      const expectedAt = performance.now() + REASONING_ROLL_INTERVAL_MS
      timer.current = setTimeout(() => {
        timer.current = null
        const [pending, ...rest] = reasoningPlaybackQueue(
          queue.current,
          performance.now() - expectedAt,
        )
        queue.current = rest
        if (pending) promote(pending)
      }, REASONING_ROLL_INTERVAL_MS)
    }
    if (reducedMotion) {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      queue.current = []
      current.current = line
      setDisplayed(line)
    } else if (current.current.lineIndex === line.lineIndex) {
      current.current = line
      setDisplayed(line)
    } else if (timer.current !== null) {
      queue.current = enqueueReasoningLine(queue.current, line)
    } else {
      promote(line)
    }
  }, [line.lineIndex, line.text, reducedMotion])

  React.useEffect(
    () => () => {
      if (timer.current !== null) clearTimeout(timer.current)
      timer.current = null
      queue.current = []
    },
    [],
  )

  React.useLayoutEffect(() => {
    const element = viewport.current
    if (!element) return
    const follow = (): void => {
      element.scrollLeft = element.scrollWidth
    }
    follow()
    const observer = new ResizeObserver(follow)
    observer.observe(element)
    if (content.current) observer.observe(content.current)
    return () => observer.disconnect()
  }, [displayed.text])

  const visible = reducedMotion ? line : displayed
  return (
    <span className="reasoning-node__preview" ref={viewport} data-overflow={edge.scrollable}>
      <span className="reasoning-node__preview-text" ref={content}>
        {reducedMotion ? (
          visible.text
        ) : (
          <AnimatePresence initial={false} mode="popLayout">
            <motion.span
              key={visible.lineIndex}
              className="reasoning-node__rolling-line"
              initial={{ y: '0.8em', opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: '-0.8em', opacity: 0 }}
              transition={{ duration: 0.3, ease: [0.4, 0, 0.2, 1] }}
            >
              {visible.text}
            </motion.span>
          </AnimatePresence>
        )}
      </span>
    </span>
  )
}

export function ReasoningItemView({
  item,
  disclosure,
  threadId,
}: {
  item: Extract<Item, { type: 'reasoning' }>
  disclosure?: ResolvedCanonicalItemDisclosure
  threadId?: string
}): React.ReactNode {
  const tail = useLiveItemTail(threadId, item.id)
  const fullText = item.text + tail
  const active = item.status === 'streaming'
  const [localExpanded, setLocalExpanded] = React.useState(false)
  const expanded = disclosure?.expanded ?? localExpanded
  const reducedMotion = usePrefersReducedMotion()
  const scroller = React.useRef<HTMLDivElement>(null)
  const shimmerId = React.useId()
  const content = React.useRef<HTMLDivElement>(null)
  const following = React.useRef(active)
  const wasExpanded = React.useRef(false)
  const hasText = Boolean(fullText.trim())
  const edge = useScrollEdgeState(scroller, { contentRef: content, version: expanded && hasText })

  React.useLayoutEffect(() => {
    following.current = commandOutputFollowing(
      active,
      expanded,
      wasExpanded.current,
      following.current,
    )
    wasExpanded.current = expanded
    if (expanded && scroller.current) {
      scroller.current.scrollTop = commandOutputScrollTop(
        scroller.current,
        active,
        following.current,
      )
    }
  }, [active, expanded, fullText])

  if (!hasText) return null
  const line = active && !expanded ? reasoningLatestLine(fullText) : null
  return (
    <Collapsible
      className="reasoning-node tw:type-body-sm"
      open={expanded}
      onOpenChange={(next) => {
        if (disclosure) disclosure.onExpandedChange(disclosure.id, next)
        else setLocalExpanded(next)
      }}
      data-reduced-motion={reducedMotion}
    >
      <CollapsibleTrigger
        className="cpx-agent-activity__item-header reasoning-node__header"
        type="button"
      >
        <Brain size={APP_ICON_SIZES.sm} className="tw:shrink-0" aria-hidden="true" />
        <span className="reasoning-node__label" data-active={active}>
          {active ? '正在思考' : item.status === 'interrupted' ? '思考已中断' : '思考'}
          {active && !reducedMotion ? (
            // 文本遮罩让扫光只移动 transform，避免逐帧重绘文字背景。
            <svg className="reasoning-node__shimmer" aria-hidden="true" width="100%" height="100%">
              <defs>
                <mask id={`${shimmerId}-mask`}>
                  <text
                    x="0"
                    y="50%"
                    dy=".35em"
                    textLength="100%"
                    lengthAdjust="spacingAndGlyphs"
                    fill="white"
                  >
                    正在思考
                  </text>
                </mask>
                <linearGradient id={`${shimmerId}-gradient`}>
                  <stop offset="0" stopColor="currentColor" stopOpacity="0" />
                  <stop offset=".5" stopColor="currentColor" />
                  <stop offset="1" stopColor="currentColor" stopOpacity="0" />
                </linearGradient>
              </defs>
              <g mask={`url(#${shimmerId}-mask)`}>
                <rect
                  className="reasoning-node__sweep"
                  width="100%"
                  height="100%"
                  fill={`url(#${shimmerId}-gradient)`}
                />
              </g>
            </svg>
          ) : null}
        </span>
        {line ? (
          <>
            <span aria-hidden="true">·</span>
            <ReasoningPreview line={line} />
          </>
        ) : null}
        <ChevronRight
          size={APP_ICON_SIZES.sm}
          className="reasoning-node__chevron"
          aria-hidden="true"
        />
      </CollapsibleTrigger>
      <CollapsibleContent expanded={expanded}>
        <div className="reasoning-node__detail">
          <div
            className="execution-plan-card__edge-fade"
            data-at-start={edge.atStart}
            data-at-end={edge.atEnd}
            data-scrollable={edge.scrollable}
          >
            <div
              ref={scroller}
              className="reasoning-node__scroller"
              tabIndex={0}
              role="region"
              aria-label="思考文本"
              onScroll={(event) => {
                following.current = isCommandOutputAtBottom(event.currentTarget)
              }}
            >
              <div ref={content} className="reasoning-node__text">
                {fullText}
              </div>
            </div>
          </div>
        </div>
      </CollapsibleContent>
    </Collapsible>
  )
}
