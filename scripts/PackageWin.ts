import { resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { parseSemver } from './SemverUtils'

const root = resolve(import.meta.dir, '..')
if (process.argv.slice(2).join(' ') !== '--x64') {
  throw new Error('Windows 打包当前仅支持：bun scripts/PackageWin.ts --x64')
}

await run(['bun', 'run', 'build'])
const requireSigning = process.env.PIDEX_REQUIRE_SIGNING === '1'
if (requireSigning) await run(['bun', 'scripts/SignWinAgent.ts'])
const manifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  version?: unknown
}
if (typeof manifest.version !== 'string') {
  throw new Error('根 package.json 缺少字符串类型的 version')
}
const parsedVersion = parseSemver(manifest.version)
if (!parsedVersion) {
  throw new Error(`版本 "${manifest.version}" 不符合发布 SemVer 规则`)
}
const updateChannel = parsedVersion.prereleaseType ?? 'latest'
await run([
  'bun',
  'run',
  '--cwd',
  'apps/desktop/electron',
  'package:win',
  '--',
  `-c.publish.channel=${updateChannel}`,
])
await run([
  'bun',
  'scripts/VerifyWinX64Package.ts',
  ...(requireSigning ? ['--require-signing'] : []),
])
await run(['bun', 'scripts/SmokeWinX64.ts'])

async function run(command: readonly string[]): Promise<void> {
  const child = Bun.spawn([...command], {
    cwd: root,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) process.exit(exitCode)
}
