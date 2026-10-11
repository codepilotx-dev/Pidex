import { describe, expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dir, '..')

function timeoutConstant(source: string, name: string): number {
  const match = source.match(new RegExp(`const ${name} = ([\\d_]+)`))
  if (!match?.[1]) throw new Error(`缺少 ${name}`)
  return Number(match[1].replaceAll('_', ''))
}

describe('Windows x64 packaged terminal smoke', () => {
  test('为共享 Windows runner 的 ConPTY 冷启动保留分层预算', () => {
    const packagedSource = readFileSync(
      resolve(root, 'apps/desktop/electron/src/terminal/PackagedTerminalSmoke.ts'),
      'utf8',
    )
    const runnerSource = readFileSync(resolve(root, 'scripts/SmokeWinX64.ts'), 'utf8')
    const stepTimeout = timeoutConstant(packagedSource, 'SMOKE_TIMEOUT_MS')
    const processTimeout = timeoutConstant(runnerSource, 'PACKAGED_TERMINAL_SMOKE_TIMEOUT_MS')

    expect(stepTimeout).toBeGreaterThanOrEqual(30_000)
    expect(processTimeout).toBeGreaterThanOrEqual(stepTimeout * 3)
    expect(runnerSource).toContain('PACKAGED_TERMINAL_SMOKE_TIMEOUT_MS / 1_000')
  })
})
