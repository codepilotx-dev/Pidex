export function reasoningHeading(text: string): string | null {
  const line = text
    .trimEnd()
    .split(/\r?\n/)
    .findLast((line) => line.trim())
    ?.trim()
  if (!line) return null
  return (
    line
      .replace(/^#{1,6}\s+/, '')
      .replace(/\*\*|__|`/g, '')
      .trim() || null
  )
}
