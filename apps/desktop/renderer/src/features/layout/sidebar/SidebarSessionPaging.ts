/**
 * 侧栏分组内的分页状态。
 *
 * 规则：分页只由用户手动展开/折叠决定，不跟随激活会话或数据变化自动变化。
 * - 分组实例被复用到其他分组时回到默认条数。
 * - 所在折叠区域收起期间保留条数，再次展开前回到默认条数。
 */
export type SidebarSessionPagingState = {
  /** 当前分组键；与状态不一致表示实例被复用到其他分组。 */
  groupKey: string
  /** 当前渲染的会话条数。 */
  visibleLimit: number
  disclosureExpanded: boolean
}

export type SidebarSessionPagingInput = {
  disclosureExpanded: boolean
  groupKey: string
  initialLimit: number
}

export function createSidebarSessionPagingState(input: {
  groupKey: string
  initialLimit: number
}): SidebarSessionPagingState {
  return {
    groupKey: input.groupKey,
    visibleLimit: input.initialLimit,
    disclosureExpanded: true,
  }
}

/** 用户手动调整分页条数（展开显示、折叠显示、键盘调整顺序）。 */
export function setSidebarSessionVisibleLimit(
  state: SidebarSessionPagingState,
  resolution: number | ((visibleLimit: number) => number),
): SidebarSessionPagingState {
  const visibleLimit =
    typeof resolution === 'function' ? resolution(state.visibleLimit) : resolution
  return visibleLimit === state.visibleLimit ? state : { ...state, visibleLimit }
}

export function syncSidebarSessionPaging(
  state: SidebarSessionPagingState,
  input: SidebarSessionPagingInput,
): SidebarSessionPagingState {
  if (input.groupKey !== state.groupKey) {
    return createSidebarSessionPagingState(input)
  }
  if (input.disclosureExpanded !== state.disclosureExpanded) {
    // 收起时保留内容高度，重新展开前再恢复默认分页，避免两层动画争用高度。
    return {
      ...state,
      disclosureExpanded: input.disclosureExpanded,
      visibleLimit: input.disclosureExpanded ? input.initialLimit : state.visibleLimit,
    }
  }
  return state
}
