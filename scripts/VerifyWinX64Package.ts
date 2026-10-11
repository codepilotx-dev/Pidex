import { createHash } from 'node:crypto'
import { createReadStream, existsSync } from 'node:fs'
import { readFile, stat } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { assertAgentBinaryHasNoStaticRiskFeatures } from './AgentPeSignatures'
import { assertAuthenticodeValid, verifyPackagedAgentRuntime } from './AgentRuntimeVerifier'
import { parseSemver } from './SemverUtils'
import { assertWindowsX64PE } from './WindowsPe'

const root = resolve(import.meta.dir, '..')
const requireSigning = process.argv.includes('--require-signing')
const unpackedArgument = process.argv.find((argument) => argument.startsWith('--unpacked='))
const unpacked = unpackedArgument
  ? resolve(unpackedArgument.slice('--unpacked='.length))
  : resolve(root, 'release/win-unpacked')

const application = join(unpacked, 'Pidex Desktop.exe')
const agent = join(unpacked, 'resources/agent/pidex-agent.exe')
const cuaRuntime = join(unpacked, 'resources/cua/cpx-cua.exe')
const appUpdateConfiguration = join(unpacked, 'resources/app-update.yml')
const nodePtyDirectory = join(unpacked, 'resources/app.asar.unpacked/node_modules/node-pty')
const nodePtyManifest = join(nodePtyDirectory, 'package.json')
const nodePtyLicense = join(nodePtyDirectory, 'LICENSE')
const nodePtyNativeFiles = [
  join(nodePtyDirectory, 'prebuilds/win32-x64/conpty.node'),
  join(nodePtyDirectory, 'prebuilds/win32-x64/conpty_console_list.node'),
  join(nodePtyDirectory, 'prebuilds/win32-x64/pty.node'),
]
const requiredFiles = [
  application,
  agent,
  cuaRuntime,
  appUpdateConfiguration,
  join(unpacked, 'resources/app.asar'),
  join(unpacked, 'resources/renderer/index.html'),
  join(unpacked, 'resources/THIRD_PARTY_NOTICES.md'),
  nodePtyManifest,
  nodePtyLicense,
  ...nodePtyNativeFiles,
]
for (const path of requiredFiles) {
  if (!existsSync(path)) throw new Error(`Windows x64 包缺少文件：${path}`)
  if ((await stat(path)).size === 0) throw new Error(`Windows x64 包含空文件：${path}`)
}
const thirdPartyDirectory = join(unpacked, 'resources/third_party')
if (!existsSync(thirdPartyDirectory) || !(await stat(thirdPartyDirectory)).isDirectory()) {
  throw new Error(`Windows x64 包缺少第三方许可证目录：${thirdPartyDirectory}`)
}
for (const path of [application, agent, cuaRuntime]) {
  await assertWindowsX64PE(path)
}
for (const path of nodePtyNativeFiles) {
  await assertWindowsX64PE(path)
}
const nodePtyPackage = JSON.parse(await readFile(nodePtyManifest, 'utf8')) as {
  name?: unknown
  version?: unknown
  license?: unknown
}
if (
  nodePtyPackage.name !== 'node-pty' ||
  nodePtyPackage.version !== '1.1.0' ||
  nodePtyPackage.license !== 'MIT'
) {
  throw new Error('Windows x64 包中的 node-pty 版本或许可证无效')
}
await assertAgentBinaryHasNoStaticRiskFeatures(agent)
await verifyPackagedAgentRuntime({ agentPath: agent, requireAuthenticode: requireSigning })
await verifyPackagedCuaRuntime(cuaRuntime)

const rootManifest = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8')) as {
  version?: unknown
}
if (typeof rootManifest.version !== 'string') {
  throw new Error('根 package.json 缺少字符串类型的 version')
}
const parsedVersion = parseSemver(rootManifest.version)
if (!parsedVersion) {
  throw new Error(`版本 "${rootManifest.version}" 不符合发布 SemVer 规则`)
}
const updateChannel = parsedVersion.prereleaseType ?? 'latest'
const releaseDirectory = resolve(root, 'release')
const installerName = `Pidex-Desktop-${rootManifest.version}-x64.exe`
const installer = resolve(releaseDirectory, installerName)
const blockmap = `${installer}.blockmap`
const updateMetadata = resolve(releaseDirectory, `${updateChannel}.yml`)
for (const path of [installer, blockmap, updateMetadata]) {
  if (!existsSync(path) || (await stat(path)).size === 0) {
    throw new Error(`Windows x64 更新产物缺失或为空：${path}`)
  }
}
await assertUpdaterConfiguration(appUpdateConfiguration, updateChannel)
await assertUpdaterMetadata(
  updateMetadata,
  rootManifest.version,
  installerName,
  (await stat(installer)).size,
)

if (requireSigning) {
  await assertAuthenticodeValid([application, installer])
}

console.log(`[Pidex] Windows x64 package verified: ${unpacked}`)
console.log(`[Pidex] Installer: ${installer}`)
console.log(`[Pidex] Installer size: ${(await stat(installer)).size} bytes`)
console.log(`[Pidex] Installer SHA-256: ${await sha256(installer)}`)

async function assertUpdaterConfiguration(path: string, expectedChannel: string): Promise<void> {
  const configuration = await readFile(path, 'utf8')
  for (const [key, expected] of [
    ['provider', 'github'],
    ['owner', 'codepilotx-dev'],
    ['repo', 'Pidex'],
    ['channel', expectedChannel],
  ] as const) {
    const match = configuration.match(new RegExp(`^${key}:\\s*["']?([^"'\\r\\n]+)["']?\\s*$`, 'm'))
    if (match?.[1] !== expected) {
      throw new Error(`app-update.yml 的 ${key} 配置无效`)
    }
  }
}

async function assertUpdaterMetadata(
  path: string,
  expectedVersion: string,
  expectedInstallerName: string,
  expectedInstallerSize: number,
): Promise<void> {
  const metadata = await readFile(path, 'utf8')
  const version = metadata.match(/^version:\s*["']?([^"' \r\n]+)["']?\s*$/m)?.[1]
  if (version !== expectedVersion) {
    throw new Error(`更新元数据版本无效：${version ?? 'missing'}`)
  }
  const installerUrls = [
    ...metadata.matchAll(/^\s*-\s+url:\s*["']?([^"'\r\n]+\.exe)["']?\s*$/gim),
  ].map((match) => match[1])
  if (installerUrls.length !== 1 || installerUrls[0] !== expectedInstallerName) {
    throw new Error('更新元数据引用了非当前版本安装包')
  }
  const sha512Values = [...metadata.matchAll(/^\s+sha512:\s*([A-Za-z0-9+/=]+)\s*$/gm)]
  if (sha512Values.length < 1 || sha512Values.some((match) => match[1].length < 44)) {
    throw new Error('更新元数据缺少有效的 SHA-512')
  }
  const sizes = [...metadata.matchAll(/^\s+size:\s*(\d+)\s*$/gm)].map((match) => Number(match[1]))
  if (sizes.length < 1 || !sizes.includes(expectedInstallerSize)) {
    throw new Error('更新元数据中的安装包大小无效')
  }
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

/**
 * The packaged runtime is spawned by Electron at first use, so the installer is
 * only trustworthy if the shipped binary still completes the MCP stdio
 * handshake on a clean machine.
 */
async function verifyPackagedCuaRuntime(executable: string): Promise<void> {
  const child = Bun.spawn([executable], { stdin: 'pipe', stdout: 'pipe', stderr: 'ignore' })
  const handshake = (async () => {
    child.stdin.write(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'initialize',
        params: {
          protocolVersion: '2025-06-18',
          capabilities: {},
          clientInfo: { name: 'package-verifier', version: '1.0.0' },
        },
      })}\n`,
    )
    const decoder = new TextDecoder()
    let buffer = ''
    for await (const chunk of child.stdout) {
      buffer += decoder.decode(chunk as Uint8Array, { stream: true })
      let index = buffer.indexOf('\n')
      while (index >= 0) {
        const line = buffer.slice(0, index).trim()
        buffer = buffer.slice(index + 1)
        if (line) {
          const message = JSON.parse(line) as {
            id?: number
            result?: { serverInfo?: { name?: string } }
          }
          if (message.id === 1) return message.result?.serverInfo?.name ?? null
        }
        index = buffer.indexOf('\n')
      }
    }
    return null
  })()
  const name = await Promise.race([handshake, Bun.sleep(20_000).then(() => null)])
  child.kill()
  if (name !== 'CPX-CUA') throw new Error(`打包的 CPX-CUA 运行时无法启动：${name ?? '无响应'}`)
}
