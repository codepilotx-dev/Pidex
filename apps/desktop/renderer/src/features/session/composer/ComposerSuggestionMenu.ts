import type { ComposerMenuItem } from './ComposerCommandMenu.js'

export function composerMenuScrollTop(
  scrollTop: number,
  viewportHeight: number,
  itemTop: number,
  itemBottom: number,
): number {
  if (itemTop < 0) return Math.max(0, scrollTop + itemTop)
  if (itemBottom > viewportHeight) return scrollTop + itemBottom - viewportHeight
  return scrollTop
}

function subsequence(query: string, value: string): boolean {
  let index = 0
  for (const char of value) if (char === query[index]) index++
  return index === query.length
}

function score(item: ComposerMenuItem, query: string): number {
  const names = [item.label, item.command?.trigger ?? ''].map((name) => name.toLocaleLowerCase())
  if (names.some((name) => name === query)) return 0
  if (names.some((name) => name.startsWith(query))) return 1
  if ([...names, item.searchPath?.toLocaleLowerCase() ?? ''].some((name) => name.includes(query)))
    return 2
  if (
    (item.description ?? '').toLocaleLowerCase().includes(query) ||
    item.matchText.toLocaleLowerCase().includes(query)
  )
    return 3
  if (
    !/\p{Script=Han}/u.test(query) &&
    [...names, item.searchPath?.toLocaleLowerCase() ?? ''].some((name) => subsequence(query, name))
  )
    return 4
  return Infinity
}

export function filterComposerMenuItems(
  items: readonly ComposerMenuItem[],
  keyword: string,
): ComposerMenuItem[] {
  const query = keyword.trim().toLocaleLowerCase()
  if (!query) return [...items]
  return items
    .filter((item) => !item.status)
    .map((item, index) => ({ item, index, score: score(item, query) }))
    .filter((entry) => Number.isFinite(entry.score))
    .sort((a, b) => a.score - b.score || a.index - b.index)
    .map((entry) => entry.item)
}

export function buildComposerSuggestionItems(
  source: readonly ComposerMenuItem[],
  keyword: string,
  category: string | null,
  onCategoryChange: (category: string | null) => void,
): ComposerMenuItem[] {
  const query = keyword.trim()
  const visible = source
    .filter((item) => (category ? item.section === category : !item.categoryOnly))
    .map((item) =>
      item.category
        ? {
            ...item,
            completion: 'category' as const,
            onSelect: () => onCategoryChange(item.category!),
          }
        : item,
    )
  const matches = filterComposerMenuItems(visible, keyword)
  const statuses = visible.filter((item) => item.status)
  if (category) {
    return [
      {
        key: 'category:back',
        label: '返回全部',
        icon: '←',
        matchText: '',
        onSelect: () => onCategoryChange(null),
      },
      ...matches.filter((item) => !item.status),
      ...statuses,
    ]
  }
  if (query)
    return [...matches.slice(0, 8).map((item) => ({ ...item, section: undefined })), ...statuses]
  const sections = new Map<string, ComposerMenuItem[]>()
  for (const item of matches) {
    const group = sections.get(item.section ?? '') ?? []
    group.push(item)
    sections.set(item.section ?? '', group)
  }
  return [...sections.values()].flat()
}

export function nextEnabledMenuIndex(
  items: readonly ComposerMenuItem[],
  current: number,
  direction: 1 | -1,
): number {
  for (let count = 0, index = current; count < items.length; count++) {
    index = (index + direction + items.length) % items.length
    if (!items[index]?.disabled && !items[index]?.status) return index
  }
  return -1
}

export function resolveComposerMenuActiveKey(
  items: readonly ComposerMenuItem[],
  storedKey: string | null,
): string | null {
  return items.some((item) => item.key === storedKey && !item.disabled && !item.status)
    ? storedKey
    : (items[nextEnabledMenuIndex(items, -1, 1)]?.key ?? null)
}
