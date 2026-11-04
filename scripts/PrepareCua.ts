import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { artifactDigest, cuaFingerprint, cuaProject, cuaRoot, downloadCua } from './CuaArtifact'

if (process.platform !== 'win32' || process.arch !== 'x64') {
  throw new Error('CPX-CUA 当前仅支持 Windows x64')
}

const output = resolve(cuaRoot, cuaProject, 'dist/cpx-cua.exe')
const metadata = `${output}.json`
const fingerprint = await cuaFingerprint()
const debug = process.env.PIDEX_CUA_PROFILE === 'debug'
if (!debug) {
  const saved = await readFile(metadata, 'utf8').catch((error) => {
    if (error.code !== 'ENOENT') throw error
    return undefined
  })
  if (saved) {
    const entry = JSON.parse(saved) as { fingerprint: string; digest: string }
    const bytes = await readFile(output).catch((error) => {
      if (error.code !== 'ENOENT') throw error
      return undefined
    })
    if (entry.fingerprint === fingerprint && bytes && entry.digest === artifactDigest(bytes)) {
      console.log('[Pidex] 复用已校验的 CUA EXE')
      process.exit(0)
    }
  }
  const bytes = await downloadCua(`cua-${fingerprint}`)
  if (bytes) {
    await mkdir(resolve(output, '..'), { recursive: true })
    await writeFile(`${output}.download`, bytes)
    await rename(`${output}.download`, output)
    await writeFile(metadata, JSON.stringify({ fingerprint, digest: artifactDigest(bytes) }))
    console.log('[Pidex] 已下载并校验 CUA EXE')
    process.exit(0)
  }
  console.log('[Pidex] 当前源码尚无预编译 CUA，使用源码构建')
}

const child = Bun.spawn([process.execPath, 'scripts/BuildCua.ts'], {
  cwd: cuaRoot,
  stdin: 'inherit',
  stdout: 'inherit',
  stderr: 'inherit',
})
const code = await child.exited
if (code !== 0) process.exit(code)
// Debug must never leave release metadata pointing at a debug executable.
await writeFile(
  metadata,
  JSON.stringify({
    fingerprint: debug ? 'debug' : fingerprint,
    digest: artifactDigest(await readFile(output)),
  }),
)
