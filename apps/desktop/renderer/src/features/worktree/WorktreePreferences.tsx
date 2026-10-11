import { useState, type ReactNode } from 'react'
import { SettingsRow } from '../settings/SettingsRow.js'
import { SettingsSection } from '../settings/SettingsSection.js'
import { isSettingsSaveShortcut, useDesktopSettings } from '../settings/UseDesktopSettings.js'
import { Input } from '../../components/ui/Input.js'
import { ToggleSwitch } from '../../components/ui/ToggleSwitch.js'
import { ConfirmationDialog } from '../../components/ui/ConfirmationDialog.js'

export function WorktreePreferences({
  onError,
}: {
  onError: (message: string) => void
}): ReactNode {
  const { draft } = useDesktopSettings()
  const { worktreeRoot, worktreeFetchUpstream, gitAutoDeleteWorktree, gitAutoDeleteWorktreeLimit } =
    draft.values
  const [confirmDisable, setConfirmDisable] = useState(false)
  const [limit, setLimit] = useState<string | null>(null)
  const save = async (keys: Parameters<typeof draft.saveFields>[0]) => {
    try {
      await draft.saveFields(keys)
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : '保存工作树设置失败')
    }
  }
  const saveLimit = () => {
    if (limit === null) return
    const value = Number(limit.trim())
    setLimit(null)
    if (!limit.trim() || !Number.isFinite(value)) return
    draft.setValue('gitAutoDeleteWorktreeLimit', Math.max(1, Math.min(100, Math.trunc(value))))
    void save(['gitAutoDeleteWorktreeLimit'])
  }
  return (
    <div
      onKeyDown={(event) => {
        if (isSettingsSaveShortcut(event)) {
          event.preventDefault()
          saveLimit()
          void save(['worktreeRoot'])
        }
      }}
    >
      <SettingsSection>
        <SettingsRow
          title="工作树根目录"
          description="创建托管工作树的位置。留空使用默认目录，仅影响新建工作树。"
          control={
            <Input
              aria-label="工作树根目录"
              value={worktreeRoot}
              placeholder="使用默认目录"
              onChange={(event) => draft.setValue('worktreeRoot', event.target.value)}
              onBlur={() => void save(['worktreeRoot'])}
            />
          }
        />
        <SettingsRow
          title="创建工作树前获取上游更新"
          description="获取失败时使用已有本地引用，并显示警告。"
          control={
            <ToggleSwitch
              checked={worktreeFetchUpstream}
              ariaLabel="创建工作树前获取上游更新"
              onChange={(value) => {
                draft.setValue('worktreeFetchUpstream', value)
                void save(['worktreeFetchUpstream'])
              }}
            />
          }
        />
        <SettingsRow
          title="自动删除旧工作树"
          description="推荐开启；保留永久、置顶和仍有未归档任务的工作树。"
          control={
            <ToggleSwitch
              checked={gitAutoDeleteWorktree}
              ariaLabel="自动删除旧工作树"
              onChange={(value) => {
                if (!value) setConfirmDisable(true)
                else {
                  draft.setValue('gitAutoDeleteWorktree', true)
                  void save(['gitAutoDeleteWorktree'])
                }
              }}
            />
          }
        />
        <SettingsRow
          title="自动删除限制"
          description={
            gitAutoDeleteWorktree
              ? '超出保留数量后清理旧工作树；删除前创建可恢复快照。'
              : '自动删除已关闭；重新开启后继续使用此限制。'
          }
          control={
            <Input
              aria-label="自动删除限制"
              type="number"
              min={1}
              max={100}
              step={1}
              disabled={!gitAutoDeleteWorktree}
              value={limit ?? gitAutoDeleteWorktreeLimit}
              onChange={(event) => setLimit(event.target.value)}
              onBlur={saveLimit}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveLimit()
              }}
            />
          }
        />
      </SettingsSection>
      <ConfirmationDialog
        open={confirmDisable}
        title="关闭自动删除工作树？"
        description="旧工作树将持续占用磁盘空间，需要你自行管理。"
        actionLabel="关闭自动删除"
        onCancel={() => setConfirmDisable(false)}
        onAction={() => {
          draft.setValue('gitAutoDeleteWorktree', false)
          setConfirmDisable(false)
          void save(['gitAutoDeleteWorktree'])
        }}
      />
    </div>
  )
}
