import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { expectSourceContains, expectSourceNotContains } from './SourceContract.js'

const preloadSource = readFileSync(
  fileURLToPath(new URL('../src/preload.cts', import.meta.url)),
  'utf8',
)

/**
 * preload.cjs 由 tsc 单独产出、不参与打包，运行时只会 require "electron"。
 * 一旦从 workspace 包引入运行时值，产物会 require TypeScript 源并在加载时抛错，
 * 结果是整个 contextBridge 消失、渲染端退回 browser-mock。这里把该边界钉住。
 */
describe('preload 模块边界', () => {
  test('不得从 workspace 包引入运行时值', () => {
    // 每条 import 语句单独分析，避免跨语句匹配。
    const statements = preloadSource
      .split(/\n(?=import\s)/)
      .filter((statement) => statement.startsWith('import '))
    const workspaceImports = statements.filter((statement) => /from\s+['"]@pidex\//.test(statement))
    expect(workspaceImports.length).toBeGreaterThan(0)

    const offenders = workspaceImports
      .filter((statement) => {
        if (/^import\s+type\s/.test(statement)) return false
        const clause = /^import\s+([\s\S]*?)\s+from\s+['"]/.exec(statement)?.[1] ?? ''
        if (clause.trim().startsWith('type ')) return false
        const specifiers = clause
          .replace(/^\{|\}$/g, '')
          .split(',')
          .map((specifier) => specifier.trim())
          .filter((specifier) => specifier.length > 0)
        return specifiers.some((specifier) => !specifier.startsWith('type '))
      })
      .map((statement) => /from\s+['"](@pidex\/[^'"]+)['"]/.exec(statement)?.[1])

    expect(offenders).toEqual([])
  })

  test('缩放活动校验在本地实现，避免运行时依赖', () => {
    expectSourceContains(preloadSource, 'function isDesktopResizeActivity(')
    expectSourceNotContains(preloadSource, 'import {\n  isDesktopResizeActivity,')
  })
})
