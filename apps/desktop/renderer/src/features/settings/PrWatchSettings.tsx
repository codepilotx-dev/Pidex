import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ModelRefSchema } from '@pidex/shared'
import type { RpcResult } from '@pidex/agent-protocol'
import type { DesktopWorkspace } from '../../../shared/Types.js'
import { desktopClient } from '../../services/desktop-client/index.js'
import { environmentDomainClient } from '../../services/desktop-client/EnvironmentDomainClient.js'
import { Button } from '../../components/ui/Button.js'
import { Input } from '../../components/ui/Input.js'
import { Select } from '../../components/ui/Select.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { SettingsRow } from './SettingsRow.js'
import { SettingsSection } from './SettingsSection.js'
import {
  isSettingsSaveShortcut,
  useDesktopSettings,
  useDesktopRuntimeSettings,
} from './UseDesktopSettings.js'

export function PrWatchSettings(): React.ReactNode {
  const settings = useDesktopSettings()
  const runtime = useDesktopRuntimeSettings()
  const { draft } = settings
  const client = useMemo(() => environmentDomainClient(), [])
  const navigate = useNavigate()
  const [projects, setProjects] = useState<DesktopWorkspace[]>([])
  const [projectId, setProjectId] = useState('')
  const [url, setUrl] = useState('')
  const [watches, setWatches] = useState<RpcResult<'github/watch/list'>['watches']>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const lock = useRef(false)
  const refresh = async () => setWatches((await client.listPrWatches()).watches)
  useEffect(() => {
    let active = true
    void Promise.all([desktopClient.listProjects(), client.listPrWatches()])
      .then(([items, result]) => {
        if (active) {
          setProjects(items)
          setWatches(result.watches)
        }
      })
      .catch((cause) => {
        if (active) setError(cause instanceof Error ? cause.message : '读取监控失败')
      })
    return () => {
      active = false
    }
  }, [client])
  const operate = async (action: () => Promise<unknown>) => {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setError(null)
    try {
      await action()
      await refresh()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '操作失败')
    } finally {
      lock.current = false
      setBusy(false)
    }
  }
  const save = async (keys: Parameters<typeof draft.saveFields>[0]) => {
    try {
      await draft.saveFields(keys)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败')
    }
  }
  useEffect(() => {
    if (draft.values.prWatchInstructions === runtime.values.prWatchInstructions) return
    const timer = window.setTimeout(() => void save(['prWatchInstructions']), 3000)
    return () => window.clearTimeout(timer)
  }, [draft.values.prWatchInstructions, runtime.values.prWatchInstructions, draft.saveFields])
  return (
    <SettingsSection
      title="监控并修复 Pull Request"
      description="选择项目和 PR 后持续检查 CI 与审查要求，需要修复时复用独立聊天与工作树。"
    >
      {error && (
        <p role="alert" className="tw:type-caption tw:text-app-danger tw:p-3">
          {error}
        </p>
      )}
      <SettingsRow
        title="准备就绪时自动合并"
        description="仅在 PR、CI、审查和 head SHA 均通过宿主检查，且权限允许时合并。"
        control={
          <ToggleSwitch
            ariaLabel="准备就绪时自动合并"
            checked={draft.values.prWatchAutoMerge}
            onChange={(value) => {
              draft.setValue('prWatchAutoMerge', value)
              void save(['prWatchAutoMerge'])
            }}
          />
        }
      />
      <SettingsRow
        title="监控与修复说明"
        variant="stacked"
        control={
          <textarea
            className="confirmation-dialog-input"
            aria-label="监控与修复说明"
            rows={4}
            value={draft.values.prWatchInstructions}
            placeholder="例如：修复失败的检查，运行项目测试，并说明修复结果…"
            onChange={(event) => draft.setValue('prWatchInstructions', event.target.value)}
            onKeyDown={(event) => {
              if (isSettingsSaveShortcut(event)) {
                event.preventDefault()
                void save(['prWatchInstructions'])
              }
            }}
          />
        }
      />
      <SettingsRow
        title="项目"
        control={
          <Select
            ariaLabel="监控项目"
            value={projectId}
            options={[
              { value: '', label: '选择项目' },
              ...projects
                .filter((project) => project.projectId)
                .map((project) => ({ value: project.projectId!, label: project.name })),
            ]}
            onValueChange={setProjectId}
          />
        }
      />
      <SettingsRow
        title="PR URL"
        variant="stacked"
        control={
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Input
              aria-label="PR URL"
              className="tw:min-w-0 tw:flex-1"
              value={url}
              placeholder="https://github.com/owner/repository/pull/123"
              onChange={(event) => setUrl(event.target.value)}
            />
            <Button
              color="primary"
              disabled={busy || !projectId || !url.trim()}
              onClick={() =>
                void operate(() =>
                  client.startPrWatch({
                    projectId,
                    url,
                    model: ModelRefSchema.make({
                      providerID: ModelRefSchema.fields.providerID.make(settings.providerID),
                      id: ModelRefSchema.fields.id.make(settings.model),
                    }),
                    permissionConfig: draft.values.permissionConfig,
                  }),
                )
              }
            >
              启动监控
            </Button>
          </div>
        }
      />
      <div className="tw:grid tw:gap-2 tw:p-3">
        <Button
          color="ghostSecondary"
          size="toolbar"
          disabled={busy}
          onClick={() => void operate(refresh)}
        >
          刷新监控
        </Button>
        {watches.map((watch) => (
          <div
            key={watch.id}
            className="tw:grid tw:gap-2 tw:border-t tw:border-app-border-subtle tw:py-3"
          >
            <span className="tw:type-row-title">
              {watch.automation.name} · {watch.automation.status === 'active' ? '运行中' : '已暂停'}
            </span>
            {watch.reason && (
              <span className="tw:type-caption tw:text-app-text-soft">{watch.reason}</span>
            )}
            <div className="tw:flex tw:flex-wrap tw:gap-2">
              <Button
                color="secondary"
                onClick={() =>
                  navigate(`/automations?automationId=${encodeURIComponent(watch.automation.id)}`)
                }
              >
                查看自动化
              </Button>
              <Button color="secondary" onClick={() => navigate(`/threads/${watch.threadId}`)}>
                打开修复聊天
              </Button>
              <Button
                color="secondary"
                disabled={busy || watch.automation.status === 'deleted'}
                onClick={() =>
                  void operate(() =>
                    client.updatePrWatch({
                      id: watch.id,
                      expectedRevision: watch.automation.revision,
                      status: watch.automation.status === 'active' ? 'paused' : 'active',
                    }),
                  )
                }
              >
                {watch.automation.status === 'active' ? '暂停' : '恢复'}
              </Button>
              <Button
                color="danger"
                disabled={busy || watch.automation.status !== 'active'}
                onClick={() => void operate(() => client.stopPrWatch(watch.id))}
              >
                停止
              </Button>
            </div>
          </div>
        ))}
      </div>
    </SettingsSection>
  )
}
