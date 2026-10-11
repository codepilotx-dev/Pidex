import { readFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const rendererRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/*
 * Browser harnesses inject the global stylesheet by hand, so they must declare
 * the same cascade layer order as the real entrypoint before loading any block.
 */
export const CASCADE_LAYER_ORDER =
  '@layer theme, vendor, reset, tokens, primitives, shell, features, utilities, overrides;'

export const NATIVE_STYLE_FILES = [
  'src/styles/base.css',
  'src/styles/design-system/tokens.css',
  'src/styles/design-system/codex-semantic-tokens.css',
] as const

export function rendererPath(...segments: string[]): string {
  return resolve(rendererRoot, ...segments)
}

/** Reset and design tokens are plain CSS and are read verbatim. */
export async function readNativeStyles(): Promise<string> {
  const sources = await Promise.all(
    NATIVE_STYLE_FILES.map((path) => readFile(rendererPath(path), 'utf8')),
  )
  return sources.join('\n')
}

/**
 * The real entrypoint, compiled through Vite with the Tailwind plugin, so a
 * harness styles `<button class="tw:...">` exactly like the app does. There is no
 * Sass left in the renderer, so this is the whole stylesheet.
 */
export async function compileEntryStyles(): Promise<string> {
  const [{ build }, tailwindcss] = await Promise.all([
    import('vite'),
    import('@tailwindcss/vite').then((module) => module.default),
  ])
  const result = await build({
    root: rendererRoot,
    configFile: false,
    logLevel: 'silent',
    plugins: [tailwindcss()],
    build: {
      write: false,
      rollupOptions: { input: rendererPath('src/styles/tailwind.css') },
    },
  })
  for (const bundle of Array.isArray(result) ? result : [result]) {
    for (const item of bundle.output ?? []) {
      if (item.type === 'asset' && item.fileName.endsWith('.css')) return String(item.source)
    }
  }
  throw new Error('the Tailwind entrypoint produced no CSS asset')
}
