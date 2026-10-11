import { useEffect, useState } from 'react'
import type { ProtocolCapability } from '@pidex/agent-protocol'
import { desktopClient } from '../../services/desktop-client/index.js'
import type { SettingsSectionRequirement } from './SettingsRegistry.js'

export type SettingsCapabilityState =
  | { status: 'unknown'; capabilities: null }
  | { status: 'ready'; capabilities: ReadonlySet<ProtocolCapability> }
  | { status: 'unavailable'; capabilities: null }

export type SettingsSectionVisibility = {
  visible: boolean
  pending: boolean
}

const UNKNOWN_SETTINGS_CAPABILITY_STATE: SettingsCapabilityState = {
  status: 'unknown',
  capabilities: null,
}

let sharedCapabilityState: SettingsCapabilityState = UNKNOWN_SETTINGS_CAPABILITY_STATE
let sharedCapabilityLoad: Promise<void> | null = null
const capabilityStateListeners = new Set<() => void>()

function notifyCapabilityStateListeners(): void {
  for (const listener of capabilityStateListeners) listener()
}

function loadRuntimeCapabilities(): void {
  if (sharedCapabilityLoad != null) return
  sharedCapabilityLoad = desktopClient
    .getRuntimeCapabilities()
    .then((capabilities) => {
      sharedCapabilityState = { status: 'ready', capabilities: new Set(capabilities) }
    })
    .catch(() => {
      sharedCapabilityState = { status: 'unavailable', capabilities: null }
    })
    .finally(() => {
      notifyCapabilityStateListeners()
    })
}

/**
 * 设置侧栏与内容区共用的运行时能力状态。模块级共享一份查询结果，
 * 避免导航与路由两处各自请求 desktopClient.getRuntimeCapabilities()。
 */
export function useSettingsCapabilityState(): SettingsCapabilityState {
  const [state, setState] = useState<SettingsCapabilityState>(sharedCapabilityState)
  useEffect(() => {
    const listener = (): void => {
      setState(sharedCapabilityState)
    }
    capabilityStateListeners.add(listener)
    loadRuntimeCapabilities()
    if (sharedCapabilityState.status !== 'unknown') listener()
    return () => {
      capabilityStateListeners.delete(listener)
    }
  }, [])
  return state
}

/**
 * 计算单个设置分节的可见性：
 * - 无门控声明时始终可见；
 * - `workspace` 要求活动工作区，不满足直接隐藏（不等待能力查询）；
 * - `capabilities` 为任一满足，能力查询进行中返回 pending，完成后按结果隐藏或显示。
 */
export function resolveSettingsSectionVisibility(
  requires: SettingsSectionRequirement | undefined,
  context: {
    workspacePath: string | null
    capabilityState: SettingsCapabilityState
  },
): SettingsSectionVisibility {
  if (requires == null) return { visible: true, pending: false }
  if (requires.workspace === true && (context.workspacePath ?? '').trim().length === 0) {
    return { visible: false, pending: false }
  }
  if (requires.capabilities != null && requires.capabilities.length > 0) {
    if (context.capabilityState.status !== 'ready') {
      return {
        visible: false,
        pending: context.capabilityState.status === 'unknown',
      }
    }
    return {
      visible: requires.capabilities.some((capability) =>
        context.capabilityState.capabilities.has(capability),
      ),
      pending: false,
    }
  }
  return { visible: true, pending: false }
}
