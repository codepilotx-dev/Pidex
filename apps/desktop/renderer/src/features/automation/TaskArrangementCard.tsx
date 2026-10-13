import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  decodeTaskArrangementProposal,
  type TaskArrangementProposal,
  type TaskSchedule,
} from '@pidex/shared/task-schedule'
import type { Item } from '@pidex/shared/thread'
import { desktopClient } from '../../services/desktop-client/index.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { toUserErrorMessage } from '../../utils/Errors.js'

export function taskArrangementFromTool(
  item: Extract<Item, { type: 'tool' }>,
): TaskArrangementProposal | null {
  if (
    !['submit_task_schedule', 'task_schedule_propose', 'task_schedule.propose'].includes(
      item.tool,
    ) ||
    item.state !== 'completed' ||
    !item.output
  )
    return null
  try {
    const value = JSON.parse(item.output)
    return decodeTaskArrangementProposal(value.proposal ?? value)
  } catch {
    return null
  }
}

export function TaskArrangementCard({ initial }: { initial: TaskArrangementProposal }) {
  const [proposal, setProposal] = useState(initial)
  const [items, setItems] = useState([...initial.items])
  const [tasks, setTasks] = useState<readonly TaskSchedule[]>([])
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const navigate = useNavigate()
  useEffect(() => {
    setItems([...proposal.items])
  }, [proposal])
  useEffect(() => {
    let disposed = false
    const refresh = async () => {
      const data = await desktopClient.taskSchedule('task-schedule/list', {})
      if (disposed) return
      setTasks(data.tasks)
      const current = data.proposals.find((p) => p.id === initial.id)
      if (current)
        setProposal((previous) => (previous.revision === current.revision ? previous : current))
    }
    void refresh().catch((cause) => {
      if (!disposed) setError(toUserErrorMessage(cause))
    })
    const unsubscribe = desktopClient.subscribeAgentEventEnvelopes(
      { liveEventTypes: [] },
      (events) => {
        if (events.some((e) => e.type === 'task-schedule/changed'))
          void refresh().catch((cause) => {
            if (!disposed) setError(toUserErrorMessage(cause))
          })
      },
    )
    return () => {
      disposed = true
      unsubscribe()
    }
  }, [initial.id])
  const commit = async (decision: 'confirm' | 'cancel') => {
    setBusy(true)
    setError('')
    try {
      let current = proposal
      if (decision === 'confirm' && JSON.stringify(items) !== JSON.stringify(proposal.items)) {
        const saved = await desktopClient.taskSchedule('task-schedule/propose', {
          id: proposal.id,
          expectedRevision: proposal.revision,
          operationId: crypto.randomUUID(),
          items,
          unscheduled: proposal.unscheduled,
        })
        current = saved.proposal
        setProposal(current)
      }
      const result = await desktopClient.taskSchedule('task-schedule/arrange', {
        id: current.id,
        expectedRevision: current.revision,
        operationId: crypto.randomUUID(),
        decision,
      })
      setProposal(result.proposal)
    } catch (cause) {
      setError(toUserErrorMessage(cause))
    } finally {
      setBusy(false)
    }
  }
  const localDate = (at: number) =>
    new Date(at - new Date(at).getTimezoneOffset() * 60_000).toISOString().slice(0, 16)
  return (
    <section
      aria-label="时间安排草案"
      className="tw:grid tw:gap-3 tw:rounded-lg tw:border tw:border-app-border-subtle tw:p-3"
    >
      <strong>
        {proposal.status === 'pending'
          ? '待确认的时间安排'
          : proposal.status === 'committed'
            ? '时间已安排'
            : '时间安排已取消'}
      </strong>
      {items.map((item, index) => (
        <div key={index} className="tw:grid tw:gap-2 tw:md:grid-cols-3">
          <span>
            {'taskId' in item
              ? (tasks.find((t) => t.id === item.taskId)?.name ?? item.taskId)
              : item.name}
          </span>
          <Input
            aria-label="任务安排时间"
            type="datetime-local"
            disabled={busy || proposal.status !== 'pending'}
            value={localDate(item.at)}
            onChange={(e) =>
              setItems((current) =>
                current.map((value, i) =>
                  i === index ? { ...value, at: new Date(e.target.value).getTime() } : value,
                ),
              )
            }
          />
          <Input
            aria-label="任务预计分钟"
            type="number"
            min={1}
            disabled={busy || proposal.status !== 'pending'}
            value={item.durationMinutes}
            onChange={(e) =>
              setItems((current) =>
                current.map((value, i) =>
                  i === index ? { ...value, durationMinutes: Number(e.target.value) } : value,
                ),
              )
            }
          />
        </div>
      ))}
      {proposal.unscheduled.map((item, index) => (
        <p key={index}>
          未安排：
          {'taskId' in item
            ? (tasks.find((t) => t.id === item.taskId)?.name ?? item.taskId)
            : item.name}{' '}
          · {item.reason}
        </p>
      ))}
      {error ? <p role="alert">{error}</p> : null}
      <div className="tw:flex tw:gap-2">
        {proposal.status === 'pending' ? (
          <>
            <Button color="primary" disabled={busy} onClick={() => void commit('confirm')}>
              确认时间安排
            </Button>
            <Button color="secondary" disabled={busy} onClick={() => void commit('cancel')}>
              取消草案
            </Button>
          </>
        ) : null}
        <Button color="secondary" onClick={() => navigate('/automations')}>
          查看任务与日历
        </Button>
      </div>
    </section>
  )
}
