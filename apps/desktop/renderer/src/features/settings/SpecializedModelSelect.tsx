import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { desktopClient } from '../../services/desktop-client/index.js'
import { withModelCatalogLoading } from '../../hooks/UseModelCatalogLoading.js'
import type {
  DesktopModelMetadata,
  DesktopModelProviderSummary,
  ModelProviderID,
} from '../../../shared/Types.js'
import { getModelDisplayLabel } from '../../ModelPresets.js'
import { SettingsDropdown } from './SettingsDropdown.js'
import { formatCompactNumber } from '../../utils/UsageFormatters.js'

function splitProviderModel(value: string): { providerID: string; id: string } | null {
  const slash = value.indexOf('/')
  if (slash <= 0 || slash === value.length - 1) return null
  return { providerID: value.slice(0, slash), id: value.slice(slash + 1) }
}

type ModelOption = { value: string; label: string; detail?: string }

type SpecializedModelKey = 'generationModel' | 'organizationModel' | 'codingModel' | 'securityModel'

const SPECIALIZED_MODEL_LABELS: Record<SpecializedModelKey, string> = {
  generationModel: '生成模型',
  organizationModel: '整理模型',
  codingModel: '代码模型',
  securityModel: '安全模型（实验）',
}

function formatModelDetail(modelID: string, metadata?: DesktopModelMetadata): string {
  if (!metadata) return ''
  const parts: string[] = []
  if (metadata.contextWindow) {
    parts.push(`上下文 ${formatCompactNumber(metadata.contextWindow)}`)
  }
  if (metadata.outputTokens) {
    parts.push(`输出 ${formatCompactNumber(metadata.outputTokens)}`)
  }
  if (metadata.reasoning) parts.push('推理')
  if (metadata.toolCall) parts.push('工具调用')
  if (metadata.vision) parts.push('视觉')
  return parts.join(' / ')
}

export function SpecializedModelSelect({
  value,
  mainModel,
  specializedModelKey,
  onChange,
}: {
  value: string
  mainModel: string
  specializedModelKey: SpecializedModelKey
  onChange: (newValue: string) => void
}): React.ReactNode {
  const label = SPECIALIZED_MODEL_LABELS[specializedModelKey]

  const [providers, setProviders] = useState<DesktopModelProviderSummary[]>([])
  const [providerModels, setProviderModels] = useState<Record<string, string[]>>({})
  const [providerMetadata, setProviderMetadata] = useState<
    Record<string, Record<string, DesktopModelMetadata> | undefined>
  >({})
  const [loading, setLoading] = useState(false)

  // Load all providers
  useEffect(() => {
    let cancelled = false
    desktopClient
      .listModelProviders()
      .then((provs) => {
        if (!cancelled) setProviders(provs)
      })
      .catch(() => {
        // ignore — dropdown will show empty options
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Fetch catalogs for all apiKeyConfigured providers
  useEffect(() => {
    if (providers.length === 0) return
    const configured = providers.filter((p) => p.apiKeyConfigured)
    if (configured.length === 0) return

    let cancelled = false
    setLoading(true)

    void (async () => {
      const models: Record<string, string[]> = {}
      const metadata: Record<string, Record<string, DesktopModelMetadata> | undefined> = {}
      for (const provider of configured) {
        try {
          const result = await withModelCatalogLoading(() =>
            desktopClient.fetchProviderModels({
              providerID: provider.providerID as ModelProviderID,
            }),
          )
          if (cancelled) return
          models[provider.providerID] = result.models
          metadata[provider.providerID] = result.modelMetadata
        } catch {
          // ignore — individual provider failures don't break the whole list
        }
      }
      if (!cancelled) {
        setProviderModels(models)
        setProviderMetadata(metadata)
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [providers])

  const parsedValue = useMemo(() => splitProviderModel(value), [value])

  const options = useMemo<ModelOption[]>(() => {
    const inheritedLabel = mainModel ? `使用主模型 (${mainModel})` : '使用主模型'
    const opts: ModelOption[] = [{ value: '', label: inheritedLabel, detail: '继承会话主模型' }]

    // Add options from fetched catalogs
    for (const provider of providers) {
      const models = providerModels[provider.providerID]
      if (!models || models.length === 0) continue
      for (const modelID of models) {
        if (opts.length >= 100) break
        const fullValue = `${provider.providerID}/${modelID}`
        const meta = providerMetadata[provider.providerID]?.[modelID]
        opts.push({
          value: fullValue,
          label: getModelDisplayLabel(modelID),
          detail: `${provider.displayName}${meta ? ` · ${formatModelDetail(modelID, meta)}` : ''}`,
        })
      }
      if (opts.length >= 100) break
    }

    // Append saved value if it doesn't exist in any catalog
    if (
      value &&
      !opts.some((o) => o.value === value) &&
      !opts.some((o) => o.value === parsedValue?.id)
    ) {
      const savedMeta = parsedValue?.providerID
        ? providerMetadata[parsedValue.providerID]?.[parsedValue.id]
        : undefined
      opts.push({
        value,
        label: getModelDisplayLabel(parsedValue?.id ?? value),
        detail: `当前保存${parsedValue?.providerID ? ` · ${parsedValue.providerID}` : ''}`,
      })
    }

    return opts
  }, [mainModel, providers, providerModels, providerMetadata, value, parsedValue])

  const displayValue = useMemo(() => {
    if (!value) return ''
    return options.some((o) => o.value === value) ? value : ''
  }, [value, options])

  const handleChange = useCallback(
    (newValue: string) => {
      onChange(newValue)
    },
    [onChange],
  )

  return (
    <SettingsDropdown
      size="lg"
      ariaLabel={label}
      value={displayValue}
      options={options}
      onChange={handleChange}
    />
  )
}
