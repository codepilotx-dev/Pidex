import { createServer } from 'node:net'
import { spawn, type ChildProcess } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { killProcessTree } from '../../../../scripts/IntegrationTestRunner'

const rendererRoot = fileURLToPath(new URL('..', import.meta.url))
const allowedConfigs = new Set(['playwright.a11y.config.ts', 'playwright.config.ts'])

async function allocateLoopbackPort() {
  return await new Promise<number>((resolve, reject) => {
    const server = createServer()
    server.once('error', reject)
    server.listen({ host: '127.0.0.1', port: 0 }, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        server.close()
        reject(new Error('无法分配 Playwright 回环端口'))
        return
      }
      server.close((error) => (error ? reject(error) : resolve(address.port)))
    })
  })
}

export async function waitForPlaywright(child: ChildProcess): Promise<number> {
  let interrupted: number | undefined
  const interrupt = (code: number) => {
    if (interrupted !== undefined) return
    interrupted = code
    killProcessTree(child)
  }
  const onInterrupt = () => interrupt(130)
  const onTerminate = () => interrupt(143)
  process.on('SIGINT', onInterrupt)
  process.on('SIGTERM', onTerminate)
  try {
    return await new Promise<number>((resolve, reject) => {
      child.once('error', reject)
      child.once('exit', (code) => resolve(interrupted ?? code ?? 1))
    })
  } finally {
    process.off('SIGINT', onInterrupt)
    process.off('SIGTERM', onTerminate)
    killProcessTree(child)
  }
}

async function main() {
  const configFile = process.argv[2]?.trim()
  if (!configFile || !allowedConfigs.has(configFile)) {
    throw new Error(
      'Playwright 配置必须是 playwright.config.ts 或 playwright.a11y.config.ts，且只接受文件名',
    )
  }
  const args = process.argv.slice(3)
  if (
    args.some((arg) => arg === '--config' || arg.startsWith('--config=') || arg.startsWith('-c'))
  ) {
    throw new Error('请通过第一个参数选择白名单内的 Playwright 配置，不可重复指定 --config/-c')
  }

  const port = await allocateLoopbackPort()
  console.log(`[playwright] 使用动态回环端口 ${port}`)

  const playwright = spawn(
    process.execPath,
    ['x', 'playwright', 'test', '--config', configFile, ...args],
    {
      cwd: rendererRoot,
      env: {
        ...process.env,
        PIDEX_VISUAL_PORT: String(port),
      },
      stdio: 'inherit',
      windowsHide: true,
    },
  )

  process.exitCode = await waitForPlaywright(playwright)
}

if (import.meta.main) await main()
