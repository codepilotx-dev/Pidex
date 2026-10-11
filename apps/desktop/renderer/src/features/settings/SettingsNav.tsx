import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ScrollArea } from '../../components/ui/ScrollArea.js'
import { ArrowLeft } from 'lucide-react'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'
import { SidebarRow } from '../layout/sidebar/SidebarRow.js'
import {
  SETTINGS_GROUPS,
  SETTINGS_SEARCH_DOCUMENTS,
  type SettingsSearchDocument,
} from './SettingsRegistry.js'
import {
  resolveSettingsSectionVisibility,
  useSettingsCapabilityState,
} from './UseSettingsSectionVisibility.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { moveFocusOnArrowKey } from '../../utils/ArrowListFocus.js'

type Props = {
  activeTab: string
  workspacePath?: string | null
  onBack: () => void
  onTabChange: (tabId: string) => void
}

export function SettingsNav({ activeTab, workspacePath = null, onBack, onTabChange }: Props) {
  const { t, locale } = useLocale()
  const capabilityState = useSettingsCapabilityState()
  const itemVisibility = useMemo(() => {
    const visibility = new Map<string, { visible: boolean; pending: boolean }>()
    for (const group of SETTINGS_GROUPS) {
      for (const item of group.items) {
        visibility.set(
          item.routeId,
          resolveSettingsSectionVisibility('requires' in item ? item.requires : undefined, {
            workspacePath,
            capabilityState,
          }),
        )
      }
    }
    return visibility
  }, [capabilityState, workspacePath])
  const [searchQuery, setSearchQuery] = useState('')
  const [activeResultIndex, setActiveResultIndex] = useState(0)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const normalizedQuery = normalizeSearchText(searchQuery)
  const searchableDocuments = useMemo(
    () =>
      SETTINGS_SEARCH_DOCUMENTS.filter(
        (document) => itemVisibility.get(document.tabId)?.visible === true,
      ),
    [itemVisibility],
  )
  const searchResults = useMemo(
    () => searchSettings(normalizedQuery, t, locale, searchableDocuments),
    [normalizedQuery, t, locale, searchableDocuments],
  )

  useEffect(() => {
    setActiveResultIndex(0)
  }, [normalizedQuery])

  useEffect(() => {
    if (!normalizedQuery) return
    document
      .getElementById(`settings-search-result-${activeResultIndex}`)
      ?.scrollIntoView({ block: 'nearest' })
  }, [activeResultIndex, normalizedQuery])

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLocaleLowerCase() === 'f') {
        event.preventDefault()
        searchInputRef.current?.focus()
        searchInputRef.current?.select()
      }
    }
    window.addEventListener('keydown', focusSearch)
    return () => window.removeEventListener('keydown', focusSearch)
  }, [])

  const clearSearch = useCallback((): void => {
    setSearchQuery('')
    setActiveResultIndex(0)
    searchInputRef.current?.focus()
  }, [])

  const activateResult = useCallback(
    (result: SettingsSearchDocument): void => {
      onTabChange(result.tabId)
      scrollToSettingsTarget(result)
    },
    [onTabChange],
  )

  const handleSearchKeyDown = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === 'Escape') {
      if (searchQuery) {
        event.preventDefault()
        clearSearch()
      } else {
        searchInputRef.current?.blur()
      }
      return
    }
    if (!normalizedQuery || searchResults.length === 0) return
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      const direction = event.key === 'ArrowDown' ? 1 : -1
      setActiveResultIndex(
        (index) => (index + direction + searchResults.length) % searchResults.length,
      )
      return
    }
    if (event.key === 'Enter') {
      event.preventDefault()
      const result = searchResults[activeResultIndex]
      if (result) activateResult(result)
    }
  }

  return (
    <ScrollArea
      aria-label={t('设置分类')}
      className="settings-nav-scroll-area tw:min-h-0 tw:flex-1 tw:overflow-x-hidden"
      contentClassName="settings-nav-scroll-content tw:flex tw:min-w-0 tw:flex-col tw:gap-4 tw:px-2"
    >
      <div className="settings-nav-header tw:grid tw:shrink-0 tw:gap-3">
        <SidebarRow
          asChild
          className="settings-back-btn tw:mb-2 tw:type-row-title"
          layout="flex"
          leading={<ArrowLeft size={APP_ICON_SIZE} />}
        >
          <button onClick={onBack} type="button">
            <span>{t('返回应用')}</span>
          </button>
        </SidebarRow>
        <SearchInput
          ref={searchInputRef}
          aria-label={t('搜索设置')}
          className="settings-nav-search tw:w-full"
          mode="combobox"
          controls="settings-search-results"
          expanded={Boolean(normalizedQuery)}
          activeDescendant={
            normalizedQuery && searchResults[activeResultIndex]
              ? `settings-search-result-${activeResultIndex}`
              : undefined
          }
          onChange={setSearchQuery}
          onEscapeEmpty={() => searchInputRef.current?.blur()}
          onKeyDown={handleSearchKeyDown}
          placeholder={t('搜索设置...')}
          value={searchQuery}
          variant="standard"
        />
      </div>
      <div
        className="settings-nav-menu tw:flex tw:w-full tw:min-w-0 tw:flex-col tw:gap-4"
        onKeyDown={(event) => moveFocusOnArrowKey(event, '.settings-nav-item')}
      >
        {normalizedQuery ? (
          <SearchResults
            t={t}
            activeIndex={activeResultIndex}
            onActivate={activateResult}
            onActiveIndexChange={setActiveResultIndex}
            results={searchResults}
          />
        ) : (
          SETTINGS_GROUPS.map((group) => {
            const visibleItems = group.items.filter(
              (item) => itemVisibility.get(item.routeId)?.visible === true,
            )
            if (visibleItems.length === 0) return null
            return (
              <section className="settings-nav-group tw:grid" key={group.title}>
                <div className="settings-nav-group-title-row tw:min-w-0 tw:px-2 tw:py-1">
                  <h2 className="settings-nav-group-title tw:m-0 tw:text-app-text-meta tw:type-row-title">
                    {t(group.title)}
                  </h2>
                </div>
                <div className="settings-nav-group-items tw:grid">
                  {visibleItems.map((item) => {
                    const pending = itemVisibility.get(item.routeId)?.pending === true
                    return (
                      <SidebarRow
                        active={activeTab === item.routeId}
                        asChild
                        className={
                          pending
                            ? 'settings-nav-item tw:type-row-title tw:whitespace-nowrap tw:opacity-50'
                            : 'settings-nav-item tw:type-row-title tw:whitespace-nowrap'
                        }
                        key={item.id}
                        layout="flex"
                        leading={<item.icon className="settings-nav-icon tw:text-current" />}
                      >
                        <button
                          disabled={pending}
                          onClick={() => onTabChange(item.routeId)}
                          type="button"
                        >
                          <span>{t(item.label)}</span>
                        </button>
                      </SidebarRow>
                    )
                  })}
                </div>
              </section>
            )
          })
        )}
      </div>
    </ScrollArea>
  )
}

type SearchResultsProps = {
  t: (source: string) => string
  activeIndex: number
  onActivate: (result: SettingsSearchDocument) => void
  onActiveIndexChange: (index: number) => void
  results: readonly SettingsSearchDocument[]
}

function SearchResults({
  t,
  activeIndex,
  onActivate,
  onActiveIndexChange,
  results,
}: SearchResultsProps): React.ReactNode {
  if (results.length === 0) {
    return (
      <div className="settings-search-results" id="settings-search-results" role="listbox">
        <p className="settings-search-empty tw:m-0 tw:px-2 tw:py-4 tw:text-app-text-soft tw:type-body-sm">
          {t('未找到匹配的设置')}
        </p>
      </div>
    )
  }
  return (
    <div
      aria-label={t('设置搜索结果')}
      className="settings-search-results tw:grid"
      id="settings-search-results"
      role="listbox"
    >
      {results.map((result, index) => {
        const selected = index === activeIndex
        return (
          <button
            aria-selected={selected}
            className="settings-search-result tw:grid tw:w-full tw:min-w-0 tw:grid-cols-[minmax(0,1fr)] tw:gap-0.5 tw:rounded-container tw:p-2 tw:text-left tw:text-app-text tw:outline-none tw:hover:bg-app-hover tw:aria-selected:bg-app-selected tw:focus-visible:outline-solid tw:focus-visible:outline-2 tw:focus-visible:outline-offset-0 tw:focus-visible:outline-app-focus"
            id={`settings-search-result-${index}`}
            key={result.key}
            onClick={() => onActivate(result)}
            onMouseEnter={() => onActiveIndexChange(index)}
            role="option"
            tabIndex={-1}
            type="button"
          >
            <span className="settings-search-result-heading tw:flex tw:min-w-0 tw:items-baseline tw:gap-2">
              <span className="settings-search-result-title tw:min-w-0 tw:truncate tw:type-row-title">
                {t(result.rowTitle ?? result.pageLabel)}
              </span>
              {result.rowTitle ? (
                <span className="settings-search-result-page tw:shrink-0 tw:text-app-text-meta tw:type-caption">
                  {t(result.pageLabel)}
                </span>
              ) : null}
            </span>
            <span className="settings-search-result-description tw:line-clamp-2 tw:text-app-text-soft tw:type-caption">
              {t(result.description)}
            </span>
          </button>
        )
      })}
    </div>
  )
}

function normalizeSearchText(value: string): string {
  return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ')
}

function searchSettings(
  query: string,
  t: (source: string) => string = (source) => source,
  locale = 'zh-CN',
  documents: readonly SettingsSearchDocument[] = SETTINGS_SEARCH_DOCUMENTS,
): readonly SettingsSearchDocument[] {
  if (!query) return []
  const terms = query.split(' ')
  return documents
    .map((document) => ({
      document,
      score: Math.max(
        scoreSearchDocument(document, terms),
        scoreSearchDocument(
          {
            ...document,
            groupTitle: t(document.groupTitle),
            pageLabel: t(document.pageLabel),
            rowTitle: document.rowTitle ? t(document.rowTitle) : undefined,
            description: t(document.description),
          },
          terms,
        ),
      ),
    }))
    .filter((result) => result.score > 0)
    .sort(
      (left, right) =>
        right.score - left.score ||
        left.document.pageLabel.localeCompare(right.document.pageLabel, locale),
    )
    .slice(0, 40)
    .map((result) => result.document)
}

function scoreSearchDocument(document: SettingsSearchDocument, terms: readonly string[]): number {
  const page = normalizeSearchText(document.pageLabel)
  const rowTitle = normalizeSearchText(document.rowTitle ?? '')
  const description = normalizeSearchText(document.description)
  const group = normalizeSearchText(document.groupTitle)
  let total = 0
  for (const term of terms) {
    const pageScore = scoreSearchField(page, term, 160, 130, 95)
    const rowScore = scoreSearchField(rowTitle, term, 130, 100, 75)
    const descriptionScore = description.includes(term) ? 35 : 0
    const groupScore = group.includes(term) ? 20 : 0
    const termScore = Math.max(pageScore, rowScore, descriptionScore, groupScore)
    if (termScore === 0) return 0
    total += termScore
  }
  return total + (document.rowTitle ? 5 : 0)
}

function scoreSearchField(
  field: string,
  term: string,
  exact: number,
  prefix: number,
  contains: number,
): number {
  if (!field) return 0
  if (field === term) return exact
  if (field.startsWith(term)) return prefix
  return field.includes(term) ? contains : 0
}

function scrollToSettingsTarget(result: SettingsSearchDocument): void {
  let attempts = 0
  const locate = (): void => {
    attempts += 1
    const registeredTarget = document.getElementById(result.targetId)
    const candidates = document.querySelectorAll<HTMLElement>(
      '.settings-row-title, .settings-section-title, .settings-page-title',
    )
    const heading = [...candidates].find(
      (candidate) => candidate.textContent?.trim() === (result.rowTitle ?? result.pageLabel),
    )
    const target =
      registeredTarget ??
      heading?.closest<HTMLElement>('.settings-row, .settings-section') ??
      heading
    if (!target) {
      if (attempts < 12) {
        window.setTimeout(locate, 25)
      } else if (!result.rowTitle) {
        document
          .querySelector<HTMLElement>('.settings-content-area')
          ?.scrollTo({ behavior: 'auto', top: 0 })
      }
      return
    }
    target.id = result.targetId
    target.tabIndex = -1
    target.scrollIntoView({ behavior: 'auto', block: 'center' })
    target.focus({ preventScroll: true })
    flashSettingsTarget(target)
  }
  window.setTimeout(locate, 0)
}

function flashSettingsTarget(target: HTMLElement): void {
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  if (reduceMotion || typeof target.animate !== 'function') return
  target
    .animate(
      [
        { backgroundColor: 'var(--cpx-sys-color-hover)' },
        { backgroundColor: 'var(--cpx-sys-color-hover)', offset: 0.35 },
        { backgroundColor: 'transparent' },
      ],
      { duration: 450, easing: 'ease-out' },
    )
    .finished.catch(() => {})
}
