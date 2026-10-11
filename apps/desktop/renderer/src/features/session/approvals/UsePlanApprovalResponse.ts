import React from 'react'
import type { RpcParams } from '@pidex/agent-protocol'
import type { PlanApproval } from '@pidex/shared/thread'
import { ModelRefSchema } from '@pidex/shared'
import type { DesktopModelSelection } from '../../../../shared/Types.js'
import { desktopClient } from '../../../services/desktop-client/index.js'

type Response = RpcParams<'planApproval/respond'>['response'] | { action: 'implementFresh' }

export function usePlanApprovalResponse(
  approval: PlanApproval | null | undefined,
  reload: () => Promise<void>,
  model?: Pick<DesktopModelSelection, 'providerID' | 'model' | 'variant'>,
  onImplementedFresh?: (threadId: string) => void,
) {
  const [available, setAvailable] = React.useState(false)
  const [freshAvailable, setFreshAvailable] = React.useState(false)
  const [capabilityError, setCapabilityError] = React.useState<string | null>(null)
  const operation = React.useRef<{ key: string; id: string } | null>(null)
  React.useEffect(() => {
    let active = true
    void desktopClient
      .getRuntimeCapabilities()
      .then((capabilities) => {
        if (active) {
          setAvailable(capabilities.includes('plan.approval.v1'))
          setFreshAvailable(capabilities.includes('plan.approval.fresh.v1'))
        }
      })
      .catch(() => {
        if (active) setCapabilityError('无法确认计划操作能力，请重新打开会话。')
      })
    return () => {
      active = false
    }
  }, [])

  const respond = React.useCallback(
    async (response: Response) => {
      if (!approval || !available) throw new Error('当前会话不支持计划批准。')
      if (response.action === 'implementFresh' && !freshAvailable)
        throw new Error('当前 Agent 不支持在新聊天中实施计划。')
      const resolvedResponse =
        response.action === 'close' || !model?.providerID || !model.model
          ? response
          : {
              ...response,
              model: ModelRefSchema.make({
                providerID: ModelRefSchema.fields.providerID.make(model.providerID),
                id: ModelRefSchema.fields.id.make(model.model),
                ...(model.variant && model.variant !== 'default'
                  ? { variant: ModelRefSchema.fields.variant.from.make(model.variant) }
                  : {}),
              }),
            }
      const key = JSON.stringify([approval.id, approval.version, resolvedResponse])
      if (operation.current?.key !== key) operation.current = { key, id: crypto.randomUUID() }
      const params = {
        threadId: approval.threadId,
        approvalId: approval.id,
        expectedVersion: approval.version,
        operationId: operation.current.id,
      }
      if (resolvedResponse.action === 'implementFresh') {
        const result = await desktopClient.implementPlanFresh({
          ...params,
          ...('model' in resolvedResponse ? { model: resolvedResponse.model } : {}),
        })
        onImplementedFresh?.(result.targetThreadId)
      } else await desktopClient.respondPlanApproval({ ...params, response: resolvedResponse })
      await reload()
    },
    [approval, available, freshAvailable, reload, model, onImplementedFresh],
  )

  return {
    respond,
    freshAvailable,
    disabledReason: available
      ? undefined
      : (capabilityError ?? '当前 Agent 尚未提供计划批准能力。'),
  }
}
