import React, { useContext, useState } from 'react'
import { Bot } from 'lucide-react'
import type { SubagentRole } from '@pidex/shared/thread'
import { cx } from '../../../utils/Cx.js'
import { DesktopThemeContext } from '../../theme/ThemeContext.js'
// Vite 会把 `new URL(相对路径, import.meta.url)` 打包成带哈希的资源地址；
// 也不用 `.png` 模块导入，避免非 Vite 运行时（bun test）把它当 JS 解析。
const asset = (variant: 'light' | 'dark', file: string): string =>
  new URL(`../../../assets/subagents/${variant}/${file}.png`, import.meta.url).href

const ASSETS: Record<SubagentRole, { light: string; dark: string }> = {
  frontend: { light: asset('light', 'Frontend'), dark: asset('dark', 'Frontend') },
  backend: { light: asset('light', 'Backend'), dark: asset('dark', 'Backend') },
  devops: { light: asset('light', 'DevOps'), dark: asset('dark', 'DevOps') },
  qa: { light: asset('light', 'QA'), dark: asset('dark', 'QA') },
  designer: { light: asset('light', 'Designer'), dark: asset('dark', 'Designer') },
  data: { light: asset('light', 'Data'), dark: asset('dark', 'Data') },
  docs: { light: asset('light', 'Docs'), dark: asset('dark', 'Docs') },
  product: { light: asset('light', 'Product'), dark: asset('dark', 'Product') },
  general: { light: asset('light', 'General'), dark: asset('dark', 'General') },
}

const SIZES = { sm: 18, md: 24, lg: 32 } as const

export type SubagentAvatarProps = {
  role: SubagentRole
  size?: keyof typeof SIZES
  className?: string
}

export function SubagentAvatar({
  role,
  size = 'md',
  className,
}: SubagentAvatarProps): React.ReactNode {
  // 跟随应用解析后的明暗变体；不做亮度计算或额外主题监听。
  const dark = useContext(DesktopThemeContext)?.resolvedVariant === 'dark'
  const px = SIZES[size]
  const source = dark ? ASSETS[role].dark : ASSETS[role].light
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const failed = failedSource === source

  return (
    <span
      aria-hidden="true"
      className={cx(
        'tw:inline-flex tw:shrink-0 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-full tw:border tw:border-app-border-subtle tw:bg-app-raised tw:text-app-text-meta',
        className,
      )}
      style={{ width: px, height: px }}
    >
      {failed ? (
        <Bot size={Math.round(px * 0.55)} />
      ) : (
        <img
          alt=""
          className="tw:size-full tw:object-contain"
          draggable={false}
          src={source}
          onError={() => setFailedSource(source)}
        />
      )}
    </span>
  )
}
