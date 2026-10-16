import React from 'react'
import { Check, CircleAlert, CircleStop, LoaderCircle, WrapText } from 'lucide-react'
import type { Item } from '@pidex/shared/thread'
import { APP_ICON_SIZES } from '../../../components/ui/IconTokens.js'
import { useScrollEdgeState } from '../../../hooks/UseScrollEdgeState.js'
import { useCodeWrapPreference } from '../../syntax/WrapPreference.js'
import { CopyButton } from './CopyButton.js'

type ToolItem = Extract<Item, { type: 'tool' }>

export function isShellTool(tool: string | null | undefined): boolean {
  if (!tool) return false
  const leaf = tool.split(/[./]/).at(-1)?.toLowerCase() ?? ''
  return /^(shell|bash|powershell|pwsh|cmd|exec|terminal|command|run_command|execute_command)/i.test(
    leaf,
  )
}

export function toolDetailKind(item: ToolItem): 'command' | 'result' | 'generic' {
  switch (item.activity?.type) {
    case 'read':
    case 'search':
    case 'list_files':
      return 'result'
    case 'command':
      return item.activity.kind === 'current_time' || item.activity.kind === 'noop'
        ? 'generic'
        : 'command'
    case undefined:
      return isShellTool(item.tool) && Boolean(item.command?.trim()) ? 'command' : 'generic'
    default:
      return 'generic'
  }
}

export function readCommandExitCode(output: string | null): number | null {
  if (!output) return null
  try {
    const value = JSON.parse(
      output
        .trim()
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, ''),
    )
    const exitCode =
      value?.exitCode ?? value?.exit_code ?? value?.result?.exitCode ?? value?.result?.exit_code
    return Number.isInteger(exitCode) ? exitCode : null
  } catch {
    return null
  }
}

export function isCommandOutputAtBottom(metrics: {
  scrollTop: number
  scrollHeight: number
  clientHeight: number
}): boolean {
  return metrics.scrollHeight - metrics.clientHeight - metrics.scrollTop <= 8
}

export function commandOutputScrollTop(
  metrics: { scrollTop: number; scrollHeight: number; clientHeight: number },
  active: boolean,
  following: boolean,
): number {
  return active && following
    ? Math.max(0, metrics.scrollHeight - metrics.clientHeight)
    : metrics.scrollTop
}

export function commandOutputFollowing(
  active: boolean,
  expanded: boolean,
  wasExpanded: boolean,
  following: boolean,
): boolean {
  return expanded && !wasExpanded ? active : following
}

export function ToolCommandCard({
  item,
  command,
  output,
  statusLabel,
  expanded = true,
  grouped = false,
  children,
}: {
  item: ToolItem
  command: string
  output: string | null
  statusLabel: string
  expanded?: boolean
  grouped?: boolean
  children?: React.ReactNode
}): React.ReactNode {
  const active =
    item.state === 'pending' || item.state === 'waiting-permission' || item.state === 'running'
  const [wrapped, setWrapped] = useCodeWrapPreference()
  const scrollerRef = React.useRef<HTMLDivElement | null>(null)
  const contentRef = React.useRef<HTMLPreElement | null>(null)
  const followingRef = React.useRef(active)
  const wasExpandedRef = React.useRef(false)
  const edge = useScrollEdgeState(scrollerRef, { contentRef, version: output })
  const exitCode = readCommandExitCode(item.output)
  const StatusIcon =
    item.state === 'interrupted'
      ? CircleStop
      : item.state === 'error'
        ? CircleAlert
        : active
          ? LoaderCircle
          : Check

  React.useLayoutEffect(() => {
    // 手动上滚只停止吸底，不冻结数据；重新展开运行中的工具恢复跟随。
    followingRef.current = commandOutputFollowing(
      active,
      expanded,
      wasExpandedRef.current,
      followingRef.current,
    )
    wasExpandedRef.current = expanded
    const scroller = scrollerRef.current
    if (!expanded || !scroller) return
    scroller.scrollTop = commandOutputScrollTop(scroller, active, followingRef.current)
  }, [active, expanded, output, wrapped])

  return (
    <article
      className={`canonical-command-shell canonical-command-card${grouped ? ' canonical-command-shell--embedded' : ''}`}
      data-state={item.state}
    >
      <div className="canonical-command-card__command">
        <span className="canonical-command-shell__prompt" aria-hidden="true">
          $
        </span>
        <pre aria-label="执行内容">{command}</pre>
        <CopyButton
          ariaLabel="复制执行内容"
          text={command}
          className="canonical-command-card__copy"
        />
      </div>
      <div className="canonical-command-card__output">
        <div
          className="canonical-command-shell__edge-fade"
          data-at-start={edge.atStart}
          data-at-end={edge.atEnd}
          data-scrollable={edge.scrollable}
        >
          <div
            className="canonical-command-shell__scroller"
            ref={scrollerRef}
            tabIndex={0}
            aria-label="返回结果"
            onScroll={(event) => {
              followingRef.current = isCommandOutputAtBottom(event.currentTarget)
            }}
          >
            <pre
              ref={contentRef}
              className="canonical-command-card__output-text"
              data-wrapped={wrapped}
            >
              {output ?? (active ? '等待输出' : '无输出')}
            </pre>
          </div>
        </div>
        <div className="canonical-command-card__actions">
          <button
            className="md-code-wrap tw:inline-flex tw:size-6 tw:items-center tw:justify-center tw:rounded-control tw:border-0 tw:text-app-text-soft tw:cursor-pointer tw:focus-visible:ring-1 tw:focus-visible:ring-app-accent"
            type="button"
            aria-label="输出自动换行"
            title="输出自动换行"
            aria-pressed={wrapped}
            onClick={() => setWrapped(!wrapped)}
          >
            <WrapText size={APP_ICON_SIZES.sm} aria-hidden="true" />
          </button>
          {output !== null ? <CopyButton ariaLabel="复制返回结果" text={output} /> : null}
        </div>
      </div>
      {children}
      <footer className="canonical-command-shell__footer">
        <span className="canonical-command-shell__status">
          <StatusIcon
            size={APP_ICON_SIZES.sm}
            aria-hidden="true"
            className={active ? 'canonical-spin' : undefined}
          />
          {statusLabel}
          {!active && exitCode !== null ? ` · 退出码 ${exitCode}` : ''}
        </span>
      </footer>
    </article>
  )
}
