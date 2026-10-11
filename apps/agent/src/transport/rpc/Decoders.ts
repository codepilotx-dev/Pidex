import { AgentError } from '../../Domain'

export const rpcRecord = (value: unknown, name = 'params') => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  }
  return value as Record<string, unknown>
}

export const optionalRpcRecord = (value: unknown) => (value == null ? {} : rpcRecord(value))

export const decodeRpcParams = <A>(
  decode: (value: unknown) => A,
  value: unknown,
  name: string,
): A => {
  try {
    return decode(value)
  } catch {
    throw new AgentError('INVALID_REQUEST', `${name} 参数无效`, 400)
  }
}
