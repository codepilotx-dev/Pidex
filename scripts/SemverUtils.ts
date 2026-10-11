/**
 * SemverUtils.ts — SemVer 解析与比较工具
 * 从 VersionPolicy.ts 中提取，便于测试。
 */

export const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(-(alpha|beta|rc)\.(0|[1-9]\d*))?$/

export interface SemVerParts {
  major: number
  minor: number
  patch: number
  prereleaseType?: 'alpha' | 'beta' | 'rc'
  prereleaseNum?: number
}

export function parseSemver(v: string): SemVerParts | null {
  const m = v.match(SEMVER_RE)
  if (!m) return null
  return {
    major: parseInt(m[1], 10),
    minor: parseInt(m[2], 10),
    patch: parseInt(m[3], 10),
    prereleaseType: (m[5] as any) ?? undefined,
    prereleaseNum: m[6] !== undefined ? parseInt(m[6], 10) : undefined,
  }
}

const PRERELEASE_ORDER: Record<string, number> = { alpha: 0, beta: 1, rc: 2 }

/** 严格比较 SemVer。返回 1 表示 a > b，-1 表示 a < b，0 相等。 */
export function compareSemver(a: string, b: string): number {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (!pa || !pb) return NaN as any

  if (pa.major !== pb.major) return pa.major > pb.major ? 1 : -1
  if (pa.minor !== pb.minor) return pa.minor > pb.minor ? 1 : -1
  if (pa.patch !== pb.patch) return pa.patch > pb.patch ? 1 : -1

  // Release > prerelease
  if (!pa.prereleaseType && pb.prereleaseType) return 1
  if (pa.prereleaseType && !pb.prereleaseType) return -1
  if (!pa.prereleaseType && !pb.prereleaseType) return 0

  // Both have prerelease
  const oA = PRERELEASE_ORDER[pa.prereleaseType!] ?? -1
  const oB = PRERELEASE_ORDER[pb.prereleaseType!] ?? -1
  if (oA !== oB) return oA > oB ? 1 : -1
  const pnA = pa.prereleaseNum ?? 0
  const pnB = pb.prereleaseNum ?? 0
  if (pnA !== pnB) return pnA > pnB ? 1 : -1
  return 0
}
