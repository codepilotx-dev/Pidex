import React from 'react'
import { VList, type VListHandle } from 'virtua'
import { ReviewFileTreeRow } from './ReviewFileTree.js'
import { flattenReviewFileTree, type ReviewFileTreeNode } from './BuildReviewFileTree.js'

const REVIEW_FILE_TREE_ROW_HEIGHT = 29

export const ReviewFileTreeController = React.memo(function ReviewFileTreeController({
  commentCountsByPath,
  emptyMessage,
  reviewTree,
  selectedPath,
  onSelectFile,
}: {
  commentCountsByPath: Readonly<Record<string, number>>
  emptyMessage: string
  reviewTree: readonly ReviewFileTreeNode[]
  selectedPath: string | null
  onSelectFile: (path: string) => void
}): React.ReactNode {
  const [collapsedDirs, setCollapsedDirs] = React.useState<Set<string>>(() => new Set())
  const listRef = React.useRef<VListHandle | null>(null)

  React.useEffect(() => {
    if (!selectedPath) return
    const segments = selectedPath.split('/').slice(0, -1)
    setCollapsedDirs((current) => {
      const next = new Set(current)
      let path = ''
      for (const segment of segments) {
        path = path ? `${path}/${segment}` : segment
        next.delete(path)
      }
      return next.size === current.size ? current : next
    })
  }, [selectedPath])

  const rows = React.useMemo(
    () => flattenReviewFileTree(reviewTree, collapsedDirs),
    [collapsedDirs, reviewTree],
  )

  React.useEffect(() => {
    if (!selectedPath) return
    const selectedIndex = rows.findIndex(
      (row) => row.kind === 'file' && row.file.path === selectedPath,
    )
    if (selectedIndex >= 0) {
      listRef.current?.scrollToIndex(selectedIndex, { align: 'nearest' })
    }
  }, [rows, selectedPath])

  const toggleDir = React.useCallback((dirPath: string) => {
    setCollapsedDirs((current) => {
      const next = new Set(current)
      if (next.has(dirPath)) next.delete(dirPath)
      else next.add(dirPath)
      return next
    })
  }, [])

  if (rows.length === 0) {
    return (
      <div className="review-empty-state tw:px-4 tw:py-6 tw:text-app-text-meta tw:type-body-sm">
        {emptyMessage}
      </div>
    )
  }

  return (
    <VList
      className="review-file-tree-scroll review-file-tree-vlist tw:flex-auto tw:min-h-0 tw:min-w-0"
      data={rows}
      itemSize={REVIEW_FILE_TREE_ROW_HEIGHT}
      ref={listRef}
      role="tree"
    >
      {(row) => (
        <ReviewFileTreeRow
          collapsedDirs={collapsedDirs}
          commentCountsByPath={commentCountsByPath}
          key={row.key}
          row={row}
          selectedPath={selectedPath}
          onSelectFile={onSelectFile}
          onToggleDir={toggleDir}
        />
      )}
    </VList>
  )
})
