/**
 * AgentRuntimeVerifier.ts — 打包 Agent 运行时验证门面。
 *
 * 供本地 package verifier、普通 PR 的合成签名 `release-parity` 与人工标签签名包
 * 复用；不实现第二套 PE 修改逻辑。
 *
 * CLI：
 *   bun scripts/AgentRuntimeVerifier.ts --agent <path> [--require-authenticode]
 */

import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { existsSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { spawn, type ChildProcess } from 'node:child_process'
import { assertWindowsX64PE } from './WindowsPe'

export const AGENT_RUNTIME_VERIFIER_SCHEMA_VERSION = 1 as const

export interface PackagedAgentRuntimeResultV1 {
  schemaVersion: typeof AGENT_RUNTIME_VERIFIER_SCHEMA_VERSION
  readyMs: number
  apiReadyMs: number
  providerCount: number
  modelCount: number
  processTreeCleaned: true
}

export interface VerifyPackagedAgentRuntimeOptions {
  agentPath: string
  /** 验证 Agent PE 的 Authenticode 状态必须为 Valid。 */
  requireAuthenticode?: boolean
  /** 合成签名场景的自定义信任锚 thumbprint（见 assertAuthenticodeValid）。 */
  authenticodeTrustAnchorThumbprint?: string
  /** ready 等待超时，默认 60 秒。 */
  readyTimeoutMs?: number
  /** 追加到 Agent 可执行文件之后的参数（测试用假 Agent）。 */
  agentArgs?: readonly string[]
  extraEnv?: Record<string, string | undefined>
}

const VERIFIER_CAPABILITIES = [
  'rpc.typed.v1',
  'model.catalog.paged.v1',
  'provider.config.pi.v1',
] as const

/** 去除错误信息中的本机路径，避免泄露敏感绝对路径。 */
export function sanitizeVerifierError(message: string): string {
  return message
    .replace(/[A-Za-z]:\\[^\r\n]+/g, '[LOCAL_PATH]')
    .replace(/\\\\[^\\\r\n]+\\[^\r\n]+/g, '[UNC_PATH]')
    .slice(0, 1_000)
}

async function sha256(path: string): Promise<string> {
  const hash = createHash('sha256')
  await new Promise<void>((resolveHash, rejectHash) => {
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', rejectHash)
    stream.once('end', resolveHash)
  })
  return hash.digest('hex')
}

export interface AuthenticodeVerificationOptions {
  /**
   * 用自定义信任锚验证签名链（PR 合成签名场景）：
   * 从 CurrentUser\My 按 thumbprint 取锚证书，允许未知根构建链后
   * 固定链根必须等于锚证书，避免向用户根存储添加自签证书触发
   * Windows 极慢的根验证/自动更新。
   */
  trustAnchorThumbprint?: string
}

export async function assertAuthenticodeValid(
  paths: readonly string[],
  options: AuthenticodeVerificationOptions = {},
): Promise<void> {
  const powershell = join(
    process.env.SystemRoot ?? 'C:\\Windows',
    'System32/WindowsPowerShell/v1.0/powershell.exe',
  )
  const anchor = options.trustAnchorThumbprint
  // 信任锚验证在 Windows PowerShell 5.1 上完成：.NET Framework 没有
  // CustomRootTrust，改用 ExtraStore + AllowUnknownCertificateAuthority
  // 构建链后固定链根 thumbprint 必须等于锚证书，效果等价且全环境可用
  // （pwsh 在本地开发机可能只是 WindowsApps 别名，Bun 无法直接启动）。
  const command = anchor
    ? "$ErrorActionPreference='Stop'; $paths=ConvertFrom-Json $env:PIDEX_SIGNATURE_PATHS; $anchorThumbprint=$env:PIDEX_TRUST_ANCHOR_THUMBPRINT; foreach($path in $paths){ $signature=Get-AuthenticodeSignature -LiteralPath $path; Write-Output \"$path`t$($signature.Status)\"; if($signature.Status -ne 'Valid' -and $signature.Status -ne 'UnknownError'){ exit 12 }; $chain=New-Object System.Security.Cryptography.X509Certificates.X509Chain; $chain.ChainPolicy.RevocationMode='NoCheck'; $chain.ChainPolicy.VerificationFlags=[System.Security.Cryptography.X509Certificates.X509VerificationFlags]::AllowUnknownCertificateAuthority; $anchorCert=Get-ChildItem \"Cert:\\CurrentUser\\My\\$anchorThumbprint\"; $chain.ChainPolicy.ExtraStore.Add($anchorCert); if(-not $chain.Build($signature.SignerCertificate)){ exit 13 }; $root=$chain.ChainElements[$chain.ChainElements.Count-1].Certificate; if(-not ($root.Thumbprint -eq $anchorThumbprint)){ exit 13 } }"
    : "$ErrorActionPreference='Stop'; $paths=ConvertFrom-Json $env:PIDEX_SIGNATURE_PATHS; foreach($path in $paths){ $status=(Get-AuthenticodeSignature -LiteralPath $path).Status; Write-Output \"$path`t$status\"; if($status -ne 'Valid'){ exit 12 } }"
  const environment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'),
  )
  const child = Bun.spawn([powershell, '-NoProfile', '-NonInteractive', '-Command', command], {
    cwd: process.cwd(),
    env: {
      ...environment,
      PIDEX_SIGNATURE_PATHS: JSON.stringify(paths),
      ...(anchor ? { PIDEX_TRUST_ANCHOR_THUMBPRINT: anchor } : {}),
    },
    stdout: 'inherit',
    stderr: 'inherit',
  })
  const exitCode = await child.exited
  if (exitCode !== 0) {
    throw new Error('Windows Authenticode 验证失败')
  }
}

export async function verifyPackagedAgentRuntime(
  options: VerifyPackagedAgentRuntimeOptions,
): Promise<PackagedAgentRuntimeResultV1> {
  const {
    agentPath,
    requireAuthenticode = false,
    authenticodeTrustAnchorThumbprint,
    readyTimeoutMs = 60_000,
    agentArgs = [],
  } = options
  // 统一为绝对路径：spawn 的 cwd 是隔离临时目录，相对路径解析不可靠，
  // Windows 上相对路径启动可能拿不到子进程 pid，导致清理时无法终止进程树。
  const absoluteAgentPath = resolve(agentPath)
  if (!existsSync(absoluteAgentPath)) {
    throw new Error(`打包 Agent 不存在：${sanitizeVerifierError(absoluteAgentPath)}`)
  }
  await assertWindowsX64PE(absoluteAgentPath)
  if (requireAuthenticode) {
    await assertAuthenticodeValid(
      [absoluteAgentPath],
      authenticodeTrustAnchorThumbprint
        ? { trustAnchorThumbprint: authenticodeTrustAnchorThumbprint }
        : {},
    )
  }

  const isolatedRoot = await mkdtemp(join(tmpdir(), 'pidex-agent-runtime-'))
  const token = crypto.randomUUID()
  const startedAt = Date.now()
  const child = spawn(absoluteAgentPath, [...agentArgs], {
    cwd: isolatedRoot,
    env: {
      ...process.env,
      PIDEX_AUTH_TOKEN: token,
      PIDEX_DATA_DIR: join(isolatedRoot, 'data'),
      PIDEX_LOG_DIR: join(isolatedRoot, 'logs'),
      PIDEX_DESKTOP_MANAGED: '1',
      PIDEX_PORT: '0',
      NO_PROXY: '127.0.0.1,localhost,::1',
      no_proxy: '127.0.0.1,localhost,::1',
      ...options.extraEnv,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  let stderr = ''
  child.stderr?.on('data', (chunk) => {
    if (stderr.length < 16_384) stderr += String(chunk)
  })
  try {
    const origin = await waitForPackagedAgent(child, readyTimeoutMs)
    const readyMs = Date.now() - startedAt
    const apiReadyAt = Date.now()
    const response = await fetch(`${origin}/api/ready`, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(2_000),
    })
    if (!response.ok || ((await response.json()) as { ok?: boolean }).ok !== true) {
      throw new Error('打包 Agent /api/ready 失败')
    }
    const apiReadyMs = Date.now() - apiReadyAt
    const { providerCount, modelCount } = await assertPackagedRpcCatalogs(origin, token)
    return {
      schemaVersion: AGENT_RUNTIME_VERIFIER_SCHEMA_VERSION,
      readyMs,
      apiReadyMs,
      providerCount,
      modelCount,
      processTreeCleaned: true,
    }
  } catch (cause) {
    const original = cause instanceof Error ? cause.message : String(cause)
    const detail = stderr.trim()
    throw new Error(
      `打包 Agent 运行时验证失败：${sanitizeVerifierError(original)}${detail ? `（${sanitizeVerifierError(detail)}）` : ''}`,
      { cause },
    )
  } finally {
    await stopAgentProcessTree(child)
    await removeIsolatedRoot(isolatedRoot)
  }
}

async function assertPackagedRpcCatalogs(
  origin: string,
  token: string,
): Promise<{ providerCount: number; modelCount: number }> {
  let sequence = 0
  let connectionId = ''
  const call = async (method: string, params: Record<string, unknown>) => {
    const response = await fetch(`${origin}/rpc`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        ...(connectionId ? { 'x-pidex-connection-id': connectionId } : {}),
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: `agent-runtime-verifier:${++sequence}`,
        method,
        params,
      }),
    })
    const payload = (await response.json()) as {
      result?: Record<string, unknown>
      error?: unknown
    }
    if (!response.ok || payload.error) {
      throw new Error(`${method} 失败：${JSON.stringify(payload.error)}`)
    }
    return payload.result ?? {}
  }
  const initialized = await call('initialize', {
    clientInfo: {
      name: 'windows-agent-runtime-verifier',
      version: '1.0.0',
      platform: 'win32',
    },
    protocols: ['thread-rpc-v4'],
    capabilities: [...VERIFIER_CAPABILITIES],
    interactionDelivery: 'active',
  })
  if (typeof initialized.connectionId !== 'string') {
    throw new Error('打包 Agent 未返回 connectionId')
  }
  connectionId = initialized.connectionId
  await fetch(`${origin}/rpc`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'x-pidex-connection-id': connectionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'initialized',
      params: { protocol: 'thread-rpc-v4' },
    }),
  })
  const providerResult = await call('provider/list', {})
  const providers = Array.isArray(providerResult.providers)
    ? (providerResult.providers as Array<Record<string, unknown>>)
    : []
  if (
    providers.length === 0 ||
    providers.some((provider) => {
      const source = provider.source
      return (
        !source || typeof source !== 'object' || (source as Record<string, unknown>).type !== 'pi'
      )
    })
  ) {
    throw new Error('打包 Agent 未能从 Pi 加载 Provider 目录')
  }
  const modelResult = await call('model/list', {})
  const modelGroups = Array.isArray(modelResult.providers)
    ? (modelResult.providers as Array<Record<string, unknown>>)
    : []
  const models = modelGroups.flatMap((group) =>
    Array.isArray(group.models) ? (group.models as Array<Record<string, unknown>>) : [],
  )
  if (
    models.length === 0 ||
    models.some((model) => {
      const api = model.api
      return !api || typeof api !== 'object' || (api as Record<string, unknown>).type !== 'pi'
    })
  ) {
    throw new Error('打包 Agent 未能从 Pi 加载模型目录')
  }
  return { providerCount: providers.length, modelCount: models.length }
}

async function waitForPackagedAgent(child: ChildProcess, readyTimeoutMs: number): Promise<string> {
  if (!child.stdout) throw new Error('无法读取打包 Agent 启动输出')
  const lines = createInterface({ input: child.stdout })
  return new Promise<string>((resolveReady, rejectReady) => {
    let settled = false
    const timeout = setTimeout(
      () => finish(new Error(`打包 Agent 在 ${Math.round(readyTimeoutMs / 1_000)} 秒内未就绪`)),
      readyTimeoutMs,
    )
    const finish = (result: string | Error) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      lines.close()
      if (result instanceof Error) rejectReady(result)
      else resolveReady(result)
    }
    lines.on('line', (line) => {
      let message: { type?: string; url?: string } | undefined
      try {
        message = JSON.parse(line) as typeof message
      } catch {
        return
      }
      if (message?.type === 'ready' && typeof message.url === 'string') {
        finish(message.url)
      }
    })
    child.once('error', (cause) => {
      finish(new Error(`打包 Agent 启动失败：${String(cause)}`))
    })
    child.once('exit', (code) => {
      finish(new Error(`打包 Agent 提前退出 (${code ?? 'signal'})`))
    })
  })
}

async function stopAgentProcessTree(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null) return
  try {
    child.kill()
  } catch {
    // 进程已退出时 kill 可能抛出，由 taskkill 返回码确认。
  }
  if (process.platform === 'win32' && child.pid) {
    const cleanup = Bun.spawn(['taskkill.exe', '/PID', String(child.pid), '/T', '/F'], {
      stdout: 'ignore',
      stderr: 'ignore',
      windowsHide: true,
    })
    const taskkillCode = await cleanup.exited.catch(() => -1)
    // 0=已终止；128=进程已不存在。Windows 上 kill 后 exit 事件可能不触发，
    // 以 taskkill 返回码为准；其余返回码无法确认进程树终止，严格失败。
    if (taskkillCode !== 0 && taskkillCode !== 128) {
      throw new Error(`打包 Agent 进程树清理失败（taskkill=${taskkillCode}）`)
    }
    return
  }
  const exited = await waitForChildExit(child, 5_000)
  if (!exited) {
    throw new Error('打包 Agent 进程树未能退出')
  }
}

function waitForChildExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null) return Promise.resolve(true)
  return new Promise<boolean>((resolveExit) => {
    const timeout = setTimeout(() => resolveExit(false), timeoutMs)
    child.once('exit', () => {
      clearTimeout(timeout)
      resolveExit(true)
    })
    child.once('error', () => {
      clearTimeout(timeout)
      resolveExit(true)
    })
  })
}

async function removeIsolatedRoot(isolatedRoot: string): Promise<void> {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      await rm(isolatedRoot, { recursive: true, force: true })
      return
    } catch (cause) {
      if (
        !(cause instanceof Error) ||
        !('code' in cause) ||
        !['EBUSY', 'EPERM', 'ENOTEMPTY'].includes(String(cause.code)) ||
        attempt === 79
      ) {
        throw cause
      }
      await Bun.sleep(100)
    }
  }
}

/** 解析 `--name=value` 或 `--name value` 两种 CLI 参数形式。 */
export function readCliArgument(args: readonly string[], name: string): string | undefined {
  const inline = args.find((argument) => argument.startsWith(`${name}=`))
  if (inline) return inline.slice(name.length + 1)
  const index = args.indexOf(name)
  const value = index >= 0 ? args[index + 1] : undefined
  return value !== undefined && !value.startsWith('--') ? value : undefined
}

if (import.meta.main) {
  const args = process.argv.slice(2)
  const agentPath = readCliArgument(args, '--agent') ?? ''
  const requireAuthenticode = args.includes('--require-authenticode')
  const authenticodeTrustAnchorThumbprint = readCliArgument(args, '--authenticode-trust-anchor')
  if (!agentPath) {
    throw new Error(
      '用法：bun scripts/AgentRuntimeVerifier.ts --agent <path> [--require-authenticode] [--authenticode-trust-anchor <thumbprint>]',
    )
  }
  verifyPackagedAgentRuntime({
    agentPath,
    requireAuthenticode,
    authenticodeTrustAnchorThumbprint,
  })
    .then(async (result) => {
      console.log(`[Pidex] Packaged agent runtime verified: ${await sha256(agentPath)}`)
      console.log(JSON.stringify(result, null, 2))
    })
    .catch((error) => {
      console.error(sanitizeVerifierError(error instanceof Error ? error.message : String(error)))
      process.exitCode = 1
    })
}
