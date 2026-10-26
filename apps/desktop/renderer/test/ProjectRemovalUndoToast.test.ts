import { describe, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

const sidebar = readFileSync(
  new URL('../src/features/layout/DesktopSidebar.tsx', import.meta.url),
  'utf8',
)
const stack = readFileSync(
  new URL('../src/components/toast/ToastStack.tsx', import.meta.url),
  'utf8',
)
const styles = readFileSync(new URL('../src/styles/modal.css', import.meta.url), 'utf8')

describe('全局 toast', () => {
  test('项目移除不弹出全局撤销提示', () => {
    expectSourceNotContains(sidebar, 'project-removal-undo')
    expectSourceNotContains(sidebar, 'ProjectRemovalUndoNotice')
    expectSourceNotContains(sidebar, 'subscribeProjectRemovals')
  })

  test('水平居中只应用一次位移', () => {
    expectSourceContains(stack, 'tw:left-1/2')
    expectSourceContains(stack, 'tw:-translate-x-1/2')
    const containerStyles = styles.split('.toast-stack-container {')[1]!.split('}')[0]!
    expectSourceNotContains(containerStyles, 'transform:')
    expectSourceNotContains(containerStyles, 'translate:')
  })
})
