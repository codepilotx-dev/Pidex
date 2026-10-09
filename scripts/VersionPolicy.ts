/**
 * VersionPolicy.ts — 版本策略检查与准备工具
 *
 * 命令：
 *   bun run version:check                             基本一致性检查
 *   bun run version:check -- --base <git-sha>         PR 检查（Unreleased 有新增）
 *   bun run version:check -- --tag <v版本>             标签一致性检查
 *   bun run version:prepare -- <新版本> [--stable]     归档并升版
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { execSync } from 'node:child_process'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SEMVER_RE, compareSemver, parseSemver } from './SemverUtils.ts'
import {
  extractArchivedReleaseNotes,
  getChangelogSection,
  hasChangelogEntry,
  parseChangelogSections,
} from './ChangelogUtils.ts'

/* ─────────────── 路径 ─────────────── */

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url))
const ROOT = process.env.PIDEX_PROJECT_ROOT ?? join(SCRIPT_DIR, '..')

const MANIFESTS = [
  'package.json',
  'apps/agent/package.json',
  'apps/desktop/electron/package.json',
  'apps/desktop/renderer/package.json',
] as const

const LOCKFILE = 'bun.lock'
const CHANGELOG = 'CHANGELOG.md'
const LOCK_WS_MAP: Record<string, string> = {
  'apps/agent/package.json': 'apps/agent',
  'apps/desktop/electron/package.json': 'apps/desktop/electron',
  'apps/desktop/renderer/package.json': 'apps/desktop/renderer',
}

/* ─────────────── 工具 ─────────────── */

function readJson(p: string) {
  return JSON.parse(readFileSync(join(ROOT, p), 'utf-8'))
}

function readFile(p: string) {
  return readFileSync(join(ROOT, p), 'utf-8')
}

function writeFile(p: string, content: string) {
  writeFileSync(join(ROOT, p), content, 'utf-8')
}

function errExit(...msgs: string[]): never {
  for (const m of msgs) console.error(m)
  process.exit(1)
}

function ok(msg: string) {
  console.log(`  ✓ ${msg}`)
}

function warn(msg: string) {
  console.warn(`  ⚠ ${msg}`)
}

/* ─────────────── 检查 ─────────────── */

interface CheckOptions {
  base?: string
  tag?: string
}

function parseLockVersions(lockRaw: string): Record<string, string> {
  const lockWsRe = /"([^"]+)":\s*\{\s*"name":\s*"([^"]+)",\s*"version":\s*"([^"]+)"/g
  const lockVersions: Record<string, string> = {}
  let match: RegExpExecArray | null
  while ((match = lockWsRe.exec(lockRaw)) !== null) {
    lockVersions[match[1]] = match[3]
  }
  return lockVersions
}

function runCheck(opts: CheckOptions) {
  console.log('\n🔍 版本策略检查\n')
  let failed = false
  const fail = (...msgs: string[]) => {
    for (const m of msgs) console.error(`  ✗ ${m}`)
    failed = true
  }

  // 1. 读取根版本
  const rootPkg = readJson('package.json')
  const rootVersion: string = rootPkg.version
  if (!SEMVER_RE.test(rootVersion)) {
    fail(`根版本 "${rootVersion}" 不符合严格 SemVer 格式`)
  } else {
    ok(`根版本 ${rootVersion} 格式有效`)
  }

  // 2. 检查四个 manifest 一致
  const expectedVersion = rootVersion
  for (const mf of MANIFESTS) {
    const pkg = readJson(mf)
    if (pkg.version !== expectedVersion) {
      fail(`${mf} 版本 "${pkg.version}" 与根版本 "${expectedVersion}" 不一致`)
    }
  }
  if (!failed) ok('四个 product manifest 版本一致')

  // 3. 检查 lockfile — 使用正则解析，因为 bun.lock 含尾逗号
  const lockRaw = readFile(LOCKFILE)
  const lockVersions = parseLockVersions(lockRaw)
  for (const mf of MANIFESTS.slice(1)) {
    const pkg = readJson(mf)
    const wsKey = LOCK_WS_MAP[mf]
    if (!wsKey) continue
    const lockVersion = lockVersions[wsKey]
    if (lockVersion === undefined) {
      fail(`lockfile 中未找到 ${wsKey} 的 workspace 条目`)
    } else if (lockVersion !== pkg.version) {
      fail(`lockfile 中 ${wsKey} 版本 "${lockVersion}" 与 ${mf} "${pkg.version}" 不一致`)
    }
  }
  if (!failed) ok('lockfile 中 workspace 版本与 manifest 一致')

  // 4. 检查 CHANGELOG.md 结构
  const changelogPath = join(ROOT, CHANGELOG)
  let changelogText: string
  try {
    changelogText = readFile(CHANGELOG)
  } catch {
    fail('CHANGELOG.md 不存在')
    changelogText = ''
  }
  if (changelogText) {
    const headings = parseChangelogSections(changelogText).map((section) => section.heading)
    if (!headings.some((h) => h === 'Unreleased')) {
      fail('CHANGELOG.md 缺少 ## Unreleased 区段')
    }
    try {
      extractArchivedReleaseNotes(changelogText, rootVersion)
      ok(`CHANGELOG.md 包含当前版本 ${rootVersion} 的内置更新记录`)
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error))
    }
    // Check categories — 未知分类、重复分类与顺序漂移都会让 Unreleased
    // 与发布归档、Release 正文的分类错位，因此一律失败关闭。
    const unreleasedSection = getChangelogSection(changelogText, 'Unreleased')?.body ?? ''
    const validCategories = [
      '### Added',
      '### Changed',
      '### Fixed',
      '### Deprecated',
      '### Removed',
      '### Security',
    ]
    const categories = unreleasedSection
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('### '))
    let structureValid = true
    const failStructure = (msg: string) => {
      fail(msg)
      structureValid = false
    }
    for (const category of new Set(categories)) {
      if (!validCategories.includes(category)) {
        failStructure(`Unreleased 中出现未知分类: "${category}"`)
      }
    }
    for (const category of new Set(categories)) {
      if (categories.filter((item) => item === category).length > 1) {
        failStructure(`Unreleased 中分类重复出现: "${category}"`)
      }
    }
    const positions = categories
      .filter((category) => validCategories.includes(category))
      .map((category) => validCategories.indexOf(category))
    if (positions.join(',') !== [...positions].sort((a, b) => a - b).join(',')) {
      failStructure(`Unreleased 分类顺序不符合规范，应为 ${validCategories.join(' → ')}`)
    }
    if (structureValid) ok('CHANGELOG.md 结构有效')
  }

  // 5. --base: 普通 PR 检查 Unreleased 有新增
  if (opts.base) {
    try {
      const diff = execSync(`git diff "${opts.base}" -- "${CHANGELOG}"`, {
        encoding: 'utf-8',
        cwd: ROOT,
      })
      // Check if diff adds lines under Unreleased heading
      const addedLines = diff.split('\n').filter((l) => l.startsWith('+') && !l.startsWith('+++'))
      // We need to see if any addition is after an "## Unreleased" line
      // Simple check: look for added bullet points in the Unreleased section
      const hasNewEntry = addedLines.some((l) => l.startsWith('+- ['))
      if (!hasNewEntry) {
        fail(`基于 ${opts.base} 的 diff 中 Unreleased 区段缺少新增说明`)
      } else {
        ok(`Unreleased 区段有新增说明 (base: ${opts.base})`)
      }
    } catch (e: any) {
      warn(`无法执行 git diff (--base): ${e.message}，跳过 PR 检查`)
    }
  }

  // 7. --tag: 标签一致性检查
  if (opts.tag) {
    if (!opts.tag.startsWith('v')) {
      fail(`标签 "${opts.tag}" 必须以 "v" 开头`)
    } else {
      const tagVersion = opts.tag.slice(1)
      if (tagVersion !== rootVersion) {
        fail(`标签版本 "${tagVersion}" 与根版本 "${rootVersion}" 不一致`)
      } else {
        ok(`标签 ${opts.tag} 与根版本一致`)
      }
    }
  }

  if (failed) {
    console.error('\n❌ 检查失败\n')
    process.exit(1)
  }
  console.log('\n✅ 全部检查通过\n')
}

/* ─────────────── 准备升版 ─────────────── */

function runPrepare(newVersion: string, stable: boolean) {
  console.log(`\n📦 准备升版至 ${newVersion}\n`)

  // 1. 读取当前根版本
  const rootPkg = readJson('package.json')
  const currentVersion: string = rootPkg.version

  // 2. 校验新版本格式
  if (!SEMVER_RE.test(newVersion)) {
    errExit(`新版本 "${newVersion}" 不符合严格 SemVer 格式`)
  }

  // 3. 如果是稳定版（无预发布后缀），必须传 --stable
  const hasPrerelease = newVersion.includes('-')
  if (!hasPrerelease && !stable) {
    errExit(`稳定版 "${newVersion}" 必须显式传入 --stable`)
  }
  if (hasPrerelease && stable) {
    errExit(`预发布版本 "${newVersion}" 不能与 --stable 同时使用`)
  }

  // 4. 校验递增
  const cmp = compareSemver(newVersion, currentVersion)
  if (isNaN(cmp)) {
    errExit(`无法比较版本: ${currentVersion} vs ${newVersion}`)
  }
  if (cmp <= 0) {
    errExit(`新版本 "${newVersion}" 必须高于当前版本 "${currentVersion}" (递增规则)`)
  }

  ok(`版本递增: ${currentVersion} → ${newVersion}`)

  // 5. 检查 Unreleased 非空
  const changelogText = readFile(CHANGELOG)
  const unreleasedSection = getChangelogSection(changelogText, 'Unreleased')
  if (!unreleasedSection || !hasChangelogEntry(unreleasedSection)) {
    errExit('Unreleased 区段为空，无法升版；请先添加变更记录')
  }
  ok('Unreleased 区段非空')

  // 6. 归档 Unreleased → 新版本标题
  const today = new Date().toISOString().slice(0, 10)
  const versionHeading = `## ${newVersion} — ${today}`

  // Replace "## Unreleased" with "## Unreleased\n\n(empty)" as placeholder
  // Then insert the new version heading after the Unreleased section
  const newChangelog = changelogText.replace(
    /## Unreleased/,
    (match) => `${match}\n\n${versionHeading}`,
  )

  writeFile(CHANGELOG, newChangelog)
  ok(`CHANGELOG.md 归档 ${newVersion} (${today})`)

  // 7. 同步四个 manifest
  for (const mf of MANIFESTS) {
    const pkg = readJson(mf)
    pkg.version = newVersion
    writeFile(mf, JSON.stringify(pkg, null, 2) + '\n')
    ok(`${mf} → ${newVersion}`)
  }

  // 8. 刷新 lockfile
  console.log('\n⏳ 刷新 lockfile...')
  try {
    execSync('bun install', {
      cwd: ROOT,
      stdio: 'inherit',
      timeout: 120_000,
    })
    // bun 不会把 workspace 版本变更写回 lockfile，这里按 parseLockVersions
    // 的同款格式把三个 workspace 条目的版本对齐到新版本
    let lockRaw = readFile(LOCKFILE)
    for (const mf of MANIFESTS.slice(1)) {
      const wsKey = LOCK_WS_MAP[mf]
      if (!wsKey) continue
      const pkg = readJson(mf)
      const entryRe = new RegExp(
        `("${wsKey}":\\s*\\{\\s*"name":\\s*"[^"]+",\\s*"version":\\s*")[^"]+(")`,
      )
      const next = lockRaw.replace(entryRe, `$1${pkg.version}$2`)
      if (next === lockRaw) {
        errExit(`lockfile 中未找到 ${wsKey} 的 workspace 版本条目，无法对齐版本`)
      }
      lockRaw = next
    }
    writeFile(LOCKFILE, lockRaw)
    ok('lockfile 已刷新')
  } catch (e: any) {
    errExit(`bun install 失败: ${e.message}`, '请手动运行 bun install 并确认 lockfile 状态')
  }

  console.log('\n✅ 升版至 ' + newVersion + ' 准备完成\n')
  console.log('后续签名标签发布步骤（分阶段，勿在 dev 上同时推分支与标签）:')
  console.log('  1. 创建签名提交并推送当前版本分支:')
  console.log(`     git add -A`)
  console.log(`     git commit -S -m "chore(release)：准备 ${newVersion}"`)
  console.log(`     git push origin <当前版本分支>`)
  console.log('  2. 通过正常 PR/合并流程让该提交进入 main，等待其合入 origin/main')
  console.log('  3. 目标提交进入 main 后，本地同步并校验标签目标:')
  console.log(`     git checkout main && git pull --ff-only`)
  console.log('     bun run version:check -- --tag v' + newVersion)
  console.log('  4. 在 main 上的目标提交创建签名标签并单独推送:')
  console.log(`     git tag -s v${newVersion} -m "Pidex v${newVersion}"`)
  console.log(`     git push origin v${newVersion}\n`)
  console.log(
    '  推送 v* 标签后由 GitHub-hosted runner 校验 main 历史，并创建仅含 GitHub 自动源码归档的 Release。\n',
  )
}

/* ┌──────────────────────────────────┐
   │  CLI 入口                        │
   └──────────────────────────────────┘ */

function main() {
  const args = process.argv.slice(2)

  if (args.length === 0) {
    console.log('用法:')
    console.log('  version:check                          基本一致性检查')
    console.log('  version:check -- --base <git-sha>      PR 检查（Unreleased 有新增）')
    console.log('  version:check -- --tag <v版本>          标签检查')
    console.log('  version:prepare -- <SemVer> [--stable]  升版准备')
    process.exit(0)
  }

  const cmd = args[0]

  if (cmd === 'version:check') {
    const rest = args.slice(1)
    const opts: CheckOptions = {}
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--base' && i + 1 < rest.length) {
        opts.base = rest[++i]
      } else if (rest[i] === '--tag' && i + 1 < rest.length) {
        opts.tag = rest[++i]
      } else if (rest[i] === '--') {
        continue
      }
    }
    runCheck(opts)
    return
  }

  if (cmd === 'version:prepare') {
    const rest = args.slice(1)
    // Handle -- separator
    const filtered = rest.filter((a) => a !== '--')
    const newVersion = filtered[0]
    const stable = filtered.includes('--stable')
    if (!newVersion || newVersion.startsWith('-')) {
      errExit('用法: version:prepare -- <SemVer> [--stable]')
    }
    runPrepare(newVersion, stable)
    return
  }

  errExit(`未知命令: "${cmd}"。支持: version:check, version:prepare`)
}

if (import.meta.main) {
  main()
}
