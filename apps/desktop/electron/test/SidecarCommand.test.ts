import { afterEach, describe, expect, test } from 'bun:test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  missingPackagedSidecarError,
  resolveBunExecutable,
  resolveSidecarCommand,
  SidecarInstallationError,
} from '../src/sidecar/Command'

const roots: string[] = []

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Bun sidecar 命令解析', () => {
  test('识别 npm/nvm Windows shim 后面的真实 bun.exe', () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
    const executable = join(root, 'node_modules', 'bun', 'bin', 'bun.exe')
    roots.push(root)
    mkdirSync(join(root, 'node_modules', 'bun', 'bin'), { recursive: true })
    writeFileSync(join(root, 'bun.cmd'), '@echo off')
    writeFileSync(executable, '')

    expect(resolveBunExecutable({ Path: root }, 'win32')).toBe(executable)
  })

  test('显式路径优先于 PATH 自动发现', () => {
    expect(resolveBunExecutable({ PIDEX_BUN_PATH: 'D:\\tools\\bun.exe', Path: '' }, 'win32')).toBe(
      'D:\\tools\\bun.exe',
    )
  })

  test('开发模式默认启动统一 Agent 入口', () => {
    expect(
      resolveSidecarCommand({
        packaged: false,
        resourcesPath: '',
        moduleDirectory: import.meta.dir,
        env: { PIDEX_BUN_PATH: 'D:\\tools\\bun.exe' },
      }).args,
    ).toEqual(['run', 'apps/agent/src/index.ts'])
  })

  test('packaged 模式解析固定资源路径', () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
    const executable = join(root, 'agent', 'pidex-agent.exe')
    roots.push(root)
    mkdirSync(join(root, 'agent'), { recursive: true })
    writeFileSync(executable, '')

    expect(
      resolveSidecarCommand({
        packaged: true,
        resourcesPath: root,
        moduleDirectory: import.meta.dir,
      }),
    ).toEqual({ executable, args: [], cwd: root })
  })

  test('packaged 模式缺失 Agent 时返回不可重试的安装错误', () => {
    const root = join(import.meta.dir, `.tmp-${crypto.randomUUID()}`)
    roots.push(root)
    mkdirSync(root, { recursive: true })

    expect(() =>
      resolveSidecarCommand({
        packaged: true,
        resourcesPath: root,
        moduleDirectory: import.meta.dir,
      }),
    ).toThrow(SidecarInstallationError)

    expect(
      missingPackagedSidecarError(
        Object.assign(new Error('spawn failed'), { code: 'ENOENT' }),
        'C:\\resources\\agent.exe',
      ),
    ).toBeInstanceOf(SidecarInstallationError)
    expect(
      missingPackagedSidecarError(
        Object.assign(new Error('access denied'), { code: 'EACCES' }),
        'C:\\resources\\agent.exe',
      ),
    ).toBeUndefined()
  })
})
