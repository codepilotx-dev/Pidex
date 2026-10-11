import type { AgentTool } from '../../orchestration/harness/AgentTypes.ts'

interface NamedTool {
  name: string
}

export interface DeferredToolSummary {
  name: string
  label: string
  description: string
}

export type DeferredToolLoader<TTool extends NamedTool = AgentTool> = () => TTool | Promise<TTool>

export interface DeferredToolCatalogEntry<
  TTool extends NamedTool = AgentTool,
> extends DeferredToolSummary {
  load: DeferredToolLoader<TTool>
}

/**
 * Searchable catalog whose tool implementations are loaded only when selected.
 * Search never loads tools. `resolve()` and `activate()` require exact names and
 * reject unknown entries so callers cannot silently expose the wrong tool.
 */
export class DeferredToolCatalog<TTool extends NamedTool = AgentTool> {
  private readonly entries = new Map<string, DeferredToolCatalogEntry<TTool>>()
  private readonly resolved = new Map<string, TTool>()
  private readonly loading = new Map<string, Promise<TTool>>()

  constructor(entries: Iterable<DeferredToolCatalogEntry<TTool>> = []) {
    for (const entry of entries) this.register(entry)
  }

  register(entry: DeferredToolCatalogEntry<TTool>): this {
    if (!entry.name.trim()) throw new Error('Deferred tool name must not be empty')
    if (this.entries.has(entry.name)) throw new Error(`Duplicate deferred tool name: ${entry.name}`)
    this.entries.set(entry.name, { ...entry })
    return this
  }

  has(name: string): boolean {
    return this.entries.has(name)
  }

  names(): string[] {
    return [...this.entries.keys()]
  }

  search(query: string, limit = 20): DeferredToolSummary[] {
    if (!Number.isInteger(limit) || limit < 0)
      throw new Error('Search limit must be a non-negative integer')
    const normalized = query.trim().toLocaleLowerCase()
    const terms = normalized.split(/\s+/u).filter(Boolean)
    const matches = [...this.entries.values()]
      .map((entry, index) => {
        const name = entry.name.toLocaleLowerCase()
        const label = entry.label.toLocaleLowerCase()
        const description = entry.description.toLocaleLowerCase()
        const haystack = `${name}\n${label}\n${description}`
        if (terms.some((term) => !haystack.includes(term))) return undefined
        const score =
          normalized === name
            ? 0
            : name.startsWith(normalized)
              ? 1
              : label.startsWith(normalized)
                ? 2
                : 3
        return { entry, index, score }
      })
      .filter((match): match is NonNullable<typeof match> => match !== undefined)
      .sort((left, right) => left.score - right.score || left.index - right.index)
      .slice(0, limit)
    return matches.map(({ entry }) => ({
      name: entry.name,
      label: entry.label,
      description: entry.description,
    }))
  }

  async resolve(names: readonly string[]): Promise<TTool[]> {
    const uniqueNames = [...new Set(names)]
    const unknown = uniqueNames.filter((name) => !this.entries.has(name))
    if (unknown.length > 0) throw new Error(`Unknown deferred tool(s): ${unknown.join(', ')}`)

    return Promise.all(
      uniqueNames.map(async (name) => {
        const cached = this.resolved.get(name)
        if (cached) return cached
        const inFlight = this.loading.get(name)
        if (inFlight) return inFlight
        const load = Promise.resolve(this.entries.get(name)!.load()).then((tool) => {
          if (tool.name !== name) {
            throw new Error(
              `Deferred tool loader for ${name} returned mismatched tool ${tool.name}`,
            )
          }
          this.resolved.set(name, tool)
          return tool
        })
        this.loading.set(name, load)
        try {
          return await load
        } finally {
          this.loading.delete(name)
        }
      }),
    )
  }

  /** Resolve tool implementations selected for activation. */
  activate(names: readonly string[]): Promise<TTool[]> {
    return this.resolve(names)
  }
}
