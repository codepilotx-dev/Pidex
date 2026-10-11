import { describe, expect, test } from 'bun:test'
import { join } from 'node:path'
import {
  ExternalOpenTargetService,
  type ExternalOpenTargetDependencies,
} from '../src/ipc/ExternalOpenTargets'

const targetPath = 'C:\\workspace\\src\\index.ts'
const targetDirectory = 'C:\\workspace\\src'

const WIN32_ENV: NodeJS.ProcessEnv = {
  LOCALAPPDATA: 'C:\\Users\\test\\AppData\\Local',
  ProgramFiles: 'C:\\Program Files',
  'ProgramFiles(x86)': 'C:\\Program Files (x86)',
  WINDIR: 'C:\\Windows',
}

type HarnessOptions = {
  installedPaths?: string[]
  installedDirectories?: string[]
  execFile?: Partial<ExternalOpenTargetDependencies>['execFile']
  platform?: NodeJS.Platform
}

type Harness = {
  service: ExternalOpenTargetService
  launches: Array<{ executablePath: string; args: readonly string[] }>
  revealed: string[]
  opened: string[]
}

function createService(options: HarnessOptions = {}, env: NodeJS.ProcessEnv = WIN32_ENV): Harness {
  const launches: Harness['launches'] = []
  const revealed: string[] = []
  const opened: string[] = []
  const exists = new Set(options.installedPaths ?? [])
  const directories = new Set(options.installedDirectories ?? [])
  const service = new ExternalOpenTargetService({
    platform: options.platform ?? 'win32',
    env,
    fileExists: async (path) => exists.has(path),
    isDirectory: async (path) => directories.has(path),
    readDirectory: async () => [],
    execFile: async (file, args) =>
      options.execFile ? options.execFile(file, args) : { stdout: '', stderr: '' },
    openPath: async (path) => {
      opened.push(path)
      return ''
    },
    revealPath: (path) => {
      revealed.push(path)
    },
    spawnProcess: (executablePath, args) => {
      launches.push({ executablePath, args })
      return { unref: () => undefined }
    },
  })
  return { service, launches, revealed, opened }
}

describe('ExternalOpenTargetService', () => {
  test('PATH 中的 code.cmd 映射为父目录 Code.exe，编辑器直接接收目标路径', async () => {
    const vscodeRoot = 'C:\\Software\\Microsoft VS Code'
    const codeCmd = join(vscodeRoot, 'bin', 'code.cmd')
    const codeExe = join(vscodeRoot, 'Code.exe')
    const env = {
      ...WIN32_ENV,
      PATH: `${join(vscodeRoot, 'bin')};C:\\Windows\\system32`,
    }
    const harness = createService({ installedPaths: [codeCmd, codeExe] }, env)
    await expect(harness.service.listTargets(targetPath)).resolves.toEqual([
      { targetId: 'vscode', label: 'Visual Studio Code', kind: 'editor' },
      { targetId: 'file-explorer', label: 'File Explorer', kind: 'file-explorer' },
    ])
    await harness.service.openPathWithTarget(targetPath, 'vscode')
    expect(harness.launches).toEqual([{ executablePath: codeExe, args: [targetPath] }])
  })

  test('PATH 中存在 idea64.exe 时识别自定义 IntelliJ 并直接接收目标路径', async () => {
    const ideaBin = 'C:\\Software\\JetBrains\\IntelliJ IDEA 2024.3.7\\bin'
    const ideaExe = join(ideaBin, 'idea64.exe')
    const env = { ...WIN32_ENV, PATH: `${ideaBin};C:\\Windows\\system32` }
    const harness = createService({ installedPaths: [ideaExe] }, env)

    const targets = await harness.service.listTargets(targetPath)
    expect(targets.map((target) => target.targetId)).toEqual(['file-explorer', 'intellij'])
    await harness.service.openPathWithTarget(targetPath, 'intellij')
    expect(harness.launches).toEqual([{ executablePath: ideaExe, args: [targetPath] }])
  })

  test('vswhere 返回合法 devenv.exe 时显示 Visual Studio，空输出或无效路径时隐藏', async () => {
    const vswhere = join(
      'C:\\Program Files (x86)',
      'Microsoft Visual Studio',
      'Installer',
      'vswhere.exe',
    )
    const devenv = join(
      'C:\\Program Files',
      'Microsoft Visual Studio',
      '2022',
      'Community',
      'Common7',
      'IDE',
      'devenv.exe',
    )
    const withStdout = (stdout: string): HarnessOptions => ({
      installedPaths: [vswhere, devenv],
      execFile: async () => ({ stdout, stderr: '' }),
    })

    const listed = createService(withStdout(`${devenv}\r\n`))
    const targets = await listed.service.listTargets(targetPath)
    expect(targets.map((target) => target.targetId)).toEqual(['visual-studio', 'file-explorer'])
    await listed.service.openPathWithTarget(targetPath, 'visual-studio')
    expect(listed.launches).toEqual([{ executablePath: devenv, args: [targetPath] }])

    const empty = createService(withStdout(''))
    await expect(empty.service.listTargets(targetPath)).resolves.toEqual([
      { targetId: 'file-explorer', label: 'File Explorer', kind: 'file-explorer' },
    ])

    const invalid = createService(withStdout('C:\\Windows\\notepad.exe\r\n'))
    const invalidTargets = await invalid.service.listTargets(targetPath)
    expect(invalidTargets.some((target) => target.targetId === 'visual-studio')).toBe(false)

    const failing = createService({
      installedPaths: [vswhere, devenv],
      execFile: async () => {
        throw new Error('vswhere 未找到产品')
      },
    })
    const failingTargets = await failing.service.listTargets(targetPath)
    expect(failingTargets.some((target) => target.targetId === 'visual-studio')).toBe(false)
  })

  test('GitHub Desktop wrapper 映射到 GitHubDesktop.exe 并接收目录', async () => {
    const githubRoot = 'C:\\Users\\test\\AppData\\Local\\GitHubDesktop'
    const githubBat = join(githubRoot, 'bin', 'github.bat')
    const githubExe = join(githubRoot, 'GitHubDesktop.exe')
    const env = {
      ...WIN32_ENV,
      PATH: `${join(githubRoot, 'bin')};C:\\Windows\\system32`,
    }
    const harness = createService(
      {
        installedPaths: [githubBat, githubExe],
        installedDirectories: [targetDirectory],
      },
      env,
    )

    const targets = await harness.service.listTargets(targetPath)
    expect(targets.map((target) => target.targetId)).toEqual(['github-desktop', 'file-explorer'])
    // 文件目标归一化为其所在目录
    await harness.service.openPathWithTarget(targetPath, 'github-desktop')
    // 目录目标直接传目录
    await harness.service.openPathWithTarget(targetDirectory, 'github-desktop')
    expect(harness.launches).toEqual([
      { executablePath: githubExe, args: [targetDirectory] },
      { executablePath: githubExe, args: [targetDirectory] },
    ])
  })

  test('wt.exe 存在时显示 Terminal 且使用 -d，不存在时隐藏', async () => {
    const windowsApps = join('C:\\Users\\test\\AppData\\Local', 'Microsoft', 'WindowsApps')
    const wtExe = join(windowsApps, 'wt.exe')
    const env = { ...WIN32_ENV, PATH: 'C:\\Windows\\system32' }
    const harness = createService(
      {
        installedPaths: [wtExe],
        installedDirectories: [targetDirectory],
      },
      env,
    )

    const targets = await harness.service.listTargets(targetPath)
    expect(targets.map((target) => target.targetId)).toEqual(['file-explorer', 'terminal'])
    await harness.service.openPathWithTarget(targetPath, 'terminal')
    await harness.service.openPathWithTarget(targetDirectory, 'terminal')
    expect(harness.launches).toEqual([
      { executablePath: wtExe, args: ['-d', targetDirectory] },
      { executablePath: wtExe, args: ['-d', targetDirectory] },
    ])

    const withoutTerminal = createService({}, env)
    const hiddenTargets = await withoutTerminal.service.listTargets(targetPath)
    expect(hiddenTargets.some((target) => target.targetId === 'terminal')).toBe(false)
  })

  test('File Explorer 永远存在：文件执行 reveal，目录执行 open', async () => {
    const harness = createService({
      installedDirectories: [targetDirectory],
    })
    const targets = await harness.service.listTargets(targetPath)
    expect(targets.map((target) => target.targetId)).toEqual(['file-explorer'])
    expect(targets[0]).toEqual({
      targetId: 'file-explorer',
      label: 'File Explorer',
      kind: 'file-explorer',
    })

    await harness.service.openPathWithTarget(targetPath, 'file-explorer')
    await harness.service.openPathWithTarget(targetDirectory, 'file-explorer')
    expect(harness.revealed).toEqual([targetPath])
    expect(harness.opened).toEqual([targetDirectory])
  })

  test('返回列表不包含 default-app，顺序稳定且没有重复 target ID', async () => {
    const vscodeRoot = 'C:\\Software\\Microsoft VS Code'
    const ideaBin = 'C:\\Software\\JetBrains\\IntelliJ IDEA 2024.3.7\\bin'
    const githubRoot = 'C:\\Users\\test\\AppData\\Local\\GitHubDesktop'
    const windowsApps = join('C:\\Users\\test\\AppData\\Local', 'Microsoft', 'WindowsApps')
    const env = {
      ...WIN32_ENV,
      PATH: [join(vscodeRoot, 'bin'), ideaBin, join(githubRoot, 'bin'), windowsApps].join(';'),
    }
    const installed = [
      join(vscodeRoot, 'bin', 'code.cmd'),
      join(vscodeRoot, 'Code.exe'),
      join('C:\\Program Files', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
      join('C:\\Program Files', 'Cursor', 'Cursor.exe'),
      join('C:\\Program Files', 'Windsurf', 'Windsurf.exe'),
      join(githubRoot, 'bin', 'github.bat'),
      join(githubRoot, 'GitHubDesktop.exe'),
      join(windowsApps, 'wt.exe'),
      join(ideaBin, 'idea64.exe'),
    ]
    const harness = createService({ installedPaths: installed }, env)
    const targets = await harness.service.listTargets(targetPath)

    expect(targets.map((target) => target.targetId)).toEqual([
      'vscode',
      'vscode-insiders',
      'cursor',
      'windsurf',
      'github-desktop',
      'file-explorer',
      'terminal',
      'intellij',
    ])
    expect(new Set(targets.map((target) => target.targetId)).size).toBe(targets.length)
    expect(targets.some((target) => target.targetId === 'default-app')).toBe(false)
  })

  test('不支持或不存在的 target ID 安全报错，不回退到系统默认应用', async () => {
    const harness = createService({
      installedPaths: [join('C:\\Software\\Microsoft VS Code', 'Code.exe')],
    })
    await expect(harness.service.openPathWithTarget(targetPath, 'C:\\malware.exe')).rejects.toThrow(
      '不支持或未安装',
    )
    await expect(harness.service.openPathWithTarget(targetPath, 'default-app')).rejects.toThrow(
      '不支持或未安装',
    )
    await expect(harness.service.openPathWithTarget(targetPath, '')).rejects.toThrow(
      '外部打开目标无效',
    )
    expect(harness.launches).toEqual([])
  })

  test('拒绝相对路径', async () => {
    const harness = createService()
    await expect(harness.service.listTargets('relative.txt')).rejects.toThrow('只允许打开绝对路径')
    await expect(
      harness.service.openPathWithTarget('relative.txt', 'file-explorer'),
    ).rejects.toThrow('只允许打开绝对路径')
    expect(() => harness.service.revealPathInFolder('relative.txt')).toThrow('只允许打开绝对路径')
  })
})
