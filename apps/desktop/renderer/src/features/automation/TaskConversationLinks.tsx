import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { TaskNotificationState } from '../notifications/TaskScheduleNotifications.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { Button } from '../../components/ui/Button.js'
import { Select } from '../../components/ui/Select.js'
import { toUserErrorMessage } from '../../utils/Errors.js'

export function TaskConversationLinks({
  threadId,
  state,
}: {
  threadId: string | null
  state: TaskNotificationState
}) {
  const [selectedId, setSelectedId] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const navigate = useNavigate()
  if (!threadId || !state.tasks.length) return null
  const linked = state.links.filter((link) => link.threadId === threadId)
  const selected = state.tasks.find((task) => task.id === selectedId)
  return (
    <div
      aria-label="会话所属任务"
      className="tw:flex tw:flex-wrap tw:items-center tw:gap-2 tw:border-b tw:border-app-border-subtle tw:p-2"
    >
      {linked.map((link) => (
        <Button
          key={link.taskId}
          color="secondary"
          onClick={() => navigate(`/automations?taskId=${encodeURIComponent(link.taskId)}`)}
        >
          返回任务 · {state.tasks.find((task) => task.id === link.taskId)?.name ?? link.taskId}
        </Button>
      ))}
      <Select
        ariaLabel="将会话归入任务"
        value={selectedId}
        options={[
          { value: '', label: '归入已有任务' },
          ...state.tasks
            .filter((task) => task.status !== 'cancelled')
            .map((task) => ({ value: task.id, label: task.name })),
        ]}
        onValueChange={setSelectedId}
      />
      <Button
        color="secondary"
        disabled={busy || !selected}
        onClick={async () => {
          if (!selected) return
          setBusy(true)
          setError('')
          try {
            await desktopClient.taskSchedule('task-schedule/link', {
              id: selected.id,
              expectedRevision: selected.revision,
              operationId: crypto.randomUUID(),
              threadId,
              role: 'planning',
            })
            setSelectedId('')
          } catch (cause) {
            setError(toUserErrorMessage(cause))
          } finally {
            setBusy(false)
          }
        }}
      >
        关联此会话
      </Button>
      {error ? <span role="alert">{error}</span> : null}
    </div>
  )
}
