import { execFile as execFileCallback } from 'node:child_process'
import { access, readdir, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join } from 'node:path'
import { promisify } from 'node:util'

export type ExternalOpenTargetKind = 'editor' | 'file-explorer' | 'terminal'

export type ExternalOpenTarget = {
  targetId: string
  label: string
  kind: ExternalOpenTargetKind
}

type SpawnOptions = {
  detached: true
  shell: false
  stdio: 'ignore'
  windowsHide: true
}

type ExecFileResult = {
  stdout: string
  stderr: string
}

export type ExternalOpenTargetDependencies = {
  platform: NodeJS.Platform
  env: NodeJS.ProcessEnv
  fileExists?: (path: string) => Promise<boolean>
  isDirectory?: (path: string) => Promise<boolean>
  readDirectory?: (path: string) => Promise<string[]>
  execFile?: (
    file: string,
    args: readonly string[],
    options: { windowsHide: true },
  ) => Promise<ExecFileResult>
  openPath: (path: string) => Promise<string>
  revealPath: (path: string) => void
  spawnProcess: (
    executablePath: string,
    args: readonly string[],
    options: SpawnOptions,
  ) => { unref(): void }
}

type DetectionContext = {
  env: NodeJS.ProcessEnv
  isWindows: boolean
  fileExists: (path: string) => Promise<boolean>
  isDirectory: (path: string) => Promise<boolean>
  readDirectory: (path: string) => Promise<string[]>
  execFile: (
    file: string,
    args: readonly string[],
    options: { windowsHide: true },
  ) => Promise<ExecFileResult>
}

/** `{}` 表示已安装但无可启动可执行文件（如 File Explorer），`null` 表示未安装。 */
type ResolvedExecutable = {
  executablePath?: string
}

type OpenTargetDefinition = {
  targetId: string
  label: string
  kind: ExternalOpenTargetKind
  resolve: (context: DetectionContext) => Promise<ResolvedExecutable | null>
  launch: (
    targetPath: string,
    executablePath: string | undefined,
    deps: LaunchDependencies,
  ) => Promise<void>
}

type LaunchDependencies = {
  isDirectory: (path: string) => Promise<boolean>
  openPath: (path: string) => Promise<string>
  revealPath: (path: string) => void
  spawnProcess: ExternalOpenTargetDependencies['spawnProcess']
}

type InstalledTarget = ExternalOpenTarget & {
  executablePath?: string
  launch: (targetPath: string) => Promise<void>
}

type PathAppSpec = {
  pathNames: readonly string[]
  standardDirs: (env: NodeJS.ProcessEnv) => readonly string[]
  /** 把 PATH 中命中的 wrapper 脚本映射为真实可执行文件；非 wrapper 返回 null。 */
  wrapperToExecutable?: (path: string) => string | null
}

const VSCODE_SPEC: PathAppSpec = {
  pathNames: ['code.cmd', 'code', 'Code.exe'],
  wrapperToExecutable: (path) =>
    /[\\/]bin[\\/]code\.cmd$/i.test(path) ? join(dirname(dirname(path)), 'Code.exe') : null,
  standardDirs: (env) =>
    compactPaths([
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code', 'Code.exe'),
      env.ProgramFiles && join(env.ProgramFiles, 'Microsoft VS Code', 'Code.exe'),
      env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Microsoft VS Code', 'Code.exe'),
    ]),
}

const VSCODE_INSIDERS_SPEC: PathAppSpec = {
  pathNames: ['code-insiders.cmd', 'code-insiders', 'Code - Insiders.exe'],
  wrapperToExecutable: (path) =>
    /[\\/]bin[\\/]code-insiders\.cmd$/i.test(path)
      ? join(dirname(dirname(path)), 'Code - Insiders.exe')
      : null,
  standardDirs: (env) =>
    compactPaths([
      env.LOCALAPPDATA &&
        join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
      env.ProgramFiles &&
        join(env.ProgramFiles, 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
      env['ProgramFiles(x86)'] &&
        join(env['ProgramFiles(x86)'], 'Microsoft VS Code Insiders', 'Code - Insiders.exe'),
    ]),
}

const CURSOR_SPEC: PathAppSpec = {
  pathNames: ['cursor', 'Cursor.exe'],
  standardDirs: (env) =>
    compactPaths([
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'cursor', 'Cursor.exe'),
      env.ProgramFiles && join(env.ProgramFiles, 'Cursor', 'Cursor.exe'),
      env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Cursor', 'Cursor.exe'),
    ]),
}

const WINDSURF_SPEC: PathAppSpec = {
  pathNames: ['windsurf', 'Windsurf.exe'],
  standardDirs: (env) =>
    compactPaths([
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs', 'Windsurf', 'Windsurf.exe'),
      env.ProgramFiles && join(env.ProgramFiles, 'Windsurf', 'Windsurf.exe'),
      env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'Windsurf', 'Windsurf.exe'),
    ]),
}

const GITHUB_DESKTOP_SPEC: PathAppSpec = {
  pathNames: ['github.bat', 'github', 'GitHubDesktop.exe'],
  wrapperToExecutable: (path) =>
    /[\\/]bin[\\/]github\.bat$/i.test(path)
      ? join(dirname(dirname(path)), 'GitHubDesktop.exe')
      : null,
  standardDirs: (env) =>
    compactPaths([
      env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'GitHubDesktop', 'GitHubDesktop.exe'),
    ]),
}

export class ExternalOpenTargetService {
  readonly #dependencies: ExternalOpenTargetDependencies
  readonly #fileExists: (path: string) => Promise<boolean>
  readonly #isDirectory: (path: string) => Promise<boolean>
  readonly #readDirectory: (path: string) => Promise<string[]>
  readonly #execFile: (
    file: string,
    args: readonly string[],
    options: { windowsHide: true },
  ) => Promise<ExecFileResult>

  constructor(dependencies: ExternalOpenTargetDependencies) {
    this.#dependencies = dependencies
    this.#fileExists = dependencies.fileExists ?? fileExists
    this.#isDirectory = dependencies.isDirectory ?? isDirectory
    this.#readDirectory = dependencies.readDirectory ?? readDirectory
    this.#execFile = dependencies.execFile ?? execFile
  }

  async listTargets(targetPath: string): Promise<ExternalOpenTarget[]> {
    assertAbsolutePath(targetPath)
    const targets = await this.#installedTargets()
    return targets.map(({ executablePath: _, launch: __, ...target }) => target)
  }

  async openPathWithTarget(targetPath: string, targetId: string): Promise<void> {
    assertAbsolutePath(targetPath)
    if (typeof targetId !== 'string' || !targetId) {
      throw new Error('外部打开目标无效')
    }
    const target = (await this.#installedTargets()).find((item) => item.targetId === targetId)
    if (!target) {
      throw new Error(`不支持或未安装的外部打开目标：${targetId}`)
    }
    await target.launch(targetPath)
  }

  revealPathInFolder(targetPath: string): void {
    assertAbsolutePath(targetPath)
    this.#dependencies.revealPath(targetPath)
  }

  async #installedTargets(): Promise<InstalledTarget[]> {
    const context = this.#context()
    const launchDeps: LaunchDependencies = {
      isDirectory: this.#isDirectory,
      openPath: this.#dependencies.openPath,
      revealPath: this.#dependencies.revealPath,
      spawnProcess: this.#dependencies.spawnProcess,
    }
    const targets = await Promise.all(
      this.#definitions().map(async (definition) => {
        const resolved = await definition.resolve(context).catch(() => null)
        if (!resolved) return null
        return {
          targetId: definition.targetId,
          label: definition.label,
          kind: definition.kind,
          ...(resolved.executablePath ? { executablePath: resolved.executablePath } : {}),
          launch: (targetPath: string) =>
            definition.launch(targetPath, resolved.executablePath, launchDeps),
        }
      }),
    )
    return targets.flatMap((target) => (target === null ? [] : [target]))
  }

  #context(): DetectionContext {
    return {
      env: this.#dependencies.env,
      isWindows: this.#dependencies.platform === 'win32',
      fileExists: this.#fileExists,
      isDirectory: this.#isDirectory,
      readDirectory: this.#readDirectory,
      execFile: this.#execFile,
    }
  }

  #definitions(): readonly OpenTargetDefinition[] {
    const launchDeps: LaunchDependencies = {
      isDirectory: this.#isDirectory,
      openPath: this.#dependencies.openPath,
      revealPath: this.#dependencies.revealPath,
      spawnProcess: this.#dependencies.spawnProcess,
    }
    const launchPath = (targetPath: string, executablePath: string | undefined): Promise<void> =>
      launchPathTarget(targetPath, executablePath, launchDeps)
    const launchDirectory = (
      targetPath: string,
      executablePath: string | undefined,
    ): Promise<void> => launchDirectoryTarget(targetPath, executablePath, launchDeps)
    return [
      {
        targetId: 'vscode',
        label: 'Visual Studio Code',
        kind: 'editor',
        resolve: (context) => resolvePathEditor(context, VSCODE_SPEC),
        launch: launchPath,
      },
      {
        targetId: 'vscode-insiders',
        label: 'Visual Studio Code Insiders',
        kind: 'editor',
        resolve: (context) => resolvePathEditor(context, VSCODE_INSIDERS_SPEC),
        launch: launchPath,
      },
      {
        targetId: 'visual-studio',
        label: 'Visual Studio',
        kind: 'editor',
        resolve: resolveVisualStudio,
        launch: launchPath,
      },
      {
        targetId: 'cursor',
        label: 'Cursor',
        kind: 'editor',
        resolve: (context) => resolvePathEditor(context, CURSOR_SPEC),
        launch: launchPath,
      },
      {
        targetId: 'windsurf',
        label: 'Windsurf',
        kind: 'editor',
        resolve: (context) => resolvePathEditor(context, WINDSURF_SPEC),
        launch: launchPath,
      },
      {
        targetId: 'github-desktop',
        label: 'GitHub Desktop',
        kind: 'editor',
        resolve: (context) => resolvePathEditor(context, GITHUB_DESKTOP_SPEC),
        launch: launchDirectory,
      },
      {
        targetId: 'file-explorer',
        label: 'File Explorer',
        kind: 'file-explorer',
        resolve: async (context) => (context.isWindows ? {} : null),
        launch: launchExplorerTarget,
      },
      {
        targetId: 'terminal',
        label: 'Windows Terminal',
        kind: 'terminal',
        resolve: resolveWindowsTerminal,
        launch: launchTerminalTarget,
      },
      {
        targetId: 'intellij',
        label: 'IntelliJ IDEA',
        kind: 'editor',
        resolve: resolveIntellij,
        launch: launchPath,
      },
    ]
  }
}

async function resolvePathEditor(
  context: DetectionContext,
  spec: PathAppSpec,
): Promise<ResolvedExecutable | null> {
  const fromPath = await findFirstInPath(context, spec.pathNames)
  if (fromPath) {
    const executable = spec.wrapperToExecutable?.(fromPath) ?? fromPath
    if (await context.fileExists(executable)) return { executablePath: executable }
    // wrapper 无法映射时不通过脚本启动，继续检查标准目录
  }
  const standard = await firstExistingPath(spec.standardDirs(context.env), context.fileExists)
  return standard ? { executablePath: standard } : null
}

async function resolveVisualStudio(context: DetectionContext): Promise<ResolvedExecutable | null> {
  if (!context.isWindows) return null
  const vswhere =
    context.env['ProgramFiles(x86)'] &&
    join(context.env['ProgramFiles(x86)'], 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!vswhere || !(await context.fileExists(vswhere))) return null
  try {
    const { stdout } = await context.execFile(
      vswhere,
      ['-latest', '-products', '*', '-property', 'productPath'],
      { windowsHide: true },
    )
    const productPath = stdout.trim().split(/\r?\n/)[0]?.trim() ?? ''
    if (!productPath || !isAbsolute(productPath) || !/devenv\.exe$/i.test(productPath)) {
      return null
    }
    if (!(await context.fileExists(productPath))) return null
    return { executablePath: productPath }
  } catch {
    return null
  }
}

async function resolveWindowsTerminal(
  context: DetectionContext,
): Promise<ResolvedExecutable | null> {
  if (!context.isWindows) return null
  const fromPath = await findFirstInPath(context, ['wt.exe', 'wt'])
  if (fromPath) return { executablePath: fromPath }
  const alias =
    context.env.LOCALAPPDATA && join(context.env.LOCALAPPDATA, 'Microsoft', 'WindowsApps', 'wt.exe')
  if (alias && (await context.fileExists(alias))) return { executablePath: alias }
  return null
}

async function resolveIntellij(context: DetectionContext): Promise<ResolvedExecutable | null> {
  const fromPath = await findFirstInPath(context, ['idea64.exe', 'idea.exe', 'idea.bat'])
  if (fromPath) {
    if (/[\\/]bin[\\/]idea\.bat$/i.test(fromPath)) {
      const executable = join(dirname(fromPath), 'idea64.exe')
      if (await context.fileExists(executable)) return { executablePath: executable }
      return null
    }
    return { executablePath: fromPath }
  }
  const toolboxApps =
    context.env.LOCALAPPDATA && join(context.env.LOCALAPPDATA, 'JetBrains', 'Toolbox', 'apps')
  if (toolboxApps) {
    const fromToolbox = await findToolboxIdeaExecutable(toolboxApps, context)
    if (fromToolbox) return { executablePath: fromToolbox }
  }
  for (const root of jetbrainsInstallRoots(context.env)) {
    const found = await findJetBrainsExecutable(root, context)
    if (found) return { executablePath: found }
  }
  return null
}

async function findToolboxIdeaExecutable(
  root: string,
  context: DetectionContext,
): Promise<string | null> {
  let products: string[]
  try {
    products = await context.readDirectory(root)
  } catch {
    return null
  }
  for (const product of products) {
    if (!/^IDEA-/i.test(product) && !/^IntelliJ IDEA/i.test(product)) continue
    const productRoot = join(root, product)
    let channels: string[]
    try {
      channels = await context.readDirectory(productRoot)
    } catch {
      continue
    }
    for (const channel of channels) {
      const channelRoot = join(productRoot, channel)
      let builds: string[]
      try {
        builds = await context.readDirectory(channelRoot)
      } catch {
        continue
      }
      for (const build of builds) {
        const executable = join(channelRoot, build, 'bin', 'idea64.exe')
        if (await context.fileExists(executable)) return executable
      }
    }
  }
  return null
}

async function findJetBrainsExecutable(
  root: string,
  context: DetectionContext,
): Promise<string | null> {
  let entries: string[]
  try {
    entries = await context.readDirectory(root)
  } catch {
    return null
  }
  for (const entry of entries) {
    if (!/idea/i.test(entry)) continue
    const executable = join(root, entry, 'bin', 'idea64.exe')
    if (await context.fileExists(executable)) return executable
  }
  return null
}

const jetbrainsInstallRoots = (env: NodeJS.ProcessEnv): readonly string[] =>
  compactPaths([
    env.ProgramFiles && join(env.ProgramFiles, 'JetBrains'),
    env['ProgramFiles(x86)'] && join(env['ProgramFiles(x86)'], 'JetBrains'),
    env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'JetBrains'),
  ])

async function launchPathTarget(
  targetPath: string,
  executablePath: string | undefined,
  deps: LaunchDependencies,
): Promise<void> {
  if (!executablePath) throw new Error('外部打开目标缺少可执行文件')
  spawnDetached(deps, executablePath, [targetPath])
}

async function launchDirectoryTarget(
  targetPath: string,
  executablePath: string | undefined,
  deps: LaunchDependencies,
): Promise<void> {
  if (!executablePath) throw new Error('外部打开目标缺少可执行文件')
  spawnDetached(deps, executablePath, [await targetDirectory(targetPath, deps)])
}

async function launchTerminalTarget(
  targetPath: string,
  executablePath: string | undefined,
  deps: LaunchDependencies,
): Promise<void> {
  if (!executablePath) throw new Error('外部打开目标缺少可执行文件')
  spawnDetached(deps, executablePath, ['-d', await targetDirectory(targetPath, deps)])
}

async function launchExplorerTarget(
  targetPath: string,
  _executablePath: string | undefined,
  deps: LaunchDependencies,
): Promise<void> {
  if (await deps.isDirectory(targetPath)) {
    await deps.openPath(targetPath)
  } else {
    deps.revealPath(targetPath)
  }
}

const SPAWN_OPTIONS: SpawnOptions = {
  detached: true,
  shell: false,
  stdio: 'ignore',
  windowsHide: true,
}

function spawnDetached(
  deps: LaunchDependencies,
  executablePath: string,
  args: readonly string[],
): void {
  const child = deps.spawnProcess(executablePath, args, SPAWN_OPTIONS)
  child.unref()
}

async function targetDirectory(targetPath: string, deps: LaunchDependencies): Promise<string> {
  return (await deps.isDirectory(targetPath)) ? targetPath : dirname(targetPath)
}

const PATH_EXTENSIONS = ['.exe', '.cmd', '.bat']

async function findFirstInPath(
  context: DetectionContext,
  names: readonly string[],
): Promise<string | null> {
  for (const directory of pathDirectories(context.env)) {
    for (const name of names) {
      const candidates =
        context.isWindows && !/\./u.test(name)
          ? [name, ...PATH_EXTENSIONS.map((extension) => `${name}${extension}`)]
          : [name]
      for (const candidate of candidates) {
        const path = join(directory, candidate)
        if (await context.fileExists(path)) return path
      }
    }
  }
  return null
}

const pathDirectories = (env: NodeJS.ProcessEnv): string[] => {
  const value = env.PATH ?? env.Path ?? ''
  const separator = value.includes(';') ? ';' : ':'
  return value
    .split(separator)
    .map((part) => part.trim())
    .filter(Boolean)
}

const fileExists = async (path: string): Promise<boolean> =>
  access(path).then(
    () => true,
    () => false,
  )

const isDirectory = async (path: string): Promise<boolean> =>
  stat(path).then(
    (info) => info.isDirectory(),
    () => false,
  )

const readDirectory = async (path: string): Promise<string[]> => readdir(path).catch(() => [])

const execFile = promisify(execFileCallback) as (
  file: string,
  args: readonly string[],
  options: { windowsHide: true },
) => Promise<ExecFileResult>

const firstExistingPath = async (
  candidates: readonly string[],
  exists: (path: string) => Promise<boolean>,
): Promise<string | undefined> => {
  for (const candidate of candidates) {
    if (await exists(candidate)) return candidate
  }
  return undefined
}

const compactPaths = (paths: Array<string | undefined>): string[] =>
  paths.filter((path): path is string => Boolean(path))

const assertAbsolutePath = (path: string): void => {
  if (typeof path !== 'string' || !path.trim() || !isAbsolute(path)) {
    throw new Error('只允许打开绝对路径')
  }
}
