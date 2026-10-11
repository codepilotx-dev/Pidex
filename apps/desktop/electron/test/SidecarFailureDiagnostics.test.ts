import { describe, expect, test } from 'bun:test'
import {
  isSidecarConnectStage,
  isSidecarFailureCode,
  readSidecarFailureCode,
} from '../src/sidecar/FailureDiagnostics'
import { resolveDocumentsDirectory } from '../src/sidecar/Supervisor'

describe('Sidecar 安全失败诊断', () => {
  test('只接受固定阶段与错误码', () => {
    expect(isSidecarConnectStage('spawn-process')).toBe(true)
    expect(isSidecarConnectStage('C:\\private\\agent.exe')).toBe(false)
    expect(isSidecarFailureCode('EACCES')).toBe(true)
    expect(isSidecarFailureCode('TOKEN_secret-value')).toBe(false)
  })

  test('未知错误不会泄露原始 code 或 message', () => {
    const error = Object.assign(new Error('Bearer secret-token at C:\\private\\agent.exe'), {
      code: 'PRIVATE_secret-token',
    })
    expect(readSidecarFailureCode(error)).toBe('unknown')
    expect(readSidecarFailureCode({ code: 'EINVAL' })).toBe('EINVAL')
  })

  test('Windows 服务账户缺少 Documents 已知目录时回退到 home', () => {
    expect(
      resolveDocumentsDirectory((name) => {
        if (name === 'documents') throw new Error('known folder unavailable')
        return 'C:\\service-profile'
      }),
    ).toBe('C:\\service-profile\\Documents')
  })
})
