import type { SidebarCustomization, SidebarCustomSection } from '../../../../shared/Types.js'

/** 侧栏自定义分组与归属的纯函数集合；持久化由调用方通过设置接口完成。 */

export function createSidebarSectionTitle(existing: readonly SidebarCustomSection[]): string {
  let index = existing.length + 1
  const titles = new Set(existing.map((section) => section.title))
  while (titles.has(`新建分组 ${index}`)) index += 1
  return `新建分组 ${index}`
}

export function addSidebarSection(
  current: SidebarCustomization,
  id: string,
  title?: string,
): SidebarCustomization {
  if (current.sections.some((section) => section.id === id)) return current
  const section: SidebarCustomSection = {
    id,
    title: title ?? createSidebarSectionTitle(current.sections),
    itemKeys: [],
    sort: 'manual',
    collapsed: false,
  }
  return {
    ...current,
    sections: [...current.sections, section],
    sectionOrder: [...current.sectionOrder, id],
  }
}

export function renameSidebarSection(
  current: SidebarCustomization,
  id: string,
  title: string,
): SidebarCustomization {
  const trimmed = title.trim()
  if (!trimmed) return current
  return {
    ...current,
    sections: current.sections.map((section) =>
      section.id === id ? { ...section, title: trimmed } : section,
    ),
  }
}

export function deleteSidebarSection(
  current: SidebarCustomization,
  id: string,
): SidebarCustomization {
  if (!current.sections.some((section) => section.id === id)) return current
  return {
    ...current,
    sections: current.sections.filter((section) => section.id !== id),
    sectionOrder: current.sectionOrder.filter((sectionId) => sectionId !== id),
  }
}

export function setSidebarSectionCollapsed(
  current: SidebarCustomization,
  id: string,
  collapsed: boolean,
): SidebarCustomization {
  return {
    ...current,
    sections: current.sections.map((section) =>
      section.id === id ? { ...section, collapsed } : section,
    ),
  }
}

export function setSidebarSectionSort(
  current: SidebarCustomization,
  id: string,
  sort: 'manual' | 'updated',
): SidebarCustomization {
  return {
    ...current,
    sections: current.sections.map((section) =>
      section.id === id ? { ...section, sort } : section,
    ),
  }
}

/** 按给定顺序重排自定义分组；未出现在 order 中的分组保持原有相对位置。 */
export function orderSidebarSections(
  current: SidebarCustomization,
  order: readonly string[],
): SidebarCustomization {
  const known = new Set(current.sections.map((section) => section.id))
  const ordered = [...order.filter((id) => known.has(id))]
  for (const section of current.sections) {
    if (!ordered.includes(section.id)) ordered.push(section.id)
  }
  return { ...current, sectionOrder: ordered }
}

export function setSidebarSectionItems(
  current: SidebarCustomization,
  sectionId: string,
  itemKeys: readonly string[],
): SidebarCustomization {
  const unique = [...new Set(itemKeys)]
  return {
    ...current,
    sections: current.sections.map((section) => {
      if (section.id === sectionId) return { ...section, itemKeys: unique }
      // 顶层归属唯一：同一键不能在多个分组或置顶区重复出现。
      const filtered = section.itemKeys.filter((key) => !unique.includes(key))
      return filtered.length === section.itemKeys.length
        ? section
        : { ...section, itemKeys: filtered }
    }),
  }
}

/** 把条目移动到指定自定义分组的指定位置。 */
export function moveItemToSection(
  current: SidebarCustomization,
  sectionId: string,
  itemKey: string,
  index?: number,
): SidebarCustomization {
  const nextKeys = new Map<string, string[]>()
  for (const section of current.sections) {
    nextKeys.set(
      section.id,
      section.itemKeys.filter((key) => key !== itemKey),
    )
  }
  const target = nextKeys.get(sectionId)
  if (!target) return current
  const insertAt = index === undefined ? target.length : Math.max(0, Math.min(index, target.length))
  target.splice(insertAt, 0, itemKey)
  return {
    ...current,
    sections: current.sections.map((section) => ({
      ...section,
      itemKeys: nextKeys.get(section.id) ?? section.itemKeys,
    })),
  }
}

export function moveItemsToSection(
  current: SidebarCustomization,
  sectionId: string,
  itemKeys: readonly string[],
  index?: number,
): SidebarCustomization {
  let next = current
  itemKeys.forEach((itemKey, offset) => {
    next = moveItemToSection(
      next,
      sectionId,
      itemKey,
      index === undefined ? undefined : index + offset,
    )
  })
  return next
}

/** 移除条目的自定义归属，回到默认区域或项目归属。 */
export function removeItemsFromSections(
  current: SidebarCustomization,
  itemKeys: readonly string[],
): SidebarCustomization {
  if (itemKeys.length === 0) return current
  const removed = new Set(itemKeys)
  let changed = false
  const sections = current.sections.map((section) => {
    const filtered = section.itemKeys.filter((key) => !removed.has(key))
    if (filtered.length === section.itemKeys.length) return section
    changed = true
    return { ...section, itemKeys: filtered }
  })
  return changed ? { ...current, sections } : current
}

export function setSidebarDestinationOrder(
  current: SidebarCustomization,
  order: readonly string[],
): SidebarCustomization {
  return { ...current, destinationOrder: [...new Set(order)] }
}

export function setSidebarDestinationHidden(
  current: SidebarCustomization,
  id: string,
  hidden: boolean,
): SidebarCustomization {
  const hiddenIds = new Set(current.hiddenDestinationIds)
  if (hidden) hiddenIds.add(id)
  else hiddenIds.delete(id)
  return { ...current, hiddenDestinationIds: [...hiddenIds] }
}

export type SidebarSectionAssignment = { sectionId: string; index: number }

/** 记录条目当前的自定义分组归属，供归档失败时精确回滚。 */
export function captureSidebarAssignments(
  current: SidebarCustomization,
  itemKeys: readonly string[],
): Map<string, SidebarSectionAssignment> {
  const wanted = new Set(itemKeys)
  const captured = new Map<string, SidebarSectionAssignment>()
  for (const section of current.sections) {
    section.itemKeys.forEach((key, index) => {
      if (wanted.has(key) && !captured.has(key)) captured.set(key, { sectionId: section.id, index })
    })
  }
  return captured
}

/**
 * 归档部分失败时只把失败条目恢复到原分组与位置；
 * 已成功归档的条目保持移除，不覆盖后续的其他侧栏操作。
 */
export function restoreFailedArchiveAssignments(
  current: SidebarCustomization,
  failedKeys: readonly string[],
  captured: ReadonlyMap<string, SidebarSectionAssignment>,
): SidebarCustomization {
  let next = current
  for (const key of failedKeys) {
    const assignment = captured.get(key)
    if (!assignment) continue
    // 归档之后已经被移动到其他分组的条目不再回滚，避免重复归属。
    const assignedElsewhere = next.sections.some((section) => section.itemKeys.includes(key))
    if (assignedElsewhere) continue
    next = restoreSidebarAssignments(next, {
      sectionId: assignment.sectionId,
      itemKey: key,
      index: assignment.index,
    })
  }
  return next
}

/**
 * 归档撤销时恢复本次移除的侧栏归属；只恢复指定条目，
 * 不覆盖归档之后的其他操作结果。
 */
export function restoreSidebarAssignments(
  current: SidebarCustomization,
  restore: {
    sectionId: string
    itemKey: string
    index: number
  } | null,
): SidebarCustomization {
  if (!restore) return current
  const section = current.sections.find((item) => item.id === restore.sectionId)
  if (!section) return current
  if (section.itemKeys.includes(restore.itemKey)) return current
  return moveItemToSection(current, restore.sectionId, restore.itemKey, restore.index)
}
