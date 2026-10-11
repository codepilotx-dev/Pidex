import { afterEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Effect } from 'effect'
import type {
  DecryptedCredential,
  ProviderCredentialSummary,
} from '../src/auth/ProviderCredentialRepository'
import {
  MiniMaxCliIntegrationService,
  type MiniMaxCliProcessRunner,
} from '../src/integration/minimax-cli/MiniMaxCliIntegrationService'
import { MiniMaxCliSettingsRepository } from '../src/storage/repositories/MinimaxCliSettingsRepository'
import { removeFixturePaths } from './FixtureCleanup'

const temporaryDirectories: string[] = []

afterEach(async () => removeFixturePaths(temporaryDirectories.splice(0)))

class MemorySettings {
  private readonly values = new Map<string, unknown>()

  getSetting<T>(key: string): T | null {
    return (this.values.get(key) as T | undefined) ?? null
  }

  setSetting(key: string, value: unknown) {
    this.values.set(key, value)
  }
}

type CredentialFixture = {
  providerID: 'minimax-cn-coding-plan' | 'minimax-coding-plan' | 'minimax-cn' | 'minimax'
  id: string
  label: string
  maskedValue: string
  key: string
}

class CredentialFixtures {
  constructor(private readonly fixtures: readonly CredentialFixture[]) {}

  listProviderCredentials(providerID?: string): ProviderCredentialSummary[] {
    return this.fixtures
      .filter((item) => !providerID || item.providerID === providerID)
      .map((item) => ({
        id: item.id,
        providerID: item.providerID,
        kind: 'api-key',
        methodID: null,
        label: item.label,
        maskedValue: item.maskedValue,
        enabled: true,
        active: true,
        order: 0,
        health: null,
        createdAt: 1,
        updatedAt: 1,
      }))
  }

  activeCredential<T = unknown>(providerID: string) {
    const item = this.fixtures.find((fixture) => fixture.providerID === providerID)
    const credential: DecryptedCredential<T> | null = item
      ? {
          id: item.id,
          integrationID: item.providerID,
          kind: 'api-key',
          methodID: null,
          label: item.label,
          value: { type: 'key', key: item.key } as unknown as T,
        }
      : null
    return Effect.succeed(credential)
  }
}

const createRunner = (input: { nodeVersion?: string; installed?: boolean } = {}) => {
  let installed = input.installed ?? false
  const requests: Array<{ executable: string; args: readonly string[] }> = []
  const runProcess: MiniMaxCliProcessRunner = async (request) => {
    requests.push({ executable: request.executable, args: request.args })
    const command = request.args.join(' ')
    if (request.executable === 'where.exe' && command === 'node.exe') {
      return { exitCode: 0, stdout: 'C:\\node\\node.exe', stderr: '' }
    }
    if (request.executable === 'where.exe' && command === 'npm.cmd') {
      return { exitCode: 0, stdout: 'C:\\node\\npm.cmd', stderr: '' }
    }
    if (request.executable.endsWith('node.exe') && command === '--version') {
      return { exitCode: 0, stdout: input.nodeVersion ?? 'v22.0.0', stderr: '' }
    }
    if (request.executable.endsWith('npm.cmd') && command === '--version') {
      return { exitCode: 0, stdout: '10.0.0', stderr: '' }
    }
    if (command === 'list -g mmx-cli --depth=0 --json') {
      return {
        exitCode: installed ? 0 : 1,
        stdout: JSON.stringify(
          installed ? { dependencies: { 'mmx-cli': { version: '1.2.3' } } } : {},
        ),
        stderr: '',
      }
    }
    if (command === 'view mmx-cli version --json') {
      return { exitCode: 0, stdout: JSON.stringify('1.2.3'), stderr: '' }
    }
    if (command === 'prefix -g') return { exitCode: 0, stdout: 'C:\\npm', stderr: '' }
    if (request.executable.endsWith('mmx.cmd') && command === '--version') {
      return { exitCode: installed ? 0 : 1, stdout: installed ? '1.2.3' : '', stderr: '' }
    }
    if (command === 'install -g mmx-cli@latest') {
      installed = true
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    if (command === 'uninstall -g mmx-cli') {
      installed = false
      return { exitCode: 0, stdout: '', stderr: '' }
    }
    if (command === 'quota show --output json --quiet --non-interactive') {
      return { exitCode: 0, stdout: '{}', stderr: '' }
    }
    return { exitCode: 1, stdout: '', stderr: 'unexpected fixture command' }
  }
  return { runProcess, requests }
}

const createService = async (
  input: {
    credentials?: readonly CredentialFixture[]
    nodeVersion?: string
    installed?: boolean
  } = {},
) => {
  const root = await mkdtemp(join(tmpdir(), 'pidex-minimax-cli-'))
  temporaryDirectories.push(root)
  const runner = createRunner(input)
  const service = new MiniMaxCliIntegrationService(
    new MiniMaxCliSettingsRepository(new MemorySettings()),
    new CredentialFixtures(input.credentials ?? []),
    {
      userHome: root,
      integrationRoot: join(root, 'integration'),
      env: { MMX_CONFIG_DIR: join(root, '.mmx') },
      platform: 'win32',
      runProcess: runner.runProcess,
    },
  )
  return { root, service, requests: runner.requests }
}

describe('MiniMaxCliIntegrationService', () => {
  test('使用固定 npm 命令安装和卸载，并同步 CN Coding Plan active Key', async () => {
    const secret = 'test-coding-plan-key'
    const { root, service, requests } = await createService({
      credentials: [
        {
          providerID: 'minimax-cn-coding-plan',
          id: 'credential:cn',
          label: 'MiniMax CN Coding Plan',
          maskedValue: 'sk-****plan',
          key: secret,
        },
      ],
    })
    await mkdir(join(root, '.mmx'), { recursive: true })
    await writeFile(
      join(root, '.mmx', 'config.json'),
      JSON.stringify({ oauth: { token: 'old' }, keep: true }),
      { encoding: 'utf8', flag: 'wx' },
    )

    const installed = await service.install({ operationId: 'operation:install' })
    expect(installed.installationStatus).toBe('installed')
    expect(installed.authStatus).toBe('coding-plan-synced')
    expect(installed.credentialSource).toMatchObject({
      providerId: 'minimax-cn-coding-plan',
      region: 'cn',
    })
    const config = JSON.parse(await readFile(join(root, '.mmx', 'config.json'), 'utf8'))
    expect(config).toEqual({ keep: true, api_key: secret, region: 'cn' })
    expect(requests.some((request) => request.args.join(' ') === 'install -g mmx-cli@latest')).toBe(
      true,
    )
    expect(requests.flatMap((request) => request.args).join(' ')).not.toContain(secret)
    expect(await service.enabledSkillRoots()).toHaveLength(1)

    const uninstalled = await service.uninstall({ operationId: 'operation:uninstall' })
    expect(uninstalled.installationStatus).toBe('not-installed')
    expect(requests.some((request) => request.args.join(' ') === 'uninstall -g mmx-cli')).toBe(true)
    expect(await service.enabledSkillRoots()).toEqual([])
    await expect(readFile(join(root, '.mmx', 'config.json'), 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    })
  })

  test('CN 缺失时回退 Global，且普通 MiniMax Provider 不参与同步', async () => {
    const { root, service } = await createService({
      installed: true,
      credentials: [
        {
          providerID: 'minimax-coding-plan',
          id: 'credential:global',
          label: 'MiniMax Global Coding Plan',
          maskedValue: 'sk-****global',
          key: 'global-plan-key',
        },
        {
          providerID: 'minimax-cn',
          id: 'credential:ordinary',
          label: '普通 MiniMax Key',
          maskedValue: 'sk-****ordinary',
          key: 'ordinary-key-must-not-sync',
        },
      ],
    })

    const status = await service.status({ forceReload: true })
    expect(status.credentialSource).toMatchObject({
      providerId: 'minimax-coding-plan',
      region: 'global',
    })
    const config = JSON.parse(await readFile(join(root, '.mmx', 'config.json'), 'utf8'))
    expect(config).toMatchObject({ api_key: 'global-plan-key', region: 'global' })
    expect(JSON.stringify(config)).not.toContain('ordinary-key-must-not-sync')
  })

  test('Node.js 18 以下拒绝安装', async () => {
    const { service, requests } = await createService({ nodeVersion: 'v16.20.0' })
    await expect(service.install({ operationId: 'operation:old-node' })).rejects.toMatchObject({
      code: 'MINIMAX_CLI_PREREQUISITE_MISSING',
    })
    expect(requests.some((request) => request.args[0] === 'install')).toBe(false)
  })
})
