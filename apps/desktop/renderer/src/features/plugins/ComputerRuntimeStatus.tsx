import { useComputerSettings } from '../settings/UseComputerSettings.js'

export function ComputerRuntimeStatus() {
  const { state } = useComputerSettings()
  if (!state.enabled || state.runtime?.status === 'ready') return null
  const runtime = state.runtime
  const message =
    runtime?.status === 'error'
      ? runtime.error === 'start_failed'
        ? '电脑控制组件启动失败，请关闭后重新启用以重试。'
        : runtime.error === 'unsupported_platform'
          ? '电脑控制组件仅支持 Windows x64。'
          : '电脑控制组件安装失败，请关闭后重新启用以重试。'
      : runtime?.status === 'starting'
        ? '下载校验完成，正在启动电脑控制组件…'
        : runtime?.status === 'downloading'
          ? `正在下载电脑控制组件… ${runtime.progress ?? 0}%`
          : '正在准备下载电脑控制组件…'
  return (
    <span className="tw:mt-2 tw:grid tw:gap-1 tw:text-app-text-soft tw:type-body-sm" role="status">
      <span>{message}</span>
      {runtime?.status === 'downloading' ? (
        <progress
          className="tw:w-full"
          aria-label="电脑控制组件下载进度"
          max={100}
          value={runtime.progress ?? 0}
        />
      ) : null}
    </span>
  )
}
