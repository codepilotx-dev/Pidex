import {
  RPC_APPLICATION_ERROR,
  type ApplicationErrorCode,
  type RpcMethod,
} from '@pidex/agent-protocol'

const WORKSPACE_FILE_APPLICATION_ERROR_CODES: Readonly<Record<string, ApplicationErrorCode>> = {
  WORKSPACE_PATH_DENIED: 'PATH_DENIED',
  WORKSPACE_PATH_NOT_FOUND: 'FILE_NOT_FOUND',
  WORKSPACE_NOT_FILE: 'FILE_NOT_TEXT',
  WORKSPACE_FILE_UNREADABLE: 'FILE_NOT_TEXT',
  WORKSPACE_FILE_TOO_LARGE: 'FILE_TOO_LARGE',
  WORKSPACE_FILE_READONLY: 'FILE_READONLY',
}

export const workspaceFileApplicationErrorCode = (
  method: RpcMethod,
  causeCode: string,
  declared: readonly string[],
): ApplicationErrorCode | null => {
  if (!method.startsWith('workspace/file/')) return null
  const mapped = WORKSPACE_FILE_APPLICATION_ERROR_CODES[causeCode]
  return mapped && declared.includes(mapped) ? mapped : null
}

const responseID = (input: unknown) => {
  const id =
    input && typeof input === 'object' && !Array.isArray(input)
      ? (input as Record<string, unknown>).id
      : null
  return typeof id === 'string' || typeof id === 'number' ? id : null
}

export const unauthorizedRequestResponse = (input: unknown) => ({
  jsonrpc: '2.0' as const,
  id: responseID(input),
  error: {
    code: RPC_APPLICATION_ERROR,
    message: 'RPC 连接尚未完成 initialized 握手',
    data: { code: 'UNAUTHORIZED' as const, retryable: false },
  },
})

export const capabilityRequiredResponse = (input: unknown, capability: string) => ({
  jsonrpc: '2.0' as const,
  id: responseID(input),
  error: {
    code: RPC_APPLICATION_ERROR,
    message: `RPC 连接未协商 capability：${capability}`,
    data: {
      code: 'CAPABILITY_REQUIRED' as const,
      retryable: false,
      details: { capability },
    },
  },
})

export const unauthorizedNotificationResponse = () => ({
  jsonrpc: '2.0' as const,
  id: null,
  error: {
    code: RPC_APPLICATION_ERROR,
    message: 'RPC connection is not initialized',
    data: { code: 'UNAUTHORIZED' as const, retryable: false },
  },
})
