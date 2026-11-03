import { toNamespacedPath } from 'node:path'
import { AgentError } from '../Domain'

export const hasWindowsDeviceName = (path: string) =>
  process.platform === 'win32' &&
  path
    .split(/[\\/]/u)
    .some((part) => /^(?:con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(part))

// Bun 会把保留名称解释为设备，使用 Windows 自带 .NET 文件 API 保留真实文件。
export async function windowsWorktreeFiles(
  input:
    | { operation: 'copy' | 'check' | 'preserve'; source: string; target: string }
    | { operation: 'remove'; target: string },
): Promise<boolean> {
  const script = `
$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
try {
  $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  function Assert-NoReparse([string]$path) {
    $cursor = $path
    while ($cursor) {
      if ([IO.File]::Exists($cursor) -or [IO.Directory]::Exists($cursor)) {
        if (([IO.File]::GetAttributes($cursor) -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'unsafe path' }
      }
      $cursor = [IO.Path]::GetDirectoryName($cursor)
    }
  }
  Assert-NoReparse $inputData.target
  if ($inputData.operation -in @('copy', 'check', 'preserve')) {
    Assert-NoReparse $inputData.source
    if (-not [IO.File]::Exists($inputData.source)) { throw 'source unavailable' }
    if ([IO.File]::Exists($inputData.target)) {
      if ($inputData.operation -eq 'preserve') {
        $hash = [Security.Cryptography.SHA256]::Create()
        $sourceStream = [IO.File]::OpenRead($inputData.source)
        $targetStream = [IO.File]::OpenRead($inputData.target)
        try {
          if ([Convert]::ToBase64String($hash.ComputeHash($sourceStream)) -ne [Convert]::ToBase64String($hash.ComputeHash($targetStream))) { throw 'snapshot differs' }
        } finally { $sourceStream.Dispose(); $targetStream.Dispose(); $hash.Dispose() }
      }
      [Console]::Write('skipped'); exit 0
    }
    if ([IO.Directory]::Exists($inputData.target)) { throw 'target is directory' }
    if ($inputData.operation -ne 'check') {
      [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($inputData.target)) | Out-Null
      [IO.File]::Copy($inputData.source, $inputData.target, $false)
    }
  } elseif ($inputData.operation -eq 'remove') {
    if ([IO.Directory]::Exists($inputData.target)) { [IO.Directory]::Delete($inputData.target, $true) }
  } else { throw 'invalid operation' }
  [Console]::Write('done')
} catch { exit 1 }
`
  const child = Bun.spawn(
    [
      'powershell.exe',
      '-NoProfile',
      '-NonInteractive',
      '-EncodedCommand',
      Buffer.from(script, 'utf16le').toString('base64'),
    ],
    {
      windowsHide: true,
      stdin: new Blob([
        JSON.stringify({
          ...input,
          ...('source' in input ? { source: toNamespacedPath(input.source) } : {}),
          target: toNamespacedPath(input.target),
        }),
      ]),
      stdout: 'pipe',
      stderr: 'ignore',
    },
  )
  const [output, code] = await Promise.all([new Response(child.stdout).text(), child.exited])
  if (code !== 0)
    throw new AgentError(
      'WORKTREE_GIT_FAILED',
      '工作树特殊文件无法安全处理，可能被占用、无权访问或与恢复快照不同；目录与已有快照已保留，请检查后重试。',
      409,
    )
  return output === 'done'
}
