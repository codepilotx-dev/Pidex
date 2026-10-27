import { useEffect, useState } from 'react'
import { X } from 'lucide-react'
import type { DesktopReviewSource, DesktopWorkspace } from '../../../shared/Types.js'
import { Tooltip } from '../../components/ui/Tooltip.js'
import { Button } from '../../components/ui/Button.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import { useDesktopSettingsField } from '../settings/UseDesktopSettings.js'
import { useCodeWrapPreference } from '../syntax/WrapPreference.js'
import { ReviewDiffReadOnlyInline } from '../review/diff/ReviewDiffSurface.js'
import {
  reviewAgentClient,
  summaryFileToDesktop,
  type ReviewSummarySnapshot,
  type ReviewFileDiff,
} from '../review/source/ReviewAgentClient.js'

export function GitBoardDetails({
  project,
  source,
  path,
  hasConflicts = false,
  onClose,
}: {
  project: DesktopWorkspace
  source: DesktopReviewSource
  path?: string
  hasConflicts?: boolean
  onClose: () => void
}) {
  const { t } = useLocale()
  const diffMarkerStyle = useDesktopSettingsField((settings) => settings.diffMarkerStyle)
  const [wrapLines] = useCodeWrapPreference()
  const [summary, setSummary] = useState<ReviewSummarySnapshot | null>(null)
  const [selectedPath, setSelectedPath] = useState(path ?? '')
  const [diff, setDiff] = useState<ReviewFileDiff | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    if (hasConflicts) {
      setSummary(null)
      setDiff(null)
      setError(null)
      return
    }
    let cancelled = false
    void reviewAgentClient
      .summary(project.path, source, true, project.projectId)
      .then(({ snapshot }) => {
        if (cancelled) return
        setDiff(null)
        setError(null)
        setSummary(snapshot)
        setSelectedPath((current) =>
          snapshot.files.some((file) => file.path === current)
            ? current
            : (snapshot.files[0]?.path ?? ''),
        )
      })
      .catch(() => {
        if (!cancelled) setError('变更详情加载失败，请重试')
      })
    return () => {
      cancelled = true
    }
  }, [project.path, project.projectId, source, retry, hasConflicts])
  useEffect(() => {
    if (hasConflicts || !summary || !selectedPath) return
    let cancelled = false
    void reviewAgentClient
      .fileDiff(project.path, source, summary.generation, selectedPath, false, project.projectId)
      .then((loaded) => {
        if (!cancelled) setDiff(loaded)
      })
      .catch(() => {
        if (!cancelled) setError('变更详情加载失败，请重试')
      })
    return () => {
      cancelled = true
    }
  }, [project.path, project.projectId, source, summary, selectedPath, hasConflicts])
  return (
    <aside
      aria-label={t('变更详情')}
      className="tw:flex tw:h-full tw:min-w-[360px] tw:flex-1 tw:flex-col tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-main"
    >
      <header className="tw:flex tw:items-center tw:justify-between tw:gap-2 tw:border-b tw:border-app-border-subtle tw:p-3">
        <div className="tw:min-w-0">
          <h2 className="tw:truncate tw:type-row-title">{project.name}</h2>
          <p className="tw:type-caption tw:text-app-text-meta">
            {source.kind === 'commit' ? source.commitSha.slice(0, 8) : t('未提交改动')}
          </p>
        </div>
        <Tooltip content={t('关闭详情')}>
          <Button
            nativeTitle={false}
            isIconOnly
            variant="ghost"
            title={t('关闭详情')}
            onClick={onClose}
          >
            <X size={16} />
          </Button>
        </Tooltip>
      </header>
      {hasConflicts && (
        <p role="status" className="tw:p-3 tw:type-body-sm tw:text-app-text-meta">
          {t(
            '存在未解决的合并冲突，暂不加载差异。冲突解除后将自动恢复，仓库状态和提交历史仍会刷新。',
          )}
        </p>
      )}
      {!hasConflicts && error && (
        <div role="alert" className="tw:p-3">
          <p>{t(error)}</p>
          <Button
            variant="ghost"
            onClick={() => {
              setSummary(null)
              setDiff(null)
              setError(null)
              setRetry((value) => value + 1)
            }}
          >
            {t('重试')}
          </Button>
        </div>
      )}
      {!hasConflicts && !summary && !error && (
        <p role="status" className="tw:p-3">
          {t('加载中')}
        </p>
      )}
      {!hasConflicts && summary && (
        <>
          <div className="tw:max-h-48 tw:shrink-0 tw:overflow-y-auto tw:border-b tw:border-app-border-subtle tw:p-2">
            {summary.files.length === 0 && <p className="tw:type-body-sm">{t('没有文件变更')}</p>}
            {summary.files.map((file) => (
              <button
                key={file.path}
                type="button"
                aria-pressed={selectedPath === file.path}
                className="tw:block tw:w-full tw:rounded-md tw:px-2 tw:py-2 tw:text-left tw:type-body-sm tw:break-all tw:hover:bg-app-hover tw:aria-pressed:bg-app-selected tw:focus-visible:outline-app-focus"
                onClick={() => {
                  if (selectedPath === file.path) return
                  setDiff(null)
                  setError(null)
                  setSelectedPath(file.path)
                }}
              >
                {file.path}
              </button>
            ))}
          </div>
          <div className="tw:min-h-0 tw:flex-1 tw:overflow-auto">
            {selectedPath && !diff && !error && (
              <p role="status" className="tw:p-3">
                {t('加载中')}
              </p>
            )}
            {diff &&
              (diff.file.binary ? (
                <p className="tw:p-3">{t('二进制文件不支持差异预览')}</p>
              ) : !diff.renderable ? (
                <p className="tw:p-3">{t('文件过大，无法预览差异')}</p>
              ) : (
                <ReviewDiffReadOnlyInline
                  file={summaryFileToDesktop(diff.file, diff)}
                  diffMarkerStyle={diffMarkerStyle}
                  showWordDiff
                  wrapLines={wrapLines}
                  ariaLabel={diff.file.path}
                />
              ))}
          </div>
        </>
      )}
    </aside>
  )
}
