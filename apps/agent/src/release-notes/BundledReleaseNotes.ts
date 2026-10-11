import type { ReleaseNotesListResult } from '@pidex/agent-protocol'
import bundledChangelog from '../../../../CHANGELOG.md' with { type: 'text' }

const REPOSITORY = 'codepilotx-dev/Pidex' as const
const ARCHIVED_VERSION_HEADING_RE = /^(.+?)\s+—\s+(\d{4}-\d{2}-\d{2})$/

type ChangelogSection = {
  heading: string
  body: string
}

export const DEFAULT_BUNDLED_CHANGELOG = bundledChangelog

export function bundledReleaseNotes(
  changelogText: string,
  currentVersion: string,
  now: number,
): ReleaseNotesListResult | null {
  const section = parseChangelogSections(changelogText).find((candidate) => {
    const match = candidate.heading.match(ARCHIVED_VERSION_HEADING_RE)
    return match?.[1] === currentVersion
  })
  if (!section || !hasChangelogEntry(section)) return null

  const heading = section.heading.match(ARCHIVED_VERSION_HEADING_RE)
  const publishedAt = heading ? `${heading[2]}T00:00:00.000Z` : ''
  if (!Number.isFinite(Date.parse(publishedAt))) return null

  const tagName = `v${currentVersion}`
  return {
    source: 'bundled-changelog',
    repository: REPOSITORY,
    currentVersion,
    currentReleaseFound: true,
    fetchedAt: new Date(now).toISOString(),
    truncated: false,
    releases: [
      {
        tagName,
        name: `Pidex ${currentVersion}`,
        body: `${section.body}\n`,
        htmlUrl: `https://github.com/${REPOSITORY}/releases/tag/${tagName}`,
        publishedAt,
        prerelease: currentVersion.includes('-'),
      },
    ],
  }
}

function parseChangelogSections(text: string): ChangelogSection[] {
  const normalized = text.replace(/\r\n?/g, '\n')
  const matches = [...normalized.matchAll(/^##\s+(.+?)\s*$/gm)]
  return matches.map((match, index) => {
    const bodyStart = (match.index ?? 0) + match[0].length
    const bodyEnd = matches[index + 1]?.index ?? normalized.length
    return {
      heading: match[1]!.trim(),
      body: normalized.slice(bodyStart, bodyEnd).trim(),
    }
  })
}

function hasChangelogEntry(section: ChangelogSection): boolean {
  return section.body.split('\n').some((line) => line.trimStart().startsWith('- '))
}
