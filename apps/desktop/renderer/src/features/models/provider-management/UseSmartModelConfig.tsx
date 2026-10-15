import { useEffect, useRef, useState } from 'react'
import type { RpcResult } from '@pidex/agent-protocol'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { Button } from '../../../components/ui/Button.js'
import { InfoTooltip } from '../../../components/ui/InfoTooltip.js'
import { fullErrorMessage } from '../../../utils/Errors.js'
import type { EditableModel } from './ProviderEditorForm.js'
import { fillModelDraft } from './SmartModelDraft.js'

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
  const edits = useRef(0)
  const latest = useRef({ model, onChange })
  latest.current = { model, onChange }

  async function load(fill: boolean) {
    if (!supported || !model.id.trim()) return
    const request = ++sequence.current
    const revision = edits.current
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
      // 用户在等待期间修改过输入时，只展示匹配结果，避免回包盖掉输入。
      if (fill && result.status === 'matched' && revision === edits.current) {
        const current = latest.current
        current.onChange(fillModelDraft(current.model, result.recommended))
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
    // 普通参数编辑不重新填充；身份改变才重新匹配本地缓存。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported, providerId, baseUrl, model.id, model.modelType, model.api])

  const controls = supported ? (
    <div className="tw:grid tw:gap-2 tw:text-app-text-soft tw:type-body-sm">
      <div className="tw:flex tw:items-center tw:gap-2">
        <Button
          color="secondary"
          disabled={busy || !model.id.trim()}
          onClick={() => void load(true)}
        >
          智能填充
        </Button>
        <InfoTooltip
          ariaLabel="智能配置说明"
          content="按模型 ID 匹配 models.dev 推荐。点击智能填充后填入推荐参数，填充后可自由修改；保存后生效。"
        />
      </div>
      <p role="status" className="tw:m-0">
        {error ??
          (!model.id.trim()
            ? '输入模型 ID 后匹配推荐。'
            : busy
              ? '正在匹配推荐…'
              : !preview
                ? ''
                : {
                    matched: '已匹配推荐配置',
                    unmatched: '未匹配，可继续手动配置',
                    ambiguous: '模型 ID 存在歧义，请使用完整 ID',
                    'no-cache': '推荐数据正在后台更新，请稍后再试',
                  }[preview.status])}
        {preview?.updatedAt ? ` · ${new Date(preview.updatedAt).toLocaleString()}` : ''}
      </p>
    </div>
  ) : null
  return {
    controls,
    change: (next: EditableModel) => {
      edits.current++
      onChange(next)
    },
  }
}
