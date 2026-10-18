import { describe, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

const sidebar = readFileSync(
  new URL('../src/features/layout/DesktopSidebar.tsx', import.meta.url),
  'utf8',
)

/**
 * 项目移除的撤销提示必须走全局 Toast：位置、堆叠、动效与无障碍由 ToastStack
 * 统一承载，并携带服务端撤销期限；禁止再自绘固定定位提示压住输入区工具行。
 */
describe('项目移除撤销提示', () => {
  test('经全局 toastStore 呈现并携带撤销期限', () => {
    expectSourceContains(
      sidebar,
      "import { toastStore } from '../../components/toast/ToastState.js'",
    )
    expectSourceContains(sidebar, "message: '项目已移除'")
    expectSourceContains(sidebar, "'project-removal-undo'")
    expectSourceContains(sidebar, 'expiresAt,')
  })

  test('不再自绘固定定位提示', () => {
    expectSourceNotContains(sidebar, 'tw:fixed tw:bottom-4')
    expectSourceNotContains(sidebar, "from '../../components/ui/Toast.js'")
  })
})
