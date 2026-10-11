import { afterEach, describe, expect, test } from 'bun:test'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createDesktopLogger, resolveDesktopLogDirectory } from '../src/logging/DesktopLogger'
import { rendererConsoleRecord } from '../src/logging/RendererConsole'

const roots: string[] = []
afterEach(async () =>
  Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true }))),
)

describe('desktop logging', () => {
  test('写入 desktop.jsonl 并过滤终端开发详情', async () => {
    const root = await mkdtemp(join(tmpdir(), 'pidex-desktop-logger-'))
    roots.push(root)
    const output: string[] = []
    const logger = createDesktopLogger(root, {
      consoleLevel: 'debug',
      detailMode: 'development',
      consoleSink: (line) => output.push(line),
    })
    logger.warn('desktop.test', {
      details: { status: 'warning', apiKey: 'sk-secret' },
      development: { source: 'C:\\private\\source.ts' },
    })

    const record = JSON.parse(await readFile(join(root, 'desktop.jsonl'), 'utf8')) as Record<
      string,
      unknown
    >
    expect(record.component).toBe('desktop')
    expect(JSON.stringify(record)).not.toContain('sk-secret')
    expect(record).toHaveProperty('development')
    expect(output.join('')).not.toContain('source.ts')
  })

  test('日志目录优先显式配置，迁移时使用源目录', () => {
    const launch = {
      dataDir: resolve('D:/target/.pidex'),
      relocation: {
        operationId: 'operation-1',
        sourceDataDir: resolve('C:/source/.pidex'),
        targetDataDir: resolve('D:/target/.pidex'),
      },
    }
    expect(resolveDesktopLogDirectory(launch, undefined)).toBe(resolve('C:/source/.pidex/logs'))
    expect(resolveDesktopLogDirectory(launch, 'E:/logs')).toBe(resolve('E:/logs'))
  })

  test('renderer 只保留 warning/error 且 source 仅保留文件名', () => {
    expect(rendererConsoleRecord('info', 'info', 1, 'file:///C:/private/source.ts')).toBeNull()
    expect(rendererConsoleRecord('debug', 'debug', 1, 'file:///C:/private/source.ts')).toBeNull()
    expect(rendererConsoleRecord('warning', 'warning', 12, 'file:///C:/private/source.ts')).toEqual(
      {
        level: 'warning',
        message: 'warning',
        line: 12,
        source: 'source.ts',
      },
    )
    expect(rendererConsoleRecord('error', 'error', 15, 'http://localhost/src/page.tsx')).toEqual({
      level: 'error',
      message: 'error',
      line: 15,
      source: 'page.tsx',
    })
  })
})
