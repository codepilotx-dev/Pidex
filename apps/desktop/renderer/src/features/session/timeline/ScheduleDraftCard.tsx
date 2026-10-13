import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { ScheduleDraft } from '@pidex/shared/schedule-draft'
import type { Item } from '@pidex/shared/thread'
import { Button } from '../../../components/ui/Button.js'
import { Checkbox } from '../../../components/ui/Checkbox.js'
import { Textarea } from '../../../components/ui/Textarea.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { toUserErrorMessage } from '../../../utils/Errors.js'
import { StructuredPlanView } from '../workflow/WorkflowPlanCard.js'

type ToolItem = Extract<Item, { type: 'tool' }>

export function scheduleDraftFromTool(item: ToolItem): ScheduleDraft | null {
  if (item.tool !== 'submit_schedule_plan' || item.state !== 'completed' || !item.output)
    return null
  try {
    const parsed = JSON.parse(item.output) as { draft?: ScheduleDraft }
    return parsed.draft ?? null
  } catch {
    return null
  }
}

export function ScheduleDraftCard({ initial }: { initial: ScheduleDraft }) {
  const navigate = useNavigate()
  const [draft, setDraft] = useState(initial)
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [editing, setEditing] = useState<'任务计划' | '执行安排' | null>(null)
  const [feedback, setFeedback] = useState('')
  const [taskSupported, setTaskSupported] = useState(false)
  const [requireManualAcceptance, setRequireManualAcceptance] = useState(true)
  useEffect(() => {
    let active = true
    setReady(false)
    void Promise.all([
      desktopClient.readScheduleDraft({ id: initial.id }),
      desktopClient.getRuntimeCapabilities(),
    ])
      .then(([{ draft: current }, capabilities]) => {
        if (active) {
          setTaskSupported(capabilities.includes('task.schedule.v1'))
          setDraft(current)
          setReady(true)
          setMessage(null)
        }
      })
      .catch((error: unknown) => {
        if (active) setMessage(toUserErrorMessage(error))
      })
    return () => {
      active = false
    }
  }, [initial.id])

  async function act(kind: 'confirm' | 'feedback' | 'cancel') {
    setBusy(true)
    setMessage(null)
    try {
      const identity = { id: draft.id, expectedRevision: draft.revision }
      const result =
        kind === 'confirm'
          ? await desktopClient.commitScheduleDraft({
              ...identity,
              name: draft.name,
              prompt: draft.prompt,
              trigger: draft.trigger,
              conditions: draft.conditions,
              conditionFallback: draft.conditionFallback,
              acceptance: draft.acceptance,
              ...(taskSupported ? { requireManualAcceptance } : {}),
              notificationPolicy: draft.notificationPolicy,
              missedRuns: draft.missedRuns,
              execution: draft.execution,
            })
          : kind === 'feedback'
            ? await desktopClient.feedbackScheduleDraft({
                ...identity,
                feedback: `修改${editing}：${feedback.trim()}`,
              })
            : await desktopClient.cancelScheduleDraft(identity)
      setDraft(result.draft)
      setEditing(null)
      setFeedback('')
      setMessage(
        kind === 'confirm'
          ? '已写入「已安排」页。'
          : kind === 'feedback'
            ? '已提交修改意见，正在重新规划。'
            : '已取消安排。',
      )
    } catch (error) {
      setMessage(toUserErrorMessage(error))
      try {
        setDraft((await desktopClient.readScheduleDraft({ id: draft.id })).draft)
      } catch {
        setReady(false)
      }
    } finally {
      setBusy(false)
    }
  }

  const trigger = draft.trigger
  const pending = draft.status === 'pending'
  const disabled = busy || !ready
  function openScheduled() {
    const ref = draft.createdRefs[0]
    const params = new URLSearchParams()
    if (ref)
      params.set(
        ref.kind === 'task-schedule'
          ? 'taskId'
          : ref.kind === 'automation'
            ? 'automationId'
            : 'scheduledTaskId',
        ref.id,
      )
    if (trigger.kind === 'once') {
      const date = new Date(trigger.at)
      params.set(
        'date',
        `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`,
      )
    }
    navigate(`/automations?${params}`)
  }
  return (
    <article
      className="tw:grid tw:gap-3 tw:rounded-container tw:border tw:border-app-border tw:bg-app-panel tw:p-3 tw:text-app-text"
      data-state={draft.status}
    >
      <strong>
        {draft.status === 'committed'
          ? '已安排'
          : pending
            ? '确认任务安排'
            : '安排已取消或已被替代'}{' '}
        · {draft.name}
      </strong>
      <section aria-label="任务计划">
        <StructuredPlanView plan={draft.taskPlan.structured} />
      </section>
      <section aria-label="执行安排" className="tw:grid tw:gap-2">
        <strong>执行安排</strong>
        {draft.status === 'pending' && taskSupported ? (
          <Checkbox
            checked={requireManualAcceptance}
            onCheckedChange={(value) => setRequireManualAcceptance(value === true)}
            disabled={busy}
          >
            需要人工验收（执行结束后强提醒，验收通过才完成）
          </Checkbox>
        ) : null}
        <p>
          {trigger.kind === 'once'
            ? `执行时间：${new Intl.DateTimeFormat('zh-CN', { timeZone: trigger.timeZone, dateStyle: 'medium', timeStyle: 'short' }).format(trigger.at)}（${trigger.timeZone}）`
            : trigger.kind === 'recurring'
              ? `周期：${trigger.schedule.mode === 'custom' ? trigger.schedule.rrule : trigger.schedule.mode === 'hourly' ? `每 ${trigger.schedule.intervalMinutes} 分钟` : `${{ daily: '每天', weekdays: '工作日', weekly: '每周' }[trigger.schedule.mode]} ${trigger.schedule.time}`}（${trigger.timeZone}）`
              : `${trigger.kind === 'task-succeeded' ? '上游任务成功' : '上游验收通过'}后执行：${trigger.taskId}`}
        </p>
        <p>执行提示：{draft.prompt}</p>
        <p>
          模型：{draft.execution.model.providerID} / {draft.execution.model.id} · 执行权限：
          {draft.execution.permissionConfig.sandboxMode === 'read-only'
            ? '只读'
            : draft.execution.permissionConfig.sandboxMode === 'workspace-write'
              ? '工作区读写'
              : '完全访问'}{' '}
          · 无人值守执行不等待权限审批
        </p>
        <p>
          执行环境：{draft.execution.environment?.kind === 'new-worktree' ? '独立工作树' : '本地'}
        </p>
        {trigger.kind === 'recurring' && trigger.schedule.mode === 'weekly' ? (
          <p>每周执行日：{trigger.schedule.weekdays.join('、')}</p>
        ) : null}
        <p>
          执行目标：{draft.execution.kind === 'thread' ? '当前聊天' : '项目独立任务'} · 验收：
          {draft.acceptance.kind === 'manual' ? '人工验收' : '自动检查'}
        </p>
        <p>
          通知：{{ all: '全部结果', failures: '仅失败', off: '关闭' }[draft.notificationPolicy]} ·
          错过执行：{draft.missedRuns === 'catch-up' ? '补跑' : '跳过'} · 条件不满足：
          {draft.conditionFallback === 'wait' ? '等待重查' : '跳过'}
        </p>
        {draft.conditions.dependsOn.length ? (
          <p>依赖任务：{draft.conditions.dependsOn.join('、')}</p>
        ) : null}
        {draft.conditions.requireEnvironment ? <p>要求执行环境可用</p> : null}
        {draft.conditions.notBefore !== null ? (
          <p>最早执行：{new Date(draft.conditions.notBefore).toLocaleString()}</p>
        ) : null}
        {draft.conditions.deadline !== null ? (
          <p>截止时间：{new Date(draft.conditions.deadline).toLocaleString()}</p>
        ) : null}
        {draft.acceptance.kind === 'automatic'
          ? draft.acceptance.checks.map((check, index) => (
              <p key={index}>
                {check.kind === 'file-exists'
                  ? `检查文件：${check.path}`
                  : check.kind === 'document-section'
                    ? `检查章节：${check.path} · ${check.section}`
                    : `检查命令：${check.command} · 退出码 ${check.expectedExitCode}`}
              </p>
            ))
          : null}
      </section>
      {editing && pending ? (
        <div className="tw:grid tw:gap-2">
          <Textarea
            aria-label={`修改${editing}`}
            value={feedback}
            disabled={disabled}
            onChange={(event) => setFeedback(event.currentTarget.value)}
          />
          <Button disabled={disabled || !feedback.trim()} onClick={() => void act('feedback')}>
            提交修改意见
          </Button>
          <Button disabled={busy} onClick={() => setEditing(null)}>
            返回审阅
          </Button>
        </div>
      ) : null}
      <p role="status">
        {message ?? (pending ? '确认后写入「已安排」页，并按执行安排运行。' : '')}
      </p>
      <footer className="tw:flex tw:flex-wrap tw:gap-2">
        {pending ? (
          <>
            <Button
              disabled={disabled}
              onClick={() => {
                setEditing('任务计划')
                setFeedback('')
              }}
            >
              修改任务计划
            </Button>
            <Button
              disabled={disabled}
              onClick={() => {
                setEditing('执行安排')
                setFeedback('')
              }}
            >
              修改执行安排
            </Button>
            <Button
              color="primary"
              disabled={disabled || editing !== null}
              loading={busy}
              onClick={() => void act('confirm')}
            >
              确认安排
            </Button>
            <Button disabled={disabled} onClick={() => void act('cancel')}>
              取消安排
            </Button>
          </>
        ) : draft.status === 'committed' ? (
          <Button onClick={openScheduled}>查看已安排</Button>
        ) : null}
      </footer>
    </article>
  )
}
