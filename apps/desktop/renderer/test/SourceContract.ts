import { expect } from 'bun:test'

/**
 * 部分契约测试直接读取源码文本做断言。格式化会改变换行、尾随逗号与单参数
 * 箭头括号，但不改变被保护的契约，因此先把文本抹平到统一形态再匹配，
 * 让断言只依赖行为与结构，不依赖代码风格。
 *
 * 注意：引号会被统一成单引号，因此必须两侧一起归一化后再比较。
 * 用 expectSource* 比较，不要只归一化其中一侧。
 * 只用于「源码即契约」的文本断言；不要把结果再交给按行解析的局部解析器。
 */
export function normalizeSource(text: string | undefined): string {
  return (text ?? '')
    .replace(/\s+/g, ' ')
    .replace(/\(\s+/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/,(\s*[}\])])/g, '$1')
    .replace(/"/g, "'")
    .replace(/\((\w+)\)\s*=>/g, '$1 =>')
}

/** 断言源码包含某片段，两侧都抹平格式差异后再比较。 */
export function expectSourceContains(actual: string | undefined, expected: string): void {
  expect(normalizeSource(actual)).toContain(normalizeSource(expected))
}

/** 断言源码不包含某片段，两侧都抹平格式差异后再比较。 */
export function expectSourceNotContains(actual: string | undefined, expected: string): void {
  expect(normalizeSource(actual)).not.toContain(normalizeSource(expected))
}
