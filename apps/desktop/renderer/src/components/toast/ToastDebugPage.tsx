import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Archive } from 'lucide-react'
import { Button } from '../ui/Button.js'
import { ToastStack } from './ToastStack.js'
import { createToastStore, toastStore, type ShowToastOptions } from './ToastState.js'

type DebugCase = {
  id: string
  label: string
  options: ShowToastOptions
  actions?: string[]
  expires?: boolean
}

const CASES: DebugCase[] = [
  { id: 'success', label: '状态 / 成功', options: { tone: 'status', message: '文件已保存' } },
  { id: 'info', label: '普通提示', options: { tone: 'info', message: '工作区已更新', details: '可以继续当前操作。' } },
  { id: 'error', label: '错误', options: { tone: 'error', message: '操作失败，请重试' } },
  { id: 'details', label: '点击打开详情', options: { tone: 'status', message: 'brand-kit.zip 上传完成', details: '已保存到当前工作区。' } },
  { id: 'retry', label: '重试 / 原位更新', options: { tone: 'error', message: '请求失败', details: '点击重试，在原卡片内更新为成功。' }, actions: ['重试'] },
  {
    id: 'archive', label: '归档 / 富文本与双动作',
    options: {
      tone: 'status', appearance: 'action',
      icon: <Archive aria-hidden="true" size={18} />,
      message: '已归档的聊天',
    },
    actions: ['查看', '撤销'],
  },
  {
    id: 'custom', label: '自定义图标、内容与按钮',
    options: {
      tone: 'info', icon: <Archive size={18} />,
      message: <span>自定义通知内容</span>,
    },
  },
  { id: 'no-icon', label: '纯文字 / 无图标', options: { tone: 'info', icon: null, message: '不带图标的通知' } },
  { id: 'error-details', label: '简短错误 / 独立详情弹窗', options: { tone: 'error', message: '操作失败', details: '调试错误详情第一行\n调试错误详情第二行（仅示例，无真实路径或凭据）' } },
  { id: 'grow', label: '内容撑宽 / 300–420px', options: { tone: 'info', message: '工作区文件已更新，请检查修改结果后继续操作' } },
  { id: 'max-width', label: '最大宽度 / 单行省略', options: { tone: 'info', message: '用于查看最大宽度省略效果的通知内容'.repeat(3), details: '用于查看最大宽度省略效果的通知内容'.repeat(3) } },
  { id: 'navigate', label: '点击正文跳转常规设置', options: { tone: 'info', message: '查看常规设置' } },
  { id: 'failed-navigation', label: '跳转失败 / 保留原通知', options: { tone: 'info', message: '调试跳转失败', onActivate: () => Promise.reject(new Error('调试跳转失败，原通知应保留')) } },
  { id: 'disabled', label: '禁用动作', options: { tone: 'info', message: '任务正在处理中', details: '操作暂不可用。' }, actions: ['处理中'] },
  { id: 'expiry', label: '动作期限 / 5 秒后禁用', options: { tone: 'status', message: '可以撤销本次操作', details: '重置后重新开始 5 秒期限。' }, actions: ['撤销'], expires: true },
  { id: 'no-close', label: '隐藏关闭按钮', options: { tone: 'info', message: '等待业务主动移除', details: '可用卡片外的重置和清除调试弹窗。', showCloseButton: false } },
]

function showDebugToast(sample: DebugCase, store: typeof toastStore, onNavigate: () => void): void {
  const id = `toast-debug-${sample.id}`
  const onAction = (label: string): void => {
    store.show({
      id, dedupeKey: id, tone: 'status', message: `${label}完成`,
      details: '调试反馈，未执行真实业务操作。',
    })
  }
  store.show({
    ...sample.options,
    onActivate: sample.id === 'navigate' || sample.id === 'archive' ? onNavigate : sample.options.onActivate,
    actions: sample.id === 'custom'
      ? <Button size="sm" shape="pill" onClick={() => onAction('操作')}>操作</Button>
      : sample.options.actions,
    id, dedupeKey: id,
    expiresAt: sample.expires ? Date.now() + 5000 : undefined,
    action: sample.actions?.[0] ? {
      label: sample.actions[0], disabled: sample.id === 'disabled',
      onClick: () => onAction(sample.actions![0]!),
    } : undefined,
    secondaryAction: sample.actions?.[1] ? {
      label: sample.actions[1], onClick: () => onAction(sample.actions![1]!),
    } : undefined,
  })
}

function ToastPreview({ sample, onNavigate }: { sample: DebugCase; onNavigate: () => void }) {
  const [store] = useState(() => {
    const local = createToastStore()
    showDebugToast(sample, local, onNavigate)
    return local
  })
  return (
    <section className="tw:flex tw:min-w-0 tw:flex-col tw:gap-3 tw:rounded-container tw:border tw:border-app-border-subtle tw:bg-app-canvas tw:p-4">
      <h2 className="tw:m-0 tw:type-row-title tw:text-app-text">{sample.label}</h2>
      <div className="tw:flex tw:gap-2">
        <Button size="sm" onClick={() => showDebugToast(sample, store, onNavigate)}>重置</Button>
        <Button size="sm" onClick={() => showDebugToast(sample, toastStore, onNavigate)}>弹到全局</Button>
      </div>
      <div className="tw:flex tw:justify-center"><ToastStack store={store} embedded /></div>
    </section>
  )
}

export function ToastDebugPage() {
  const navigate = useNavigate()
  const onNavigate = () => navigate('/settings/general')
  const [generation, setGeneration] = useState(0)
  const clearDebugToasts = () => {
    for (const item of toastStore.getState().toasts) {
      if (item.id.startsWith('toast-debug-')) toastStore.dismiss(item.id)
    }
  }
  return (
    <main className="tw:h-full tw:overflow-y-auto tw:bg-app-main tw:p-6 tw:text-app-text">
      <div className="tw:mx-auto tw:flex tw:max-w-6xl tw:flex-col tw:gap-5">
        <header className="tw:flex tw:flex-col tw:gap-2">
          <h1 className="tw:m-0 tw:type-page-title">Toast 调试</h1>
          <p className="tw:m-0 tw:type-body-sm tw:text-app-text-soft">全部通知形态平铺显示，复用真实组件与主题。宽度 300–420px · Peek 10px · Gap 4px · Corner 14px。正文可打开详情或跳转常规设置；按钮仅更新示例，不会归档聊天或发送请求。</p>
          <div className="tw:flex tw:flex-wrap tw:gap-2">
            <Button onClick={() => setGeneration((value) => value + 1)}>重置全部示例</Button>
            <Button onClick={() => CASES.slice(0, 3).forEach((sample) => showDebugToast(sample, toastStore, onNavigate))}>叠放三条</Button>
            <Button onClick={() => CASES.slice(0, 6).forEach((sample) => showDebugToast(sample, toastStore, onNavigate))}>连续弹出六条</Button>
            <Button onClick={clearDebugToasts}>清除调试弹窗</Button>
          </div>
          <p className="tw:m-0 tw:type-caption tw:text-app-text-meta">全局栈最多保留五条，可视区域只预留三条高度，展开后内部滚动查看其余通知；弹出调试通知也会按同一规则淘汰最旧通知。平铺示例互相独立，关闭后可重置。</p>
        </header>
        <div className="tw:grid tw:grid-cols-[repeat(auto-fit,minmax(460px,1fr))] tw:gap-4">
          {CASES.map((sample) => <ToastPreview key={`${generation}-${sample.id}`} sample={sample} onNavigate={onNavigate} />)}
        </div>
      </div>
    </main>
  )
}
