import type { RpcParams, UsageSourceDescriptor } from '@pidex/agent-protocol'
import type React from 'react'
import { useState } from 'react'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'

type BillingConnectionMethod = Extract<
  UsageSourceDescriptor['connectionMethod'],
  { kind: 'billing-key' }
>

export type BillingUsageSourceDescriptor = UsageSourceDescriptor & {
  connectionMethod: BillingConnectionMethod
}

type ConnectInput =
  RpcParams<'usage/credential/connect'> extends infer Input
    ? Input extends unknown
      ? Omit<Input, 'operationId'>
      : never
    : never

export type BillingCredentialConnectionProps = {
  source: BillingUsageSourceDescriptor
  onConnect: (input: ConnectInput) => Promise<unknown>
  onDisconnect: (sourceId: BillingConnectionMethod['sourceId']) => Promise<unknown>
  onChanged: () => void | Promise<void>
}

export function BillingCredentialConnection({
  source,
  onConnect,
  onDisconnect,
  onChanged,
}: BillingCredentialConnectionProps): React.ReactNode {
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const connected = source.connection.kind !== 'none'

  async function connect(): Promise<void> {
    if (!fieldsComplete(source, values)) return
    setBusy(true)
    setError(null)
    try {
      const input = {
        sourceId: source.connectionMethod.sourceId,
        ...Object.fromEntries(
          source.connectionMethod.fields.map((field) => [
            field.name,
            values[field.name]?.trim() ?? '',
          ]),
        ),
      } as ConnectInput
      await onConnect(input)
      setValues({})
      await onChanged()
    } catch (connectError) {
      setError(connectError instanceof Error ? connectError.message : String(connectError))
    } finally {
      setBusy(false)
    }
  }

  async function disconnect(): Promise<void> {
    setBusy(true)
    setError(null)
    try {
      await onDisconnect(source.connectionMethod.sourceId)
      await onChanged()
    } catch (disconnectError) {
      setError(disconnectError instanceof Error ? disconnectError.message : String(disconnectError))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="model-center-account-connection tw:grid tw:min-w-0 tw:gap-3 tw:p-4">
      <header className="tw:flex tw:min-w-0 tw:items-start tw:justify-between tw:gap-3">
        <div>
          <h4 className="tw:m-0 tw:text-app-text tw:[font-size:var(--cpx-sys-font-size-md)] tw:type-weight-label">
            {source.displayName}
          </h4>
          <p className="tw:mt-1 tw:mb-0 tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-sm)] tw:[line-height:var(--cpx-sys-line-height-tight)]">
            {connected && source.connection.maskedValue
              ? `已保存 ${source.connection.maskedValue}；输入框不会回显现有密钥。`
              : '独立管理凭据仅用于余额和账务查询，不会进入推理 Key 池。'}
          </p>
        </div>
        <span
          className="tw:whitespace-nowrap tw:rounded-full tw:border tw:border-app-border-subtle tw:px-2 tw:py-1 tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-xs)] tw:data-[tone=success]:text-app-success"
          data-tone={connected ? 'success' : 'neutral'}
        >
          {connected ? '已连接' : '可连接'}
        </span>
      </header>
      <div className="model-center-account-fields tw:grid tw:grid-cols-2 tw:items-end tw:gap-3 tw:@max-[720px]:grid-cols-1">
        {source.connectionMethod.fields.map((field) => (
          <label
            className="model-center-account-field tw:grid tw:min-w-0 tw:gap-2"
            key={field.name}
          >
            <span className="tw:text-app-text-soft tw:[font-size:var(--cpx-sys-font-size-xs)] tw:type-weight-label">
              {field.label}
            </span>
            <Input
              className="tw:w-full"
              autoComplete={field.secret ? 'off' : undefined}
              onChange={(event) =>
                setValues((current) => ({
                  ...current,
                  [field.name]: event.target.value,
                }))
              }
              placeholder={field.secret && connected ? `输入新的${field.label}以替换` : field.label}
              type={field.secret ? 'password' : 'text'}
              value={values[field.name] ?? ''}
            />
          </label>
        ))}
        <div className="model-center-account-actions tw:flex tw:flex-wrap tw:items-center tw:justify-end tw:gap-2 tw:min-h-9 tw:self-end tw:[&_svg]:size-icon tw:@max-[720px]:justify-start">
          <Button
            color="primary"
            disabled={!fieldsComplete(source, values)}
            loading={busy}
            onClick={() => void connect()}
          >
            {connected ? '替换连接' : '连接'}
          </Button>
          {connected ? (
            <Button color="danger" loading={busy} onClick={() => void disconnect()}>
              断开
            </Button>
          ) : null}
        </div>
      </div>
      {error ? (
        <p
          className="model-center-account-error tw:m-0 tw:text-app-danger tw:[font-size:var(--cpx-sys-font-size-sm)] tw:[line-height:var(--cpx-sys-line-height-tight)]"
          role="status"
        >
          {error}
        </p>
      ) : null}
    </section>
  )
}

function fieldsComplete(
  source: BillingUsageSourceDescriptor,
  values: Readonly<Record<string, string>>,
): boolean {
  return source.connectionMethod.fields.every(
    (field) => !field.required || Boolean(values[field.name]?.trim()),
  )
}
