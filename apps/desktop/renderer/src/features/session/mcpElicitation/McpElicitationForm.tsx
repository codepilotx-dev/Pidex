import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { CornerDownLeft, X } from 'lucide-react'
import React from 'react'
import { Button } from '../../../components/ui/Button.js'
import { Checkbox } from '../../../components/ui/Checkbox.js'
import { RadioGroup, RadioItem } from '../../../components/ui/RadioGroup.js'
import { ToggleSwitch } from '../../../components/ui/ToggleSwitch.js'
import type {
  McpElicitationBooleanSchema,
  McpElicitationConstOption,
  McpElicitationMultiSelectEnumSchema,
  McpElicitationNumberSchema,
  McpElicitationPrimitiveSchema,
  McpElicitationSchema,
  McpElicitationSingleSelectEnumSchema,
  McpElicitationStringSchema,
} from './McpElicitationTypes.js'
import { getFieldDefault, validateField } from './McpElicitationUtils.js'
import { RequestCard } from '../approvals/RequestCard.js'

// ── Props ────────────────────────────────────────────────────

export type McpElicitationFormProps = {
  details?: React.ReactNode
  busy?: boolean
  error?: string | null
  serverName: string
  message: string
  schema: McpElicitationSchema
  onSubmit: (content: Record<string, unknown>) => void
  onDecline: () => void
  onCancel: () => void
}

// ── Main component ───────────────────────────────────────────

export function McpElicitationForm({
  serverName,
  message,
  schema,
  onSubmit,
  onDecline,
  onCancel,
  busy,
  error,
  details,
}: McpElicitationFormProps): React.ReactNode {
  const fieldNames = Object.keys(schema.properties)

  // Initialise values from schema defaults
  const [formValues, setFormValues] = React.useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {}
    for (const key of fieldNames) {
      const fieldSchema = schema.properties[key]
      if (fieldSchema) {
        initial[key] = getFieldDefault(fieldSchema)
      }
    }
    return initial
  })

  const [errors, setErrors] = React.useState<Record<string, string>>({})
  const [submitted, setSubmitted] = React.useState(false)

  const updateField = (name: string, value: unknown): void => {
    setFormValues((prev) => ({ ...prev, [name]: value }))
    // Clear error on change after first submit attempt
    if (submitted) {
      const fieldSchema = schema.properties[name]
      const isRequired = schema.required?.includes(name) ?? false
      const error = fieldSchema ? validateField(fieldSchema, value, isRequired) : null
      setErrors((prev) => {
        const next = { ...prev }
        if (error) {
          next[name] = error
        } else {
          delete next[name]
        }
        return next
      })
    }
  }

  const handleSubmit = (): void => {
    setSubmitted(true)
    // Validate all fields
    const newErrors: Record<string, string> = {}
    for (const name of fieldNames) {
      const fieldSchema = schema.properties[name]
      const isRequired = schema.required?.includes(name) ?? false
      if (fieldSchema) {
        const error = validateField(fieldSchema, formValues[name], isRequired)
        if (error) newErrors[name] = error
      }
    }
    setErrors(newErrors)

    if (Object.keys(newErrors).length > 0) return

    // Build content object for accepted elicitation
    const content: Record<string, unknown> = {}
    for (const name of fieldNames) {
      const val = formValues[name]
      // Convert '' to null for number fields so the content doesn't
      // include unset numeric defaults
      if (val === '' || val === null || val === undefined) {
        const fieldSchema = schema.properties[name]
        if (fieldSchema?.type === 'number' || fieldSchema?.type === 'integer') {
          content[name] = null
        } else {
          content[name] = val
        }
      } else {
        content[name] = val
      }
    }
    onSubmit(content)
  }

  const hasErrors = Object.keys(errors).length > 0

  return (
    <RequestCard
      variant="permission"
      title={`MCP 服务器 “${serverName}” 请求输入`}
      disabled={busy}
      error={error}
    >
      {message ? (
        <p className="mcp-form-message tw:m-0 tw:px-3 tw:text-app-text-soft tw:type-body tw:break-words">
          {message}
        </p>
      ) : null}
      {details}

      <div className="mcp-form-fields tw:flex tw:flex-col tw:gap-2 tw:px-3">
        {fieldNames.map((name) => {
          const fieldSchema = schema.properties[name]
          if (!fieldSchema) return null
          const isRequired = schema.required?.includes(name) ?? false
          return (
            <McpFormField
              key={name}
              name={name}
              schema={fieldSchema}
              value={formValues[name]}
              error={submitted ? errors[name] : undefined}
              isRequired={isRequired}
              onChange={(val) => updateField(name, val)}
            />
          )
        })}
      </div>

      {hasErrors && submitted ? (
        <p className="mcp-form-error-summary tw:m-0 tw:px-3 tw:text-app-danger tw:type-body-sm">
          请修正标红的字段后再提交
        </p>
      ) : null}

      <div className="mcp-form-actions tw:flex tw:items-center tw:gap-1 tw:px-3 tw:pb-1">
        <Button color="danger" onClick={onDecline}>
          拒绝
        </Button>
        <Button color="secondary" onClick={onCancel}>
          <X size={APP_ICON_SIZE} />
          取消
        </Button>
        <Button color="primary" onClick={handleSubmit}>
          提交
          <CornerDownLeft size={APP_ICON_SIZE} />
        </Button>
      </div>
    </RequestCard>
  )
}

// ── Unsupported-mode fallback card ───────────────────────────

export type McpElicitationUnsupportedProps = {
  busy?: boolean
  error?: string | null
  serverName: string
  message: string
  onDecline: () => void
  onCancel: () => void
}

export function McpElicitationUnsupported({
  serverName,
  message,
  onDecline,
  onCancel,
  busy,
  error,
}: McpElicitationUnsupportedProps): React.ReactNode {
  return (
    <RequestCard
      variant="permission"
      title={`MCP 服务器 “${serverName}” 请求输入`}
      disabled={busy}
      error={error}
    >
      {message ? (
        <p className="mcp-form-message tw:m-0 tw:px-3 tw:text-app-text-soft tw:type-body tw:break-words">
          {message}
        </p>
      ) : null}

      <div className="mcp-form-unsupported tw:flex tw:items-start tw:gap-2 tw:px-3 tw:text-app-text-soft tw:type-body-sm">
        <span
          className="mcp-form-unsupported-icon tw:mt-1 tw:shrink-0 tw:text-[var(--cpx-sys-space-4)]"
          aria-hidden="true"
        >
          ⚠️
        </span>
        <p className="tw:m-0">当前版本不支持此输入方式。</p>
      </div>

      <div className="mcp-form-actions tw:flex tw:items-center tw:gap-1 tw:px-3 tw:pb-1">
        <Button color="danger" onClick={onDecline}>
          拒绝
        </Button>
        <Button color="secondary" onClick={onCancel}>
          <X size={APP_ICON_SIZE} />
          取消
        </Button>
      </div>
    </RequestCard>
  )
}

// ── Individual form field ────────────────────────────────────

function McpFormField({
  name,
  schema,
  value,
  error,
  isRequired,
  onChange,
}: {
  name: string
  schema: McpElicitationPrimitiveSchema
  value: unknown
  error?: string
  isRequired: boolean
  onChange: (value: unknown) => void
}): React.ReactNode {
  const label = fieldLabel(name, schema)
  const description = fieldDescription(schema)

  return (
    <div
      className={
        error
          ? 'mcp-form-field mcp-form-field-error tw:flex tw:flex-col tw:gap-1 tw:[&_.mcp-form-field-input]:border-app-danger tw:[&_.mcp-form-field-input:focus]:border-app-danger'
          : 'mcp-form-field tw:flex tw:flex-col tw:gap-1'
      }
    >
      <label
        className="mcp-form-field-label tw:flex tw:items-center tw:gap-1 tw:text-app-text tw:type-row-title"
        htmlFor={`mcp-field-${name}`}
      >
        {label}
        {isRequired ? (
          <span
            className="mcp-form-required-mark tw:ms-1 tw:text-app-danger tw:type-weight-heading"
            aria-hidden="true"
          >
            *
          </span>
        ) : null}
      </label>

      {description ? (
        <p className="mcp-form-field-desc tw:m-0 tw:text-app-text-meta tw:type-body-sm">
          {description}
        </p>
      ) : null}

      <FieldInput name={name} schema={schema} value={value} onChange={onChange} />

      {error ? (
        <p className="mcp-form-field-error tw:m-0 tw:text-app-danger tw:type-body-sm" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  )
}

// ── Field input dispatcher ───────────────────────────────────

function FieldInput({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationPrimitiveSchema
  value: unknown
  onChange: (value: unknown) => void
}): React.ReactNode {
  switch (schema.type) {
    case 'string':
      return isSingleSelectEnum(schema) ? (
        <SingleSelectField
          name={name}
          schema={schema}
          value={value as string}
          onChange={onChange}
        />
      ) : (
        <TextField name={name} schema={schema} value={value as string} onChange={onChange} />
      )
    case 'number':
    case 'integer':
      return (
        <NumberField
          name={name}
          schema={schema}
          value={value as number | null}
          onChange={onChange}
        />
      )
    case 'boolean':
      return (
        <BooleanField name={name} schema={schema} value={value as boolean} onChange={onChange} />
      )
    case 'array':
      return (
        <MultiSelectField
          name={name}
          schema={schema}
          value={value as string[]}
          onChange={onChange}
        />
      )
    default:
      return null
  }
}

function isSingleSelectEnum(
  schema: McpElicitationStringSchema | McpElicitationSingleSelectEnumSchema,
): schema is McpElicitationSingleSelectEnumSchema {
  return (
    Array.isArray((schema as McpElicitationSingleSelectEnumSchema).enum) ||
    Array.isArray((schema as McpElicitationSingleSelectEnumSchema).oneOf)
  )
}

// ── Text field ───────────────────────────────────────────────

const TEXT_INPUT_CLASS =
  'mcp-form-field-input tw:w-full tw:box-border tw:rounded-control tw:border tw:border-app-border-subtle tw:bg-app-control tw:px-2 tw:py-1 tw:text-app-text tw:type-body tw:outline-none tw:transition-[border-color,box-shadow] tw:duration-state tw:ease-standard tw:focus:border-app-accent tw:focus:shadow-[var(--cpx-sys-focus-ring-soft)]'

function TextField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationStringSchema
  value: string
  onChange: (value: unknown) => void
}): React.ReactNode {
  const placeholder = buildPlaceholder(schema)
  return (
    <input
      id={`mcp-field-${name}`}
      className={TEXT_INPUT_CLASS}
      type="text"
      value={value ?? ''}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
    />
  )
}

// ── Number field ─────────────────────────────────────────────

function NumberField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationNumberSchema
  value: number | null
  onChange: (value: unknown) => void
}): React.ReactNode {
  const placeholder = buildPlaceholder(schema)
  return (
    <input
      id={`mcp-field-${name}`}
      className={TEXT_INPUT_CLASS}
      type="number"
      value={value ?? ''}
      placeholder={placeholder}
      step={schema.type === 'integer' ? '1' : undefined}
      onChange={(e) => {
        const raw = e.target.value
        if (raw === '') {
          onChange(null)
        } else {
          onChange(schema.type === 'integer' ? parseInt(raw, 10) : parseFloat(raw))
        }
      }}
    />
  )
}

// ── Boolean (toggle) ─────────────────────────────────────────

function BooleanField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationBooleanSchema
  value: boolean
  onChange: (value: unknown) => void
}): React.ReactNode {
  return (
    <div className="mcp-form-boolean tw:inline-flex tw:items-center tw:gap-2">
      <ToggleSwitch ariaLabel={schema.title ?? name} checked={value} onChange={onChange} />
      <span className="mcp-form-boolean-label tw:type-body">{value ? '是' : '否'}</span>
    </div>
  )
}

// ── Single-select (radio) ────────────────────────────────────

function SingleSelectField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationSingleSelectEnumSchema
  value: string
  onChange: (value: unknown) => void
}): React.ReactNode {
  const options = getSelectOptions(schema)
  return (
    <RadioGroup
      ariaLabel={schema.title ?? name}
      className="mcp-form-option-group tw:flex tw:flex-col tw:gap-1"
      value={value}
      onValueChange={onChange}
    >
      {options.map((option) => (
        <RadioItem
          className="mcp-form-option tw:w-full"
          key={option.value}
          label={option.label}
          value={option.value}
          variant="card"
        />
      ))}
    </RadioGroup>
  )
}

// ── Multi-select (checkbox) ──────────────────────────────────

function MultiSelectField({
  name,
  schema,
  value,
  onChange,
}: {
  name: string
  schema: McpElicitationMultiSelectEnumSchema
  value: string[]
  onChange: (value: unknown) => void
}): React.ReactNode {
  const options = getMultiSelectOptions(schema)
  const selectedSet = new Set(value ?? [])

  const toggle = (optValue: string): void => {
    const next = new Set(selectedSet)
    if (next.has(optValue)) {
      next.delete(optValue)
    } else {
      next.add(optValue)
    }
    onChange(Array.from(next))
  }

  return (
    <div className="mcp-form-option-group tw:flex tw:flex-col tw:gap-1" role="group">
      {options.map((option) => {
        const isSelected = selectedSet.has(option.value)
        return (
          <Checkbox
            checked={isSelected}
            className="mcp-form-option tw:w-full"
            key={option.value}
            onCheckedChange={() => toggle(option.value)}
          >
            {option.label}
          </Checkbox>
        )
      })}
    </div>
  )
}

// ── Helpers ──────────────────────────────────────────────────

function getSelectOptions(
  schema: McpElicitationSingleSelectEnumSchema,
): Array<{ value: string; label: string }> {
  if (Array.isArray(schema.oneOf)) {
    return schema.oneOf.map((opt) => ({
      value: opt.const,
      label: opt.title,
    }))
  }
  if (Array.isArray(schema.enum)) {
    return schema.enum.map((val) => ({
      value: val,
      label: val,
    }))
  }
  return []
}

function getMultiSelectOptions(
  schema: McpElicitationMultiSelectEnumSchema,
): Array<{ value: string; label: string }> {
  if ('anyOf' in schema.items) {
    return schema.items.anyOf.map((opt) => ({
      value: opt.const,
      label: opt.title,
    }))
  }
  if (Array.isArray(schema.items.enum)) {
    return schema.items.enum.map((val) => ({
      value: val,
      label: val,
    }))
  }
  return []
}

function fieldLabel(name: string, schema: McpElicitationPrimitiveSchema): string {
  return schema.title ?? name
}

function fieldDescription(schema: McpElicitationPrimitiveSchema): string | undefined {
  return schema.description
}

function buildPlaceholder(schema: McpElicitationStringSchema | McpElicitationNumberSchema): string {
  const parts: string[] = []
  if (schema.type === 'string') {
    const s = schema as McpElicitationStringSchema
    if (s.minLength !== undefined) parts.push(`≥${s.minLength}`)
    if (s.maxLength !== undefined) parts.push(`≤${s.maxLength}`)
  } else {
    const n = schema as McpElicitationNumberSchema
    if (n.minimum !== undefined) parts.push(`≥${n.minimum}`)
    if (n.maximum !== undefined) parts.push(`≤${n.maximum}`)
  }
  return parts.length > 0 ? parts.join(', ') : ''
}
