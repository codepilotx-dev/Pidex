import type { ProtocolCapability } from '@pidex/agent-protocol'
import {
  Archive,
  Blocks,
  Brain,
  BrainCircuit,
  CreditCard,
  GitBranch,
  Keyboard,
  Mic,
  MonitorSmartphone,
  Package,
  Palette,
  Settings,
  Sliders,
  Square,
  User,
  Gauge,
  PawPrint,
  Trees,
  type LucideIcon,
} from 'lucide-react'

export type SettingsSearchRow = {
  title: string
  description: string
}

export type SettingsSectionRequirement = {
  /** 需要活动工作区上下文才可使用。 */
  workspace?: boolean
  /** 需要任一列出的运行时协议能力（任一满足即可见）。 */
  capabilities?: readonly ProtocolCapability[]
}

export type SettingsSectionDefinition = {
  id: string
  routeId: string
  label: string
  description: string
  icon: LucideIcon
  rows: readonly SettingsSearchRow[]
  requires?: SettingsSectionRequirement
}

export type SettingsGroupDefinition = {
  id: 'personal' | 'integrations' | 'coding' | 'archived'
  title: string
  items: readonly SettingsSectionDefinition[]
}

export type SettingsRegistryItem = SettingsSectionDefinition
export type SettingsRegistryGroup = SettingsGroupDefinition

const row = (title: string, description: string): SettingsSearchRow => ({
  title,
  description,
})

export const SETTINGS_GROUPS = [
  {
    id: 'personal',
    title: '个人',
    items: [
      {
        id: 'general',
        routeId: 'general',
        label: '常规',
        description: '权限、语言、通知与应用行为',
        icon: Settings,
        rows: [
          row('默认权限', '设置读取、写入、命令、联网和 MCP 请求权限'),
          row('自动审核', '配置需要授权操作的自动审核行为'),
          row('完全访问权限', '允许 Pidex 使用完整系统能力'),
          row('默认打开目标', '默认打开文件和文件夹的位置'),
          row('集成终端 Shell', '选择集成终端使用的 Shell'),
          row('语言', '应用 UI 语言'),
          row('需按 ^ + 回车键发送长文本提示', '调整长文本提示的发送方式'),
          row('速度', '选择聊天、子智能体和压缩的推理层级'),
          row('跟进行为', '控制任务完成后的跟进行为'),
          row('允许普通模式提问', '允许 Agent 通过结构化问题卡提问'),
          row('代码审查', '选择行内或左右分离的 diff 展示方式'),
          row('建议提示', '搜索项目文件和连接应用并建议下一步'),
          row('从其他 AI 应用导入工作内容', '导入设置、项目和最近聊天记录'),
          row('弹出窗口快捷键', '为弹出窗口设置全局快捷键'),
          row('通知', '设置轮次完成、权限和问题通知'),
          row('显示上下文窗口使用量', '在对话框底部显示上下文使用量'),
        ],
      },
      {
        id: 'voice',
        routeId: 'voice',
        label: '语音',
        description: '查看本地语音模型状态、选择麦克风并使用听写快捷键',
        icon: Mic,
        requires: { capabilities: ['speech.transcription.v1'] },
        rows: [
          row('本地语音模型', '查看本地离线转写模型的状态与安装进度'),
          row('输入设备', '选择听写使用的麦克风'),
          row('听写快捷键', '在当前消息输入框中开始或停止听写。'),
          row('麦克风隐私设置', '打开 Windows 麦克风权限页面，允许 Pidex 使用输入设备。'),
        ],
      },
      {
        id: 'profile',
        routeId: 'profile',
        label: '个人资料',
        description: '账户身份、头像和个人信息',
        icon: User,
        rows: [row('个人资料', '查看和管理当前 Pidex 账户信息')],
      },
      {
        id: 'appearance',
        routeId: 'appearance',
        label: '外观',
        description: '主题、颜色、字体、动效和差异标记',
        icon: Palette,
        rows: [
          row('主题', '选择浅色、深色或跟随系统，并配置代码主题'),
          row('强调色', '设置当前主题的强调颜色'),
          row('背景', '设置当前主题的背景颜色'),
          row('前景', '设置当前主题的文字颜色'),
          row('UI 字体', '设置应用界面字体'),
          row('代码字体', '设置代码与终端字体'),
          row('对比度', '调整当前主题的视觉对比度'),
          row('使用指针光标', '交互元素悬停时显示手形指针'),
          row('减少动态效果', '跟随系统或始终开启、关闭界面动画'),
          row('界面字号', '调整应用 UI 字号'),
          row('代码字号', '调整代码和终端字号'),
          row('差异标记', '使用颜色或加减号展示代码更改'),
          row('字体平滑', '在 macOS 上优化浅色文字边缘'),
        ],
      },
      {
        id: 'pets',
        routeId: 'pets',
        label: '宠物',
        description: '让桌面伙伴管理任务并提醒需要你处理的事项',
        icon: PawPrint,
        rows: [
          row('唤醒宠物', '显示或收起桌面宠物'),
          row('选择宠物', '选择已安装的自定义宠物'),
          row('宠物大小', '在 80 到 224 像素之间调整显示大小'),
          row('任务提醒', '显示完成、失败、权限、问题和计划提醒'),
          row('社区宠物商店', '浏览社区宠物并一键安装和使用'),
          row('从链接安装', '从 HTTPS 地址预览并安装自定义宠物包'),
        ],
      },
      {
        id: 'config',
        routeId: 'config',
        label: '配置',
        description: '智能体默认设置、诊断、专用模型与数据设置',
        icon: Sliders,
        rows: [
          row(
            '智能体默认设置',
            '配置用户或项目 config.json、权限预设、工具范围、Shell 风险处理和审批方式',
          ),
          row('Profile', '选择跨桌面端和 CLI/TUI 共享的启动配置；切换后关闭所有客户端再重新打开'),
          row('权限预设', '快速选择默认权限、自动审查、完全访问或自定义批准策略'),
          row(
            '文件访问范围',
            '约束内建文件工具；Shell 在宿主机执行；网络授权属于审批范围，不提供网络隔离',
          ),
          row('Shell 安全级别', '调整宿主 Shell 的静态风险处理'),
          row('审批时机', '设置批准策略，选择 Pidex 何时请求批准'),
          row('审批执行者', '选择由你或 Guardian 处理审批'),
          row('诊断', '查看配置告警和当前任务完整提示词'),
          row('专用模型', '按用途配置辅助能力使用的模型'),
          row('生成模型', '用于任务建议和会话标题生成与更新'),
          row('整理模型', '用于记忆提取和任务上下文整理'),
          row('代码模型', '用于计划实施和 AI 代码审查'),
          row('安全模型（实验）', '用于 Shell 和工具权限自动审核'),
          row('数据位置', '更改 Pidex 配置和会话数据目录'),
          row('配置层', '选择用户配置、活动 Profile 或项目配置，并打开 JSON/JSONC 配置文件'),
          row('完整提示词诊断', '查看提示词来源、哈希与 token 估算'),
        ],
      },
      {
        id: 'personalization',
        routeId: 'personalization',
        label: '个性化',
        description: '回复个性和自定义指令',
        icon: Gauge,
        rows: [
          row('个性', '选择 Pidex 回复的默认语气'),
          row('自定义指令', '为所有新会话设置长期指令'),
        ],
      },
      {
        id: 'memory',
        routeId: 'memory',
        label: '记忆',
        description: '自动记忆、当前工作区和召回时间线',
        icon: Brain,
        rows: [
          row('启用记忆', '允许新会话读取和写入自动记忆'),
          row('工作区', '显示当前工作区，项目记忆按工作区隔离'),
          row('记忆状态', '查看自动记忆运行状态'),
          row('项目记忆', '浏览和管理项目记忆内容'),
          row('召回时间线', '查看记忆在会话中的召回记录'),
        ],
      },
      {
        id: 'shortcuts',
        routeId: 'shortcuts',
        label: '键盘快捷键',
        description: '查看应用、聊天、导航和面板快捷键',
        icon: Keyboard,
        rows: [
          row('聊天快捷键', '新对话、换行、侧边聊天和快速聊天'),
          row('导航快捷键', '前进、后退、切换标签和切换对话'),
          row('面板快捷键', '显示侧栏、终端、浏览器和底部面板'),
        ],
      },
      {
        id: 'billing',
        routeId: 'billing',
        label: '用量与成本',
        description: '本机模型消耗与已连接账户的历史用量、成本分析',
        icon: CreditCard,
        rows: [
          row('应用用量', '查看本机 Token、任务、成本与模型趋势'),
          row('账户用量与成本', '分析已连接厂商的远端 Token、请求和成本趋势'),
          row('账户连接', '余额、套餐和计费凭据统一前往账户连接管理'),
        ],
      },
    ],
  },
  {
    id: 'integrations',
    title: '集成',
    items: [
      {
        id: 'providers',
        routeId: 'providers',
        label: '供应商',
        description: '管理模型供应商、账户连接、凭据和模型目录',
        icon: BrainCircuit,
        rows: [
          row('供应商目录', '查看并筛选可用、已连接和未连接的供应商'),
          row('账户连接', '管理 API Key、OAuth 和活动凭据'),
          row('模型目录', '查看、刷新和测试供应商提供的模型'),
          row('自定义 Provider', '新增、编辑或删除 OpenAI 兼容供应商'),
        ],
      },
      {
        id: 'plugins',
        routeId: 'plugins',
        label: '插件',
        description: '管理插件、技能和 MCP',
        icon: Blocks,
        rows: [
          row('插件', '查看 Pidex 已内置和可管理的扩展能力'),
          row('MCP', '查看、启停和配置 MCP 服务器'),
          row('技能', '管理当前工作区和个人技能'),
          row('启用或禁用', '控制插件、技能和 MCP 的运行状态'),
          row('技能详情', '查看、打开或立即使用已安装技能'),
        ],
      },
      {
        id: 'browser',
        routeId: 'browser',
        label: '浏览器',
        description: '内置浏览器隔离会话和站点权限',
        icon: Square,
        requires: { capabilities: ['browser.host.v1', 'browser.manage.v1'] },
        rows: [
          row('内置浏览器', '管理隔离的浏览器会话'),
          row('站点权限', '查看和管理网站访问权限'),
        ],
      },
      {
        id: 'computer',
        routeId: 'computer',
        label: '电脑控制',
        description: '读取已运行应用的界面并执行操作',
        icon: MonitorSmartphone,
        requires: { capabilities: ['computer.use.v1'] },
        rows: [
          row('启用电脑控制', '开启后 Agent 才能发现已运行的应用'),
          row('应用授权', '始终允许、拒绝或撤销单个应用'),
          row('控制范围', '查看后台优先与前台升级规则'),
        ],
      },
    ],
  },
  {
    id: 'coding',
    title: '编码',
    items: [
      {
        id: 'worktrees',
        routeId: 'worktrees',
        label: '托管 Worktrees',
        description: '创建、恢复、保留和清理 Pidex 工作树',
        icon: Trees,
        rows: [
          row('创建 Worktree', '从分支或当前 working tree 创建隔离工作区'),
          row('工作树根目录', '配置后续创建的目录；已有工作树保持原路径'),
          row('上游更新', '创建工作树前获取上游更新，失败时继续使用本地引用'),
          row('自动删除', '自动清理旧工作树并设置保留数量'),
          row('项目指令与共享来源', '管理项目上下文、指令和共享文件'),
          row('多环境', '选择项目默认环境，管理 Setup、Cleanup 和 Actions'),
          row('Setup 进度', '查看输出并在失败后重试或跳过'),
          row('永久保留', '避免自动清理重要工作树'),
          row('删除与恢复', '通过安全快照清理或恢复工作树'),
        ],
      },
      {
        id: 'dependencies',
        routeId: 'dependencies',
        label: '工作空间依赖项',
        description: '管理 Node.js、Python、Git Bash 和 ripgrep 运行环境',
        icon: Package,
        rows: [
          row('Node.js', '选择内置或本机版本并查看安装状态'),
          row('Python', '选择内置或本机版本并查看安装状态'),
          row('Git Bash', '选择内置或本机版本并查看安装状态'),
          row('ripgrep', '选择内置或本机版本并查看安装状态'),
        ],
      },
      {
        id: 'code-review',
        routeId: 'code-review',
        label: '代码审查',
        description: 'AI 审查呈现、PR 监控和自动修复',
        icon: GitBranch,
        rows: [
          row('审查结果呈现方式', '在当前聊天内联审查或使用单独聊天'),
          row('监控并修复 PR', '选择项目和 PR，管理独立修复聊天与工作树'),
          row('自动合并', '通过 head SHA、CI、审查和权限检查后合并 PR'),
        ],
      },
      {
        id: 'git',
        routeId: 'git',
        label: 'Git',
        description: '分支、拉取请求、工作树和 GitHub 账户',
        icon: GitBranch,
        rows: [
          row('分支前缀', '设置 Pidex 创建分支时使用的前缀'),
          row('拉取请求合并方法', '选择 PR 的默认合并方法'),
          row('在侧边栏显示 PR 图标', '显示拉取请求状态'),
          row('始终强制推送', '推送时使用 --force-with-lease'),
          row('创建草稿拉取请求', '默认创建 Draft PR'),
          row('提交指令', '设置提交信息生成指令'),
          row('拉取请求指令', '设置 PR 标题和描述生成指令'),
          row('GitHub 账号', '登录 GitHub 并管理 OAuth 状态'),
        ],
      },
    ],
  },
  {
    id: 'archived',
    title: '已归档',
    items: [
      {
        id: 'archived',
        routeId: 'archived',
        label: '已归档对话',
        description: '查看、恢复或管理已归档的对话',
        icon: Archive,
        rows: [row('归档列表', '恢复归档对话后会回到原来的分组')],
      },
    ],
  },
] as const satisfies readonly SettingsRegistryGroup[]

export type SettingsTabId = (typeof SETTINGS_GROUPS)[number]['items'][number]['routeId']

export const SETTINGS_ITEMS: readonly SettingsRegistryItem[] = SETTINGS_GROUPS.flatMap(
  (group) => group.items as readonly SettingsRegistryItem[],
)

export type SettingsSearchDocument = {
  key: string
  tabId: string
  groupTitle: string
  pageLabel: string
  rowTitle?: string
  description: string
  targetId: string
}

export const SETTINGS_SEARCH_DOCUMENTS: readonly SettingsSearchDocument[] = SETTINGS_GROUPS.flatMap(
  (group) =>
    group.items.flatMap((item) => [
      {
        key: `${item.id}:page`,
        tabId: item.routeId,
        groupTitle: group.title,
        pageLabel: item.label,
        description: item.description,
        targetId: createSettingsTargetId(item.id),
      },
      ...item.rows.map((searchRow, index) => ({
        key: `${item.id}:row:${index}`,
        tabId: item.routeId,
        groupTitle: group.title,
        pageLabel: item.label,
        rowTitle: searchRow.title,
        description: searchRow.description,
        targetId: createSettingsTargetId(item.id, searchRow.title),
      })),
    ]),
)

export function createSettingsTargetId(tabId: string, rowTitle?: string): string {
  return rowTitle ? `settings-${tabId}-${toTargetSegment(rowTitle)}` : `settings-${tabId}-page`
}

function toTargetSegment(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[^\p{Letter}\p{Number}]+/gu, '-')
    .replace(/^-|-$/g, '')
}
