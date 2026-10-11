/**
 * ReleaseRunContext.test.ts — 发布机唯一运行上下文的创建与安全清理边界
 */

import { describe, expect, it } from 'bun:test'
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  createReleaseRunContext,
  disposeReleaseRunContext,
  validateReleaseRunContext,
} from './ReleaseRunContext.ts'

const RUN_ID = '42'
const RUN_ATTEMPT = '1'
const options = { runId: RUN_ID, runAttempt: RUN_ATTEMPT }

async function freshRunnerTemp(): Promise<string> {
  return mkdtemp(join(tmpdir(), 'pidex-runner-temp-'))
}

async function removeTree(path: string): Promise<void> {
  await rm(path, { recursive: true, force: true }).catch(() => undefined)
}

describe('release run context', () => {
  it('两次创建得到不同目录且包含完整隔离布局', async () => {
    const runnerTemp = await freshRunnerTemp()
    try {
      const first = await createReleaseRunContext({ ...options, runnerTemp })
      const second = await createReleaseRunContext({ ...options, runnerTemp })
      expect(first.root).not.toBe(second.root)
      for (const context of [first, second]) {
        for (const directory of [
          context.temp,
          context.appData,
          context.localAppData,
          context.userData,
          context.data,
          context.logs,
          context.artifacts,
        ]) {
          expect(existsSync(directory)).toBe(true)
        }
        expect(existsSync(join(context.root, '.pidex-release-ownership.json'))).toBe(true)
      }
      await disposeReleaseRunContext(first.root, { ...options, runnerTemp })
      await disposeReleaseRunContext(second.root, { ...options, runnerTemp })
      expect(existsSync(first.root)).toBe(false)
      expect(existsSync(second.root)).toBe(false)
    } finally {
      await removeTree(runnerTemp)
    }
  })

  it('拒绝 RUNNER_TEMP 之外的清理路径', async () => {
    const runnerTemp = await freshRunnerTemp()
    try {
      const outside = await mkdtemp(join(tmpdir(), 'pidex-outside-'))
      await expect(validateReleaseRunContext(outside, { ...options, runnerTemp })).rejects.toThrow(
        'RUNNER_TEMP 直接子目录',
      )
    } finally {
      await removeTree(runnerTemp)
    }
  })

  it('拒绝错误 marker、run ID、attempt 与 repository', async () => {
    const runnerTemp = await freshRunnerTemp()
    try {
      const context = await createReleaseRunContext({ ...options, runnerTemp })
      const markerPath = join(context.root, '.pidex-release-ownership.json')
      const marker = JSON.parse(await readFile(markerPath, 'utf8')) as Record<string, unknown>

      await writeFile(markerPath, JSON.stringify({ ...marker, repository: 'other/repo' }), 'utf8')
      await expect(
        validateReleaseRunContext(context.root, { ...options, runnerTemp }),
      ).rejects.toThrow('repository 不匹配')

      await writeFile(markerPath, JSON.stringify({ ...marker, runId: '99' }), 'utf8')
      await expect(
        validateReleaseRunContext(context.root, { ...options, runnerTemp }),
      ).rejects.toThrow('run ID 不匹配')

      await writeFile(markerPath, JSON.stringify({ ...marker, runAttempt: '9' }), 'utf8')
      await expect(
        validateReleaseRunContext(context.root, { ...options, runnerTemp }),
      ).rejects.toThrow('run attempt 不匹配')

      await writeFile(markerPath, JSON.stringify(marker), 'utf8')
      const renamed = join(runnerTemp, 'pidex-release-42-1-00000000-0000-0000-0000-000000000000')
      await mkdir(renamed)
      await writeFile(
        join(renamed, '.pidex-release-ownership.json'),
        JSON.stringify(marker),
        'utf8',
      )
      await expect(validateReleaseRunContext(renamed, { ...options, runnerTemp })).rejects.toThrow(
        '目录名与 ownership marker 不匹配',
      )

      await expect(
        validateReleaseRunContext(context.root, { ...options, runnerTemp, runId: '7' }),
      ).rejects.toThrow('run ID 不匹配')

      await disposeReleaseRunContext(context.root, { ...options, runnerTemp })
    } finally {
      await removeTree(runnerTemp)
    }
  })

  it('持续占用时保留现场并严格失败', async () => {
    const runnerTemp = await freshRunnerTemp()
    try {
      const context = await createReleaseRunContext({ ...options, runnerTemp })
      // 子进程以 context 根目录为 cwd，Windows 会持有目录句柄使删除持续失败。
      const child = Bun.spawn([process.execPath, '-e', 'setInterval(() => {}, 1_000)'], {
        cwd: context.root,
        stdout: 'ignore',
        stderr: 'ignore',
        windowsHide: true,
      })
      // 子进程的 cwd 句柄在其进程创建完成后才打开；先等启动完成再触发清理。
      await Bun.sleep(300)
      try {
        await expect(
          disposeReleaseRunContext(context.root, {
            ...options,
            runnerTemp,
            removeAttempts: 5,
            removeDelayMs: 10,
          }),
        ).rejects.toThrow('清理失败')
      } finally {
        child.kill()
        await child.exited.catch(() => undefined)
      }
      expect(existsSync(context.root)).toBe(true)
      // 失败轮已删除 ownership marker：无有效 marker 时拒绝继续清理。
      await expect(
        disposeReleaseRunContext(context.root, { ...options, runnerTemp }),
      ).rejects.toThrow('ownership marker')
      await removeTree(runnerTemp)
    } finally {
      await removeTree(runnerTemp)
    }
  })
})
