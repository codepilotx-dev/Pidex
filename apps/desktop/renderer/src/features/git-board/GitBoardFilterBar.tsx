import { SegmentedControl } from '../../components/ui/SegmentedControl.js'
import { Button } from '../../components/ui/Button.js'
import { useLocale } from '../i18n/LocaleProvider.js'
import {
  GIT_BOARD_FILTERS,
  gitBoardFilterEmptyMessage,
  type GitBoardFilter,
} from './GitBoardFilter.js'

export function GitBoardFilterBar({
  filter,
  matched,
  total,
  onChange,
}: {
  filter: GitBoardFilter
  matched: number
  total: number
  onChange: (filter: GitBoardFilter) => void
}) {
  const { t } = useLocale()
  const options = GIT_BOARD_FILTERS.map((option) => ({
    value: option.value,
    label: t(option.label),
  }))
  return (
    <div className="tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:justify-between tw:gap-3">
      <SegmentedControl<GitBoardFilter>
        ariaLabel={t('仓库筛选')}
        options={options}
        overflowMode="fit"
        size="md"
        value={filter}
        onChange={onChange}
      />
      <span role="status" className="tw:type-caption tw:text-app-text-meta">
        {`${t('匹配')} ${matched} / ${total} ${t('个仓库')}`}
      </span>
    </div>
  )
}

export function GitBoardFilterEmpty({
  filter,
  onReset,
}: {
  filter: GitBoardFilter
  onReset: () => void
}) {
  const { t } = useLocale()
  return (
    <div className="tw:m-auto tw:grid tw:max-w-[24rem] tw:justify-items-center tw:gap-2 tw:px-4 tw:py-8 tw:text-center">
      <p role="status" className="tw:m-0 tw:text-app-text tw:type-body">
        {t(gitBoardFilterEmptyMessage(filter))}
      </p>
      <Button variant="ghost" onClick={onReset}>
        {t('查看全部仓库')}
      </Button>
    </div>
  )
}
