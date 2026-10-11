import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type {
  DesktopModelMetadata,
  DesktopThinkingMode,
  DesktopModelProviderState,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { isExecutableDesktopProvider } from '../../services/desktop-client/ProviderAdapters.js'
import {
  useModelCatalogLoading,
  withModelCatalogLoading,
} from '../../hooks/UseModelCatalogLoading.js'
import { buildModelPresets, resolveModelPresetId } from '../../ModelPresets.js'
import { buildVariantOptions } from '../models/ReasoningVariantLabels.js'
import type { SessionModelSelection } from '../session/state/SessionModelSelectionStore.js'

export function useModelProviderController({
  selection,
  onSelectionChange,
  selectionLoading,
  sessionId,
  hasMessages,
  setErrorMessage,
  setNoticeMessage,
}: {
  selection: SessionModelSelection | null
  onSelectionChange: (selection: SessionModelSelection) => void
  selectionLoading: boolean
  sessionId: string | null
  hasMessages: boolean
  setErrorMessage: (message: string) => void
  setNoticeMessage: (message: string) => void
}) {
  const model = selection?.model ?? ''
  const providerID = selection?.providerID
  const thinkingMode = selection?.thinkingMode ?? 'default'
  const [providerState, setProviderState] = useState<DesktopModelProviderState | null>(null)
  const [modelProviders, setModelProviders] = useState<DesktopModelProviderSummary[]>([])
  const modelCatalogLoading = useModelCatalogLoading()
  const modelPresets = useMemo(
    () => buildModelPresets(providerState?.models ?? providerState?.provider.defaultModels ?? []),
    [providerState],
  )
  const providerIDRef = useRef(providerID)
  providerIDRef.current = providerID
  const providerStateRequestIdRef = useRef(0)
  const fetchedModelCatalogKeysRef = useRef<Set<string>>(new Set())
  const pendingModelCatalogKeysRef = useRef<Set<string>>(new Set())
  const openedProviderCatalogsRef = useRef<Set<ModelProviderID>>(new Set())
  const providerModelOptions = useMemo(() => {
    const providers = [...modelProviders]
    if (
      providerState &&
      !providers.some((provider) => provider.providerID === providerState.provider.providerID)
    ) {
      providers.unshift(providerState.provider)
    }
    return providers
      .filter((provider) => provider.apiKeyConfigured && isExecutableDesktopProvider(provider))
      .map((provider) => {
        const isSelected = provider.providerID === providerState?.selectedProviderID
        const models = isSelected
          ? (providerState?.models ?? provider.defaultModels)
          : provider.defaultModels
        return {
          providerID: provider.providerID,
          displayName: provider.displayName,
          modelPresets: buildModelPresets(models),
          baseURL: provider.baseURL,
          logoURL: provider.logoURL,
        }
      })
  }, [modelProviders, providerState])
  const selectedProviderID = providerID
  const selectedProviderModelPresets =
    providerModelOptions.find((provider) => provider.providerID === selectedProviderID)
      ?.modelPresets ?? []
  const resolvedSelectedModelPreset = resolveModelPresetId(
    model,
    undefined,
    selectedProviderModelPresets,
  )
  const selectedProviderSummary =
    modelProviders.find((provider) => provider.providerID === selectedProviderID) ??
    (providerState && providerState.provider.providerID === selectedProviderID
      ? providerState.provider
      : undefined)
  const selectedModelMetadata =
    (providerState && providerState.selectedProviderID === selectedProviderID
      ? providerState.modelMetadata?.[model]
      : undefined) ?? selectedProviderSummary?.modelMetadata?.[model]
  const selectedVariant = selection?.variant ?? 'default'
  const variantOptions = buildVariantOptions(selectedModelMetadata?.variants)
  const deepSeekThinkingControls = isDeepSeekThinkingModel({
    providerID: selectedProviderID,
    model,
    metadata: selectedModelMetadata,
  })
  const showThinkingOptions =
    deepSeekThinkingControls ||
    selectedProviderSummary?.kind === 'anthropic' ||
    selectedModelMetadata?.reasoning === true ||
    Boolean(selectedModelMetadata?.variants?.length)
  const selectedModelAvailable = Boolean(
    model &&
    selectedProviderSummary &&
    isExecutableDesktopProvider(selectedProviderSummary) &&
    (selectedProviderID === providerState?.selectedProviderID
      ? providerState.models.includes(model)
      : selectedProviderSummary.defaultModels.includes(model)),
  )
  const modelConfigured =
    !selectionLoading &&
    selectedProviderSummary?.apiKeyConfigured === true &&
    selectedModelAvailable
  const selectedModelUnavailableMessage =
    selection?.model &&
    !selectionLoading &&
    !modelCatalogLoading &&
    providerState?.selectedProviderID === selectedProviderID &&
    !modelConfigured
      ? `当前会话模型不可用：${selection.providerID}/${selection.model}，请检查提供商配置`
      : null

  const refreshProviderState = useCallback(async (): Promise<void> => {
    const requestId = ++providerStateRequestIdRef.current
    const requestedProviderID = providerID
    try {
      const [next, providers] = await Promise.all([
        desktopClient.getModelProviderState(requestedProviderID),
        desktopClient.listModelProviders(),
      ])
      if (
        requestId !== providerStateRequestIdRef.current ||
        providerIDRef.current !== requestedProviderID
      )
        return
      setProviderState(next)
      setModelProviders(providers)
      if (next.selectedProviderID && next.apiKeyConfigured) {
        const catalogKey = [next.selectedProviderID, next.apiKeyConfigured ? 'key' : 'no-key'].join(
          '\0',
        )
        if (
          fetchedModelCatalogKeysRef.current.has(catalogKey) ||
          pendingModelCatalogKeysRef.current.has(catalogKey)
        ) {
          return
        }
        pendingModelCatalogKeysRef.current.add(catalogKey)
        void withModelCatalogLoading(() =>
          desktopClient.fetchProviderModels({
            providerID: next.selectedProviderID,
          }),
        )
          .then((result) => {
            if (
              requestId !== providerStateRequestIdRef.current ||
              providerIDRef.current !== requestedProviderID
            )
              return
            setProviderState((current) => {
              if (current?.selectedProviderID !== next.selectedProviderID) {
                return current
              }
              return {
                ...current,
                models: result.models,
                modelMetadata: {
                  ...current.modelMetadata,
                  ...result.modelMetadata,
                },
                error: result.error,
              }
            })
            fetchedModelCatalogKeysRef.current.add(catalogKey)
          })
          .catch((error) => {
            if (
              requestId !== providerStateRequestIdRef.current ||
              providerIDRef.current !== requestedProviderID
            )
              return
            setErrorMessage(error instanceof Error ? error.message : String(error))
          })
          .finally(() => {
            pendingModelCatalogKeysRef.current.delete(catalogKey)
          })
      }
    } catch (error) {
      if (
        requestId !== providerStateRequestIdRef.current ||
        providerIDRef.current !== requestedProviderID
      )
        return
      setErrorMessage(error instanceof Error ? error.message : String(error))
    }
  }, [providerID, setErrorMessage])

  useEffect(() => {
    void refreshProviderState()
    const listener = () => {
      openedProviderCatalogsRef.current.clear()
      fetchedModelCatalogKeysRef.current.clear()
      void refreshProviderState()
    }
    window.addEventListener('desktop:model-provider-changed', listener)
    return () => {
      window.removeEventListener('desktop:model-provider-changed', listener)
    }
  }, [refreshProviderState])

  useEffect(() => {
    if (!selection || selectionLoading || !selectedModelMetadata || thinkingMode === 'default')
      return
    if (selectedModelMetadata.variants?.includes(thinkingMode)) return
    // A historical provider-specific variant stays intact until the user changes it.
    if (selection.variant && selection.variant !== thinkingMode) return
    onSelectionChange({ ...selection, thinkingMode: 'default', variant: undefined })
  }, [selection, selectionLoading, selectedModelMetadata, thinkingMode, onSelectionChange])

  const handleVariantChange = useCallback(
    (variant: string): void => {
      if (!selection || selectionLoading) return
      if (variant !== 'default' && !selectedModelMetadata?.variants?.includes(variant)) return
      const nextThinkingMode =
        variant === 'enabled' || variant === 'adaptive' || variant === 'disabled'
          ? variant
          : 'default'
      onSelectionChange({
        ...selection,
        thinkingMode: nextThinkingMode,
        variant: variant === 'default' ? undefined : variant,
      })
    },
    [selection, selectionLoading, selectedModelMetadata, onSelectionChange],
  )
  const handleThinkingChange = useCallback(
    (mode: DesktopThinkingMode): void => {
      handleVariantChange(mode)
    },
    [handleVariantChange],
  )

  const handleProviderModelChange = useCallback(
    (providerID: ModelProviderID, nextPresetId: string): void => {
      if (!selection || selectionLoading) return
      const providerOption = providerModelOptions.find(
        (provider) => provider.providerID === providerID,
      )
      const preset = providerOption?.modelPresets.find((item) => item.id === nextPresetId)
      if (!preset || (providerID === selection.providerID && preset.value === selection.model))
        return
      const metadata =
        (providerState?.selectedProviderID === providerID
          ? providerState.modelMetadata?.[preset.value]
          : undefined) ??
        modelProviders.find((provider) => provider.providerID === providerID)?.modelMetadata?.[
          preset.value
        ]
      const variant =
        selection.variant ??
        (selection.thinkingMode !== 'default' ? selection.thinkingMode : undefined)
      const preserveThinking = Boolean(variant && metadata?.variants?.includes(variant))
      onSelectionChange({
        ...selection,
        providerID,
        model: preset.value,
        variant: preserveThinking ? variant : undefined,
        thinkingMode: preserveThinking ? selection.thinkingMode : 'default',
      })
      if (sessionId && hasMessages) setNoticeMessage('在对话过程中切换模型会降低性能表现')
    },
    [
      selection,
      selectionLoading,
      providerModelOptions,
      providerState,
      modelProviders,
      onSelectionChange,
      sessionId,
      hasMessages,
      setNoticeMessage,
    ],
  )

  const handleProviderOpen = useCallback(
    (providerID: ModelProviderID): void => {
      if (openedProviderCatalogsRef.current.has(providerID)) return
      openedProviderCatalogsRef.current.add(providerID)
      const requestId = providerStateRequestIdRef.current
      void desktopClient
        .fetchProviderModels({ providerID, all: true })
        .then((result) => {
          if (requestId !== providerStateRequestIdRef.current) return
          setModelProviders((current) =>
            current.map((provider) =>
              provider.providerID === providerID
                ? {
                    ...provider,
                    defaultModels: result.models,
                    modelMetadata: {
                      ...provider.modelMetadata,
                      ...result.modelMetadata,
                    },
                  }
                : provider,
            ),
          )
          setProviderState((current) =>
            current?.selectedProviderID === providerID
              ? {
                  ...current,
                  models: result.models,
                  modelMetadata: {
                    ...current.modelMetadata,
                    ...result.modelMetadata,
                  },
                  error: result.error,
                }
              : current,
          )
        })
        .catch((error) => {
          if (requestId !== providerStateRequestIdRef.current) return
          openedProviderCatalogsRef.current.delete(providerID)
          setErrorMessage(error instanceof Error ? error.message : String(error))
        })
    },
    [setErrorMessage],
  )

  const handleProviderSearch = useCallback(
    (() => {
      const generations = new Map<string, number>()
      return (providerID: ModelProviderID, query: string): void => {
        const requestId = providerStateRequestIdRef.current
        const generation = (generations.get(providerID) ?? 0) + 1
        generations.set(providerID, generation)
        void desktopClient
          .fetchProviderModels({ providerID, query, limit: 100 })
          .then((result) => {
            if (
              generations.get(providerID) !== generation ||
              requestId !== providerStateRequestIdRef.current
            )
              return
            setModelProviders((current) =>
              current.map((provider) =>
                provider.providerID === providerID
                  ? {
                      ...provider,
                      defaultModels: result.models,
                      modelMetadata: result.modelMetadata,
                    }
                  : provider,
              ),
            )
          })
          .catch((error) => {
            if (
              generations.get(providerID) !== generation ||
              requestId !== providerStateRequestIdRef.current
            )
              return
            setErrorMessage(error instanceof Error ? error.message : String(error))
          })
      }
    })(),
    [setErrorMessage],
  )

  return {
    providerState,
    modelProviders,
    modelCatalogLoading,
    modelPresets,
    selectedProviderID,
    selectedProviderModelPresets,
    resolvedSelectedModelPreset,
    selectedModelMetadata,
    deepSeekThinkingControls,
    showThinkingOptions,
    modelConfigured,
    providerModelOptions,
    model,
    thinkingMode,
    selectionLoading,
    handleProviderModelChange,
    handleThinkingChange,
    handleProviderOpen,
    handleProviderSearch,
    selectedVariant,
    variantOptions,
    handleVariantChange,
    selectedModelUnavailableMessage,
    refreshProviderState,
  }
}

export function isDeepSeekThinkingModel({
  providerID,
  model,
  metadata,
}: {
  providerID?: ModelProviderID
  model: string
  metadata?: DesktopModelMetadata
}): boolean {
  if (providerID === 'deepseek') {
    return true
  }
  if (providerID !== 'openrouter') {
    return false
  }
  return model.toLowerCase().includes('deepseek') && metadata?.reasoning === true
}
