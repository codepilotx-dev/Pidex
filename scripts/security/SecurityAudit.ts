import { resolve } from 'node:path'
import { isRecord } from '@pidex/shared/guards'
import { errorMessageOf as errorMessage } from '@pidex/shared/errors'

interface AuditAdvisory {
  id?: number | string
  url?: string
  title?: string
  severity?: string
}

interface AuditException {
  reason?: string
  owner?: string
  expires?: string
}

interface AuditAllowlist {
  schemaVersion?: number
  exceptions?: Record<string, AuditException>
}

const repositoryRoot = resolve(import.meta.dirname, '../..')
const allowlistPath = resolve(import.meta.dirname, 'audit-allowlist.json')
const allowlist = await readAllowlist()
const today = new Date().toISOString().slice(0, 10)
const metadataErrors = validateAllowlist(allowlist, today)

if (metadataErrors.length > 0) {
  for (const error of metadataErrors) {
    console.error(`[security:audit] ${error}`)
  }
  process.exit(1)
}

const child = Bun.spawn([process.execPath, 'audit', '--json', '--audit-level=high'], {
  cwd: repositoryRoot,
  stdout: 'pipe',
  stderr: 'pipe',
})
const [stdout, stderr, exitCode] = await Promise.all([
  new Response(child.stdout).text(),
  new Response(child.stderr).text(),
  child.exited,
])

if (exitCode !== 0 && exitCode !== 1) {
  console.error(`[security:audit] bun audit 执行失败（退出码 ${exitCode}）${formatStderr(stderr)}`)
  process.exit(1)
}

let report: Record<string, AuditAdvisory[]>
try {
  report = JSON.parse(stdout) as Record<string, AuditAdvisory[]>
} catch {
  console.error(`[security:audit] 无法解析 bun audit JSON 输出${formatStderr(stderr)}`)
  process.exit(1)
}

const exceptions = allowlist.exceptions ?? {}
const observedExceptionIds = new Set<string>()
const blockers: Array<{ packageName: string; advisory: AuditAdvisory; id: string }> = []
let highOrCriticalCount = 0

for (const [packageName, advisories] of Object.entries(report)) {
  if (!Array.isArray(advisories)) {
    console.error(`[security:audit] ${packageName} 的 advisory 列表格式无效`)
    process.exit(1)
  }

  for (const advisory of advisories) {
    const severity = advisory.severity?.toLowerCase()
    if (severity !== 'high' && severity !== 'critical') continue

    highOrCriticalCount += 1
    const id = advisoryIdentifier(advisory)
    if (Object.hasOwn(exceptions, id)) {
      observedExceptionIds.add(id)
      const exception = exceptions[id]
      console.warn(
        `[security:audit] 豁免 ${id} (${packageName}, ${severity})，` +
          `owner=${exception.owner}，expires=${exception.expires}：${exception.reason}`,
      )
      continue
    }

    blockers.push({ packageName, advisory, id })
  }
}

for (const id of Object.keys(exceptions)) {
  if (!observedExceptionIds.has(id)) {
    console.warn(`[security:audit] 豁免 ${id} 未命中当前审计结果，请确认是否可以移除`)
  }
}

if (blockers.length > 0) {
  console.error(`[security:audit] 发现 ${blockers.length} 个未豁免的 High/Critical 漏洞：`)
  for (const { packageName, advisory, id } of blockers) {
    console.error(
      `  - ${id} [${advisory.severity}] ${packageName}: ` +
        `${advisory.title ?? '无标题'}${advisory.url ? ` (${advisory.url})` : ''}`,
    )
  }
  process.exit(1)
}

console.log(
  `[security:audit] 通过：${highOrCriticalCount} 个 High/Critical advisory，` +
    `${observedExceptionIds.size} 个有效豁免，0 个未豁免`,
)

async function readAllowlist(): Promise<AuditAllowlist> {
  try {
    return (await Bun.file(allowlistPath).json()) as AuditAllowlist
  } catch (cause) {
    console.error(`[security:audit] 无法读取审计豁免配置：${errorMessage(cause)}`)
    process.exit(1)
  }
}

function validateAllowlist(value: AuditAllowlist, currentDate: string): string[] {
  const errors: string[] = []
  if (value.schemaVersion !== 1) {
    errors.push('audit-allowlist.json 的 schemaVersion 必须为 1')
  }
  const exceptions = value.exceptions ?? {}
  if (!isRecord(exceptions)) {
    errors.push('audit-allowlist.json 的 exceptions 必须为对象')
    return errors
  }

  for (const [rawId, exception] of Object.entries(exceptions)) {
    if (!/^GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}$/.test(rawId)) {
      errors.push(`豁免 ID "${rawId}" 必须是规范 GHSA 标识`)
    }
    if (!isRecord(exception)) {
      errors.push(`豁免 ${rawId} 必须为对象`)
      continue
    }
    if (typeof exception.reason !== 'string' || exception.reason.trim() === '') {
      errors.push(`豁免 ${rawId} 缺少 reason`)
    }
    if (typeof exception.owner !== 'string' || exception.owner.trim() === '') {
      errors.push(`豁免 ${rawId} 缺少 owner`)
    }
    if (typeof exception.expires !== 'string' || !isCalendarDate(exception.expires)) {
      errors.push(`豁免 ${rawId} 的 expires 必须是有效 YYYY-MM-DD 日期`)
    } else if (currentDate > exception.expires) {
      errors.push(`豁免 ${rawId} 已于 ${exception.expires} 过期（当前日期 ${currentDate}）`)
    }
  }

  return errors
}

function advisoryIdentifier(advisory: AuditAdvisory): string {
  const ghsa = advisory.url?.match(/GHSA-[0-9A-Z]{4}-[0-9A-Z]{4}-[0-9A-Z]{4}/i)
  if (!ghsa) return String(advisory.id ?? 'UNKNOWN')
  return `GHSA-${ghsa[0].slice(5).toLowerCase()}`
}

function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}

function formatStderr(stderr: string): string {
  const trimmed = stderr.trim()
  return trimmed ? `：${trimmed}` : ''
}
