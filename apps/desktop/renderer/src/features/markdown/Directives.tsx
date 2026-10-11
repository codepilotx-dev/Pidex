import { APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import React from 'react'
import { ChevronRight } from 'lucide-react'
import { DisclosureContent } from '../../components/ui/DisclosureContent.js'
import type { MarkdownDirectiveRegistry, MarkdownDirectiveRenderer } from './Types.js'

const BUILTIN_DIRECTIVES: ReadonlyArray<readonly [string, MarkdownDirectiveRenderer]> = [
  [
    'note',
    ({ argument, children, name }) => (
      <aside className="md-directive md-directive-note" data-md-directive={name}>
        {argument ? <strong>{argument}</strong> : null}
        {children}
      </aside>
    ),
  ],
  [
    'tip',
    ({ argument, children, name }) => (
      <aside className="md-directive md-directive-tip" data-md-directive={name}>
        {argument ? <strong>{argument}</strong> : null}
        {children}
      </aside>
    ),
  ],
  [
    'warning',
    ({ argument, children, name }) => (
      <aside className="md-directive md-directive-warning" data-md-directive={name}>
        {argument ? <strong>{argument}</strong> : null}
        {children}
      </aside>
    ),
  ],
  [
    'danger',
    ({ argument, children, name }) => (
      <aside className="md-directive md-directive-danger" data-md-directive={name}>
        {argument ? <strong>{argument}</strong> : null}
        {children}
      </aside>
    ),
  ],
  ['details', (props) => <DetailsDirective {...props} />],
]

function DetailsDirective({
  argument,
  children,
  name,
}: Parameters<MarkdownDirectiveRenderer>[0]): React.ReactNode {
  const [expanded, setExpanded] = React.useState(false)
  const contentId = React.useId()

  return (
    <section
      className="md-directive md-directive-details"
      data-expanded={expanded ? 'true' : 'false'}
      data-md-directive={name}
    >
      <button
        aria-controls={contentId}
        aria-expanded={expanded}
        className="md-directive-details__summary"
        onClick={() => setExpanded((current) => !current)}
        type="button"
      >
        <ChevronRight size={APP_ICON_SIZES.sm} aria-hidden="true" />
        {argument || '详情'}
      </button>
      <DisclosureContent expanded={expanded} id={contentId} mountPolicy="always">
        {children}
      </DisclosureContent>
    </section>
  )
}

export const DEFAULT_MARKDOWN_DIRECTIVES: MarkdownDirectiveRegistry = new Map(BUILTIN_DIRECTIVES)

export function createMarkdownDirectiveRegistry(
  entries: Iterable<readonly [string, MarkdownDirectiveRenderer]> = [],
): MarkdownDirectiveRegistry {
  const registry = new Map(DEFAULT_MARKDOWN_DIRECTIVES)
  for (const [name, renderer] of entries) {
    const normalizedName = normalizeDirectiveName(name)
    if (normalizedName) registry.set(normalizedName, renderer)
  }
  return registry
}

export function normalizeDirectiveName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/gu, '')
}
