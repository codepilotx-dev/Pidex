import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const agent = resolve(root, 'apps/agent/dist/x64/pidex-agent.exe')
const certificate = process.env.PIDEX_WINDOWS_CERTIFICATE_PATH?.trim()
const password = process.env.PIDEX_WINDOWS_CERTIFICATE_PASSWORD
const explicitSignTool = process.env.PIDEX_SIGNTOOL_PATH?.trim()

if (!certificate || !existsSync(certificate))
  throw new Error('Release 构建缺少 PIDEX_WINDOWS_CERTIFICATE_PATH')
if (!password) throw new Error('Release 构建缺少 PIDEX_WINDOWS_CERTIFICATE_PASSWORD')
if (!existsSync(agent)) throw new Error(`Agent PE 不存在：${agent}`)

const signTool = explicitSignTool || (await findSignTool())
const sign = Bun.spawn(
  [
    signTool,
    'sign',
    '/fd',
    'SHA256',
    '/td',
    'SHA256',
    '/tr',
    process.env.PIDEX_TIMESTAMP_URL ?? 'http://timestamp.digicert.com',
    '/f',
    certificate,
    '/p',
    password,
    agent,
  ],
  { cwd: root, stdout: 'inherit', stderr: 'inherit' },
)
if ((await sign.exited) !== 0) throw new Error('Agent Authenticode 签名失败')
console.log('[Pidex] Agent x64 PE signed')

async function findSignTool(): Promise<string> {
  const windowsKits = join(
    process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)',
    'Windows Kits/10/bin',
  )
  const search = Bun.spawn(
    [
      join(
        process.env.SystemRoot ?? 'C:\\Windows',
        'System32/WindowsPowerShell/v1.0/powershell.exe',
      ),
      '-NoProfile',
      '-NonInteractive',
      '-Command',
      `(Get-ChildItem -LiteralPath '${windowsKits.replaceAll("'", "''")}' -Filter signtool.exe -Recurse | Where-Object FullName -match '\\\\x64\\\\signtool.exe$' | Sort-Object FullName -Descending | Select-Object -First 1 -ExpandProperty FullName)`,
    ],
    { stdout: 'pipe', stderr: 'inherit' },
  )
  const output = await new Response(search.stdout).text()
  if ((await search.exited) !== 0 || !output.trim())
    throw new Error('未找到 Windows SDK signtool.exe')
  return output.trim()
}
