import { existsSync } from 'node:fs'
import { delimiter, join, resolve } from 'node:path'

export interface SidecarCommand {
  readonly executable: string
  readonly args: string[]
  readonly cwd: string
}

export class SidecarInstallationError extends Error {
  readonly code = 'SIDECAR_INSTALLATION_INCOMPLETE'

  constructor(readonly executable: string) {
    super('安装不完整，请重新安装 Pidex')
    this.name = 'SidecarInstallationError'
  }
}

export function missingPackagedSidecarError(
  error: unknown,
  executable: string,
): SidecarInstallationError | undefined {
  if (typeof error !== 'object' || error === null) return undefined
  const code = 'code' in error ? String(error.code) : ''
  return code === 'ENOENT' ? new SidecarInstallationError(executable) : undefined
}

function envValue(env: NodeJS.ProcessEnv, name: string): string | undefined {
  const entry = Object.entries(env).find(([key]) => key.toLowerCase() === name.toLowerCase())
  return entry?.[1]
}

function firstExisting(candidates: readonly string[]): string | undefined {
  return candidates.find((candidate) => candidate.length > 0 && existsSync(candidate))
}

export function resolveBunExecutable(
  env: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
): string {
  const explicit = env.PIDEX_BUN_PATH?.trim()
  if (explicit) return explicit

  const bunInstall = env.BUN_INSTALL?.trim()
  if (bunInstall) {
    const installed = firstExisting([
      join(bunInstall, 'bin', platform === 'win32' ? 'bun.exe' : 'bun'),
      join(bunInstall, platform === 'win32' ? 'bun.exe' : 'bun'),
    ])
    if (installed) return installed
  }

  const pathEntries = (envValue(env, 'PATH') ?? '')
    .split(delimiter)
    .map((entry) => entry.trim().replace(/^"|"$/g, ''))
    .filter(Boolean)

  const candidates = pathEntries.flatMap((entry) =>
    platform === 'win32'
      ? [join(entry, 'bun.exe'), join(entry, 'node_modules', 'bun', 'bin', 'bun.exe')]
      : [join(entry, 'bun')],
  )
  const executable = firstExisting(candidates)
  if (executable) return executable

  throw new Error(
    '未找到 Bun 可执行文件。请先运行 bun run dev:agent，再运行 bun run dev:desktop，或设置 PIDEX_BUN_PATH。',
  )
}

export function resolveSidecarCommand(input: {
  readonly packaged: boolean
  readonly resourcesPath: string
  readonly moduleDirectory: string
  readonly env?: NodeJS.ProcessEnv
}): SidecarCommand {
  const env = input.env ?? process.env
  if (input.packaged) {
    const executable = join(input.resourcesPath, 'agent', 'pidex-agent.exe')
    if (!existsSync(executable)) throw new SidecarInstallationError(executable)
    return { executable, args: [], cwd: input.resourcesPath }
  }

  return {
    executable: resolveBunExecutable(env),
    args: ['run', env.PIDEX_AGENT_ENTRY ?? 'apps/agent/src/index.ts'],
    cwd: resolve(input.moduleDirectory, '../../../../'),
  }
}
