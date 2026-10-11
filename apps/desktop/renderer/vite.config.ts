import { defineConfig, type Plugin, type ProxyOptions, type ServerOptions } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { gzipSync } from 'node:zlib'

// Report the static entry graph and each /new interactive surface without size
// limits: complete functionality and visual effects take priority over bundle size.
// Raw JS reflects desktop loading because Bun.file has no Content-Encoding;
// gzip remains an informational comparison. Existing dynamic isolation is unchanged.
const rootPackage = JSON.parse(
  readFileSync(resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8'),
) as { version: string }

const RENDERER_SRC_ROOT = resolve(__dirname, 'src')

// The startup splash in index.html reuses the Electron brand mark directly
// from apps/desktop/build; emit it into the renderer output without keeping a
// second copy of the icon in this workspace.
const BRAND_MARK_PATH = resolve(__dirname, '..', 'build', 'pidex-mark-green.svg')
const BRAND_MARK_URL = '/pidex-mark-green.svg'

const LOOPBACK_AGENT_ORIGIN_PATTERN = /^http:\/\/127\.0\.0\.1:([0-9]{1,5})$/
const AUTH_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,4096}$/

type RendererDevEnvironment = Readonly<Record<string, string | undefined>>

function parsePort(value: string | undefined, name: string): number | undefined {
  if (value === undefined || value === '') return undefined
  if (!/^[0-9]{1,5}$/.test(value)) {
    throw new Error(`${name} 必须是有效的回环端口`)
  }
  const port = Number(value)
  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error(`${name} 必须是有效的回环端口`)
  }
  return port
}

export function normalizeRendererAgentOrigin(value: string): string {
  const match = LOOPBACK_AGENT_ORIGIN_PATTERN.exec(value)
  if (!match || parsePort(match[1], 'PIDEX_AGENT_URL') === undefined) {
    throw new Error('PIDEX_AGENT_URL 必须是带有效端口的 127.0.0.1 HTTP origin')
  }
  return value
}

function createAuthenticatedProxy(target: string, authToken: string): ProxyOptions {
  return {
    target,
    changeOrigin: false,
    configure(proxy) {
      proxy.on('proxyReq', (proxyRequest) => {
        proxyRequest.setHeader('Authorization', `Bearer ${authToken}`)
      })
    },
  }
}

export function resolveRendererDevServer(
  mode: string,
  environment: RendererDevEnvironment = process.env,
): Pick<ServerOptions, 'port' | 'hmr' | 'proxy'> {
  const port = parsePort(environment.PIDEX_RENDERER_PORT, 'PIDEX_RENDERER_PORT')
  const agentOrigin = environment.PIDEX_AGENT_URL
  const authToken = environment.PIDEX_AUTH_TOKEN
  if ((agentOrigin === undefined) !== (authToken === undefined)) {
    throw new Error('开发 Agent origin 与认证令牌必须同时提供')
  }

  let proxy: ServerOptions['proxy']
  if (agentOrigin !== undefined && authToken !== undefined) {
    const target = normalizeRendererAgentOrigin(agentOrigin)
    if (!AUTH_TOKEN_PATTERN.test(authToken)) {
      throw new Error('开发 Agent 认证令牌无效')
    }
    proxy = {
      '/rpc': createAuthenticatedProxy(target, authToken),
      '/api': createAuthenticatedProxy(target, authToken),
    }
  }

  return {
    port,
    hmr:
      mode === 'performance'
        ? false
        : mode === 'visual'
          ? undefined
          : port === undefined
            ? {
                protocol: 'ws',
                host: '127.0.0.1',
              }
            : {
                protocol: 'ws',
                host: '127.0.0.1',
                port,
                clientPort: port,
              },
    proxy,
  }
}

export function resolveRendererServerOverrides(
  command: 'build' | 'serve',
  mode: string,
  environment: RendererDevEnvironment = process.env,
): Pick<ServerOptions, 'port' | 'hmr' | 'proxy'> | Record<string, never> {
  return command === 'serve' ? resolveRendererDevServer(mode, environment) : {}
}

function startupSplashAssets(): Plugin {
  return {
    name: 'pidex-startup-splash-assets',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url !== BRAND_MARK_URL) return next()
        res.setHeader('Content-Type', 'image/svg+xml')
        res.end(readFileSync(BRAND_MARK_PATH))
      })
    },
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'pidex-mark-green.svg',
        source: readFileSync(BRAND_MARK_PATH),
      })
    },
  }
}

// Module manifests of the three /new interactive first screens. Every listed
// module must be part of the build output; the build fails otherwise so the
// manifests cannot silently drift from the source tree.
const NEW_SURFACE_COMMON_MODULES = [
  'features/layout/shell/DesktopLayout.tsx',
  'features/session/QuickChatView.tsx',
  'features/session/composer/DesktopComposer.tsx',
  'features/session/composer/ComposerEditor.tsx',
] as const

const NEW_SURFACE_MODULES: Record<string, readonly string[]> = {
  coding: [...NEW_SURFACE_COMMON_MODULES, 'features/session/CodingHeadingTransition.tsx'],
  working: NEW_SURFACE_COMMON_MODULES,
  chat: NEW_SURFACE_COMMON_MODULES,
}

type BundleChunk = {
  fileName: string
  isEntry: boolean
  code: string
  imports: string[]
  modules: Record<string, { renderedLength: number }>
  viteMetadata?: { importedCss?: string[] }
}

function normalizeSlashes(path: string): string {
  return path.replaceAll('\\', '/')
}

function normalizeModuleId(moduleId: string): string {
  return normalizeSlashes(moduleId.split('?', 1)[0] ?? moduleId)
}

/** Collect the static graph reachable from the given chunks via `chunk.imports`. */
function collectStaticGraph(
  chunks: Map<string, BundleChunk>,
  rootFileNames: Iterable<string>,
): Set<string> {
  const visited = new Set<string>()
  const visit = (fileName: string): void => {
    if (visited.has(fileName)) return
    const chunk = chunks.get(fileName)
    if (!chunk) return
    visited.add(fileName)
    for (const imported of chunk.imports) visit(imported)
  }
  for (const fileName of rootFileNames) visit(fileName)
  return visited
}

/** Locate chunks that contain any of the normalized absolute source paths. */
function findChunksContainingModules(
  chunks: Map<string, BundleChunk>,
  sourceModulePaths: readonly string[],
): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()
  const targets = new Set(sourceModulePaths.map(normalizeSlashes))
  for (const [fileName, chunk] of chunks) {
    const hit = new Set<string>()
    for (const moduleId of Object.keys(chunk.modules)) {
      const normalized = normalizeModuleId(moduleId)
      if (targets.has(normalized)) hit.add(normalized)
    }
    if (hit.size > 0) found.set(fileName, hit)
  }
  return found
}

function measureGraph(
  chunks: Map<string, BundleChunk>,
  fileNames: Iterable<string>,
): { rawBytes: number; gzipBytes: number } {
  let rawBytes = 0
  let gzipBytes = 0
  for (const fileName of fileNames) {
    const chunk = chunks.get(fileName)
    const code = chunk?.code ?? ''
    rawBytes += Buffer.byteLength(code)
    gzipBytes += gzipSync(code).byteLength
  }
  return { rawBytes, gzipBytes }
}

function collectCssFiles(
  chunks: Map<string, BundleChunk>,
  fileNames: Iterable<string>,
): Set<string> {
  const cssFiles = new Set<string>()
  for (const fileName of fileNames) {
    for (const cssFile of chunks.get(fileName)?.viteMetadata?.importedCss ?? []) {
      cssFiles.add(cssFile)
    }
  }
  return cssFiles
}

function assetByteLength(asset: { type?: string; source?: unknown } | undefined): number {
  if (!asset || asset.type !== 'asset') return 0
  if (typeof asset.source === 'string') return Buffer.byteLength(asset.source)
  return asset.source instanceof Uint8Array ? asset.source.byteLength : 0
}

function measureCssAssets(
  assets: Record<string, { type?: string; source?: unknown }>,
  cssFiles: Iterable<string>,
): number {
  let total = 0
  for (const fileName of cssFiles) total += assetByteLength(assets[fileName])
  return total
}

function formatKib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function routeBundleReport(): Plugin {
  return {
    name: 'pidex-route-bundle-report',
    generateBundle(_options, bundle) {
      const chunks = new Map<string, BundleChunk>()
      for (const item of Object.values(bundle)) {
        if (item.type !== 'chunk') continue
        chunks.set(item.fileName, item as unknown as BundleChunk)
      }
      const entries = [...chunks.values()].filter((chunk) => chunk.isEntry)

      // Layer one: the static entry shell graph.
      const entryGraph = collectStaticGraph(
        chunks,
        entries.map((chunk) => chunk.fileName),
      )
      const entryMeasure = measureGraph(chunks, entryGraph)

      // Layer two: each /new surface interactive graph, rooted at the chunks
      // containing its manifest modules.
      const surfaceMeasures = new Map<
        string,
        {
          rawBytes: number
          gzipBytes: number
        }
      >()
      const surfaceGraphs = new Set<string>()
      for (const [surface, modules] of Object.entries(NEW_SURFACE_MODULES)) {
        const absolutePaths = modules.map((module) =>
          normalizeSlashes(resolve(RENDERER_SRC_ROOT, module)),
        )
        const found = findChunksContainingModules(chunks, absolutePaths)
        const missingModules = absolutePaths.filter(
          (path) => ![...found.values()].some((hits) => hits.has(path)),
        )
        if (missingModules.length > 0) {
          this.error(
            `Surface "${surface}" manifest modules missing from the build: ${missingModules.join(', ')}`,
          )
          continue
        }
        const graph = collectStaticGraph(chunks, [...entryGraph, ...found.keys()])
        surfaceMeasures.set(surface, measureGraph(chunks, graph))
        for (const fileName of graph) surfaceGraphs.add(fileName)
      }

      const entryCssFiles = collectCssFiles(chunks, entryGraph)
      const interactiveCssFiles = collectCssFiles(chunks, surfaceGraphs)
      const entryCssRawBytes = measureCssAssets(bundle, entryCssFiles)
      const newInteractiveCssRawBytes = measureCssAssets(bundle, interactiveCssFiles)
      const largestAsyncCss = Object.entries(bundle)
        .filter(
          ([fileName, asset]) =>
            fileName.endsWith('.css') && !entryCssFiles.has(fileName) && asset.type === 'asset',
        )
        .map(([fileName, asset]) => ({
          fileName,
          rawBytes: assetByteLength(asset),
        }))
        .sort((left, right) => right.rawBytes - left.rawBytes)[0]

      const largestChunk = [...chunks.values()]
        .map((chunk: any) => ({
          fileName: chunk.fileName,
          rawBytes: Buffer.byteLength(chunk.code),
          gzipBytes: gzipSync(chunk.code).byteLength,
        }))
        .sort((left, right) => right.rawBytes - left.rawBytes)[0]
      const largestImmediateModules = [...entryGraph]
        .flatMap((fileName) => {
          const chunk = chunks.get(fileName)
          return Object.entries(chunk?.modules ?? {}).map(([id, details]: [string, any]) => ({
            id,
            renderedLength: details.renderedLength as number,
          }))
        })
        .sort((left, right) => right.renderedLength - left.renderedLength)
        .slice(0, 10)

      this.info(
        `Renderer entry static JS: ${(entryMeasure.rawBytes / 1024).toFixed(1)} KiB raw / ${(entryMeasure.gzipBytes / 1024).toFixed(1)} KiB gzip`,
      )
      for (const [surface, measure] of surfaceMeasures) {
        this.info(
          `/new?surface=${surface} interactive JS: ${(measure.rawBytes / 1024).toFixed(1)} KiB raw / ${(measure.gzipBytes / 1024).toFixed(1)} KiB gzip (+${((measure.rawBytes - entryMeasure.rawBytes) / 1024).toFixed(1)} KiB raw vs entry)`,
        )
      }
      this.info(`CSS entry: ${formatKib(entryCssRawBytes)} raw (${entryCssRawBytes} bytes)`)
      this.info(
        `CSS /new interactive union: ${formatKib(newInteractiveCssRawBytes)} raw (${newInteractiveCssRawBytes} bytes)`,
      )
      if (largestAsyncCss) {
        this.info(
          `Largest async CSS chunk: ${largestAsyncCss.fileName} (${formatKib(largestAsyncCss.rawBytes)} raw)`,
        )
      }
      if (largestChunk) {
        this.info(
          `Largest JS chunk: ${largestChunk.fileName} (${(largestChunk.rawBytes / 1024).toFixed(1)} KiB raw / ${(largestChunk.gzipBytes / 1024).toFixed(1)} KiB gzip)`,
        )
      }
      this.info(
        `/new largest modules: ${largestImmediateModules.map((module) => `${module.id.replaceAll('\\', '/').split('/node_modules/').at(-1)} (${(module.renderedLength / 1024).toFixed(1)} KiB)`).join(', ')}`,
      )
    },
  }
}

export default defineConfig(({ command, mode }) => ({
  plugins: [tailwindcss(), react(), routeBundleReport(), startupSplashAssets()],
  define: {
    __PIDEX_VERSION__: JSON.stringify(rootPackage.version),
  },
  resolve: {
    alias: {
      '@pidex/core': resolve(__dirname, 'src/shims/core'),
    },
    dedupe: ['react', 'react-dom'],
  },
  optimizeDeps: {
    include: ['cmdk'],
  },
  build: {
    outDir: '../../../dist/renderer',
    emptyOutDir: true,
  },
  server: {
    fs: {
      allow: [resolve(__dirname), resolve(__dirname, '..', 'build')],
    },
    strictPort: true,
    ...resolveRendererServerOverrides(command, mode),
  },
}))
