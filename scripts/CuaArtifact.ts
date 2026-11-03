import { createHash } from 'node:crypto'
import { resolve } from 'node:path'

export const cuaRoot = resolve(import.meta.dir, '..')
export const cuaProject = 'apps/desktop/native/cpx-cua'

export function artifactDigest(data: Uint8Array): string {
  return `sha256:${createHash('sha256').update(data).digest('hex')}`
}

export async function cuaFingerprint(): Promise<string> {
  const child = Bun.spawn(
    ['git', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', cuaProject],
    { cwd: cuaRoot, stdout: 'pipe', stderr: 'inherit' },
  )
  const files = (await new Response(child.stdout).text()).split('\0').filter(Boolean).sort()
  if ((await child.exited) !== 0 || files.length === 0) throw new Error('无法读取 CUA 源码清单')
  // Git filters keep CRLF checkouts identical to Linux checkouts and release tags.
  const hashes = Bun.spawn(['git', 'hash-object', '--stdin-paths'], {
    cwd: cuaRoot,
    stdin: 'pipe',
    stdout: 'pipe',
    stderr: 'inherit',
  })
  hashes.stdin.end([...files, 'scripts/BuildCua.ts', 'scripts/CuaArtifact.ts'].join('\n') + '\n')
  const objects = await new Response(hashes.stdout).text()
  if ((await hashes.exited) !== 0) throw new Error('无法计算 CUA 源码指纹')
  return createHash('sha256').update(files.join('\0')).update(objects).digest('hex')
}

export async function downloadCua(tag: string): Promise<Uint8Array | undefined> {
  const response = await fetch(
    `https://api.github.com/repos/codepilotx-dev/Pidex/releases/tags/${tag}`,
    {
      signal: AbortSignal.timeout(30_000),
    },
  )
  if (response.status === 404) return undefined
  if (!response.ok) throw new Error(`读取 CUA Release 失败：HTTP ${response.status}`)
  const release = (await response.json()) as {
    assets: { name: string; digest: string | null; browser_download_url: string }[]
  }
  const asset = release.assets.find((item) => item.name === 'cpx-cua.exe')
  if (!asset || !/^sha256:[a-f0-9]{64}$/.test(asset.digest ?? '')) {
    throw new Error('CUA Release 缺少 EXE 或 SHA-256 摘要')
  }
  if (
    asset.browser_download_url !==
    `https://github.com/codepilotx-dev/Pidex/releases/download/${tag}/cpx-cua.exe`
  ) {
    throw new Error('CUA 产物下载地址不匹配')
  }
  const binary = await fetch(asset.browser_download_url, { signal: AbortSignal.timeout(120_000) })
  if (!binary.ok) throw new Error(`下载 CUA 失败：HTTP ${binary.status}`)
  const bytes = new Uint8Array(await binary.arrayBuffer())
  if (artifactDigest(bytes) !== asset.digest) throw new Error('CUA 产物 SHA-256 不匹配')
  return bytes
}

if (import.meta.main) console.log(`cua-${await cuaFingerprint()}`)
