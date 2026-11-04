// Adapted from CopilotKit/OpenIntelligentUI process-partial-html.ts (MIT).
// Source revision and license are recorded in UPSTREAM.md.
// This improves incomplete layouts; it is not an HTML sanitizer.
//
// 与上游的差异：上游用 `<[^>]*>`、`<(style|script|head)...` 等一次性正则删除多字符
// 片段，嵌套标签会残留；这里改为按标签边界扫描，逐个标签判定，语义一致且不会
// 因单次替换让危险片段重新拼合。
export function processPartialHtml(html: string): string {
  const withoutTail = dropTrailingIncompleteTag(html)
  const withoutContainers = dropBlocks(withoutTail, ['style', 'script', 'head'])
  const withoutEntity = withoutContainers.replace(/&[a-zA-Z0-9#]*$/, '')
  const bodyStart = findTag(withoutEntity, 'body')
  if (!bodyStart) return withoutEntity
  const inner = withoutEntity.slice(bodyStart.end)
  const bodyEnd = findClosingTag(inner, 'body')
  return bodyEnd === -1 ? inner : inner.slice(0, bodyEnd)
}

type TagMatch = { start: number; end: number; closing: boolean; name: string }

/** 读取 `from` 起始处的标签；不是标签则返回 null。 */
function readTag(source: string, from: number): TagMatch | null {
  if (source[from] !== '<') return null
  const end = source.indexOf('>', from)
  if (end === -1) return null
  const raw = source.slice(from + 1, end)
  const closing = raw.startsWith('/')
  const name = (closing ? raw.slice(1) : raw)
    .trim()
    .split(/[\s/>]/, 1)[0]
    ?.toLowerCase()
  if (!name) return null
  return { start: from, end: end + 1, closing, name }
}

function findTag(source: string, name: string): TagMatch | null {
  for (let index = source.indexOf('<'); index !== -1; index = source.indexOf('<', index + 1)) {
    const tag = readTag(source, index)
    if (tag && tag.name === name && !tag.closing) return tag
  }
  return null
}

function findClosingTag(source: string, name: string): number {
  for (let index = source.indexOf('<'); index !== -1; index = source.indexOf('<', index + 1)) {
    const tag = readTag(source, index)
    if (tag && tag.name === name && tag.closing) return tag.start
  }
  return -1
}

/** 去掉末尾未闭合的标签片段，例如 `<div class="x`。 */
function dropTrailingIncompleteTag(source: string): string {
  const lastOpen = source.lastIndexOf('<')
  if (lastOpen === -1) return source
  return source.indexOf('>', lastOpen) === -1 ? source.slice(0, lastOpen) : source
}

/** 删除指定容器标签的整块内容；未闭合时删除到结尾（与上游一致）。 */
function dropBlocks(source: string, names: readonly string[]): string {
  let result = ''
  let index = 0
  while (index < source.length) {
    const open = source.indexOf('<', index)
    if (open === -1) return result + source.slice(index)
    result += source.slice(index, open)
    const tag = readTag(source, open)
    if (!tag) {
      // 不完整标签：保留剩余供调用方处理（末尾片段此前已剔除）。
      return result + source.slice(open)
    }
    if (tag.closing || !names.includes(tag.name)) {
      result += source.slice(open, tag.end)
      index = tag.end
      continue
    }
    const closeStart = findClosingTag(source.slice(tag.end), tag.name)
    index = closeStart === -1 ? source.length : tag.end + closeStart + `</${tag.name}>`.length
  }
  return result
}
