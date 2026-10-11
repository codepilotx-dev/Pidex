import type { DesktopReviewDiffFile } from '../../../../shared/Types.js'

export type ReviewFileTreeNode = {
  dirPath: string
  dirLabel: string
  children: ReviewFileTreeNode[]
  files: DesktopReviewDiffFile[]
}

export type ReviewFileTreeRow =
  | {
      kind: 'directory'
      key: string
      depth: number
      node: ReviewFileTreeNode
    }
  | {
      kind: 'file'
      key: string
      depth: number
      file: DesktopReviewDiffFile
    }

const ROOT_DIR = ''

export function buildReviewFileTree(files: DesktopReviewDiffFile[]): ReviewFileTreeNode[] {
  if (files.length === 0) return []

  const root = createNode(ROOT_DIR, '(root)')
  for (const file of files) {
    const segments = file.path.split('/')
    segments.pop() // remove filename, leaving only directory segments
    let current = root
    for (const segment of segments) {
      const childPath = current.dirPath ? `${current.dirPath}/${segment}` : segment
      let child = current.children.find((node) => node.dirPath === childPath)
      if (!child) {
        child = createNode(childPath, segment)
        current.children.push(child)
      }
      current = child
    }
    current.files.push(file)
  }

  sortNode(root)
  return collapseSingleChildRoots(root)
}

export function flattenReviewFileTree(
  nodes: readonly ReviewFileTreeNode[],
  collapsedDirs: ReadonlySet<string>,
): ReviewFileTreeRow[] {
  const rows: ReviewFileTreeRow[] = []

  const appendNode = (node: ReviewFileTreeNode, depth: number): void => {
    const isRoot = node.dirPath === ROOT_DIR
    if (!isRoot) {
      rows.push({
        kind: 'directory',
        key: `directory:${node.dirPath}`,
        depth,
        node,
      })
    }
    if (!isRoot && collapsedDirs.has(node.dirPath)) return

    const childDepth = isRoot ? depth : depth + 1
    for (const file of node.files) {
      rows.push({
        kind: 'file',
        key: `file:${file.path}`,
        depth: childDepth,
        file,
      })
    }
    for (const child of node.children) appendNode(child, childDepth)
  }

  for (const node of nodes) appendNode(node, 0)
  return rows
}

function createNode(dirPath: string, dirLabel: string): ReviewFileTreeNode {
  return { dirPath, dirLabel, children: [], files: [] }
}

function sortNode(node: ReviewFileTreeNode): void {
  node.children.sort((a, b) => a.dirLabel.localeCompare(b.dirLabel))
  node.files.sort((a, b) => a.path.localeCompare(b.path))
  for (const child of node.children) sortNode(child)
}

function collapseSingleChildRoots(root: ReviewFileTreeNode): ReviewFileTreeNode[] {
  if (root.dirPath !== ROOT_DIR) return [root]
  if (root.files.length > 0) return [root]
  if (root.children.length === 0) return [root]
  return root.children.map((child) => rebase(child, child.dirLabel, child.dirLabel))
}

function rebase(
  node: ReviewFileTreeNode,
  newDirPath: string,
  newDirLabel: string,
): ReviewFileTreeNode {
  const rebased: ReviewFileTreeNode = {
    dirPath: newDirPath,
    dirLabel: newDirLabel,
    children: node.children.map((child) =>
      rebase(
        child,
        node.dirPath ? `${node.dirPath}/${child.dirLabel}` : child.dirLabel,
        child.dirLabel,
      ),
    ),
    files: node.files,
  }
  return rebased
}
