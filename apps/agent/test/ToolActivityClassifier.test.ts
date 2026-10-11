import { describe, expect, test } from 'bun:test'
import { Schema } from 'effect'
import { ToolItemSchema } from '@pidex/shared/thread'

import {
  classifyToolActivity,
  storedToolActivity,
  toolActivityTarget,
} from '../src/tool/ToolActivityClassifier'
import type { WorkspaceService } from '../src/workspace/WorkspaceService'

const workspace = {
  rootPath: 'C:\\workspace',
  roots: ['C:\\workspace'],
  rootForPath: (path: string) =>
    path.toLowerCase().startsWith('c:\\workspace')
      ? { path: 'C:\\workspace', role: 'primary' as const }
      : undefined,
} as unknown as WorkspaceService

describe('ToolActivityClassifier', () => {
  test('maps built-in file exploration and mutation tools', () => {
    expect(
      classifyToolActivity({ tool: 'Read', input: { file_path: 'src/a.ts' }, workspace }),
    ).toEqual({
      type: 'read',
      subject: 'file',
      target: { displayLabel: 'src/a.ts', workspacePath: 'src/a.ts' },
    })
    expect(
      classifyToolActivity({ tool: 'Grep', input: { pattern: 'needle', path: 'src' }, workspace }),
    ).toEqual({
      type: 'search',
      query: 'needle',
      path: { displayLabel: 'src', workspacePath: 'src' },
    })
    expect(classifyToolActivity({ tool: 'Glob', input: { path: 'src' }, workspace })).toEqual({
      type: 'list_files',
      path: { displayLabel: 'src', workspacePath: 'src' },
    })
    expect(
      classifyToolActivity({
        tool: 'apply_patch',
        input: {
          affectedPaths: [{ path: 'src/a.ts', operation: 'update', additions: 2, deletions: 1 }],
        },
        workspace,
      }),
    ).toEqual({
      type: 'file_change',
      changes: [{ path: 'src/a.ts', operation: 'update', additions: 2, deletions: 1 }],
    })
  })

  test('classifies Bash and PowerShell read-only commands without parsing quoted separators', () => {
    const activity = (command: string) =>
      classifyToolActivity({ tool: 'Bash', input: { command }, command, workspace })
    expect(activity('rg --files src | head -20')).toMatchObject({ type: 'list_files' })
    expect(activity("rg 'a|b;c' src | head -20")).toMatchObject({ type: 'search', query: 'a|b;c' })
    expect(activity('Get-Content src/a.ts | Select-Object -First 10')).toMatchObject({
      type: 'read',
    })
    expect(activity('rg needle src && bun test')).toEqual({ type: 'command', kind: 'generic' })
    expect(activity('rg needle src > result.txt')).toEqual({ type: 'command', kind: 'generic' })
    expect(activity("sed -i 's/a/b/' src/a.ts")).toEqual({ type: 'command', kind: 'generic' })
  })

  test('recognizes current time, skill scripts, format, lint and test commands', () => {
    const classify = (command: string) =>
      classifyToolActivity({ tool: 'PowerShell', input: { command }, command })
    expect(classify('Get-Date')).toEqual({ type: 'command', kind: 'current_time' })
    expect(classify('python skills/review/scripts/check.py')).toEqual({
      type: 'command',
      kind: 'skill_script',
      skillName: 'review',
      scriptName: 'check.py',
    })
    expect(classify('prettier --check src')).toEqual({ type: 'command', kind: 'format' })
    expect(classify('eslint src')).toEqual({ type: 'command', kind: 'lint' })
    expect(classify('bun test apps/agent/test/example.test.ts')).toEqual({
      type: 'command',
      kind: 'test',
    })
    expect(classify('bun run lint')).toEqual({ type: 'command', kind: 'lint' })
    expect(classify('test -z "$OUTPUT"')).toEqual({ type: 'command', kind: 'noop' })
  })

  test('distinguishes tool search from loading and keeps source semantics', () => {
    expect(classifyToolActivity({ tool: 'ToolSearch', input: { query: 'browser' } })).toEqual({
      type: 'tool',
      mode: 'search',
      name: 'browser',
    })
    expect(
      classifyToolActivity({
        tool: 'ToolSearch',
        input: { query: 'browser' },
        details: { addedToolNames: ['browser.open'] },
      }),
    ).toEqual({ type: 'tool', mode: 'load', name: 'browser.open' })
    expect(
      classifyToolActivity({ tool: 'skill_read', input: { name: 'frontend-design' } }),
    ).toEqual({
      type: 'read',
      subject: 'skill',
      target: { displayLabel: 'frontend-design' },
    })
    expect(classifyToolActivity({ tool: 'web__run', input: {} })).toEqual({ type: 'web_search' })
    expect(
      classifyToolActivity({ tool: 'mcp__short__call', input: {}, integrationSource: 'github' }),
    ).toEqual({
      type: 'integration',
      source: 'github',
    })
  })

  test('never publishes an external absolute path as a clickable workspace target', () => {
    expect(toolActivityTarget('D:\\private\\secret.ts', workspace)).toEqual({
      displayLabel: 'secret.ts',
    })
  })

  test('ToolItem wire schema accepts descriptors and legacy items', () => {
    const base = {
      id: 'tool-1',
      messageID: 'turn-1',
      turnId: 'turn-1',
      agentId: 'agent-1',
      type: 'tool' as const,
      callID: 'call-1',
      tool: 'Read',
      title: 'Read',
      state: 'completed' as const,
      input: null,
      command: null,
      output: null,
      error: null,
      startedAt: 1,
      finishedAt: 2,
      durationMs: 1,
      createdAt: 1,
    }
    expect(Schema.decodeUnknownSync(ToolItemSchema)(base).activity).toBeUndefined()
    const decoded = Schema.decodeUnknownSync(ToolItemSchema)({
      ...base,
      activity: {
        type: 'read',
        subject: 'file',
        target: { displayLabel: 'src/a.ts', workspacePath: 'src/a.ts' },
      },
    })
    expect(storedToolActivity(decoded.activity)).toEqual(decoded.activity)
  })
})
