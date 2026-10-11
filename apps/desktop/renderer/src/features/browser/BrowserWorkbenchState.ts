import type { DesktopBrowserState } from '../../../shared/Types.js'
import type { WorkbenchTabsState, WorkbenchTabId } from '../layout/dock/RightDockState.js'
/** Browser descriptors are global Agent projections; other workbench tabs remain conversation-local. */
export function mergeBrowserWorkbench(
  state: WorkbenchTabsState,
  records: readonly DesktopBrowserState[],
  previous = state,
): WorkbenchTabsState {
  const next = {
    ...state,
    tabsById: { ...state.tabsById },
    right: { ...state.right, tabIds: [...state.right.tabIds] },
    bottom: { ...state.bottom, tabIds: [...state.bottom.tabIds] },
  }
  const valid = new Set(records.filter((r) => r.open && r.tabId).map((r) => `browser:${r.tabId}`))
  for (const [id, tab] of Object.entries(next.tabsById))
    if (tab?.kind === 'browser' && !valid.has(id)) delete next.tabsById[id as WorkbenchTabId]
  for (const panel of ['right', 'bottom'] as const) {
    const previousBrowserIds = previous[panel].tabIds.filter(
      (id) => previous.tabsById[id]?.kind === 'browser' && valid.has(id),
    )
    next[panel].tabIds = next[panel].tabIds.filter(
      (id) =>
        id in next.tabsById &&
        (next.tabsById[id]?.kind !== 'browser' || previousBrowserIds.includes(id)),
    )
    next[panel].tabIds.push(...previousBrowserIds.filter((id) => !next[panel].tabIds.includes(id)))
    if (previous[panel].activeTabId && previousBrowserIds.includes(previous[panel].activeTabId!)) {
      next[panel].activeTabId = previous[panel].activeTabId
      // 右栏的 open 是 workspaceView 的投影，后台同步不得改写显隐/完整视图状态。
      if (panel === 'bottom') next[panel].open = previous[panel].open
    }
  }
  for (const record of [...records].sort((a, b) => (a.order ?? 0) - (b.order ?? 0))) {
    if (!record.tabId || !record.open) continue
    const id = `browser:${record.tabId}` as const
    next.tabsById[id] = {
      id,
      kind: 'browser',
      tabId: record.tabId,
      title: record.title,
      busy: record.busy ?? false,
      suspended: record.state === 'suspended',
    }
    if (!next.right.tabIds.includes(id) && !next.bottom.tabIds.includes(id))
      next[record.panel ?? 'right'].tabIds.push(id)
  }
  for (const panel of ['right', 'bottom'] as const)
    if (next[panel].activeTabId && !next[panel].tabIds.includes(next[panel].activeTabId!))
      next[panel].activeTabId = next[panel].tabIds.at(-1) ?? null
  return JSON.stringify(next) === JSON.stringify(state) ? state : next
}
