import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import ts from 'typescript'

test('会话子卡片不能在运行时反向依赖父渲染模块，避免热更新循环', () => {
  for (const name of ['ExpandableFileMutationRow.tsx', 'QuestionItemView.tsx', 'FileMutationPresentation.ts']) {
    const source = readFileSync(new URL(`../src/features/session/timeline/${name}`, import.meta.url), 'utf8')
    const file = ts.createSourceFile(name, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX)
    const runtimeParentImports = file.statements.filter((statement) =>
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      statement.moduleSpecifier.text === './CanonicalItemRenderer.js' &&
      !statement.importClause?.isTypeOnly,
    )
    expect(runtimeParentImports).toHaveLength(0)
  }
})
