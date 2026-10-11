import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { DesktopTerminalProfile } from '@pidex/shared/desktop-terminal-ipc'
import { TerminalError } from './TerminalErrors.js'

export interface ResolvedShellProfile extends DesktopTerminalProfile {
  executable: string
  args: readonly string[]
}

interface ShellProfileServiceOptions {
  platform?: NodeJS.Platform
  environment?: NodeJS.ProcessEnv
  fileExists?: (path: string) => boolean
}

export class ShellProfileService {
  readonly #profiles: readonly ResolvedShellProfile[]

  constructor(options: ShellProfileServiceOptions = {}) {
    const platform = options.platform ?? process.platform
    const environment = options.environment ?? process.env
    const fileExists = options.fileExists ?? existsSync
    this.#profiles = detectProfiles(platform, environment, fileExists)
  }

  list(): readonly DesktopTerminalProfile[] {
    return this.#profiles.map(({ executable: _executable, args: _args, ...profile }) => profile)
  }

  resolve(profileId: string | null): ResolvedShellProfile {
    const profile = profileId
      ? this.#profiles.find((candidate) => candidate.id === profileId)
      : this.#profiles.find((candidate) => candidate.isDefault)
    if (!profile?.available) {
      throw new TerminalError('TERMINAL_PROFILE_UNAVAILABLE', '所选 Shell 当前不可用')
    }
    return profile
  }
}

function detectProfiles(
  platform: NodeJS.Platform,
  environment: NodeJS.ProcessEnv,
  fileExists: (path: string) => boolean,
): readonly ResolvedShellProfile[] {
  if (platform === 'win32') {
    const systemRoot = environment.SystemRoot ?? 'C:\\Windows'
    const candidates = [
      profile(
        'pwsh',
        'PowerShell 7',
        findOnPath('pwsh.exe', environment, fileExists, platform),
        [],
      ),
      profile(
        'windows-powershell',
        'Windows PowerShell',
        join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe'),
        [],
      ),
      profile(
        'cmd',
        'Command Prompt',
        environment.ComSpec ?? join(systemRoot, 'System32', 'cmd.exe'),
        [],
      ),
      profile('git-bash', 'Git Bash', findGitBash(environment, fileExists, platform), [
        '--login',
        '-i',
      ]),
    ]
    return markDefault(candidates, fileExists)
  }
  const shell = environment.SHELL?.trim()
  const candidates =
    platform === 'darwin'
      ? [
          profile('user-shell', 'Default Shell', shell, ['-l']),
          profile('zsh', 'zsh', '/bin/zsh', ['-l']),
          profile('bash', 'bash', '/bin/bash', ['-l']),
        ]
      : [
          profile('user-shell', 'Default Shell', shell, ['-l']),
          profile('bash', 'bash', '/bin/bash', ['-l']),
          profile('sh', 'sh', '/bin/sh', ['-l']),
        ]
  return markDefault(candidates, fileExists)
}

function profile(
  id: string,
  label: string,
  executable: string | undefined,
  args: readonly string[],
): ResolvedShellProfile {
  return {
    id,
    label,
    executable: executable ?? '',
    args,
    available: false,
    isDefault: false,
    unavailableReason: '未找到可执行文件',
  }
}

function markDefault(
  candidates: readonly ResolvedShellProfile[],
  fileExists: (path: string) => boolean,
): readonly ResolvedShellProfile[] {
  let defaultAssigned = false
  return candidates.map((candidate) => {
    const available = candidate.executable.length > 0 && fileExists(candidate.executable)
    const isDefault = available && !defaultAssigned
    if (isDefault) defaultAssigned = true
    return {
      ...candidate,
      available,
      isDefault,
      unavailableReason: available ? undefined : candidate.unavailableReason,
    }
  })
}

function findOnPath(
  executable: string,
  environment: NodeJS.ProcessEnv,
  fileExists: (path: string) => boolean,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const pathValue = environment.Path ?? environment.PATH ?? ''
  for (const directory of pathValue.split(platform === 'win32' ? ';' : ':')) {
    if (!directory) continue
    const candidate = join(directory, executable)
    if (fileExists(candidate)) return candidate
  }
  return undefined
}

function findGitBash(
  environment: NodeJS.ProcessEnv,
  fileExists: (path: string) => boolean,
  platform: NodeJS.Platform = process.platform,
): string | undefined {
  const fromPath = findOnPath('bash.exe', environment, fileExists, platform)
  if (fromPath) return fromPath
  for (const root of [environment.ProgramFiles, environment['ProgramFiles(x86)']]) {
    if (!root) continue
    const candidate = join(root, 'Git', 'bin', 'bash.exe')
    if (fileExists(candidate)) return candidate
  }
  return undefined
}
