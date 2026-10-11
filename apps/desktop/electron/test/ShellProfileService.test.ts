import { describe, expect, test } from 'bun:test'
import { ShellProfileService } from '../src/terminal/ShellProfileService'
import { TerminalError } from '../src/terminal/TerminalErrors'

describe('终端 Shell profile', () => {
  test('Windows 按 pwsh、Windows PowerShell、cmd 顺序选择首个可用项', () => {
    const service = new ShellProfileService({
      platform: 'win32',
      environment: {
        Path: 'C:\\Tools',
        SystemRoot: 'C:\\Windows',
        ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      },
      fileExists: (path) =>
        [
          'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe',
          'C:\\Windows\\System32\\cmd.exe',
        ].includes(path),
    })
    expect(service.list().find((profile) => profile.isDefault)?.id).toBe('windows-powershell')
    expect(service.resolve(null).id).toBe('windows-powershell')
  })

  test('只能解析探测结果中的可用 opaque profile ID', () => {
    const service = new ShellProfileService({
      platform: 'linux',
      environment: { SHELL: '/bin/bash' },
      fileExists: (path) => path === '/bin/bash',
    })
    expect(service.resolve('bash').executable).toBe('/bin/bash')
    expect(() => service.resolve('/tmp/custom-shell')).toThrow(TerminalError)
  })
})
