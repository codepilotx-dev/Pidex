import { mkdir, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')
const project = resolve(root, 'apps/desktop/native/cpx-cua')
const target = 'x86_64-pc-windows-msvc'
// Release is the shipping profile and the one development also exercises, so a
// slower native path can never hide behind a debug-only build. Set
// PIDEX_CUA_PROFILE=debug only for a fast local iteration loop.
const release = process.env.PIDEX_CUA_PROFILE !== 'debug'
const built = resolve(project, 'target', target, release ? 'release' : 'debug', 'cpx-cua.exe')
const output = resolve(project, 'dist', 'cpx-cua.exe')

if (process.platform !== 'win32') throw new Error('CPX-CUA 当前仅支持 Windows x64')

console.log(`[Pidex] 构建 CPX-CUA（${release ? 'release' : 'debug'} / ${target}）`)
const child = Bun.spawn(
  [
    'cargo',
    'build',
    '--locked',
    '--target',
    target,
    '-p',
    'cpx-cua',
    ...(release ? ['--release'] : []),
  ],
  { cwd: project, stdin: 'inherit', stdout: 'inherit', stderr: 'inherit' },
)
const exitCode = await child.exited
if (exitCode !== 0) process.exit(exitCode)

await mkdir(resolve(project, 'dist'), { recursive: true })
await copyFile(built, output)
console.log(`[Pidex] CPX-CUA 原生运行时已就绪：${output}`)
