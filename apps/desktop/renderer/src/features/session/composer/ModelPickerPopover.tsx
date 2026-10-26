import {
  APP_ICON_SIZES,
  APP_ICON_STROKE_WIDTH,
  APP_ICON_SIZE,
} from '../../../components/ui/IconTokens.js'
import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Popover as Popover } from '../../../components/ui/floating/Popover.js'
import { Brain, Check, ChevronLeft, Eye, Plus, Search, X } from 'lucide-react'
import type { DesktopModelMetadata, DesktopModelProviderSummary, ModelProviderID } from '../../../../shared/Types.js'
import { sortModelPresetsByName, type ModelPreset } from '../../../ModelPresets.js'
import { modelCapabilityBadges } from './ModelCapabilitySummary.js'
import { centeredScrollTop } from './CenterSelectedModel.js'
import { cx } from '../../../utils/Cx.js'
import { ProviderLogo } from './ProviderLogos.js'
import { modelLogoURL } from '../../../services/desktop-client/ModelLogo.js'
import { OverflowTitle } from '../../../components/ui/OverflowTitle.js'
import { usePrefersReducedMotion } from '../../../hooks/UsePrefersReducedMotion.js'

/*
 * Integrated model picker. `.composer-model-name` and `.composer-reasoning-menu-*`
 * keep their font in `src/styles/primitives/composer.css` (the selected state
 * raises the weight, which cannot be a utility next to the `font` shorthand
 * roles), and the provider/model lists hide their scrollbar there too. The same
 * file owns the model name's overflow fade and scroll rules, because the name is
 * measured at runtime by `OverflowTitle`.
 */
const PANEL_CONTENT_CLASS = 'composer-model-panel-content tw:overflow-hidden'
const PANEL_CLASS =
  'composer-model-panel tw:flex tw:h-97.5 tw:w-full tw:select-none tw:overflow-hidden'
const PROVIDER_RAIL_CLASS = cx(
  'composer-provider-rail tw:flex tw:h-full tw:w-14 tw:shrink-0 tw:flex-col tw:items-center tw:justify-between',
  'tw:border-r tw:border-app-border-subtle tw:bg-transparent tw:px-1.5 tw:py-2.5',
)
const PROVIDER_LIST_CLASS =
  'composer-provider-list tw:flex tw:w-full tw:flex-1 tw:flex-col tw:items-center tw:gap-2 tw:overflow-y-auto tw:py-0.5'
const PROVIDER_BUTTON_CLASS = cx(
  'composer-provider-btn tw:flex tw:size-9 tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center',
  'tw:rounded-control tw:border-0 tw:text-app-text-soft',
  'tw:transition-[background-color,color] tw:duration-feedback tw:ease-standard',
  'tw:hover:bg-app-hover tw:hover:text-app-text',
)
const PROVIDER_BUTTON_IDLE_CLASS = 'tw:bg-transparent'
const PROVIDER_BUTTON_ACTIVE_CLASS =
  'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_8%,transparent)] tw:text-app-text'
const HUB_TRIGGER_BUTTON_CLASS = cx(
  'composer-hub-trigger-btn tw:flex tw:size-9 tw:shrink-0 tw:cursor-pointer tw:items-center tw:justify-center',
  'tw:rounded-control tw:border-0 tw:text-app-text-soft',
  'tw:transition-[background-color,color] tw:duration-feedback tw:ease-standard',
  'tw:hover:bg-app-hover tw:hover:text-app-text',
)
const HUB_TRIGGER_WRAP_CLASS = cx(
  'composer-hub-trigger-wrap tw:mt-1 tw:flex tw:w-full tw:shrink-0 tw:flex-col tw:items-center',
  'tw:border-t tw:border-app-border-subtle tw:pt-2',
)
const MODEL_RIGHT_CLASS = cx(
  'composer-model-right tw:relative tw:flex tw:h-full tw:min-w-0 tw:flex-1 tw:flex-col tw:justify-between',
  'tw:overflow-hidden tw:rounded-r-container tw:bg-app-raised tw:p-2.5',
)
const MODELS_HEADER_CLASS = cx(
  'composer-models-header tw:relative tw:mb-2 tw:flex tw:h-9 tw:shrink-0 tw:items-center tw:justify-between tw:gap-2 tw:px-1',
)
const MODELS_HEADER_LEAD_CLASS =
  'composer-models-header-lead tw:flex tw:shrink-0 tw:items-center tw:gap-1.5'
const MODELS_HEADER_ACTIONS_CLASS =
  'composer-models-header-actions tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:justify-end'
const MODELS_TITLE_CLASS =
  'composer-models-title tw:shrink-0 tw:tracking-[-0.01em] tw:text-app-text'
const HUB_BACK_CLASS = cx(
  'composer-hub-back tw:inline-flex tw:size-6 tw:cursor-pointer tw:items-center tw:justify-center',
  'tw:rounded-sm tw:border-0 tw:bg-transparent tw:text-app-text-soft',
  'tw:transition-[background-color,color] tw:duration-feedback tw:ease-standard',
  'tw:hover:bg-app-hover tw:hover:text-app-text',
)
const SEARCH_TRIGGER_CLASS = cx(
  'composer-search-trigger tw:flex tw:cursor-pointer tw:items-center tw:gap-1.5 tw:border-0 tw:bg-transparent',
  'tw:text-app-text-meta tw:type-control',
  'tw:transition-colors tw:duration-feedback tw:ease-standard tw:hover:text-app-text',
)
const SEARCH_BAR_CLASS =
  'composer-search-bar tw:relative tw:flex tw:w-full tw:max-w-52.5 tw:items-center'
const HUB_SEARCH_BAR_CLASS =
  'composer-hub-search-bar tw:relative tw:flex tw:w-full tw:max-w-50 tw:items-center'
const SEARCH_BAR_ICON_CLASS =
  'composer-search-bar-icon tw:pointer-events-none tw:absolute tw:left-2.5 tw:text-app-text-meta'
const SEARCH_INPUT_CLASS = cx(
  'composer-search-input tw:h-7 tw:w-full tw:rounded-control tw:border tw:border-app-border-subtle',
  'tw:bg-app-control tw:py-1 tw:ps-8 tw:pe-7 tw:text-app-text tw:type-secondary',
  'tw:outline-none tw:transition-colors tw:duration-feedback tw:ease-standard tw:focus:border-app-focus',
  'tw:placeholder:text-app-text-meta',
)
const HUB_SEARCH_INPUT_CLASS = cx(
  'composer-hub-search-input tw:h-7 tw:w-full tw:rounded-control tw:border tw:border-app-border-subtle',
  'tw:bg-app-control tw:py-1 tw:ps-8 tw:pe-2.5 tw:text-app-text tw:type-caption',
  'tw:outline-none tw:transition-colors tw:duration-feedback tw:ease-standard tw:focus:border-app-focus',
  'tw:placeholder:text-app-text-meta',
)
const SEARCH_CLEAR_CLASS = cx(
  'composer-search-clear tw:absolute tw:right-1.5 tw:inline-flex tw:size-4 tw:cursor-pointer tw:items-center tw:justify-center',
  'tw:rounded-full tw:border-0 tw:bg-transparent tw:text-app-text-meta',
  'tw:hover:bg-app-hover tw:hover:text-app-text',
)
const PICKER_VIEW_CLASS =
  'composer-picker-view tw:flex tw:min-h-0 tw:flex-1 tw:flex-col tw:overflow-hidden'
const MODELS_EMPTY_CLASS =
  'composer-models-empty tw:px-3 tw:py-8 tw:text-center tw:text-app-text-meta tw:type-caption'
const MODELS_LIST_CLASS =
  'composer-models-list tw:flex tw:flex-1 tw:flex-col tw:gap-1 tw:overflow-y-auto tw:pr-0.5'
const HUB_LIST_CLASS =
  'composer-models-list composer-hub-list tw:flex tw:flex-1 tw:flex-col tw:gap-1.5 tw:overflow-y-auto tw:px-0.5'
const MODEL_ROW_CLASS = cx(
  'composer-model-row tw:group tw:flex tw:min-h-8.5 tw:cursor-pointer tw:items-center tw:justify-between',
  'tw:rounded-control tw:px-3 tw:py-2',
  'tw:transition-colors tw:duration-feedback tw:ease-standard tw:hover:bg-app-hover',
)
const MODEL_ROW_SELECTED_CLASS =
  'is-selected tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_6%,transparent)]'
const MODEL_ROW_MAIN_CLASS =
  'composer-model-row-main tw:flex tw:min-w-0 tw:items-center tw:gap-2.5 tw:pr-0.5'
const MODEL_ROW_ICON_CLASS = 'composer-model-row-icon tw:size-icon-md tw:shrink-0 tw:text-app-text'
const MODEL_ROW_TRAILING_CLASS =
  'composer-model-row-trailing tw:flex tw:shrink-0 tw:items-center tw:gap-2'
const MODEL_MARK_CLASS = cx(
  'composer-model-row-mark tw:flex tw:size-4.5 tw:shrink-0 tw:items-center tw:justify-center',
  'tw:text-app-accent-fg',
)
const CAPABILITIES_CLASS =
  'composer-model-capabilities tw:hidden tw:shrink-0 tw:items-center tw:gap-1 tw:group-hover:flex'
const CAPABILITY_CHIP_CLASS = cx(
  'composer-model-capability tw:inline-flex tw:h-4.5 tw:shrink-0 tw:items-center tw:justify-center tw:gap-1',
  'tw:rounded-indicator tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_9%,transparent)]',
  'tw:px-1.5 tw:text-app-text-soft tw:type-label tw:tabular-nums',
)
const HUB_ROW_CLASS = cx(
  'composer-hub-row tw:flex tw:cursor-pointer tw:items-center tw:justify-between tw:gap-2.5',
  'tw:rounded-control tw:border tw:border-app-border-subtle tw:bg-app-control tw:p-2',
  'tw:transition-colors tw:duration-feedback tw:ease-standard tw:hover:bg-app-hover',
)
const HUB_ROW_MAIN_CLASS =
  'composer-hub-row-main tw:flex tw:min-w-0 tw:flex-1 tw:items-center tw:gap-2.5'
const HUB_ROW_LOGO_CLASS = cx(
  'composer-hub-row-logo tw:flex tw:size-8 tw:shrink-0 tw:items-center tw:justify-center',
  'tw:rounded-item tw:border tw:border-app-border-subtle tw:bg-app-panel tw:text-app-text-soft',
)
const HUB_ROW_TEXT_CLASS = 'composer-hub-row-text tw:min-w-0 tw:flex-1'
const HUB_ROW_TITLE_CLASS = 'composer-hub-row-title tw:flex tw:min-w-0 tw:items-center tw:gap-1.5'
const HUB_ROW_NAME_CLASS =
  'composer-hub-row-name tw:truncate tw:tracking-[-0.01em] tw:text-app-text'
const HUB_ROW_DESC_CLASS =
  'composer-hub-row-desc tw:mt-0.5 tw:truncate tw:text-app-text-soft tw:type-caption'
const HUB_BADGE_CLASS = cx(
  'composer-hub-badge tw:shrink-0 tw:rounded-indicator tw:px-1.5 tw:py-px tw:type-label',
  'tw:bg-[color-mix(in_srgb,var(--cpx-sys-color-fg-primary)_10%,transparent)] tw:text-app-text-soft',
)
const HUB_ROW_ACTIONS_CLASS =
  'composer-hub-row-actions tw:flex tw:shrink-0 tw:items-center tw:gap-1.5'
const HUB_BADGE_CONNECTED_CLASS = cx(
  'composer-hub-badge-connected tw:shrink-0 tw:rounded-compact tw:border tw:border-app-success-border',
  'tw:bg-app-success-subtle tw:px-2 tw:py-0.5 tw:type-label tw:text-app-success',
)
const HUB_ACTION_BUTTON_CLASS = cx(
  'composer-hub-action-btn tw:shrink-0 tw:cursor-pointer tw:rounded-compact tw:border tw:border-app-border-subtle',
  'tw:bg-app-panel tw:px-2 tw:py-0.5 tw:text-app-text',
  'tw:transition-colors tw:duration-feedback tw:ease-standard tw:hover:bg-app-hover',
)

export type ProviderModelOption = {
  providerID: ModelProviderID
  displayName: string
  modelPresets: ModelPreset[]
  logoURL?: string
  modelMetadata?: Record<string, DesktopModelMetadata>
}

export type ModelPickerPopoverProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  trigger: React.ReactElement
  selectedProviderID?: ModelProviderID
  selectedModelPreset?: string
  providerOptions: ProviderModelOption[]
  allProviders?: readonly DesktopModelProviderSummary[]
  onProviderModelChange: (providerID: ModelProviderID, modelID: string) => void
  onProviderOpen?: (providerID: ModelProviderID) => void
  onProviderSearch?: (providerID: ModelProviderID, query: string) => void
  onOpenModelSettings?: () => void
  align?: 'start' | 'center' | 'end'
  side?: 'top' | 'right' | 'bottom' | 'left'
  sideOffset?: number
}

type HubProviderItem = {
  id: string
  name: string
  desc: string
  category: string
  logoURL?: string
}

const PROVIDER_SEARCH_DEBOUNCE_MS = 150

export function ModelPickerPopover({
  open,
  onOpenChange,
  trigger,
  selectedProviderID,
  selectedModelPreset,
  providerOptions,
  allProviders,
  onProviderModelChange,
  onProviderOpen,
  onProviderSearch,
  onOpenModelSettings,
  align = 'end',
  side = 'top',
  sideOffset = 4,
}: ModelPickerPopoverProps): React.ReactNode {
  const [activeProviderID, setActiveProviderID] = useState<ModelProviderID>(
    selectedProviderID ?? providerOptions[0]?.providerID ?? 'openai',
  )
  const [isHubOpen, setIsHubOpen] = useState(false)
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [filterText, setFilterText] = useState('')
  const [hubFilterText, setHubFilterText] = useState('')
  const [hoveredModelID, setHoveredModelID] = useState<string | null>(null)
  const reducedMotion = usePrefersReducedMotion()
  const searchInputRef = useRef<HTMLInputElement>(null)
  const hubSearchInputRef = useRef<HTMLInputElement>(null)
  const modelsListRef = useRef<HTMLDivElement>(null)
  const modelRowRefs = useRef(new Map<string, HTMLDivElement>())
  const previousProviderIDRef = useRef<ModelProviderID | null>(null)
  const providerSearchTimersRef = useRef(new Map<ModelProviderID, ReturnType<typeof setTimeout>>())
  const lastForwardedQueryRef = useRef('')

  useEffect(() => {
    if (selectedProviderID) setActiveProviderID(selectedProviderID)
  }, [selectedProviderID])

  useEffect(() => {
    if (open && activeProviderID) onProviderOpen?.(activeProviderID)
    if (!open) {
      // A closing panel must not leave the provider catalogue narrowed to the
      // last query, because the next open reuses that catalogue.
      if (lastForwardedQueryRef.current) {
        lastForwardedQueryRef.current = ''
        onProviderSearch?.(activeProviderID, '')
      }
      setIsHubOpen(false)
      setSearchExpanded(false)
      setFilterText('')
      setHubFilterText('')
      setHoveredModelID(null)
    }
  }, [open, activeProviderID, onProviderOpen, onProviderSearch])

  useEffect(() => {
    if (searchExpanded) searchInputRef.current?.focus()
  }, [searchExpanded])

  useEffect(
    () => () => {
      for (const timer of providerSearchTimersRef.current.values()) clearTimeout(timer)
      providerSearchTimersRef.current.clear()
    },
    [],
  )

  const currentProvider = useMemo(
    () =>
      providerOptions.find((provider) => provider.providerID === activeProviderID) ??
      providerOptions[0] ?? {
        providerID: activeProviderID,
        displayName: activeProviderID,
        modelPresets: [],
      },
    [activeProviderID, providerOptions],
  )

  const filteredModels = useMemo(() => {
    const query = filterText.trim().toLowerCase()
    const models = query
      ? currentProvider.modelPresets.filter(
          (model) =>
            model.label.toLowerCase().includes(query) || model.id.toLowerCase().includes(query),
        )
      : currentProvider.modelPresets
    // 选择器固定按模型名 A→Z 展示；搜索只缩小范围，不改变排序规则。
    return sortModelPresetsByName(models)
  }, [currentProvider, filterText])

  const currentProviderModelMetadata = useMemo(
    () =>
      currentProvider.modelMetadata ??
      allProviders?.find((provider) => provider.providerID === activeProviderID)?.modelMetadata,
    [activeProviderID, allProviders, currentProvider.modelMetadata],
  )

  // 打开面板（或切换服务商）时把选中模型滚到列表中间；搜索期间不抢滚动位置。
  useLayoutEffect(() => {
    const list = modelsListRef.current
    const providerChanged = previousProviderIDRef.current !== activeProviderID
    previousProviderIDRef.current = activeProviderID
    if (!open || isHubOpen || !list) return
    const row = selectedModelPreset ? modelRowRefs.current.get(selectedModelPreset) : undefined
    if (filterText.trim()) return
    if (!row) {
      if (providerChanged) list.scrollTop = 0
      return
    }
    const listRect = list.getBoundingClientRect()
    const rowRect = row.getBoundingClientRect()
    list.scrollTop = centeredScrollTop({
      scrollTop: list.scrollTop,
      scrollHeight: list.scrollHeight,
      listTop: listRect.top,
      listClientHeight: list.clientHeight,
      rowTop: rowRect.top,
      rowHeight: rowRect.height,
    })
  }, [open, isHubOpen, activeProviderID, selectedModelPreset, filterText, filteredModels])

  const hubProviders = useMemo<HubProviderItem[]>(() => {
    if (allProviders && allProviders.length > 0) {
      return allProviders.map((p) => {
        const isCustom = p.providerKind === 'custom'
        const count = p.modelCount ?? p.defaultModels.length
        return {
          id: p.providerID,
          name: p.displayName || p.providerID,
          desc: isCustom
            ? '自定义 Provider · Pi 执行'
            : count > 0
              ? `${count} 个可用模型`
              : 'Pi 内置提供商',
          category: isCustom ? '自定义' : 'Pi 内置',
          logoURL: p.logoURL,
        }
      })
    }
    return providerOptions.map((option) => ({
      id: option.providerID,
      name: option.displayName || option.providerID,
      desc:
        option.modelPresets.length > 0
          ? `${option.modelPresets.length} 个可用模型`
          : 'Pi 内置提供商',
      category: 'Pi 内置',
      logoURL: option.logoURL,
    }))
  }, [allProviders, providerOptions])

  const filteredHubProviders = useMemo(() => {
    const query = hubFilterText.trim().toLowerCase()
    if (!query) return hubProviders
    return hubProviders.filter(
      (provider) =>
        provider.name.toLowerCase().includes(query) ||
        provider.desc.toLowerCase().includes(query) ||
        provider.category.toLowerCase().includes(query),
    )
  }, [hubFilterText, hubProviders])

  // Large provider catalogues are paged on the agent side, so a paused query is
  // forwarded to the provider controller in addition to the local filter.
  const queueProviderSearch = useCallback(
    (providerID: ModelProviderID, query: string): void => {
      if (!onProviderSearch) return
      const pending = providerSearchTimersRef.current.get(providerID)
      if (pending) clearTimeout(pending)
      providerSearchTimersRef.current.set(
        providerID,
        setTimeout(() => {
          providerSearchTimersRef.current.delete(providerID)
          lastForwardedQueryRef.current = query.trim()
          onProviderSearch(providerID, query.trim())
        }, PROVIDER_SEARCH_DEBOUNCE_MS),
      )
    },
    [onProviderSearch],
  )

  const handleProviderSelect = useCallback(
    (providerID: ModelProviderID) => {
      setIsHubOpen(false)
      setActiveProviderID(providerID)
      onProviderOpen?.(providerID)
    },
    [onProviderOpen],
  )

  const handleModelSelect = (modelID: string): void => {
    onProviderModelChange(activeProviderID, modelID)
    onOpenChange(false)
  }

  const handleFilterChange = (value: string): void => {
    setFilterText(value)
    queueProviderSearch(activeProviderID, value)
  }

  // Clearing the query also resets the provider catalogue the query narrowed,
  // otherwise the visible list stays limited to the last search result.
  const resetFilter = (): void => {
    setFilterText('')
    setSearchExpanded(false)
    queueProviderSearch(activeProviderID, '')
  }

  const providerLogoURL = (targetProviderID: string): string | undefined => {
    const option = providerOptions.find((opt) => opt.providerID === targetProviderID)
    if (option?.logoURL) return option.logoURL
    const hub = hubProviders.find((item) => item.id === targetProviderID)
    return hub?.logoURL
  }

  const handleHubSelect = (hubProviderID: string): void => {
    const configured = providerOptions.find((provider) => provider.providerID === hubProviderID)
    if (configured) {
      handleProviderSelect(configured.providerID)
      return
    }
    // Unconfigured providers have no catalogue to browse, so send the user to
    // the surface that can actually add credentials.
    if (onOpenModelSettings) {
      onOpenChange(false)
      onOpenModelSettings()
      return
    }
    handleProviderSelect(hubProviderID as ModelProviderID)
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{trigger}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          size="lg"
          align={align}
          side={side}
          sideOffset={sideOffset}
          className={PANEL_CONTENT_CLASS}
          style={{ padding: 0 }}
        >
          <div className={PANEL_CLASS}>
            {/* Left provider rail */}
            <div className={PROVIDER_RAIL_CLASS}>
              <div className={PROVIDER_LIST_CLASS}>
                {providerOptions.length > 0 ? (
                  providerOptions.map((provider) => {
                    const isActive = !isHubOpen && provider.providerID === activeProviderID
                    return (
                      <button
                        key={provider.providerID}
                        type="button"
                        onClick={() => handleProviderSelect(provider.providerID)}
                        className={cx(
                          PROVIDER_BUTTON_CLASS,
                          isActive ? PROVIDER_BUTTON_ACTIVE_CLASS : PROVIDER_BUTTON_IDLE_CLASS,
                        )}
                        title={provider.displayName || provider.providerID}
                      >
                        <ProviderLogo logoURL={provider.logoURL} providerID={provider.providerID} />
                      </button>
                    )
                  })
                ) : (
                  <button
                    type="button"
                    className={cx(PROVIDER_BUTTON_CLASS, PROVIDER_BUTTON_ACTIVE_CLASS)}
                    title={activeProviderID}
                  >
                    <ProviderLogo logoURL={providerLogoURL(activeProviderID)} providerID={activeProviderID} />
                  </button>
                )}
              </div>

              <div className={HUB_TRIGGER_WRAP_CLASS}>
                <button
                  type="button"
                  onClick={() => setIsHubOpen((previous) => !previous)}
                  className={cx(
                    HUB_TRIGGER_BUTTON_CLASS,
                    isHubOpen ? PROVIDER_BUTTON_ACTIVE_CLASS : PROVIDER_BUTTON_IDLE_CLASS,
                  )}
                  title="模型中心：发现并配置服务商"
                >
                  <Plus size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                </button>
              </div>
            </div>

            {/* Right panel */}
            <div className={MODEL_RIGHT_CLASS}>
              {isHubOpen ? (
                /* View 2: Model Hub view */
                <div className={PICKER_VIEW_CLASS}>
                  <div className={MODELS_HEADER_CLASS}>
                    <div className={MODELS_HEADER_LEAD_CLASS}>
                      <button
                        type="button"
                        onClick={() => setIsHubOpen(false)}
                        className={HUB_BACK_CLASS}
                        title="返回模型列表"
                      >
                        <ChevronLeft size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                      </button>
                      <span className={MODELS_TITLE_CLASS}>模型中心</span>
                    </div>

                    <div className={HUB_SEARCH_BAR_CLASS}>
                      <Search
                        size={APP_ICON_SIZE}
                        strokeWidth={APP_ICON_STROKE_WIDTH}
                        className={SEARCH_BAR_ICON_CLASS}
                      />
                      <input
                        ref={hubSearchInputRef}
                        type="text"
                        placeholder="搜索服务商..."
                        value={hubFilterText}
                        onChange={(event) => setHubFilterText(event.target.value)}
                        className={HUB_SEARCH_INPUT_CLASS}
                      />
                    </div>
                  </div>

                  <div className={HUB_LIST_CLASS}>
                    {filteredHubProviders.length > 0 ? (
                      filteredHubProviders.map((provider) => {
                        const isConfigured = providerOptions.some(
                          (option) => option.providerID === provider.id,
                        )
                        return (
                          <div
                            key={provider.id}
                            className={HUB_ROW_CLASS}
                            onClick={() => {
                              if (isConfigured) handleHubSelect(provider.id)
                            }}
                          >
                            <div className={HUB_ROW_MAIN_CLASS}>
                              <div className={HUB_ROW_LOGO_CLASS}>
                                <ProviderLogo logoURL={providerLogoURL(provider.id)} providerID={provider.id} />
                              </div>
                              <div className={HUB_ROW_TEXT_CLASS}>
                                <div className={HUB_ROW_TITLE_CLASS}>
                                  <span className={HUB_ROW_NAME_CLASS}>{provider.name}</span>
                                  <span className={HUB_BADGE_CLASS}>{provider.category}</span>
                                </div>
                                <p className={HUB_ROW_DESC_CLASS}>{provider.desc}</p>
                              </div>
                            </div>
                            <div className={HUB_ROW_ACTIONS_CLASS}>
                              {isConfigured ? (
                                <span className={HUB_BADGE_CONNECTED_CLASS}>已配置</span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={(event) => {
                                    event.stopPropagation()
                                    handleHubSelect(provider.id)
                                  }}
                                  className={HUB_ACTION_BUTTON_CLASS}
                                >
                                  去配置
                                </button>
                              )}
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className={MODELS_EMPTY_CLASS}>没有匹配的服务商</div>
                    )}
                  </div>
                </div>
              ) : (
                /* View 1: Models Selection View */
                <div className={PICKER_VIEW_CLASS}>
                  <div className={MODELS_HEADER_CLASS}>
                    <span className={MODELS_TITLE_CLASS}>
                      {currentProvider.displayName || '模型列表'}
                    </span>

                    <div className={MODELS_HEADER_ACTIONS_CLASS}>
                      {searchExpanded ? (
                        <div className={SEARCH_BAR_CLASS}>
                          <Search
                            size={APP_ICON_SIZE}
                            strokeWidth={APP_ICON_STROKE_WIDTH}
                            className={SEARCH_BAR_ICON_CLASS}
                          />
                          <input
                            ref={searchInputRef}
                            type="text"
                            placeholder="过滤模型..."
                            value={filterText}
                            onChange={(event) => handleFilterChange(event.target.value)}
                            onKeyDown={(event) => {
                              if (event.key !== 'Escape') return
                              event.stopPropagation()
                              resetFilter()
                            }}
                            className={SEARCH_INPUT_CLASS}
                          />
                          <button
                            type="button"
                            onClick={() => {
                              resetFilter()
                              searchInputRef.current?.blur()
                            }}
                            className={SEARCH_CLEAR_CLASS}
                            title="清除并关闭"
                          >
                            <X size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setSearchExpanded(true)}
                          className={SEARCH_TRIGGER_CLASS}
                        >
                          <span>快速搜索</span>
                          <Search size="var(--inline-icon-size, 1em)" strokeWidth={APP_ICON_STROKE_WIDTH} />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className={MODELS_LIST_CLASS} ref={modelsListRef}>
                    {filteredModels.length > 0 ? (
                      filteredModels.map((preset) => {
                        const isSelected = preset.id === selectedModelPreset
                        const capabilityBadges = modelCapabilityBadges(
                          currentProviderModelMetadata?.[preset.id],
                        )
                        return (
                          <div
                            key={preset.id}
                            ref={(element) => {
                              if (element) modelRowRefs.current.set(preset.id, element)
                              else modelRowRefs.current.delete(preset.id)
                            }}
                            onClick={() => handleModelSelect(preset.id)}
                            onMouseEnter={() => setHoveredModelID(preset.id)}
                            onMouseLeave={() =>
                              setHoveredModelID((current) => (current === preset.id ? null : current))
                            }
                            className={cx(MODEL_ROW_CLASS, isSelected && MODEL_ROW_SELECTED_CLASS)}
                          >
                            <div className={MODEL_ROW_MAIN_CLASS}>
                              <span className={MODEL_ROW_ICON_CLASS}>
                                <ProviderLogo
                                  logoURL={modelLogoURL(preset.id, preset.label) ?? currentProvider.logoURL}
                                  providerID={modelLogoURL(preset.id, preset.label) ? undefined : currentProvider.providerID}
                                />
                              </span>
                              <OverflowTitle
                                active={hoveredModelID === preset.id}
                                reducedMotion={reducedMotion}
                                variant="composer"
                              >
                                {preset.label || preset.id}
                              </OverflowTitle>
                            </div>

                            <div className={MODEL_ROW_TRAILING_CLASS}>
                              {capabilityBadges.length > 0 ? (
                                <div className={CAPABILITIES_CLASS}>
                                  {capabilityBadges.map((badge) =>
                                    badge.kind === 'context' ? (
                                      <span
                                        key={badge.kind}
                                        className={CAPABILITY_CHIP_CLASS}
                                        title={badge.title}
                                      >
                                        {badge.label}
                                      </span>
                                    ) : (
                                      <span
                                        key={badge.kind}
                                        className={CAPABILITY_CHIP_CLASS}
                                        role="img"
                                        aria-label={badge.label}
                                        title={badge.title}
                                      >
                                        {badge.kind === 'vision' ? (
                                          <Eye
                                            size={APP_ICON_SIZES.sm}
                                            strokeWidth={APP_ICON_STROKE_WIDTH}
                                          />
                                        ) : (
                                          <Brain
                                            size={APP_ICON_SIZES.sm}
                                            strokeWidth={APP_ICON_STROKE_WIDTH}
                                          />
                                        )}
                                      </span>
                                    ),
                                  )}
                                </div>
                              ) : null}

                              {isSelected ? (
                                <span
                                  aria-hidden="true"
                                  className={cx(
                                    MODEL_MARK_CLASS,
                                    capabilityBadges.length > 0
                                      ? 'tw:group-hover:hidden'
                                      : undefined,
                                  )}
                                >
                                  <Check size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
                                </span>
                              ) : null}
                            </div>
                          </div>
                        )
                      })
                    ) : (
                      <div className={MODELS_EMPTY_CLASS}>
                        {filterText ? '没有匹配的模型' : '暂无可用的预设模型'}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}
