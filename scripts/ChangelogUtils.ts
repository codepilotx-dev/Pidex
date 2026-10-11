/**
 * CHANGELOG 区段解析工具。
 *
 * 版本策略检查和 GitHub Release 正文生成必须共享同一套标题边界规则，
 * 避免发布内容与升版检查产生不同解释。
 */

export interface ChangelogSection {
  heading: string
  body: string
}

const ARCHIVED_VERSION_HEADING_RE = /^(.+?)\s+—\s+(\d{4}-\d{2}-\d{2})$/

export function parseChangelogSections(text: string): ChangelogSection[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const matches = [...normalized.matchAll(/^##\s+(.+?)\s*$/gm)]

  return matches.map((match, index) => {
    const bodyStart = (match.index ?? 0) + match[0].length
    const bodyEnd = matches[index + 1]?.index ?? normalized.length
    return {
      heading: match[1].trim(),
      body: normalized.slice(bodyStart, bodyEnd).trim(),
    }
  })
}

export function getChangelogSection(text: string, heading: string): ChangelogSection | undefined {
  return parseChangelogSections(text).find((section) => section.heading === heading)
}

export function hasChangelogEntry(section: ChangelogSection): boolean {
  return section.body.split('\n').some((line) => line.trimStart().startsWith('- '))
}

export function extractArchivedReleaseNotes(text: string, version: string): string {
  const section = parseChangelogSections(text).find((candidate) => {
    const match = candidate.heading.match(ARCHIVED_VERSION_HEADING_RE)
    return match?.[1] === version
  })

  if (!section) {
    throw new Error(
      `CHANGELOG.md 中未找到已归档版本 "${version}"（期望标题：## ${version} — YYYY-MM-DD）`,
    )
  }
  if (!hasChangelogEntry(section)) {
    throw new Error(`CHANGELOG.md 的版本 "${version}" 区段为空`)
  }

  return `${section.body}\n`
}
