import { describe, expect, test } from 'bun:test'
import { createRpcClient, RpcRemoteError, type RpcTransport } from '../src/runtime/Client'
import {
  defineRpcHandlers,
  dispatchRpcMessage,
  RpcApplicationError,
  type RpcHandlers,
} from '../src/runtime/Dispatcher'
import {
  RPC_APPLICATION_ERROR,
  RPC_INTERNAL_ERROR,
  RPC_INVALID_PARAMS,
  RPC_INVALID_REQUEST,
} from '../src/wire/Messages'

const sandboxResult = {
  sandbox: {
    state: 'available' as const,
    platform: 'win32',
    architecture: 'x64',
    runtimeVersion: '1.0.0',
    maturity: 'alpha' as const,
    maxConcurrentCommands: 8,
    error: null,
    operations: { canInstall: false, canRepair: true, canUninstall: true },
  },
}

const request = (method: string, params: unknown, id = 'request-1') => ({
  jsonrpc: '2.0',
  id,
  method,
  params,
})

const handlersFor = (sandboxStatus: () => unknown): RpcHandlers =>
  new Proxy({} as RpcHandlers, {
    get: (_target, property) =>
      property === 'sandbox/status' ? sandboxStatus : () => ({ ok: true }),
  })

describe('typed client', () => {
  test('decodes transport results with the method result schema', async () => {
    const transport: RpcTransport = {
      request: async (message) => ({ jsonrpc: '2.0', id: message.id, result: sandboxResult }),
      notify: async () => undefined,
    }
    const result = await createRpcClient(transport).call('sandbox/status', {})
    expect(result).toEqual(sandboxResult)
  })

  test('rejects an invalid result and preserves stable remote errors', async () => {
    const invalidTransport: RpcTransport = {
      request: async (message) => ({
        jsonrpc: '2.0',
        id: message.id,
        result: { sandbox: { state: 'secret' } },
      }),
      notify: async () => undefined,
    }
    await expect(createRpcClient(invalidTransport).call('sandbox/status', {})).rejects.toThrow()

    const errorTransport: RpcTransport = {
      request: async (message) => ({
        jsonrpc: '2.0',
        id: message.id,
        error: {
          code: RPC_APPLICATION_ERROR,
          message: 'unavailable',
          data: { code: 'SANDBOX_UNAVAILABLE', retryable: true },
        },
      }),
      notify: async () => undefined,
    }
    await expect(createRpcClient(errorTransport).call('sandbox/status', {})).rejects.toBeInstanceOf(
      RpcRemoteError,
    )
  })
})

describe('dispatcher', () => {
  test('rejects batch frames and invalid params', async () => {
    const handlers = handlersFor(() => sandboxResult)
    const batch = await dispatchRpcMessage([], handlers, {})
    expect('error' in batch && batch.error.code).toBe(RPC_INVALID_REQUEST)

    const invalid = await dispatchRpcMessage(
      request('sandbox/uninstall', { operationId: 'op', confirm: false }),
      handlers,
      {},
    )
    expect('error' in invalid && invalid.error.code).toBe(RPC_INVALID_PARAMS)
  })

  test('validates handler results', async () => {
    const response = await dispatchRpcMessage(
      request('sandbox/status', {}),
      handlersFor(() => ({ sandbox: {} })),
      {},
    )
    expect('error' in response && response.error.code).toBe(RPC_INTERNAL_ERROR)
  })

  test('only exposes application errors declared by the method', async () => {
    const declared = await dispatchRpcMessage(
      request('sandbox/status', {}),
      handlersFor(() => {
        throw new RpcApplicationError('SANDBOX_UNAVAILABLE', 'not installed', true)
      }),
      {},
    )
    expect('error' in declared && declared.error).toEqual({
      code: RPC_APPLICATION_ERROR,
      message: 'not installed',
      data: { code: 'SANDBOX_UNAVAILABLE', retryable: true },
    })

    const undeclared = await dispatchRpcMessage(
      request('sandbox/status', {}),
      handlersFor(() => {
        throw new RpcApplicationError('MEMORY_NOT_FOUND', 'leak me')
      }),
      {},
    )
    expect('error' in undeclared && undeclared.error.code).toBe(RPC_INTERNAL_ERROR)
    expect('error' in undeclared && undeclared.error.message).toBe('Internal RPC error')
  })

  test('rejects incomplete handler maps at registration and dispatch', async () => {
    expect(() => defineRpcHandlers({} as RpcHandlers)).toThrow('Missing RPC handlers')
    const response = await dispatchRpcMessage(request('sandbox/status', {}), {} as RpcHandlers, {})
    expect('error' in response && response.error.code).toBe(RPC_INTERNAL_ERROR)
  })
})
