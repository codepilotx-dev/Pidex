import { useEffect, useRef, useState } from 'react'
import type { ModelRecommendation, RpcResult, SmartConfigPinnedField } from '@pidex/agent-protocol'
import { SmartConfigPinnedFields } from '@pidex/agent-protocol'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { Button } from '../../../components/ui/Button.js'
import { InfoTooltip } from '../../../components/ui/InfoTooltip.js'
import { fullErrorMessage } from '../../../utils/Errors.js'
import type { EditableModel } from './ProviderEditorForm.js'
import { fillModelDraft } from './SmartModelDraft.js'

/** 草稿字段 → 可固定的推荐字段。多种模态共用同一个 `input` 推荐值。 */
export const SMART_FIELD_SOURCES: Partial<Record<keyof EditableModel, SmartConfigPinnedField>> = {
  name: 'name',
  contextWindow: 'contextWindow',
  maxInputTokens: 'maxInputTokens',
  maxTokens: 'maxTokens',
  reasoning: 'reasoning',
  tools: 'tools',
  imageInput: 'imageInput',
  audioInput: 'audioInput',
  videoInput: 'videoInput',
  inputCost: 'inputCost',
  outputCost: 'outputCost',
  cacheReadCost: 'cacheReadCost',
  cacheWriteCost: 'cacheWriteCost',
  // optionSpecs 无独立固定字段：reasoningLevel.* 跟随 `reasoning`，
  // maxOutputTokens.* 跟随 `maxTokens`。
  reasoningLevelValues: 'reasoning',
  reasoningLevelMap: 'reasoning',
  maxOutputTokensMax: 'maxTokens',
  maxOutputTokensMap: 'maxTokens',
}

/** 关闭智能配置时用来固定全部字段。 */
const ALL_SMART_FIELDS: SmartConfigPinnedField[] = [...SmartConfigPinnedFields]

export function useRecommendationSupport() {
  const [supported, setSupported] = useState(false)
  useEffect(() => {
    let active = true
    void desktopClient.modelRecommendations
      ?.supported()
      .then((value) => {
        if (active) setSupported(value)
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [])
  return supported
}

export function useSmartModelConfig(
  model: EditableModel,
  onChange: (next: EditableModel) => void,
  providerId: string,
  baseUrl: string,
) {
  const supported = useRecommendationSupport()
  const [preview, setPreview] = useState<RpcResult<'model/recommendation/preview'> | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const sequence = useRef(0)
  const latest = useRef({ model, onChange })
  latest.current = { model, onChange }
  const pinned = model.smartConfig?.pinned ?? []
  const enabled = supported && model.smartConfig !== undefined

  async function load(fill: boolean) {
    if (!supported || !model.id.trim()) return
    const request = ++sequence.current
    setBusy(true)
    setError(null)
    try {
      const result = await desktopClient.modelRecommendations!.preview({
        providerId,
        baseUrl,
        modelId: model.id,
        modelType: model.modelType ?? 'chat',
      })
      if (request !== sequence.current) return
      setPreview(result)
      if (fill && result.status === 'matched') {
        const current = latest.current
        current.onChange(fillModelDraft(current.model, result.recommended, pinned))
      }
    } catch (cause) {
      if (request === sequence.current) setError(fullErrorMessage(cause))
    } finally {
      if (request === sequence.current) setBusy(false)
    }
  }

  useEffect(() => {
    setPreview(null)
    setError(null)
    setBusy(false)
    void load(false)
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps -- 请求序号用于取消回包，不引用 DOM 节点。
      sequence.current++
    }
    // 普通参数编辑不重新匹配；身份改变才重新查本地缓存。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, providerId, baseUrl, model.id, model.modelType, model.api])

  const setEnabled = (next: boolean) => {
    const current = latest.current
    // 关闭时把当前生效值全部固定住，避免下次编辑时被推荐值悄悄改回去。
    current.onChange(
      next
        ? { ...current.model, smartConfig: { pinned: [] } }
        : {
            ...current.model,
            smartConfig: { pinned: ALL_SMART_FIELDS },
          },
    )
  }

  const togglePin = (field: SmartConfigPinnedField) => {
    const current = latest.current
    const existing = current.model.smartConfig?.pinned ?? []
    const next = existing.includes(field)
      ? existing.filter((item) => item !== field)
      : [...existing, field]
    current.onChange({ ...current.model, smartConfig: { pinned: next } })
  }

  const controls = supported ? (
    <div className="tw:grid tw:gap-2 tw:text-app-text-soft tw:type-body-sm">
      <div className="tw:flex tw:items-center tw:gap-2">
        <label className="tw:flex tw:cursor-pointer tw:select-none tw:items-center tw:gap-2">
          <span className="tw:text-app-text tw:type-label">智能配置</span>
          <input
            type="checkbox"
            role="switch"
            aria-label="智能配置"
            checked={enabled}
            onChange={(event) => setEnabled(event.target.checked)}
          />
        </label>
        <InfoTooltip
          ariaLabel="智能配置说明"
          content="按模型 ID、Base URL 匹配 models.dev 推荐。开启后未修改的项持续跟随推荐更新；手动修改某项即固定该项，其余仍跟随。"
        />
        {enabled ? (
          <Button
            color="secondary"
            disabled={busy || !model.id.trim()}
            onClick={() => void load(true)}
          >
            重新应用推荐
          </Button>
        ) : null}
      </div>
      <p role="status" className="tw:m-0">
        {error ??
          (!enabled
            ? '智能配置已关闭，所有字段使用手动值。'
            : !model.id.trim()
              ? '输入模型 ID 后匹配推荐。'
              : busy
                ? '正在匹配推荐…'
                : !preview
                  ? ''
                  : {
                      matched:
                        pinned.length > 0
                          ? `已匹配推荐配置 · ${pinned.length} 项已固定`
                          : '已匹配推荐配置',
                      unmatched: '未匹配，可继续手动配置',
                      ambiguous: '模型 ID 存在歧义，请使用完整 ID',
                      'no-cache': '推荐数据正在后台更新，请稍后再试',
                    }[preview.status])}
        {preview?.status === 'no-cache' && enabled ? (
          <Button
            variant="ghost"
            size="xs"
            disabled={busy}
            onClick={() => {
              void desktopClient.modelRecommendations?.refresh().finally(() => void load(false))
            }}
          >
            立即刷新推荐数据
          </Button>
        ) : null}
        {preview?.updatedAt ? ` · ${new Date(preview.updatedAt).toLocaleString()}` : ''}
      </p>
    </div>
  ) : null

  return {
    controls,
    enabled,
    pinned,
    recommended:
      preview?.status === 'matched' ? (preview.recommended as ModelRecommendation) : undefined,
    togglePin,
    /** 编辑某个可跟随字段时自动固定它，避免下次跟随把它改回去。 */
    change: (next: EditableModel) => {
      const added = enabled
        ? (Object.entries(SMART_FIELD_SOURCES) as [keyof EditableModel, SmartConfigPinnedField][])
            .filter(([key, field]) => next[key] !== model[key] && !pinned.includes(field))
            .map(([, field]) => field)
        : []
      onChange(added.length ? { ...next, smartConfig: { pinned: [...pinned, ...added] } } : next)
    },
  }
}
