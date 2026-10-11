export function selectorBlock(source: string, selector: string): string | null {
  const start = source.indexOf(selector)
  if (start < 0) return null
  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    else if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return source.slice(start, index + 1)
    }
  }
  return null
}

export function nestedSelectorBlock(
  source: string,
  parentSelector: string,
  nestedSelector: string,
): string | null {
  const parentBlock = selectorBlock(source, parentSelector)
  return parentBlock ? selectorBlock(parentBlock, nestedSelector) : null
}

export function transitionProperties(block: string): string[] {
  const declarations = [...block.matchAll(/(?:^|[;{])\s*transition\s*:\s*([^;{}]+);/g)]
  return declarations.flatMap((match) =>
    splitTopLevelCommas(match[1] ?? '').map(
      (transition) => transition.trim().split(/\s+/, 1)[0] ?? '',
    ),
  )
}

function splitTopLevelCommas(value: string): string[] {
  const parts: string[] = []
  let start = 0
  let depth = 0
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index]
    if (character === '(') depth += 1
    else if (character === ')') depth = Math.max(0, depth - 1)
    else if (character === ',' && depth === 0) {
      parts.push(value.slice(start, index))
      start = index + 1
    }
  }
  parts.push(value.slice(start))
  return parts
}
