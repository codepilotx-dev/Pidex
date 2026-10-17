import { describe, expect, test } from 'bun:test'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  commandOutputFollowing,
  commandOutputScrollTop,
  isCommandOutputAtBottom,
  readCommandExitCode,
  toolDetailKind,
} from '../src/features/session/timeline/ToolCommandCard.js'
import type { Item } from '@pidex/shared/thread'
import { decodeResultCardEnvelope } from '@pidex/shared/thread-result-card'

import {
  buildLifecycleToolDisplay,
  buildStructuredToolDetail,
  buildToolItemDisplay,
  buildToolSemanticSummary,
  cleanCommandOutput,
  cleanCommandSummary,
  fileMutationDisplay,
  FileMutationItemView,
  formatToolDuration,
  isProcessEnvelope,
  isStandaloneLifecycleTool,
  LifecycleToolItemView,
  syntheticPatchDisplay,
  ToolItemView,
  ToolExecutionCard,
} from '../src/features/session/timeline/CanonicalItemRenderer.js'
import { ResultCardView } from '../src/features/session/timeline/ResultCardView.js'
import {
  historicalDeliveryText,
  subagentResultMarkdown,
} from '../src/features/session/timeline/StructuredDeliveryText.js'
import { CodeBlock } from '../src/features/syntax/CodeBlock.js'
import { TooltipProvider } from '../src/components/ui/Tooltip.js'
import { AttachmentFilePill } from '../src/features/session/attachments/AttachmentRowPrimitives.js'
import { threadPatchDiffToDesktopFile } from '../src/features/session/timeline/FileMutationDiffContent.js'
import {
  createThreadPatchDiffLoader,
  ExpandableFileMutationRow,
} from '../src/features/session/timeline/ExpandableFileMutationRow.js'
import { ConversationItemContext } from '../src/features/session/timeline/ConversationItemContext.js'
import { createKeyedDisclosureStore } from '../src/components/ui/KeyedDisclosureStore.js'

type ToolItem = Extract<Item, { type: 'tool' }>

function disclosureStore(...expandedKeys: string[]) {
  return createKeyedDisclosureStore({ initialExpandedKeys: expandedKeys })
}

function toolItem(overrides: Partial<ToolItem> = {}): ToolItem {
  return {
    id: 'tool-1',
    messageID: 'message-1',
    turnId: 'turn-1',
    agentId: 'agent-1',
    type: 'tool',
    callID: 'call-1',
    tool: 'Bash',
    title: '运行命令',
    state: 'completed',
    input: null,
    command: 'bun test',
    activity: { type: 'command', kind: 'test' },
    output: 'pass',
    error: null,
    startedAt: 1_000,
    finishedAt: 1_250,
    durationMs: 250,
    createdAt: 1_000,
    ...overrides,
  }
}

/** Builds the fixture through the shared decoder so it is a real v1 envelope. */
function resultCardEnvelope(overrides: { card?: Record<string, unknown> } = {}) {
  const envelope = decodeResultCardEnvelope({
    kind: 'pidex.result-card',
    version: 1,
    card: {
      title: '任务已完成',
      summary: '回归通过并修复了参数校验',
      tone: 'success',
      sections: [
        {
          title: '关键结论',
          items: [{ label: '修复了校验边界', value: '空参数不再通过', tone: 'neutral' }],
        },
      ],
      references: [{ kind: 'url', value: 'https://example.com/report', label: '验证报告' }],
      ...(overrides.card ?? {}),
    },
  })
  if (!envelope) throw new Error('测试信封必须可解码')
  return envelope
}

describe('canonical tool item display', () => {
  test('routes command and result details by activity before shell-name fallback', () => {
    expect(toolDetailKind(toolItem())).toBe('command')
    for (const kind of ['generic', 'format', 'test', 'lint', 'skill_script'] as const) {
      expect(toolDetailKind(toolItem({ activity: { type: 'command', kind } }))).toBe('command')
    }
    for (const kind of ['current_time', 'noop'] as const) {
      expect(toolDetailKind(toolItem({ activity: { type: 'command', kind } }))).toBe('generic')
    }
    for (const type of ['read', 'search', 'list_files'] as const) {
      const activity = type === 'read' ? { type, subject: 'file' as const } : { type }
      expect(toolDetailKind(toolItem({ activity }))).toBe('result')
    }
    expect(toolDetailKind(toolItem({ activity: undefined }))).toBe('command')
    expect(toolDetailKind(toolItem({ activity: undefined, command: null }))).toBe('generic')
    expect(toolDetailKind(toolItem({ activity: { type: 'integration' } }))).toBe('generic')
    expect(toolDetailKind(toolItem({ activity: { type: 'file_change', changes: [] } }))).toBe(
      'generic',
    )
  })

  test('keeps raw output formatting and explicit exit codes without exposing process envelopes', () => {
    const output = JSON.stringify({ exitCode: 1, stdout: '  indented\n', stderr: '\tfailed\n' })
    const item = toolItem({ output, error: 'failed again', state: 'error' })
    expect(buildToolItemDisplay(item).resultText).toBe('  indented\n\tfailed\nfailed again')
    expect(readCommandExitCode(output)).toBe(1)
    expect(readCommandExitCode('{"result":{"exit_code":0}}')).toBe(0)
    for (const value of [
      null,
      'done',
      '{"exitCode":"0"}',
      '{"exitCode":0.5}',
      '{"stdout":"done"}',
    ]) {
      expect(readCommandExitCode(value)).toBeNull()
    }
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )
    expect(html).toContain('退出码 1')
    expect(html).toContain('失败')
    expect(html).not.toContain('exitCode')
    expect(cleanCommandOutput('{"result":{"exitCode":0,"stdout":"  value\\n","stderr":""}}')).toBe(
      '  value\n',
    )
    expect(buildToolItemDisplay(toolItem({ output: 'same', error: 'same' })).resultText).toBe(
      'same',
    )
  })

  test('follows live output until the reader scrolls away, then resumes at the bottom', () => {
    let metrics = { scrollTop: 0, scrollHeight: 400, clientHeight: 144 }
    let following = commandOutputFollowing(true, true, false, false)
    expect(commandOutputScrollTop(metrics, true, following)).toBe(256)
    metrics = { ...metrics, scrollTop: 40 }
    following = isCommandOutputAtBottom(metrics)
    expect(following).toBe(false)
    metrics = { ...metrics, scrollHeight: 600 }
    expect(commandOutputScrollTop(metrics, true, following)).toBe(40)
    following = isCommandOutputAtBottom({ ...metrics, scrollTop: 448 })
    expect(following).toBe(true)
    expect(commandOutputScrollTop(metrics, true, following)).toBe(456)
    expect(commandOutputScrollTop(metrics, false, following)).toBe(40)
    expect(commandOutputFollowing(true, true, false, false)).toBe(true)
    expect(commandOutputFollowing(false, true, false, true)).toBe(false)
    expect(commandOutputFollowing(true, true, true, false)).toBe(false)
  })

  test('keeps read/search details result-only and does not offer empty details', () => {
    const item = toolItem({
      command: null,
      activity: { type: 'search', query: 'pattern' },
      input: { pattern: 'unique-input' },
      output: 'found',
    })
    const html = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )
    expect(html).toContain('found')
    expect(html).not.toContain('unique-input')
    expect(html).not.toContain('aria-label="执行内容"')
    expect(html).not.toContain('canonical-command-shell__prompt')
    expect(buildToolItemDisplay({ ...item, output: null }).canExpand).toBe(false)
  })

  test('keeps file attachment pills independent from action button geometry', () => {
    const markup = renderToStaticMarkup(
      <AttachmentFilePill detail="text/plain · 42 B" name="notes.txt" onOpen={() => undefined} />,
    )

    // 外观已迁到 Tailwind utility，这里只钉住锚点类与非 Button 语义。
    expect(markup).toMatch(
      /<button aria-label="打开 notes.txt" class="attachment-file-pill__open[^"]*" type="button">/,
    )
    expect(markup).not.toMatch(/class="[^"]*attachment-file-pill__open[^"]*ui-button/)
  })

  test('cleanCommandOutput extracts stdout/stderr and drops process JSON envelope', () => {
    const rawEnvelope = JSON.stringify({
      exitCode: 0,
      signal: null,
      stdout: 'On branch dev\nYour branch is ahead',
      stderr: '',
      timedOut: false,
      truncated: false,
    })
    expect(cleanCommandOutput(rawEnvelope)).toBe('On branch dev\nYour branch is ahead')

    const withStderr = JSON.stringify({
      exitCode: 1,
      signal: null,
      stdout: 'warning message',
      stderr: 'fatal error',
    })
    expect(cleanCommandOutput(withStderr)).toBe('warning message\nfatal error')

    const emptyEnvelope = JSON.stringify({
      exitCode: 0,
      signal: null,
      stdout: '',
      stderr: '',
      timedOut: false,
    })
    expect(cleanCommandOutput(emptyEnvelope)).toBeNull()

    expect(cleanCommandOutput('plain terminal output')).toBe('plain terminal output')
  })

  test('isProcessEnvelope detects various process execution payloads', () => {
    expect(isProcessEnvelope({ exitCode: 0, signal: null, stdout: 'ok', stderr: '' })).toBe(true)
    expect(isProcessEnvelope('{"exitCode":0,"stdout":"ok"}')).toBe(true)
    expect(isProcessEnvelope('```json\n{"exitCode":0,"stdout":"ok"}\n```')).toBe(true)
    expect(isProcessEnvelope({ exit_code: 0, stdout: 'ok' })).toBe(true)
    expect(isProcessEnvelope({ result: { exitCode: 0, stdout: 'ok' } })).toBe(true)
    expect(isProcessEnvelope([{ exitCode: 0, stdout: 'ok' }])).toBe(true)
    expect(isProcessEnvelope({ custom: 'data', status: 200 })).toBe(false)
    expect(isProcessEnvelope('plain user output')).toBe(false)
  })

  test('cleanCommandSummary strips directory changes', () => {
    expect(cleanCommandSummary('cd F:/CodeProject/Pidex && git diff CHANGELOG.md')).toBe(
      'git diff CHANGELOG.md',
    )
    expect(cleanCommandSummary('cd "C:\\Program Files" ; npm test')).toBe('npm test')
    expect(cleanCommandSummary('git status')).toBe('git status')
  })
  test('formats command durations independently from semantic summaries', () => {
    expect(formatToolDuration(250)).toBe('1 秒')
    expect(formatToolDuration(84_000)).toBe('1 分 24 秒')
    expect(buildToolItemDisplay(toolItem()).expandedLabel).toBe('已运行 bun test · 1 秒')
    expect(
      buildToolSemanticSummary(
        toolItem({
          activity: undefined,
        }),
      ).collapsedLabel,
    ).toBe('已运行 bun test · 1 秒')
    expect(
      buildToolSemanticSummary(
        toolItem({
          durationMs: null,
          finishedAt: null,
        }),
      ).collapsedLabel,
    ).toBe('已运行 bun test')
    expect(
      buildToolSemanticSummary(
        toolItem({
          durationMs: null,
          finishedAt: null,
          state: 'running',
        }),
        { nowMs: 2_500 },
      ).collapsedLabel,
    ).toBe('正在运行 bun test · 2 秒')
  })

  test('only allows an active command to expand after output arrives', () => {
    expect(
      buildToolItemDisplay(
        toolItem({
          state: 'running',
          durationMs: null,
          finishedAt: null,
          output: '   ',
        }),
      ).canExpand,
    ).toBe(false)
    expect(
      buildToolItemDisplay(
        toolItem({
          state: 'running',
          durationMs: null,
          finishedAt: null,
          output: 'partial output',
        }),
      ),
    ).toMatchObject({
      canExpand: true,
      collapsedLabel: '正在运行 bun test',
      expandedLabel: '正在运行 bun test',
      resultText: 'partial output',
    })
  })

  test('uses shared descriptors for activity labels and icons', () => {
    const scenarios = [
      [
        {
          type: 'read',
          subject: 'file',
          target: {
            displayLabel: 'src/ConversationPage.tsx',
            workspacePath: 'src/ConversationPage.tsx',
          },
        },
        '正在读取 src/ConversationPage.tsx',
        '已读取 src/ConversationPage.tsx',
        'read',
      ],
      [
        { type: 'search', query: 'canRegenerate' },
        '正在搜索“canRegenerate”',
        '已搜索“canRegenerate”',
        'search',
      ],
      [{ type: 'list_files' }, '正在列出文件', '已列出文件', 'list-files'],
      [{ type: 'tool', mode: 'search' }, '正在搜索工具', '已搜索工具', 'tool'],
      [
        { type: 'tool', mode: 'load', name: 'browser.open' },
        '正在加载工具 browser.open',
        '已加载工具 browser.open',
        'skill',
      ],
      [
        { type: 'read', subject: 'skill', target: { displayLabel: 'reverse-engineer-ui-feature' } },
        '正在读取 reverse-engineer-ui-feature 技能',
        '已读取 reverse-engineer-ui-feature 技能',
        'skill',
      ],
      [{ type: 'web_search' }, '正在搜索网页', '已搜索网页', 'web-search'],
      [
        { type: 'integration', source: 'github' },
        '正在使用 github',
        '已使用 github',
        'integration',
      ],
      [
        { type: 'command', kind: 'skill_script', skillName: 'review', scriptName: 'check.py' },
        '正在运行 review 技能中的脚本 check.py',
        '已运行 review 技能中的脚本 check.py · 1 秒',
        'command',
      ],
      [
        { type: 'command', kind: 'current_time' },
        '正在检查当前日期和时间',
        '已检查当前日期和时间 · 1 秒',
        'current-time',
      ],
    ] as const

    for (const [activity, runningLabel, completedLabel, iconKind] of scenarios) {
      const running = buildToolSemanticSummary(
        toolItem({
          command: null,
          activity,
          state: 'running',
        }),
      )
      const completed = buildToolSemanticSummary(
        toolItem({
          command: null,
          activity,
        }),
      )
      expect(running.collapsedLabel).toBe(runningLabel)
      expect(completed.collapsedLabel).toBe(completedLabel)
      expect(completed.iconKind).toBe(iconKind)
    }

    expect(
      buildToolSemanticSummary(
        toolItem({
          activity: undefined,
          command: null,
          input: { secret: 'do-not-render' },
          state: 'error',
          tool: 'internal.private_tool',
        }),
      ),
    ).toMatchObject({
      collapsedLabel: '工具调用失败 internal.private_tool',
      toolLabel: '工具',
    })

    expect(buildToolSemanticSummary(toolItem()).kind).toBe('command')
    expect(
      buildToolSemanticSummary(
        toolItem({
          activity: { type: 'read', subject: 'file', target: { displayLabel: 'src/a.ts' } },
          command: null,
          tool: 'Read',
        }),
      ).kind,
    ).toBe('exploration')
    expect(
      buildToolSemanticSummary(
        toolItem({
          activity: { type: 'web_search' },
          command: null,
          tool: 'web__run',
        }),
      ).kind,
    ).toBe('web-search')
    expect(
      buildToolSemanticSummary(
        toolItem({
          activity: { type: 'integration', source: 'drive' },
          command: null,
          tool: 'mcp__drive__search',
        }),
      ).kind,
    ).toBe('integration')
    expect(
      buildToolSemanticSummary(
        toolItem({
          activity: { type: 'tool', mode: 'call' },
          command: null,
          tool: 'internal.private_tool',
        }),
      ).kind,
    ).toBe('tool')
  })

  test('uses state-specific failure and interruption labels', () => {
    expect(
      buildToolSemanticSummary(
        toolItem({
          state: 'error',
        }),
      ).collapsedLabel,
    ).toBe('运行失败 bun test · 1 秒')
    expect(
      buildToolSemanticSummary(
        toolItem({
          state: 'interrupted',
        }),
      ).collapsedLabel,
    ).toBe('已停止执行 bun test · 1 秒')
    expect(
      buildToolSemanticSummary(
        toolItem({
          activity: {
            type: 'read',
            subject: 'file',
            target: { displayLabel: 'ConversationPage.tsx' },
          },
          command: null,
          input: { file_path: 'C:\\private\\ConversationPage.tsx' },
          state: 'interrupted',
          tool: 'Read',
        }),
      ).collapsedLabel,
    ).toBe('已停止读取 ConversationPage.tsx')
    expect(
      buildToolItemDisplay(
        toolItem({
          command: null,
          input: { file_path: 'C:\\private\\ConversationPage.tsx' },
          tool: 'Read',
        }),
      ).executionContent,
    ).not.toContain('C:\\private')
  })

  test('projects structured tool inputs and outputs into focused details', () => {
    expect(
      buildStructuredToolDetail(
        toolItem({
          command: null,
          input: { file_path: 'src/ConversationPage.tsx', limit: 20 },
          output: JSON.stringify({
            content: 'const conversation = true;\n',
            lineCount: 1,
            path: 'src/ConversationPage.tsx',
          }),
          tool: 'Read',
        }),
      ),
    ).toEqual({
      executionContent: 'src/ConversationPage.tsx',
      resultText: 'const conversation = true;\n',
    })
    expect(
      buildStructuredToolDetail(
        toolItem({
          command: null,
          input: { pattern: 'canRegenerate', path: 'apps' },
          output: JSON.stringify({
            files: ['src/a.ts', 'C:\\private\\src\\b.ts'],
            engine: 'ripgrep',
          }),
          tool: 'Grep',
        }),
      ),
    ).toEqual({
      executionContent: 'canRegenerate',
      resultText: JSON.stringify(['src/a.ts', 'b.ts'], null, 2),
    })
    expect(
      buildStructuredToolDetail(
        toolItem({
          command: null,
          input: { pattern: 'needle' },
          output: JSON.stringify({
            matches: [
              {
                path: 'C:\\private\\src\\secret.ts',
                line: 4,
                text: 'const needle = true;',
                internal: 'do-not-render',
              },
            ],
          }),
          tool: 'Grep',
        }),
      )?.resultText,
    ).toBe(
      JSON.stringify(
        [
          {
            path: 'secret.ts',
            line: 4,
            text: 'const needle = true;',
          },
        ],
        null,
        2,
      ),
    )
    expect(
      buildStructuredToolDetail(
        toolItem({
          command: null,
          input: { pattern: '**/*.tsx' },
          output: JSON.stringify({ matches: ['src/a.tsx'] }),
          tool: 'Glob',
        }),
      ),
    ).toEqual({
      executionContent: '**/*.tsx',
      resultText: JSON.stringify(['src/a.tsx'], null, 2),
    })
    expect(
      buildStructuredToolDetail(
        toolItem({
          command: null,
          input: { query: 'select:apply_patch' },
          output: JSON.stringify({ tools: [{ name: 'apply_patch' }] }),
          tool: 'tool.search',
        }),
      ),
    ).toEqual({
      executionContent: 'select:apply_patch',
      resultText: JSON.stringify([{ name: 'apply_patch' }], null, 2),
    })
    expect(
      buildStructuredToolDetail(
        toolItem({
          command: null,
          input: { name: 'reverse-engineer-ui-feature' },
          output: JSON.stringify({ content: '# Skill\n完整内容' }),
          tool: 'skill_read',
        }),
      ),
    ).toEqual({
      executionContent: 'reverse-engineer-ui-feature',
      resultText: '# Skill\n完整内容',
    })
  })

  test('does not fall back to whole JSON for missing structured fields', () => {
    const missing = buildStructuredToolDetail(
      toolItem({
        command: null,
        input: { pattern: 'needle', secret: 'do-not-render' },
        output: JSON.stringify({ engine: 'ripgrep', secret: 'do-not-render' }),
        tool: 'Grep',
      }),
    )
    expect(missing).toEqual({
      executionContent: 'needle',
      resultText: null,
    })
    expect(
      buildToolItemDisplay(
        toolItem({
          command: null,
          input: { pattern: 'needle', secret: 'do-not-render' },
          output: JSON.stringify({ engine: 'ripgrep', secret: 'do-not-render' }),
          tool: 'Grep',
        }),
      ).resultText,
    ).toBeNull()

    expect(
      buildStructuredToolDetail(
        toolItem({
          command: null,
          error: '读取失败',
          input: {},
          output: '安全的非 JSON 输出',
          tool: 'Read',
        }),
      ),
    ).toEqual({
      executionContent: '未提供文件路径',
      resultText: '安全的非 JSON 输出\n读取失败',
    })
  })

  test('renders lifecycle tools as non-expandable live status rows', () => {
    const scenarios = [
      ['update_plan', '正在更新计划', '已更新计划', '更新计划', 'lucide-notepad-text'],
      ['request_permissions', '正在请求权限', '已请求权限', '请求权限', 'lucide-shield'],
      [
        'request_user_input',
        '正在询问问题',
        '已发起提问',
        '提问',
        'lucide-message-circle-question',
      ],
      ['spawn_agents', '正在创建子代理', '已创建子代理', '创建子代理', 'lucide-user-round-plus'],
      ['wait_agents', '正在等待子代理', '子代理已返回', '等待子代理', 'lucide-hourglass'],
      ['send_agent', '正在通知子代理', '已通知子代理', '通知子代理', 'lucide-send'],
      ['stop_agent', '正在停止子代理', '已停止子代理', '停止子代理', 'lucide-circle-stop'],
      [
        'finalize_result',
        '正在提交子代理结果',
        '已提交子代理结果',
        '提交子代理结果',
        'lucide-clipboard-check',
      ],
    ] as const

    for (const [tool, runningLabel, completedLabel, toolLabel, iconClass] of scenarios) {
      const running = toolItem({
        command: null,
        input: {},
        output: null,
        state: 'running',
        tool,
      })
      const completed = toolItem({
        command: null,
        input: {},
        output: '{}',
        tool,
      })
      expect(buildLifecycleToolDisplay(running)).toMatchObject({
        active: true,
        label: runningLabel,
        toolLabel,
      })
      expect(buildLifecycleToolDisplay(completed)).toMatchObject({
        active: false,
        label: completedLabel,
        toolLabel,
      })
      expect(buildToolItemDisplay(completed)).toMatchObject({
        canExpand: false,
        collapsedLabel: completedLabel,
        resultText: null,
        toolLabel,
      })
      expect(isStandaloneLifecycleTool(completed)).toBe(true)

      const runningMarkup = renderToStaticMarkup(<LifecycleToolItemView item={running} />)
      const completedMarkup = renderToStaticMarkup(
        <LifecycleToolItemView item={completed} isSubagent />,
      )
      const failedMarkup = renderToStaticMarkup(
        <LifecycleToolItemView
          item={toolItem({
            command: null,
            error: 'failed',
            input: {},
            output: null,
            state: 'error',
            tool,
          })}
        />,
      )

      expect(runningMarkup).toContain(iconClass)
      expect(runningMarkup).toContain('canonical-lifecycle-tool__icon-flash')
      expect(runningMarkup).not.toContain('lucide-loader-circle')
      expect(completedMarkup).toContain(iconClass)
      expect(completedMarkup).not.toContain('canonical-lifecycle-tool__icon-flash')
      expect(completedMarkup).not.toContain('lucide-check')
      expect(failedMarkup).toContain('lucide-circle-alert')
      expect(failedMarkup).not.toContain(iconClass)
    }

    const interruptedMarkup = renderToStaticMarkup(
      <LifecycleToolItemView
        item={toolItem({
          command: null,
          input: {},
          output: null,
          state: 'interrupted',
          tool: 'update_plan',
        })}
      />,
    )
    expect(interruptedMarkup).toContain('class="canonical-lifecycle-tool"')
    expect(interruptedMarkup).toContain('已中断更新计划')
    expect(interruptedMarkup).toContain('lucide-circle-alert')
    expect(interruptedMarkup).not.toContain('lucide-notepad-text')
    expect(interruptedMarkup).not.toContain('<details')
    expect(interruptedMarkup).not.toContain('lucide-chevron')
  })

  test('combines output and error without leaking apply-patch input', () => {
    const result = buildToolItemDisplay(
      toolItem({
        tool: 'workspace.apply_patch',
        title: '应用补丁',
        command: null,
        input: {
          patch: '*** Update File: C:\\secret\\source.ts\n-old\n+new',
          patchBytes: 42,
        },
        output: 'partial',
        error: 'failed',
      }),
    )

    expect(result.resultText).toBe('partial\nfailed')
    expect(result.executionContent).toContain('[补丁正文已隐藏]')
    expect(result.executionContent).not.toContain('C:\\secret')
  })

  test('renders separate copy actions and omits result copy for empty output', () => {
    const withResultItem = toolItem({ output: 'pass', error: 'warning' })
    const withResult = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={withResultItem} view={buildToolItemDisplay(withResultItem)} />
      </TooltipProvider>,
    )
    const withoutResultItem = toolItem({ output: null, error: null })
    const withoutResult = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard
          item={withoutResultItem}
          view={buildToolItemDisplay(withoutResultItem)}
        />
      </TooltipProvider>,
    )

    expect(withResult).toContain('aria-label="复制执行内容"')
    expect(withResult).toContain('aria-label="复制返回结果"')
    expect(withResult).toContain('pass\nwarning')
    expect(withoutResult).toContain('aria-label="复制执行内容"')
    expect(withoutResult).not.toContain('aria-label="复制返回结果"')
    expect(withoutResult).toContain('无输出')
    expect(withResult).not.toContain('<figure')
    expect(withoutResult).not.toContain('<figure')
    expect(withResult).toContain('canonical-command-card')
    const output = withResult.slice(withResult.indexOf('aria-label="返回结果"'))
    expect(output).not.toContain('<details')
    expect(withResult).not.toContain('<details class="md-code-disclosure">')
    expect(withResult.match(/bun test/g)).toHaveLength(1)
    expect(withResult).not.toContain('md-code-summary-text')
    expect(output).not.toContain('<figcaption')
    expect(withResult).not.toContain('<figcaption')
    expect(withResult).not.toContain('执行内容 ·')
    expect(output).toContain('canonical-command-card__output-text')
    expect(output).not.toContain('tw:overflow-x-auto')
    expect(withoutResult.match(/<pre/g)).toHaveLength(2)
    expect(withResult.match(/<pre/g)).toHaveLength(2)
    expect(withResult).toContain('canonical-command-shell__prompt')
  })

  test('renders multiline execution content once inside its collapsed summary', () => {
    const command = ['python script.py', 'second line', 'third line'].join(String.fromCharCode(10))
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <CodeBlock collapsible code={command} language="text" />
      </TooltipProvider>,
    )
    expect(markup).toContain(command)
    expect(markup.match(/second line/g)).toHaveLength(1)
    expect(markup).toContain('<details class="md-code-disclosure">')
    expect(markup).not.toContain('<pre')
    expect(markup).not.toContain('lucide-chevron')
  })

  test('renders the command viewport with a collapsed two-line limit by default', () => {
    const command = ['bun -e \'const fs=require("fs")\';', 'second line', 'third line'].join(
      String.fromCharCode(10),
    )
    const item = toolItem({ command })
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )

    expect(markup).toContain('canonical-command-card__command-viewport')
    // 命令正文与 $ 提示符同处一个滚动视口，收起态不展开。
    expect(markup).toContain('data-expanded="false"')
    expect(markup).toContain('aria-label="执行内容"')
    expect(markup).toContain('third line')
    // 测试环境没有布局，收起态不渲染实测得出的折叠按钮。
    expect(markup).not.toContain('canonical-command-card__command-toggle')
    // 结果区不提供折叠入口。
    const output = markup.slice(markup.indexOf('aria-label="返回结果"'))
    expect(output).not.toContain('canonical-command-card__command-toggle')
  })

  test('keeps ordinary code blocks on a standalone surface', () => {
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <CodeBlock code="const answer = 42" language="typescript" />
      </TooltipProvider>,
    )
    expect(markup).toContain('data-surface="standalone"')
    expect(markup.match(/md-code-surface/g)).toHaveLength(1)
    expect(markup).toContain('aria-label="复制代码"')
    expect(markup).toContain('typescript')
    expect(markup).toContain('const answer = 42')
    expect(markup).not.toContain('<details')
  })

  test('renders workspace targets as isolated file links', () => {
    const linked = renderToStaticMarkup(
      <TooltipProvider>
        <ConversationItemContext.Provider
          value={{
            canCopyFileReferenceContents: () => false,
            onCopyFileReferenceContents: () => undefined,
            onOpenFileReference: () => undefined,
            onSubmitEditedUserMessage: async () => undefined,
            sessionStatus: 'idle',
            workspacePath: 'C:\\workspace',
          }}
        >
          <ToolItemView
            item={toolItem({
              activity: {
                type: 'read',
                subject: 'file',
                target: { displayLabel: 'src/a.ts', workspacePath: 'src/a.ts' },
              },
              command: null,
              tool: 'Read',
            })}
          />
        </ConversationItemContext.Provider>
      </TooltipProvider>,
    )
    const displayOnly = renderToStaticMarkup(
      <TooltipProvider>
        <ToolItemView
          item={toolItem({
            activity: { type: 'read', subject: 'file', target: { displayLabel: 'external.ts' } },
            command: null,
            tool: 'Read',
          })}
        />
      </TooltipProvider>,
    )

    expect(linked).toContain('class="cpx-agent-activity__file-link"')
    expect(linked).toContain('aria-label="打开文件 src/a.ts"')
    expect(displayOnly).not.toContain('cpx-agent-activity__file-link')
  })

  test('renders grouped commands as embedded shells without losing details', () => {
    const item = toolItem({ output: 'pass' })
    const embedded = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} presentation="grouped" view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )
    const standalone = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )
    const groupedItem = renderToStaticMarkup(
      <TooltipProvider>
        <ToolItemView
          disclosure={{
            id: 'tool:turn-1:tool-1',
            expanded: true,
            onExpandedChange: () => undefined,
          }}
          item={item}
          presentation="grouped"
        />
      </TooltipProvider>,
    )

    expect(embedded).toContain('canonical-command-shell--embedded')
    expect(embedded).not.toContain('md-code-header')
    expect(embedded).not.toContain('>bash</span>')
    expect(embedded).toContain('aria-label="复制执行内容"')
    expect(embedded).toContain('aria-label="复制返回结果"')
    expect(embedded).toContain('bun test')
    expect(embedded).toContain('pass')
    expect(embedded).toContain('成功')
    expect(standalone).not.toContain('canonical-command-shell--embedded')
    expect(standalone).not.toContain('md-code-header')
    expect(standalone).not.toContain('>bash</span>')
    expect(groupedItem).toContain('data-presentation="grouped"')
    expect(groupedItem).toContain('canonical-command-shell--embedded')
  })

  test('keeps the controlled disclosure mode for command details', () => {
    const item = toolItem()
    const collapsed = renderToStaticMarkup(
      <TooltipProvider>
        <ToolItemView
          disclosure={{
            id: 'tool:turn-1:tool-1',
            expanded: false,
            onExpandedChange: () => undefined,
          }}
          item={item}
        />
      </TooltipProvider>,
    )
    const expanded = renderToStaticMarkup(
      <TooltipProvider>
        <ToolItemView
          disclosure={{
            id: 'tool:turn-1:tool-1',
            expanded: true,
            onExpandedChange: () => undefined,
          }}
          item={item}
        />
      </TooltipProvider>,
    )

    expect(collapsed.replace(/<[^>]*>/g, '')).toContain('已运行 bun test · 1 秒')
    expect(collapsed).toContain('class="cpx-agent-activity__duration"> · 1 秒</span>')
    expect(collapsed).not.toContain('title="已运行 bun test · 1 秒"')
    expect(collapsed).not.toContain('aria-label="执行内容"')
    expect(collapsed).toContain('data-mount-policy="until-exit"')
    expect(collapsed).toContain('aria-hidden="true"')
    expect(collapsed).toContain('inert')
    expect(collapsed).not.toContain('canonical-command-shell')
    expect(collapsed).toContain('lucide-chevron-right')
    expect(collapsed).not.toContain('lucide-chevron-down')
    expect(expanded.replace(/<[^>]*>/g, '')).toContain('已运行 bun test · 1 秒')
    expect(expanded).not.toContain('title="已运行 bun test · 1 秒"')
    expect(expanded).toContain('aria-label="执行内容"')
    expect(expanded).toContain('lucide-chevron-right')
    expect(expanded).not.toContain('lucide-chevron-down')
  })

  test('extracts file mutations and renders one row per affected file', () => {
    const item = toolItem({
      command: null,
      input: {
        additions: 3,
        affectedPaths: [
          { path: 'src/a.ts', operation: 'update' },
          { path: 'src/b.ts', operation: 'create', additions: 2, deletions: 0 },
        ],
        deletions: 1,
      },
      output: null,
      tool: 'workspace.apply_patch',
    })
    const mutation = fileMutationDisplay(item)
    expect(mutation).toMatchObject({
      files: [
        { additions: null, deletions: null, path: 'src/a.ts' },
        { additions: 2, deletions: 0, path: 'src/b.ts' },
      ],
      totalAdditions: 3,
      totalDeletions: 1,
    })

    const markup = renderToStaticMarkup(<FileMutationItemView item={item} />)
    expect(markup).toContain('已编辑 a.ts')
    expect(markup).toContain('已创建 b.ts')
    expect(markup).toContain('+2')
    expect(markup).not.toContain('+0</small><small')
  })

  test('shows only the file name and keeps the absolute path in the hover title', () => {
    const renderInWorkspace = (item: ToolItem) =>
      renderToStaticMarkup(
        <ConversationItemContext.Provider
          value={{
            canCopyFileReferenceContents: () => false,
            onCopyFileReferenceContents: () => undefined,
            onOpenFileReference: () => undefined,
            onSubmitEditedUserMessage: async () => undefined,
            sessionStatus: 'idle',
            workspacePath: 'C:\\workspace',
          }}
        >
          <FileMutationItemView item={item} />
        </ConversationItemContext.Provider>,
      )

    const relative = renderInWorkspace(
      toolItem({
        command: null,
        input: { file_path: 'src/features/a.ts' },
        output: null,
        tool: 'Edit',
      }),
    )
    expect(relative).toContain('已编辑 a.ts')
    expect(relative).not.toContain('已编辑 src/features/a.ts')
    expect(relative).toContain('title="C:/workspace/src/features/a.ts"')

    const absolute = renderInWorkspace(
      toolItem({
        command: null,
        input: { file_path: 'C:\\outside\\probe.mjs' },
        output: null,
        tool: 'Write',
      }),
    )
    expect(absolute).toContain('已编辑 probe.mjs')
    expect(absolute).toContain('title="C:/outside/probe.mjs"')

    const unknown = renderInWorkspace(
      toolItem({ command: null, input: {}, output: null, tool: 'Edit' }),
    )
    expect(unknown).toContain('已编辑 文件')
    expect(unknown).not.toContain('title=')
  })

  test('only exposes completed file mutations backed by diff evidence', () => {
    const completed = toolItem({
      command: null,
      input: { additions: 1, deletions: 0, file_path: 'src/a.ts' },
      mutationDiffPaths: ['src\\a.ts'],
      output: null,
      tool: 'Edit',
    })
    const expandableMarkup = renderToStaticMarkup(
      <ExpandableFileMutationRow
        diffMarkerStyle="color"
        disclosure={{
          id: 'file-mutation:tool-1:0',
          store: disclosureStore('file-mutation:tool-1:0'),
        }}
        file={{ additions: 1, deletions: 0, path: 'src/a.ts' }}
        item={completed}
        readThreadPatchDiff={async () => {
          throw new Error('not called during server render')
        }}
        threadId="thread-1"
      />,
    )
    const legacyMarkup = renderToStaticMarkup(
      <FileMutationItemView item={{ ...completed, mutationDiffPaths: undefined }} />,
    )
    const runningMarkup = renderToStaticMarkup(
      <FileMutationItemView
        disclosureStore={disclosureStore('file-mutation:tool-1:0')}
        item={{ ...completed, state: 'running' }}
        readThreadPatchDiff={async () => {
          throw new Error('not called during server render')
        }}
        threadId="thread-1"
      />,
    )

    expect(expandableMarkup).toContain('data-expandable="true"')
    expect(expandableMarkup).toContain('lucide-chevron-right')
    expect(expandableMarkup).toContain('正在加载差异')
    expect(legacyMarkup).toContain('cpx-agent-activity__item-header--static')
    expect(legacyMarkup).not.toContain('<details')
    expect(legacyMarkup).not.toContain('<summary')
    expect(legacyMarkup).not.toContain('lucide-chevron')
    expect(runningMarkup).not.toContain('<details')
    expect(runningMarkup).not.toContain('lucide-chevron')
  })

  test('loads a thread patch with exact params and reuses a successful result', async () => {
    const calls: unknown[] = []
    let resolveRequest!: (
      value: Awaited<ReturnType<Parameters<typeof createThreadPatchDiffLoader>[0]>>,
    ) => void
    const result = {
      path: 'src/a.ts',
      operation: 'update' as const,
      patch: '',
      hunks: [],
      renderable: true,
      tooLargeReason: null,
    }
    const loader = createThreadPatchDiffLoader((params) => {
      calls.push(params)
      return new Promise((resolve) => {
        resolveRequest = resolve
      })
    })
    const states: string[] = []
    loader.request(
      'thread-1:call-1:src/a.ts',
      { threadId: 'thread-1', toolCallId: 'call-1', path: 'src/a.ts' },
      (state) => states.push(state.status),
    )
    expect(calls).toEqual([{ threadId: 'thread-1', toolCallId: 'call-1', path: 'src/a.ts' }])
    resolveRequest(result)
    await Promise.resolve()
    await Promise.resolve()
    loader.request(
      'thread-1:call-1:src/a.ts',
      { threadId: 'thread-1', toolCallId: 'call-1', path: 'src/a.ts' },
      (state) => states.push(state.status),
    )
    expect(calls).toHaveLength(1)
    expect(states).toEqual(['loading', 'loaded', 'loaded'])
  })

  test('ignores a patch response after its consumer is disposed', async () => {
    let resolveRequest!: (value: {
      path: string
      operation: 'update'
      patch: string
      hunks: []
      renderable: true
      tooLargeReason: null
    }) => void
    const loader = createThreadPatchDiffLoader(
      () =>
        new Promise((resolve) => {
          resolveRequest = resolve
        }),
    )
    const states: string[] = []
    const dispose = loader.request(
      'thread-1:call-1:src/a.ts',
      { threadId: 'thread-1', toolCallId: 'call-1', path: 'src/a.ts' },
      (state) => states.push(state.status),
    )
    dispose()
    resolveRequest({
      path: 'src/a.ts',
      operation: 'update',
      patch: '',
      hunks: [],
      renderable: true,
      tooLargeReason: null,
    })
    await Promise.resolve()
    await Promise.resolve()
    expect(states).toEqual(['loading'])
  })

  test('adapts a thread patch diff to the shared review line model', () => {
    const file = threadPatchDiffToDesktopFile({
      path: 'src/a.ts',
      operation: 'update',
      patch: [
        '--- a/src/a.ts',
        '+++ b/src/a.ts',
        '@@ -1,2 +1,2 @@',
        '-old',
        '+new',
        ' context',
        '',
      ].join('\n'),
      hunks: [
        {
          id: 'hunk-1',
          header: '@@ -1,2 +1,2 @@',
          oldStart: 1,
          oldLines: 2,
          newStart: 1,
          newLines: 2,
          patch: '@@ -1,2 +1,2 @@\n-old\n+new\n context',
        },
      ],
      renderable: true,
      tooLargeReason: null,
    })

    expect(file).toMatchObject({
      path: 'src/a.ts',
      status: 'modified',
      additions: 1,
      deletions: 1,
    })
    expect(file.hunks[0]?.lines).toEqual([
      expect.objectContaining({ type: 'removed', oldLine: 1, newLine: null, content: 'old' }),
      expect.objectContaining({ type: 'added', oldLine: null, newLine: 1, content: 'new' }),
      expect.objectContaining({ type: 'context', oldLine: 2, newLine: 2, content: 'context' }),
    ])
  })

  test('builds a terminal fallback patch from successful mutation tools only', () => {
    const completed = toolItem({
      command: null,
      id: 'mutation-1',
      input: { additions: 3, deletions: 1, file_path: 'src/a.ts' },
      output: null,
      tool: 'Write',
    })
    const failed = toolItem({
      command: null,
      id: 'mutation-2',
      input: { additions: 10, deletions: 10, path: 'src/b.ts' },
      output: null,
      state: 'error',
      tool: 'Edit',
    })
    expect(syntheticPatchDisplay([completed, failed])).toMatchObject({
      files: [{ additions: 3, deletions: 1, path: 'src/a.ts' }],
      totalAdditions: 3,
      totalDeletions: 1,
    })
  })

  test('renders text, citation, JSON and artifact result blocks without API name branches', () => {
    const item = toolItem({
      command: null,
      input: null,
      output: null,
      resultBlocks: [
        { type: 'text', text: '结论' },
        { type: 'citation', title: '示例来源', url: 'https://example.com/source' },
        { type: 'citation', url: 'https://example.com/bare' },
        { type: 'citation', url: 'file:///etc/passwd' },
        { type: 'json', value: { items: [{ id: 1, ok: true }] } },
        {
          type: 'artifact',
          artifactId: 'artifact:1',
          name: 'preview.png',
          mimeType: 'image/png',
          size: 1024,
        },
        {
          type: 'artifact',
          artifactId: 'artifact:2',
          name: 'notes.txt',
          mimeType: 'text/plain',
          size: 42,
        },
      ],
    })
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )

    expect(markup).toContain('canonical-tool-result-blocks')
    expect(markup).toContain('canonical-tool-result-block--text')
    expect(markup).toContain('结论')
    // citation: 安全可点击链接仅放行 http/https，且标题优先。
    expect(markup).toContain('href="https://example.com/source"')
    expect(markup).toContain('示例来源')
    expect(markup).toContain('href="https://example.com/bare"')
    // 非 http/https 的 citation 渲染为纯文本，不生成可点击链接。
    expect(markup).not.toContain('href="file:///etc/passwd"')
    // json: 结构化展示不按工具名分支。
    expect(markup).toContain('canonical-tool-result-block--json')
    expect(markup).toContain('&quot;ok&quot;: true')
    // artifact: 图片走预览 tile，其他类型走通用文件 pill。
    expect(markup).toContain('attachment-image-tile')
    expect(markup).toContain('preview.png')
    expect(markup).toContain('attachment-file-pill')
    expect(markup).toContain('notes.txt')
  })

  test('renders structured tool calls with json language and deduplicates duplicate error text blocks', () => {
    const errorText = '窗口引用已失效，请重新发现应用'
    const item = toolItem({
      command: null,
      tool: 'ComputerRead',
      activity: { type: 'integration' },
      input: { windowRef: '5d67efc3-1a2b-4824-9883-e3bdc66b6733' },
      output: null,
      error: errorText,
      state: 'error',
      resultBlocks: [{ type: 'text', text: errorText }],
    })
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )

    // Language detection recognizes JSON input and does not label it as Shell
    expect(markup).toContain('>json</span>')
    expect(markup).not.toContain('>Shell</span>')
    expect(markup).toContain('5d67efc3-1a2b-4824-9883-e3bdc66b6733')
    expect(markup).toContain(errorText)
    // Error text is rendered in CodeBlock and deduplicated from resultBlocks (not repeated twice)
    const errorMatches = markup.match(new RegExp(errorText, 'g'))
    expect(errorMatches).toHaveLength(1)
    expect(markup).not.toContain('canonical-tool-result-block--text')
    expect(markup).toContain('失败')
  })

  test('filters out process execution envelopes from resultBlocks completely', () => {
    const item = toolItem({
      command: 'git status',
      output: JSON.stringify({
        exitCode: 0,
        signal: null,
        stdout: 'On branch dev\nclean working tree',
        stderr: '',
        timedOut: false,
        truncated: false,
      }),
      resultBlocks: [
        {
          type: 'json',
          value: {
            exitCode: 0,
            signal: null,
            stdout: 'On branch dev\nclean working tree',
            stderr: '',
            timedOut: false,
            truncated: false,
          },
        },
        {
          type: 'text',
          text: JSON.stringify({
            exitCode: 0,
            signal: null,
            stdout: 'On branch dev\nclean working tree',
            stderr: '',
          }),
        },
        {
          type: 'artifact',
          artifactId: 'art-1',
          name: 'screenshot.png',
          mimeType: 'image/png',
        },
      ],
    })

    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )

    expect(markup).toContain('On branch dev\nclean working tree')
    expect(markup).toContain('attachment-image-tile')
    expect(markup).not.toContain('exitCode')
    expect(markup).not.toContain('timedOut')
    expect(markup).not.toContain('canonical-tool-result-block--json')
    expect(markup).not.toContain('canonical-tool-result-block--text')
  })

  test('renders a single legacy text block when resultBlocks are absent', () => {
    const item = toolItem({ command: null, input: null, output: '旧字符串结果' })
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )
    expect(markup).not.toContain('canonical-tool-result-blocks')
    expect(markup).toContain('旧字符串结果')
    expect(markup).toContain('aria-label="复制返回结果"')
  })

  test('renders the shared result card for an explicit envelope block', () => {
    const item = toolItem({
      command: null,
      input: null,
      output: '结论',
      resultBlocks: [{ type: 'json', value: resultCardEnvelope() }],
    })
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )

    expect(markup).toContain('class="canonical-result-card"')
    expect(markup).toContain('data-tone="success"')
    expect(markup).toContain('任务已完成')
    expect(markup).toContain('成功')
    expect(markup).toContain('回归通过并修复了参数校验')
    expect(markup).toContain('关键结论')
    expect(markup).toContain('<dl')
    expect(markup).toContain('<dt>修复了校验边界</dt>')
    expect(markup).toContain('<dd>空参数不再通过</dd>')
    expect(markup).toContain('lucide-check')
    expect(markup).toContain('aria-label="复制结构化结果"')
    // 安全引用：https 链接可点击，凭证/非 http 地址保持纯文本。
    expect(markup).toContain('href="https://example.com/report"')
    expect(markup).not.toContain('javascript:')
    expect(markup).not.toContain('canonical-tool-result-block--json')
    expect(markup).not.toContain('&quot;kind&quot;')
  })

  test('keeps plain, forged and future JSON blocks as code', () => {
    const blocks = [
      { items: [{ id: 1, ok: true }] },
      { kind: 'pidex.result-card', version: 1, card: { title: '缺少摘要' } },
      {
        kind: 'pidex.result-card',
        version: 2,
        card: { title: '未来版本', summary: '未知版本' },
      },
      {
        kind: 'pidex.other-card',
        version: 1,
        card: { title: '错误标记', summary: '未知标记' },
      },
    ]
    for (const value of blocks) {
      const item = toolItem({
        command: null,
        input: null,
        output: '结论',
        resultBlocks: [{ type: 'json', value }],
      })
      const markup = renderToStaticMarkup(
        <TooltipProvider>
          <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
        </TooltipProvider>,
      )
      expect(markup).toContain('canonical-tool-result-block--json')
      expect(markup).not.toContain('canonical-result-card')
    }
  })

  test('renders historical main delivery as text and keeps child submission compact', () => {
    const item = toolItem({
      command: null,
      input: {},
      output: '已提交结构化结果（outcome: succeeded · 已完成）',
      resultBlocks: [{ type: 'json', value: resultCardEnvelope() }],
      tool: 'finalize_result',
    })
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <LifecycleToolItemView item={item} />
      </TooltipProvider>,
    )

    expect(markup).toContain('canonical-text-item--result')
    expect(markup).not.toContain('已提交子代理结果')
    expect(markup).not.toContain('canonical-result-card')
    expect(markup).toContain('回归通过并修复了参数校验')
    expect(markup).toContain('空参数不再通过')
    expect(markup).toContain('https://example.com/report')
    expect(markup).not.toContain('canonical-tool-result-block--json')
    const childMarkup = renderToStaticMarkup(<LifecycleToolItemView item={item} isSubagent />)
    expect(childMarkup).toContain('已提交子代理结果')
    expect(childMarkup).not.toContain('回归通过并修复了参数校验')
    expect(childMarkup).not.toContain('canonical-result-card')
    for (const state of ['running', 'error', 'interrupted'] as const) {
      const statusMarkup = renderToStaticMarkup(<LifecycleToolItemView item={{ ...item, state }} />)
      expect(statusMarkup).toContain(`data-state="${state}"`)
      expect(statusMarkup).not.toContain('canonical-result-card')
    }
  })

  test('keeps every result field and unknown historical payload without rewriting data', () => {
    const result = {
      outcome: 'partial' as const,
      summary: '仍有未决问题',
      findings: [{ title: '发现', detail: '结论证据', severity: 'warning' as const }],
      changedFiles: [{ path: 'src/tool.ts', summary: '修复边界' }],
      validation: [{ command: 'bun test', status: 'failed' as const, output: '失败详情' }],
      risks: ['需进一步确认'],
      references: [{ kind: 'file' as const, value: 'src/tool.ts', label: '实现' }],
    }
    const item = toolItem({
      tool: 'finalize_result',
      resultBlocks: [{ type: 'json', value: result }],
    })
    const before = JSON.stringify(item)
    const text = historicalDeliveryText(item, 'C:\\workspace')!
    expect(text).toBe(subagentResultMarkdown(result, 'C:\\workspace'))
    for (const value of [
      '部分完成',
      '结论证据',
      '修复边界',
      'bun test（失败）',
      '失败详情',
      '需进一步确认',
      '[实现](<src/tool.ts>)',
    ]) {
      expect(text).toContain(value)
    }
    expect(JSON.stringify(item)).toBe(before)
    const mirrored = historicalDeliveryText(
      {
        ...item,
        input: { ...result, summary: '未经脱敏的输入内容' },
        output: '已提交结构化结果（outcome: succeeded · 已完成）\n摘要：回归通过并修复了参数校验',
        resultBlocks: [
          {
            type: 'text',
            text: '已提交结构化结果（outcome: succeeded · 已完成）\n摘要：回归通过并修复了参数校验',
          },
          { type: 'json', value: resultCardEnvelope() },
        ],
      },
      'C:\\workspace',
    )!
    expect(mirrored.match(/回归通过并修复了参数校验/gu)).toHaveLength(1)
    expect(mirrored).not.toContain('已提交结构化结果')
    expect(mirrored).not.toContain('未经脱敏的输入内容')
    const fullOutput = '已提交结构化结果（outcome: succeeded · 已完成）\n摘要：未截短的完整摘要'
    expect(
      historicalDeliveryText({
        ...item,
        resultBlocks: [
          { type: 'text', text: fullOutput },
          { type: 'json', value: resultCardEnvelope() },
        ],
      }),
    ).toContain('未截短的完整摘要')
    expect(
      historicalDeliveryText({
        ...item,
        resultBlocks: [{ type: 'json', value: { future: '未知内容' } }],
      }),
    ).toContain('未知内容')
    expect(historicalDeliveryText({ ...item, resultBlocks: [], output: '原始交付' })).toBe(
      '原始交付',
    )
  })

  test('only opens workspace-relative file references', () => {
    const withContext = (card: ReturnType<typeof resultCardEnvelope>) =>
      renderToStaticMarkup(
        <TooltipProvider>
          <ConversationItemContext.Provider
            value={{
              canCopyFileReferenceContents: () => false,
              onCopyFileReferenceContents: () => undefined,
              onOpenFileReference: () => undefined,
              onSubmitEditedUserMessage: async () => undefined,
              sessionStatus: 'idle',
              workspacePath: 'C:\\workspace',
            }}
          >
            <ResultCardView card={card.card} />
          </ConversationItemContext.Provider>
        </TooltipProvider>,
      )

    const relative = withContext(
      resultCardEnvelope({
        card: { references: [{ kind: 'file', value: 'src/tool/tool.ts', label: '工具实现' }] },
      }),
    )
    expect(relative).toContain('canonical-result-card__file-link')
    expect(relative).toContain('aria-label="打开文件 工具实现"')

    const escaping = withContext(
      resultCardEnvelope({
        card: {
          references: [
            { kind: 'file', value: 'C:\\private\\secret.ts' },
            { kind: 'file', value: '../../outside.ts' },
          ],
        },
      }),
    )
    expect(escaping).not.toContain('canonical-result-card__file-link')
    expect(escaping).toContain('secret.ts')

    // 没有工作区上下文时文件引用只展示，不提供打开入口。
    const withoutContext = renderToStaticMarkup(
      <TooltipProvider>
        <ResultCardView
          card={
            resultCardEnvelope({
              card: { references: [{ kind: 'file', value: 'src/tool/tool.ts' }] },
            }).card
          }
        />
      </TooltipProvider>,
    )
    expect(withoutContext).not.toContain('canonical-result-card__file-link')
    expect(withoutContext).toContain('src/tool/tool.ts')
  })

  test('folds long sections behind the existing disclosure control', () => {
    const item = toolItem({
      command: null,
      input: null,
      output: '结论',
      resultBlocks: [
        {
          type: 'json',
          value: resultCardEnvelope({
            card: {
              sections: [
                {
                  title: '验证',
                  items: Array.from({ length: 5 }, (_, index) => ({
                    label: `bun test ${index}`,
                    value: `通过 ${index}`,
                  })),
                },
              ],
            },
          }),
        },
      ],
    })
    const markup = renderToStaticMarkup(
      <TooltipProvider>
        <ToolExecutionCard item={item} view={buildToolItemDisplay(item)} />
      </TooltipProvider>,
    )

    expect(markup).toContain('再显示 2 项')
    expect(markup).toContain('aria-expanded="false"')
    expect(markup).toContain('aria-controls="')
    expect(markup).toContain('bun test 0')
    expect(markup).toContain('bun test 2')
    expect(markup).toContain('ui-disclosure-content')
    // 折叠项在展开前不进入渲染树。
    expect(markup).not.toContain('bun test 3')
    expect(markup).not.toContain('bun test 4')
  })
})
