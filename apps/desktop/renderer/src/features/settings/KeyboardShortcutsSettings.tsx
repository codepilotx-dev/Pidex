import React, { useMemo, useState } from 'react'
import { SettingsContentArea } from './SettingsContentArea.js'
import { Pencil, Trash2 } from 'lucide-react'
import { SearchInput } from '../../components/ui/SearchInput.js'
import { APP_ICON_SIZE } from '../../components/ui/IconTokens.js'

type ShortcutRow = {
  title: string
  description: string
  keys: string[]
  action?: 'edit' | 'delete'
}

const SHORTCUT_ROWS: ShortcutRow[] = [
  {
    title: '代码换行',
    description: 'Add newline in current chat',
    keys: ['Ctrl+Shift+A'],
  },
  { title: '新对话', description: 'Start a new chat', keys: ['Ctrl+N'] },
  { title: '新对话', description: 'Start a new chat', keys: ['Ctrl+Shift+O'] },
  {
    title: '打开侧边聊天',
    description: 'Open the current chat in a side chat',
    keys: ['Ctrl+Alt+S'],
  },
  {
    title: '在新窗口中打开',
    description: 'Open the current chat in a new window',
    keys: [],
  },
  {
    title: '折叠快速聊天',
    description: 'Start a lightweight chat in the quick composer',
    keys: ['Ctrl+Alt+H'],
  },
  {
    title: '切换当前状态',
    description: 'Pin or unpin the current chat',
    keys: ['Ctrl+Alt+P'],
  },
  { title: '搜索', description: 'Search the current chat', keys: ['Ctrl+F'] },
  {
    title: '聚焦浏览器地址栏',
    description: 'Focus the in-app browser address bar',
    keys: ['Ctrl+L'],
  },
  {
    title: '返回',
    description: 'Go back in navigation history',
    keys: ['Ctrl+[', 'Mouse Back'],
  },
  {
    title: '前进',
    description: 'Go forward in navigation history',
    keys: ['Ctrl+]', 'Mouse Forward'],
  },
  {
    title: '下一个最近查看聊天',
    description: 'Cycle to the next recently viewed chat',
    keys: ['Ctrl+Tab'],
    action: 'edit',
  },
  {
    title: '下一个标签页',
    description: 'Switch to the next tab',
    keys: ['Ctrl+Tab', 'Ctrl+Shift+]', 'Ctrl+PageDown'],
  },
  {
    title: '下一对话',
    description: 'Switch to the next chat',
    keys: ['Ctrl+Shift+]', 'Ctrl+PageDown'],
  },
  {
    title: '上一个最近查看聊天',
    description: 'Cycle to the previous recently viewed chat',
    keys: ['Ctrl+Shift+Tab'],
  },
  {
    title: '上一个标签页',
    description: 'Switch to the previous tab',
    keys: ['Ctrl+Shift+[', 'Ctrl+PageUp'],
  },
  {
    title: '上一个对话',
    description: 'Switch to the previous chat',
    keys: ['Ctrl+Shift+[', 'Ctrl+PageUp'],
  },
  {
    title: '打开浏览器标签页',
    description: 'Open a new browser tab',
    keys: ['Ctrl+T'],
  },
  {
    title: '打开审阅标签',
    description: 'Open the review tab',
    keys: ['Ctrl+Shift+G'],
  },
  {
    title: '切换集成终端',
    description: 'Open, focus, or hide the terminal for the current task',
    keys: ['Ctrl+`'],
  },
  {
    title: '切换右侧面板',
    description: 'Show or hide the right dock',
    keys: ['Ctrl+J'],
  },
  {
    title: '打开文件标签',
    description: 'Open the workspace file browser',
    keys: ['Ctrl+Shift+E'],
  },
  {
    title: '打开侧边聊天',
    description: 'Open the side chat tab',
    keys: ['Ctrl+Alt+S'],
  },
  {
    title: '切换边栏',
    description: 'Show or hide the sidebar',
    keys: ['Ctrl+B'],
  },
  {
    title: '切换侧栏时间线',
    description: 'Focus the sidebar on the last week of conversations and priority tasks',
    keys: ['Ctrl+Alt+U'],
  },
  {
    title: '环境动作 1',
    description: 'Run the environment action in this shortcut slot',
    keys: ['Ctrl+Alt+1'],
  },
  ...Array.from({ length: 7 }, (_, index) => ({
    title: `环境动作 ${index + 2}`,
    description: 'Run the environment action in this shortcut slot',
    keys: [],
  })),
  {
    title: '提交选项',
    description: 'Open command or push options',
    keys: [],
  },
  {
    title: '创建 PR',
    description: 'Open pull request creation options',
    keys: [],
  },
  {
    title: '打开文件夹',
    description: 'Add a local project to Code',
    keys: ['Ctrl+O'],
  },
  {
    title: '刷新技能目录',
    description: 'Refresh the skill catalog for the current context',
    keys: [],
  },
  {
    title: '智能摘要',
    description: 'Show installed and recommended skills',
    keys: [],
  },
  {
    title: '安装 Code 工作空间',
    description: 'Install dependencies for advanced local features',
    keys: [],
  },
  {
    title: '键盘快捷方式',
    description: 'Customize keyboard shortcuts',
    keys: [],
    action: 'edit',
  },
  {
    title: 'MCP',
    description: 'Configure MCP servers',
    keys: [],
  },
  {
    title: '个性',
    description: 'Adjust tone and response style',
    keys: [],
  },
  {
    title: '反馈',
    description: 'Send product feedback to the Code team',
    keys: [],
  },
  { title: '注销', description: 'Sign out of Code', keys: [] },
  {
    title: '管理自动化',
    description: 'Create or manage automations from the current workspace',
    keys: [],
  },
  { title: '设置', description: 'Open the settings', keys: ['Ctrl+,'] },
  {
    title: '打开控制窗口',
    description: 'Open the voice control window',
    keys: ['Ctrl+.'],
  },
  {
    title: '批准请求',
    description: 'Approve the active request',
    keys: ['A'],
  },
  {
    title: '拒绝请求',
    description: 'Decline the active request',
    keys: ['Escape'],
  },
  { title: 'Close Tab', description: 'Close the active tab', keys: ['Ctrl+W'] },
  { title: 'Close', description: 'Close the active tab', keys: ['Ctrl+F4'] },
  {
    title: 'Close',
    description: 'Close the active window',
    keys: ['Alt+F4'],
  },
  {
    title: '循环推理强度',
    description: 'Cycle through composer reasoning effort options',
    keys: [],
  },
  {
    title: '降低推理强度',
    description: 'Decrease the current composer reasoning effort',
    keys: [],
  },
  {
    title: '提高推理强度',
    description: 'Increase the current composer reasoning effort',
    keys: [],
  },
  {
    title: '开始听写',
    description: 'Start dictation in the current composer',
    keys: ['Ctrl+Shift+D'],
  },
  {
    title: '发送消息',
    description: 'Send the current composer message',
    keys: [],
  },
  {
    title: '切换快速模式',
    description: 'Turn fast mode on or off in the current composer',
    keys: [],
  },
  {
    title: '切换深度模式',
    description: 'Turn deep mode on or off in the current composer',
    keys: [],
  },
  {
    title: '复制为 Markdown',
    description: 'Copy the current chat as Markdown',
    keys: [],
  },
  {
    title: '复制会话路径',
    description: 'Copy conversation path',
    keys: ['Ctrl+Alt+Shift+C'],
  },
  {
    title: 'Copy file path',
    description: 'Copy a filepath in the current chat',
    keys: ['Ctrl+Alt+L'],
  },
  {
    title: 'Copy session id',
    description: 'Copy the current chat session ID',
    keys: ['Ctrl+Alt+C'],
  },
  {
    title: 'Copy working directory',
    description: 'Copy the current chat working directory',
    keys: ['Ctrl+Shift+C'],
  },
  {
    title: '分支聊天',
    description: 'Fork the current chat',
    keys: [],
  },
  {
    title: '隐藏到托盘',
    description: 'Hide anywhere on desktop to classic view',
    keys: [],
  },
  {
    title: '强制重新加载',
    description: 'Force reload browser page',
    keys: ['Ctrl+Shift+R'],
  },
  {
    title: '弹出窗口管理',
    description: 'Show or hide Popout Window from anywhere',
    keys: [],
  },
  {
    title: 'Browser Back',
    description: 'Go back in browser history',
    keys: ['Alt+Left'],
  },
  {
    title: 'Browser Forward',
    description: 'Go forward in browser history',
    keys: ['Alt+Right'],
  },
  {
    title: 'New Window',
    description: 'Open a new window',
    keys: ['Ctrl+Shift+N'],
  },
  {
    title: '放大页面',
    description: 'Increase the page zoom',
    keys: ['Ctrl++'],
  },
  {
    title: '缩小页面',
    description: 'Decrease the page zoom',
    keys: ['Ctrl+-'],
  },
  {
    title: '恢复实际大小',
    description: 'Reset the page zoom to 100%',
    keys: ['Ctrl+0'],
  },
  {
    title: 'Open command menu',
    description: 'Open the command menu',
    keys: ['Ctrl+K', 'Ctrl+Shift+P'],
  },
  {
    title: 'Reload Browser Page',
    description: 'Reload the active browser page',
    keys: ['Ctrl+R'],
  },
  { title: 'Search Files...', description: 'Search files', keys: ['Ctrl+P'] },
  {
    title: '显示快捷键列表',
    description: 'Show the shortcuts available right now',
    keys: ['Ctrl+Shift+/'],
  },
  ...Array.from({ length: 9 }, (_, index) => ({
    title: `快捷键槽 ${index + 1}`,
    description: 'Open the visible chat in this shortcut slot',
    keys: [`Ctrl+${index + 1}`],
  })),
  {
    title: 'Toggle File Tree',
    description: 'Toggle the file tree panel',
    keys: ['Ctrl+Shift+E'],
  },
  {
    title: '显示/隐藏最大输出面板',
    description: 'Expand or maximize the side panel',
    keys: [],
  },
  {
    title: 'Start Trace Recording',
    description: 'Start or stop trace recording',
    keys: ['Ctrl+Shift+S'],
  },
]

export function KeyboardShortcutsSettings(): React.ReactNode {
  const [query, setQuery] = useState('')
  const normalizedQuery = query.trim().toLocaleLowerCase()
  const rows = useMemo(() => {
    if (!normalizedQuery) return SHORTCUT_ROWS
    return SHORTCUT_ROWS.filter((row) =>
      [row.title, row.description, row.keys.join(' ')]
        .join(' ')
        .toLocaleLowerCase()
        .includes(normalizedQuery),
    )
  }, [normalizedQuery])

  return (
    <SettingsContentArea>
      <div className="settings-content-inner keyboard-shortcuts-settings tw:max-w-wide tw:@container tw:w-full tw:min-w-0 tw:mx-auto tw:p-5 tw:max-w-[calc(var(--page-content-max-width)+var(--cpx-sys-space-5)*2)]">
        <div className="settings-page-header tw:mt-0 tw:mx-0 tw:mb-8 tw:grid tw:gap-2">
          <h2 className="settings-page-title tw:m-0 tw:type-title-xl tw:text-app-text tw:tracking-[-0.01em]">
            键盘快捷键
          </h2>
        </div>
        <SearchInput
          aria-label="搜索键盘快捷键"
          className="keyboard-shortcuts-search tw:relative tw:mb-3 tw:flex tw:w-full tw:items-center"
          onChange={setQuery}
          placeholder="搜索快捷键"
          value={query}
          variant="standard"
        />
        <section
          className="keyboard-shortcuts-card tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-panel tw:shadow-none tw:transition-[background,border-color,box-shadow] tw:duration-state tw:ease-standard tw:hover:border-app-border-subtle tw:hover:bg-app-hover"
          aria-label="键盘快捷键列表"
        >
          <div className="keyboard-shortcuts-header tw:grid tw:grid-cols-[minmax(260px,1fr)_minmax(170px,0.64fr)_var(--cpx-sys-space-7)] tw:gap-3 tw:border-b tw:border-b-app-border-subtle tw:px-4 tw:py-2 tw:text-app-text-soft tw:text-[length:var(--cpx-sys-font-size-xs)] tw:type-weight-label">
            <span>命令</span>
            <span>快捷键</span>
          </div>
          <div className="keyboard-shortcuts-list tw:grid">
            {rows.map((row, index) => (
              <ShortcutRowView key={`${row.title}-${row.description}-${index}`} row={row} />
            ))}
            {rows.length === 0 && (
              <p className="keyboard-shortcuts-empty tw:px-4 tw:py-5 tw:text-app-text-soft tw:type-body-sm">
                未找到匹配的快捷键。
              </p>
            )}
          </div>
        </section>
      </div>
    </SettingsContentArea>
  )
}

function ShortcutRowView({ row }: { row: ShortcutRow }): React.ReactNode {
  const action = row.action ?? 'delete'
  const ActionIcon = action === 'edit' ? Pencil : Trash2
  const actionLabel = action === 'edit' ? `编辑 ${row.title} 快捷键` : `移除 ${row.title} 快捷键`

  return (
    <div className="keyboard-shortcuts-row tw:grid tw:grid-cols-[minmax(260px,1fr)_minmax(170px,0.64fr)_var(--cpx-sys-space-7)] tw:items-center tw:gap-3 tw:border-b tw:border-b-app-border-subtle tw:py-2 tw:pr-3 tw:pl-4 tw:last:border-b-0 tw:hover:bg-app-hover">
      <div className="keyboard-shortcuts-command tw:grid tw:min-w-0 tw:gap-1">
        <span className="keyboard-shortcuts-title tw:truncate tw:text-app-text tw:type-row-title">
          {row.title}
        </span>
        <span className="keyboard-shortcuts-desc tw:truncate tw:text-app-text-soft tw:type-body-sm">
          {row.description}
        </span>
      </div>
      <div className="keyboard-shortcuts-keys tw:flex tw:min-w-0 tw:flex-wrap tw:items-center tw:gap-1">
        {row.keys.length > 0 ? (
          row.keys.map((key) => (
            <span
              className="keyboard-shortcut-key tw:inline-flex tw:max-w-full tw:items-center tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-hover tw:px-3 tw:py-1 tw:font-mono tw:text-[length:var(--cpx-sys-font-size-xs)] tw:type-weight-label tw:[line-height:var(--cpx-sys-line-height-none)] tw:whitespace-nowrap"
              key={key}
            >
              {key}
            </span>
          ))
        ) : (
          <span className="keyboard-shortcut-unbound tw:bg-transparent tw:font-sans tw:text-app-text-soft tw:type-weight-label">
            未绑定
          </span>
        )}
      </div>
      <button
        aria-label={actionLabel}
        className="keyboard-shortcuts-action tw:inline-flex tw:size-6 tw:items-center tw:justify-center tw:rounded-md tw:text-app-text-meta tw:disabled:cursor-default tw:disabled:opacity-58"
        disabled
        title="快捷键编辑即将推出"
        type="button"
      >
        <ActionIcon size={APP_ICON_SIZE} />
      </button>
    </div>
  )
}
