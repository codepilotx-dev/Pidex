import type React from 'react'
import {
  Clipboard,
  Code2,
  Columns2,
  Ellipsis,
  File,
  GitCommitHorizontal,
  GitFork,
  GitPullRequestArrow,
  Image,
  RotateCcw,
  WrapText,
  ChevronDown,
} from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import { PopoverCheckboxItem, PopoverItem } from '../../../components/ui/PopoverItem.js'
import { PopoverMenu } from '../../../components/ui/PopoverMenu.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import type { ReviewTabUiState } from '../../layout/tabs/ConversationUiState.js'

type ReviewBooleanPreference =
  'wrapLines' | 'richPreview' | 'showWordDiff' | 'hideWhitespace' | 'loadFullFiles' | 'hideImports'

export function ReviewOptionsMenu({
  open,
  onOpenChange,
  buttonRef,
  preferences,
  supportsFullContext,
  onSetPreference,
  onRefresh,
  onCreateBranch,
  onOpenPullRequest,
  onToggleView,
  onToggleExpanded,
  onCommit,
  onCreatePullRequest,
  onCopyPatch,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  buttonRef: React.RefObject<HTMLButtonElement | null>
  preferences: ReviewTabUiState
  supportsFullContext: boolean
  onSetPreference: (key: ReviewBooleanPreference, checked: boolean) => void
  onRefresh: () => void
  onCreateBranch: () => void
  onOpenPullRequest: () => void
  onToggleView: () => void
  onToggleExpanded: () => void
  onCommit: () => void
  onCreatePullRequest: () => void
  onCopyPatch: () => void
}): React.ReactNode {
  const run = (action: () => void) => {
    action()
    onOpenChange(false)
  }
  const set = (key: ReviewBooleanPreference, checked: boolean) =>
    run(() => onSetPreference(key, checked))
  return (
    <PopoverMenu
      align="end"
      className="popover-review-more popover-menu--grid"
      open={open}
      sideOffset={4}
      size="sm"
      trigger={
        <Button ref={buttonRef} isIconOnly color="ghostSecondary" size="toolbar" title="更多">
          <Ellipsis size={APP_ICON_SIZE} />
        </Button>
      }
      onOpenChange={onOpenChange}
    >
      <div className="tw:contents tw:@min-[625px]:hidden">
        <PopoverItem icon={<RotateCcw size={APP_ICON_SIZE} />} onClick={() => run(onRefresh)}>
          刷新变更
        </PopoverItem>
        <PopoverCheckboxItem
          checked={preferences.wrapLines}
          icon={<WrapText size={APP_ICON_SIZE} />}
          onCheckedChange={(checked) => set('wrapLines', checked)}
        >
          自动换行
        </PopoverCheckboxItem>
        <PopoverItem icon={<Columns2 size={APP_ICON_SIZE} />} onClick={() => run(onToggleView)}>
          切换差异布局
        </PopoverItem>
        <PopoverItem
          icon={<ChevronDown size={APP_ICON_SIZE} />}
          onClick={() => run(onToggleExpanded)}
        >
          {preferences.diffExpansion.mode === 'none' ? '展开全部差异' : '折叠全部差异'}
        </PopoverItem>
      </div>
      {supportsFullContext ? (
        <PopoverCheckboxItem
          checked={preferences.loadFullFiles}
          icon={<File size={APP_ICON_SIZE} />}
          onCheckedChange={(checked) => set('loadFullFiles', checked)}
        >
          加载完整文件
        </PopoverCheckboxItem>
      ) : null}
      <PopoverCheckboxItem
        checked={preferences.richPreview}
        icon={<Image size={APP_ICON_SIZE} />}
        onCheckedChange={(checked) => set('richPreview', checked)}
      >
        渲染预览
      </PopoverCheckboxItem>
      <PopoverCheckboxItem
        checked={preferences.showWordDiff}
        icon={<Code2 size={APP_ICON_SIZE} />}
        onCheckedChange={(checked) => set('showWordDiff', checked)}
      >
        词级差异
      </PopoverCheckboxItem>
      <PopoverCheckboxItem
        checked={preferences.hideWhitespace}
        icon={<Code2 size={APP_ICON_SIZE} />}
        onCheckedChange={(checked) => set('hideWhitespace', checked)}
      >
        隐藏空白字符
      </PopoverCheckboxItem>
      <PopoverCheckboxItem
        checked={preferences.hideImports}
        icon={<Code2 size={APP_ICON_SIZE} />}
        onCheckedChange={(checked) => set('hideImports', checked)}
      >
        隐藏导入内容
      </PopoverCheckboxItem>
      <PopoverItem icon={<Clipboard size={APP_ICON_SIZE} />} onClick={() => run(onCopyPatch)}>
        复制 git apply 命令
      </PopoverItem>
      <PopoverItem
        icon={<GitCommitHorizontal size={APP_ICON_SIZE} />}
        onClick={() => run(onCommit)}
      >
        提交或推送
      </PopoverItem>
      <PopoverItem
        icon={<GitPullRequestArrow size={APP_ICON_SIZE} />}
        onClick={() => run(onCreatePullRequest)}
      >
        创建拉取请求
      </PopoverItem>
      <PopoverItem icon={<GitFork size={APP_ICON_SIZE} />} onClick={() => run(onCreateBranch)}>
        创建分支
      </PopoverItem>
      <PopoverItem
        icon={<GitPullRequestArrow size={APP_ICON_SIZE} />}
        onClick={() => run(onOpenPullRequest)}
      >
        打开 GitHub Pull Request…
      </PopoverItem>
    </PopoverMenu>
  )
}
