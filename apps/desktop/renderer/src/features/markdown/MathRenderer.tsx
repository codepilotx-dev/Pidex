import React, { useEffect, useRef, useState } from 'react'
import { LazyRender } from './LazyRender.js'

type KatexModule = {
  default?: {
    render: RenderKatex
  }
  render?: RenderKatex
}

type KatexOptions = {
  displayMode: boolean
  throwOnError: boolean
  trust: boolean
}

type RenderKatex = (expression: string, element: HTMLElement, options: KatexOptions) => void

export function MathRenderer({
  display,
  expression,
}: {
  display: boolean
  expression: string
}): React.ReactNode {
  const fallback = display ? (
    <pre className="md-math-fallback">
      <code>{expression}</code>
    </pre>
  ) : (
    <code className="md-math-fallback">{expression}</code>
  )
  return (
    <LazyRender fallback={fallback}>
      <KatexContent display={display} expression={expression} fallback={fallback} />
    </LazyRender>
  )
}

function KatexContent({
  display,
  expression,
  fallback,
}: {
  display: boolean
  expression: string
  fallback: React.ReactNode
}): React.ReactNode {
  const hostRef = useRef<HTMLSpanElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    host.replaceChildren()
    setFailed(false)

    void import('katex')
      .then((module) => {
        if (cancelled) return
        const katex = (module as KatexModule).default ?? module
        const render = katex.render
        if (!render) throw new Error('KaTeX render API is unavailable.')
        render(expression, host, {
          displayMode: display,
          throwOnError: true,
          trust: false,
        })
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      host.replaceChildren()
    }
  }, [display, expression])

  if (failed) return fallback
  return (
    <span
      aria-label={expression}
      className={display ? 'md-math md-math-display' : 'md-math md-math-inline'}
      ref={hostRef}
    />
  )
}
