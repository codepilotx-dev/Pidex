import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'

import {
  patchFilesForDisplay,
  PatchSummaryView,
  type FileChangeDisplay,
  type PatchDisplay,
} from '../src/features/session/timeline/CanonicalItemRenderer.js'
import { normalizePatchActionError } from '../src/features/session/timeline/PatchActionError.js'
import { AgentRpcError } from '../src/services/AgentRpcClient.js'

function files(count: number): FileChangeDisplay[] {
  return Array.from({ length: count }, (_, index) => ({
    additions: index + 1,
    deletions: index,
    path: `src/file-${index + 1}.ts`,
  }))
}

function patch(count: number, overrides: Partial<PatchDisplay> = {}): PatchDisplay {
  return {
    files: files(count),
    id: 'patch:turn-1',
    totalAdditions: 10,
    totalDeletions: 2,
    ...overrides,
  }
}

describe('canonical patch card', () => {
  test('shows three file rows and leaves the rest unmounted until revealed', () => {
    const markup = renderToStaticMarkup(
      <PatchSummaryView onOpenReview={() => undefined} patch={patch(4)} />,
    )

    expect(markup.startsWith('<article class="canonical-patch-card">')).toBe(true)
    expect(markup).toContain('已编辑 4 个文件')
    expect(markup).toContain('src/file-1.ts')
    expect(markup).toContain('src/file-3.ts')
    // until-exit 策略：折叠内容在展开前不挂载，展开后保留到退场。
    expect(markup).not.toContain('src/file-4.ts')
    expect(markup).toContain('再显示 1 个文件')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('data-mount-policy="until-exit"')
    expect(markup).toContain('aria-hidden="true"')
    expect(markup).toContain('inert')
    expect(markup).toContain('class="canonical-patch-card__disclosure"')
    expect(markup).not.toContain('ui-button canonical-patch-card__disclosure')
  })

  test('does not render a disclosure for three or fewer files', () => {
    const markup = renderToStaticMarkup(
      <PatchSummaryView onOpenReview={() => undefined} patch={patch(3)} />,
    )

    expect(markup).not.toContain('再显示')
    expect(markup).not.toContain('收起文件')
  })

  test('derives the expanded file list without changing the patch order', () => {
    const patchFiles = files(5)

    expect(patchFilesForDisplay(patchFiles, false).map((file) => file.path)).toEqual([
      'src/file-1.ts',
      'src/file-2.ts',
      'src/file-3.ts',
    ])
    expect(patchFilesForDisplay(patchFiles, true)).toEqual(patchFiles)
  })

  test('shows the action that matches the persisted apply state', () => {
    const undoMarkup = renderToStaticMarkup(
      <PatchSummaryView
        onApplyPatch={async () => undefined}
        patch={patch(1, {
          actionVersion: 2,
          applyState: 'applied',
          reversible: true,
        })}
      />,
    )
    const reapplyMarkup = renderToStaticMarkup(
      <PatchSummaryView
        onApplyPatch={async () => undefined}
        patch={patch(1, {
          actionVersion: 3,
          applyState: 'undone',
          reversible: true,
        })}
      />,
    )
    const historicalMarkup = renderToStaticMarkup(
      <PatchSummaryView onApplyPatch={async () => undefined} patch={patch(1)} />,
    )

    expect(undoMarkup).toContain('撤销')
    expect(reapplyMarkup).toContain('重新应用')
    expect(historicalMarkup).not.toContain('撤销')
    expect(historicalMarkup).not.toContain('重新应用')
  })

  test('uses the same conflict message for main and subagent patch actions', () => {
    const conflict = new AgentRpcError('conflict', 409, {
      code: 'WORKSPACE_CONFLICT',
    })

    expect(normalizePatchActionError(conflict, 'undo').message).toBe('文件已被后续修改，无法撤销')
    expect(normalizePatchActionError(conflict, 'reapply').message).toBe(
      '文件已被后续修改，无法重新应用',
    )
  })
})
