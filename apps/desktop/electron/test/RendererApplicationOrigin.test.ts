import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { resolveRendererApplicationOrigin } from '../src/security/RendererApplicationOrigin'

const input = {
  agentOrigin: 'http://127.0.0.1:4312',
  isPackaged: false,
  managedAgent: true,
  rendererDevUrl: 'http://127.0.0.1:7788',
}

describe('desktop renderer application origin', () => {
  test('开发态 managed Agent 使用独立回环 Renderer origin', () => {
    expect(resolveRendererApplicationOrigin(input)).toBe('http://127.0.0.1:7788')
  })

  test('未配置 override 时保持 Agent origin', () => {
    expect(
      resolveRendererApplicationOrigin({
        ...input,
        rendererDevUrl: undefined,
      }),
    ).toBe('http://127.0.0.1:4312')
  })

  test('打包版与 owned sidecar 忽略 Renderer override', () => {
    expect(
      resolveRendererApplicationOrigin({
        ...input,
        isPackaged: true,
        rendererDevUrl: 'https://renderer.invalid/path',
      }),
    ).toBe('http://127.0.0.1:4312')
    expect(
      resolveRendererApplicationOrigin({
        ...input,
        managedAgent: false,
        rendererDevUrl: 'https://renderer.invalid/path',
      }),
    ).toBe('http://127.0.0.1:4312')
  })

  test.each([
    'https://127.0.0.1:7788',
    'http://localhost:7788',
    'http://0.0.0.0:7788',
    'http://user@127.0.0.1:7788',
    'http://127.0.0.1:7788/path',
    'http://127.0.0.1:7788/?query=1',
    'http://127.0.0.1:7788/#hash',
    'http://127.0.0.1',
    'not-a-url',
  ])('拒绝不受支持的开发 Renderer 地址：%s', (rendererDevUrl) => {
    expect(() =>
      resolveRendererApplicationOrigin({
        ...input,
        rendererDevUrl,
      }),
    ).toThrow('开发 Renderer 地址必须是 http://127.0.0.1:<port>')
  })

  test('主进程保持 Agent 认证 origin，并将窗口安全边界切到 Renderer origin', async () => {
    const mainSource = await readFile(
      fileURLToPath(new URL('../src/main.ts', import.meta.url)),
      'utf8',
    )
    expect(mainSource).toContain('await configureAuthCookie(candidate.origin, token, activeLogger)')
    expect(mainSource).toContain('await verifyAuthCookie(candidate.origin, activeLogger)')
    expect(mainSource).toContain('petOverlay?.setApplicationOrigin(applicationOrigin)')
    expect(mainSource).toContain('await activeWindows.loadApplication(applicationOrigin)')
  })
})
