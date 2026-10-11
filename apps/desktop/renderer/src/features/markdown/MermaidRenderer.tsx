import React, { useEffect, useId, useRef, useState } from 'react'
import { LazyRender } from './LazyRender.js'

type MermaidModule = {
  default?: MermaidApi
  initialize?: MermaidApi['initialize']
  render?: MermaidApi['render']
}

type MermaidApi = {
  initialize: (config: Record<string, unknown>) => void
  render: (id: string, definition: string) => Promise<{ svg: string } | string>
}

export function MermaidRenderer({ definition }: { definition: string }): React.ReactNode {
  const fallback = (
    <pre className="md-mermaid-fallback">
      <code>{definition}</code>
    </pre>
  )
  return (
    <LazyRender fallback={fallback}>
      <MermaidContent definition={definition} fallback={fallback} />
    </LazyRender>
  )
}

function MermaidContent({
  definition,
  fallback,
}: {
  definition: string
  fallback: React.ReactNode
}): React.ReactNode {
  const reactId = useId()
  const hostRef = useRef<HTMLDivElement | null>(null)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const host = hostRef.current
    if (!host) return
    let cancelled = false
    host.replaceChildren()
    setFailed(false)

    void import('mermaid')
      .then(async (module) => {
        const api = ((module as MermaidModule).default ?? module) as MermaidApi
        api.initialize({
          securityLevel: 'strict',
          startOnLoad: false,
          suppressErrorRendering: true,
        })
        const safeId = `md-mermaid-${reactId.replace(/[^a-zA-Z0-9_-]/gu, '')}`
        const result = await api.render(safeId, definition)
        if (cancelled) return
        const svg = typeof result === 'string' ? result : result.svg
        const svgElement = parseSafeMermaidSvg(svg)
        if (!svgElement) throw new Error('Mermaid returned an invalid SVG.')
        host.replaceChildren(svgElement)
      })
      .catch(() => {
        if (!cancelled) setFailed(true)
      })
    return () => {
      cancelled = true
      host.replaceChildren()
    }
  }, [definition, reactId])

  if (failed) return fallback
  return <div aria-label="Mermaid diagram" className="md-mermaid" ref={hostRef} role="img" />
}

function parseSafeMermaidSvg(source: string): SVGElement | null {
  if (typeof DOMParser === 'undefined') return null
  const document = new DOMParser().parseFromString(source, 'image/svg+xml')
  if (document.querySelector('parsererror')) return null
  const root = document.documentElement
  if (root.localName.toLowerCase() !== 'svg') return null
  for (const forbidden of root.querySelectorAll('script, foreignObject, iframe, object, embed')) {
    forbidden.remove()
  }
  for (const element of [root, ...root.querySelectorAll('*')]) {
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase()
      const value = attribute.value.trim().toLowerCase()
      if (
        name.startsWith('on') ||
        ((name === 'href' || name.endsWith(':href')) && /^(?:javascript|data|file):/u.test(value))
      ) {
        element.removeAttribute(attribute.name)
      }
    }
  }
  return document.importNode(root, true) as unknown as SVGElement
}
