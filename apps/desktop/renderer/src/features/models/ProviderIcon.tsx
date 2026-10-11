import { Server } from 'lucide-react'
import type React from 'react'
import { RemoteImage } from '../../components/ui/RemoteImage.js'
import { useProviderIconSource } from '../../services/desktop-client/ProviderIconClient.js'

export type ProviderIconProps = {
  logoURL?: string
  /**
   * 图标槽容器类。宿主缓存未命中时用同一个类渲染占位图标，保证尺寸、圆角和
   * 背景与已加载状态一致。
   */
  className?: string
  imageClassName?: string
  fallback?: React.ReactNode
}

/**
 * 供应商图标的统一加载与渲染入口：先取宿主本地缓存，再交给 `RemoteImage`
 * 处理加载态与失败回退。模型选择器与“设置 → 供应商”页共用这里，不再各自
 * 直接请求远端图标。
 */
export function ProviderIcon({
  logoURL,
  className,
  imageClassName,
  fallback,
}: ProviderIconProps): React.ReactNode {
  const source = useProviderIconSource(logoURL)
  const placeholder = fallback ?? (
    <Server aria-hidden="true" size={14} data-icon-kind="artwork" strokeWidth={2} />
  )

  if (!source) {
    return className ? <span className={className}>{placeholder}</span> : placeholder
  }

  return (
    <RemoteImage
      alt=""
      className={className}
      fallback={placeholder}
      imageClassName={imageClassName}
      src={source}
    />
  )
}
