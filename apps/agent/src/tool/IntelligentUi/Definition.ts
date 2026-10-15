import { createHash } from 'node:crypto'
import { z } from 'zod'
import {
  decodeVisualization,
  VISUALIZATION_MAX_SOURCE,
  VISUALIZATION_TOOL,
  type VisualizationEnvelope,
  type VisualizationLibrary,
} from '@pidex/shared/visualization'
import { AgentError } from '../../Domain'
import type { ArtifactBlobInput, ArtifactService } from '../../storage/ArtifactService'
import type { ToolDefinition } from '../ToolRegistry'

export const visualizationLibraries = {
  // shortcut: fixed UMD builds expose browser globals; upgrade this catalog when newer APIs are needed.
  chartjs: {
    url: 'https://cdn.jsdelivr.net/npm/chart.js@4.4.8/dist/chart.umd.js',
    sha256: 'e4cf4d144b222634f2e64ff707cd57b953f8de4b65b231cd5ac6bde114648e4d',
  },
  d3: {
    url: 'https://cdn.jsdelivr.net/npm/d3@7.9.0/dist/d3.min.js',
    sha256: 'f2094bbf6141b359722c4fe454eb6c4b0f0e42cc10cc7af921fc158fceb86539',
  },
  three: {
    url: 'https://cdn.jsdelivr.net/npm/three@0.158.0/build/three.min.js',
    sha256: '3b3a1c97de3ce65ec5b28c28d9f2805a738e9651622691ba771aa95c79d41d51',
  },
} as const
const source = z.string().max(VISUALIZATION_MAX_SOURCE)
export const visualizationInput = z
  .object({
    title: z.string().trim().min(1).max(200),
    summary: z.string().trim().min(1).max(4000),
    libraries: z.array(z.enum(['chartjs', 'd3', 'three'])).max(3),
    initialHeight: z.number().int().min(50).max(4000),
    css: source,
    html: source.min(1),
    jsFunctions: source,
    jsExpressions: z.array(source).max(20),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      JSON.stringify(value).length > VISUALIZATION_MAX_SOURCE ||
      new Set(value.libraries).size !== value.libraries.length
    )
      context.addIssue({ code: 'custom', message: '界面内容过大或图形库重复' })
  })

async function librarySource(
  library: VisualizationLibrary,
  artifacts: ArtifactService,
  signal: AbortSignal,
): Promise<string> {
  const entry = visualizationLibraries[library]
  const cached = await artifacts.readCachedBlob(entry.sha256)
  if (cached) return Buffer.from(cached).toString('base64')
  try {
    const response = await fetch(entry.url, {
      redirect: 'error',
      signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
    })
    if (!response.ok || !response.body) throw new Error('download failed')
    const chunks: Uint8Array[] = []
    let size = 0
    const reader = response.body.getReader()
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > 2 * 1024 * 1024) throw new Error('library too large')
        chunks.push(value)
      }
    } finally {
      await reader.cancel()
      reader.releaseLock()
    }
    const bytes = Buffer.concat(chunks)
    if (createHash('sha256').update(bytes).digest('hex') !== entry.sha256)
      throw new Error('integrity mismatch')
    return bytes.toString('base64')
  } catch {
    if (signal.aborted) throw new AgentError('TOOL_ABORTED', '界面生成已取消', 409)
    throw new AgentError(
      'TOOL_EXECUTION_FAILED',
      `图形库 ${library} 下载或校验失败，请重试或生成不依赖图形库的版本`,
      503,
    )
  }
}

export function intelligentUiDefinition(
  artifacts: ArtifactService,
): ToolDefinition<
  z.infer<typeof visualizationInput>,
  { envelope: VisualizationEnvelope; artifacts: ArtifactBlobInput[] }
> {
  return {
    sdkName: VISUALIZATION_TOOL,
    schema: visualizationInput,
    inputSchema: z.toJSONSchema(visualizationInput),
    description:
      'Generate an interactive answer directly in this chat when controls, motion, numeric comparison or spatial relationships materially improve understanding. Use plain text for simple facts. Emit fields in schema order: title, summary, libraries, initialHeight, css, html, jsFunctions, jsExpressions. Complete CSS before HTML. HTML is a body fragment; put all scripts in the JS fields. Use CSS variables --pidex-background, --pidex-foreground, --pidex-secondary, --pidex-accent and --pidex-border to follow the host theme. JS fields are classic scripts; put asynchronous initialization inside an async function. Libraries are host-loaded globals Chart, d3, THREE; never import packages, fetch URLs, load external assets or use host APIs. Prefer native HTML/SVG/Canvas for simple tools. Provide semantic labelled keyboard controls, visible focus, axes/units, a concise summary and data tables where useful. Respect reduced motion and provide pause for animation. Call Pidex.sendPrompt({text, selection}) after initialization and when controls change to prepare relevant follow-up text and selected values; this never submits automatically. The host renders the real Continue analysis button, so do not draw a second submit button. Each follow-up produces a new answer. Avoid sensitive data and unbounded datasets.',
    capabilities: {
      filesystem: 'none',
      network: 'declared',
      process: false,
      externalState: false,
      userInteraction: true,
    },
    allowedModes: ['chat', 'plan'],
    allowedProfiles: ['main', 'default'],
    approvalStrategy: 'policy',
    visibility: 'deferred',
    executionMode: 'sequential',
    available: () => artifacts.hasArtifactsTable(),
    inspectInput: (input) => ({
      authorizationScope: {
        affectedPaths: [],
        ...(input.libraries.length ? { browserOrigin: 'https://cdn.jsdelivr.net' } : {}),
        fingerprint: createHash('sha256').update(JSON.stringify(input)).digest('hex'),
        ruleRequiresApproval: false,
      },
    }),
    async execute(document, context) {
      const blobs: ArtifactBlobInput[] = []
      for (const library of document.libraries) {
        blobs.push({
          artifactId: crypto.randomUUID(),
          name: `${library}.js`,
          mimeType: 'text/javascript',
          data: await librarySource(library, artifacts, context.signal),
        })
      }
      const envelope: VisualizationEnvelope = {
        kind: 'pidex.visualization',
        version: 1,
        document,
        resources: blobs.map((blob, index) => ({
          library: document.libraries[index]!,
          artifactId: blob.artifactId,
        })),
      }
      if (!decodeVisualization(envelope))
        throw new AgentError('INVALID_TOOL_INPUT', '界面内容超过上限', 400)
      return { envelope, artifacts: blobs }
    },
    formatResult: (result) => ({
      content: result.envelope.document.summary,
      details: result.envelope,
      artifacts: result.artifacts,
    }),
    auditResult: (result) => ({
      title: result.envelope.document.title,
      libraries: result.envelope.document.libraries,
    }),
  }
}
