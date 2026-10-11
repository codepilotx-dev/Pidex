export type ShellCommandSeparator = '|' | '||' | '&' | '&&' | ';' | '\n' | '(' | ')' | '{' | '}'

export type ShellCommandSegment = {
  text: string
  separatorBefore: ShellCommandSeparator | null
  executable: string | null
  executableIsPath: boolean
}

const executableFor = (segment: string) => {
  const candidate = segment
    .trim()
    .replace(/^&\s+/, '')
    .replace(/^sudo\s+/i, '')
  const raw = /^(?:"([^"]+)"|'([^']+)'|([^\s]+))/.exec(candidate)?.slice(1).find(Boolean)
  if (!raw) return { executable: null, executableIsPath: false }
  const basename = raw.split(/[\\/]/).at(-1)
  return {
    executable: basename ? basename.toLowerCase().replace(/\.(?:exe|cmd|bat|com)$/i, '') : null,
    executableIsPath: raw.includes('/') || raw.includes('\\') || /^[a-z]:/i.test(raw),
  }
}

/**
 * Splits the top-level command chain without treating separators inside quoted
 * strings as executable boundaries. This is intentionally a small lexical
 * scanner, not a Bash or PowerShell parser.
 */
export const shellCommandSegments = (command: string): ShellCommandSegment[] => {
  const segments: ShellCommandSegment[] = []
  let start = 0
  let separatorBefore: ShellCommandSeparator | null = null
  let quote: "'" | '"' | null = null
  let escaped = false

  const push = (end: number, nextSeparator: ShellCommandSeparator) => {
    const text = command.slice(start, end).trim()
    if (text) {
      const executable = executableFor(text)
      segments.push({
        text,
        separatorBefore,
        ...executable,
      })
    }
    separatorBefore = nextSeparator
  }

  for (let index = 0; index < command.length; index += 1) {
    const character = command[index]!
    if (escaped) {
      escaped = false
      continue
    }
    if (character === '\\' || character === '`') {
      escaped = true
      continue
    }
    if (quote) {
      if (character === quote) quote = null
      continue
    }
    if (character === "'" || character === '"') {
      quote = character
      continue
    }

    const pair = command.slice(index, index + 2)
    if (pair === '&&' || pair === '||') {
      push(index, pair)
      index += 1
      start = index + 1
      continue
    }
    if (character === '&' && command.slice(start, index).trim()) {
      push(index, '&')
      start = index + 1
      continue
    }
    if (
      character === '|' ||
      character === ';' ||
      character === '\n' ||
      character === '\r' ||
      character === '(' ||
      character === ')' ||
      character === '{' ||
      character === '}'
    ) {
      const separator = character === '\r' ? '\n' : (character as ShellCommandSeparator)
      push(index, separator)
      start = index + 1
    }
  }

  const text = command.slice(start).trim()
  if (text) {
    const executable = executableFor(text)
    segments.push({
      text,
      separatorBefore,
      ...executable,
    })
  }
  return segments
}
