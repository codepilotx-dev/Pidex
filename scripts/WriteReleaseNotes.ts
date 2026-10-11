/**
 * 从已归档的 CHANGELOG 版本区段生成 GitHub Release 正文。
 *
 * 用法：
 *   bun scripts/WriteReleaseNotes.ts --tag v0.2.0-beta.1 --output <文件>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { extractArchivedReleaseNotes } from './ChangelogUtils.ts'
import { SEMVER_RE } from './SemverUtils.ts'

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const DEFAULT_ROOT = join(SCRIPT_DIR, '..')

interface BuildReleaseNotesInput {
  tag: string
  rootVersion: string
  changelogText: string
}

export function buildReleaseNotes({
  tag,
  rootVersion,
  changelogText,
}: BuildReleaseNotesInput): string {
  if (!tag.startsWith('v')) {
    throw new Error(`标签 "${tag}" 必须以 "v" 开头`)
  }

  const version = tag.slice(1)
  if (!SEMVER_RE.test(version)) {
    throw new Error(`标签版本 "${version}" 不符合严格 SemVer 格式`)
  }
  if (version !== rootVersion) {
    throw new Error(`标签版本 "${version}" 与根版本 "${rootVersion}" 不一致`)
  }

  return extractArchivedReleaseNotes(changelogText, version)
}

function readArg(args: string[], name: string): string | undefined {
  const index = args.indexOf(name)
  if (index === -1 || index + 1 >= args.length) return undefined
  return args[index + 1]
}

function main() {
  const args = process.argv.slice(2)
  const tag = readArg(args, '--tag')
  const outputArg = readArg(args, '--output')

  if (!tag || !outputArg) {
    console.error('用法: bun scripts/WriteReleaseNotes.ts --tag <v版本> --output <文件>')
    process.exit(1)
  }

  try {
    const root = process.env.PIDEX_PROJECT_ROOT ?? DEFAULT_ROOT
    const rootManifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf-8')) as {
      version?: unknown
    }
    if (typeof rootManifest.version !== 'string') {
      throw new Error('根 package.json 缺少字符串类型的 version')
    }

    const notes = buildReleaseNotes({
      tag,
      rootVersion: rootManifest.version,
      changelogText: readFileSync(join(root, 'CHANGELOG.md'), 'utf-8'),
    })
    const output = resolve(outputArg)
    writeFileSync(output, notes, 'utf-8')
    console.log(`  ✓ 已生成 ${tag} 的 Release 正文：${output}`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(`  ✗ ${message}`)
    process.exit(1)
  }
}

if (import.meta.main) {
  main()
}
