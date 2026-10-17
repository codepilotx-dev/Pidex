export type SelectedModelScrollGeometry = {
  scrollTop: number
  scrollHeight: number
  listTop: number
  listClientHeight: number
  rowTop: number
  rowHeight: number
}

/**
 * 打开选择器时把选中模型放到列表可视区域中间。
 * 结果始终夹在 `0…(scrollHeight - clientHeight)` 之间，列表不足一屏时保持顶部。
 */
export function centeredScrollTop(geometry: SelectedModelScrollGeometry): number {
  const offset =
    geometry.rowTop -
    geometry.listTop -
    (geometry.listClientHeight - geometry.rowHeight) / 2
  const maxScrollTop = Math.max(0, geometry.scrollHeight - geometry.listClientHeight)
  return Math.min(Math.max(geometry.scrollTop + offset, 0), maxScrollTop)
}
