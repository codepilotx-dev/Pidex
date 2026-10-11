import { normalizeOrigin } from './Navigation.js'

export interface RendererApplicationOriginInput {
  agentOrigin: string
  isPackaged: boolean
  managedAgent: boolean
  rendererDevUrl: string | undefined
}

export function resolveRendererApplicationOrigin(input: RendererApplicationOriginInput): string {
  const agentOrigin = normalizeOrigin(input.agentOrigin)
  if (input.isPackaged || !input.managedAgent) return agentOrigin

  const configuredUrl = input.rendererDevUrl?.trim()
  if (!configuredUrl) return agentOrigin

  let parsed: URL
  try {
    parsed = new URL(configuredUrl)
  } catch {
    throw invalidRendererDevUrl()
  }
  const port = Number(parsed.port)
  if (
    parsed.protocol !== 'http:' ||
    parsed.hostname !== '127.0.0.1' ||
    parsed.username !== '' ||
    parsed.password !== '' ||
    parsed.pathname !== '/' ||
    parsed.search !== '' ||
    parsed.hash !== '' ||
    parsed.port === '' ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65_535
  ) {
    throw invalidRendererDevUrl()
  }
  return parsed.origin
}

function invalidRendererDevUrl(): Error {
  return new Error('开发 Renderer 地址必须是 http://127.0.0.1:<port>')
}
