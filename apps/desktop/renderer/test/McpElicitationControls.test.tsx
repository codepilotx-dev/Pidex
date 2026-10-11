import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import { McpElicitationForm } from '../src/features/session/mcpElicitation/McpElicitationForm.js'

describe('MCP elicitation choice controls', () => {
  test('uses switch, radio and checkbox primitives for persistent values', () => {
    const html = renderToStaticMarkup(
      <McpElicitationForm
        message="请选择"
        schema={{
          type: 'object',
          properties: {
            enabled: { type: 'boolean', title: '启用', default: true },
            mode: { type: 'string', title: '模式', enum: ['fast', 'safe'] },
            scopes: {
              type: 'array',
              title: '范围',
              items: { type: 'string', enum: ['read', 'write'] },
            },
          },
        }}
        serverName="demo"
        onCancel={() => {}}
        onDecline={() => {}}
        onSubmit={() => {}}
      />,
    )

    expect(html).toContain('role="switch"')
    expect(html).toContain('role="radiogroup"')
    expect(html).toContain('role="radio"')
    expect(html).toContain('role="checkbox"')
  })
})
