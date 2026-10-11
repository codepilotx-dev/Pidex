import { describe, expect, test } from 'bun:test'
import type { DesktopPermissionRequest } from '../shared/Types.js'
import { buildInlineApprovalCommand } from '../src/features/session/approvals/InlineApprovalCard.js'
import { formatToolInputForDisplay } from '../src/features/session/timeline/CanonicalItemRenderer.js'

describe('ApplyPatch 审批展示', () => {
  test('普通工具时间线也不会渲染 patch 正文', () => {
    const rendered = formatToolInputForDisplay('workspace.apply_patch', {
      patch: '*** Update File: C:\\secret\\source.ts\n-old\n+new',
      patchBytes: 42,
    })
    expect(rendered).toContain('[补丁正文已隐藏]')
    expect(rendered).not.toContain('C:\\secret')
    expect(rendered).not.toContain('-old')
  })

  test('只展示宿主检查后的受影响路径，不展示 patch 正文', () => {
    const request: DesktopPermissionRequest = {
      requestId: 'approval-1',
      toolName: 'apply_patch',
      toolUseId: 'tool-1',
      description: '需要确认多文件修改',
      requestKind: 'tool',
      input: {
        patch: '*** Begin Patch\n*** Update File: secret.ts\nraw patch body',
        affectedPaths: [
          { path: 'src/a.ts', operation: 'update' },
          { path: 'src/b.ts', operation: 'create' },
        ],
        reviewSummary: {
          fileCount: 2,
          hunkCount: 2,
          additions: 4,
          deletions: 1,
        },
      },
    }
    const command = buildInlineApprovalCommand(request)
    expect(command.full).toBe('修改 src/a.ts\n新增 src/b.ts')
    expect(command.full).not.toContain('raw patch body')

    expect(
      buildInlineApprovalCommand({
        ...request,
        input: { patch: 'still secret' },
      }).full,
    ).toBe('apply_patch（未提供可展示的文件范围）')
  })
})
