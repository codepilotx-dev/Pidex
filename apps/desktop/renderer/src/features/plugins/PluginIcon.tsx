import type React from 'react'
import { useContext, useState } from 'react'
import {
  Eye,
  FileSpreadsheet,
  GitBranch,
  Presentation,
  ListChecks,
  Plug,
  Sparkles,
} from 'lucide-react'
import type { PluginIconName } from './PluginCatalog.js'
import browserLogo from '../../assets/plugin-icons/browser.png'
import chromeLogo from '../../assets/plugin-icons/chrome.png'
import computerUseLogo from '../../assets/plugin-icons/computer-use.png'
import githubDarkLogo from '../../assets/plugin-icons/github-dark.png'
import githubLogo from '../../assets/plugin-icons/github.svg'
import presentationsLogo from '../../assets/plugin-icons/presentations.png'
import spreadsheetsLogo from '../../assets/plugin-icons/spreadsheets.png'
import taskPlanningLogo from '../../assets/plugin-icons/task-planning.png'
import { DesktopThemeContext } from '../theme/ThemeContext.js'
import { cx } from '../../utils/Cx.js'

import { usePluginAssets } from './UsePluginAssets.js'
import type { PluginCatalogItem } from './PluginCatalog.js'

type Props = {
  plugin?: PluginCatalogItem
  name: PluginIconName
  className?: string
  logoSource?: string
  logoDarkSource?: string
}

type KnownPluginLogo = {
  source: string
  darkSource?: string
}

/* 插件 Logo 槽位：铺满父级图标框，内部图片等比缩放。 */
const PLUGIN_LOGO_CLASS =
  'plugin-logo tw:relative tw:inline-flex tw:size-full tw:shrink-0 tw:items-center tw:justify-center'

/* Logo 图片：吃满槽位；暗色主题下 light / dark 两张图互斥显示。 */
const PLUGIN_LOGO_IMAGE_CLASS = 'plugin-logo__image tw:size-full tw:shrink-0 tw:object-contain'

const KNOWN_PLUGIN_LOGOS: Partial<Record<PluginIconName, KnownPluginLogo>> = {
  browser: { source: browserLogo },
  chrome: { source: chromeLogo },
  'computer-use': { source: computerUseLogo },
  github: { source: githubLogo, darkSource: githubDarkLogo },
  presentations: { source: presentationsLogo },
  spreadsheets: { source: spreadsheetsLogo },
  'task-planning': { source: taskPlanningLogo },
}

export function PluginIcon({
  name,
  plugin,
  className,
  logoDarkSource,
  logoSource,
}: Props): React.ReactNode {
  // 主题变体沿用全局 dark-theme 标记；无 Provider 时按浅色渲染。
  const darkTheme = useContext(DesktopThemeContext)?.resolvedVariant === 'dark'
  const loaded = usePluginAssets(plugin)
  const [failedSource, setFailedSource] = useState<string | null>(null)
  const knownLogo = KNOWN_PLUGIN_LOGOS[name]
  const source = loaded.logo ?? logoSource ?? knownLogo?.source
  const darkSource = loaded.logoDark ?? logoDarkSource ?? knownLogo?.darkSource

  if (source && failedSource !== (darkTheme && darkSource ? darkSource : source)) {
    return (
      <span
        aria-hidden="true"
        className={cx(darkSource && 'plugin-logo--themed', PLUGIN_LOGO_CLASS, className)}
      >
        <img
          alt=""
          className={cx(
            PLUGIN_LOGO_IMAGE_CLASS,
            'plugin-logo__image--light',
            darkTheme && darkSource && 'tw:hidden',
          )}
          onError={() => setFailedSource(source)}
          src={source}
        />
        {darkSource ? (
          <img
            alt=""
            className={cx(
              PLUGIN_LOGO_IMAGE_CLASS,
              'plugin-logo__image--dark',
              darkTheme ? 'tw:block' : 'tw:hidden',
            )}
            onError={() => setFailedSource(darkSource)}
            src={darkSource}
          />
        ) : null}
      </span>
    )
  }

  const props = {
    'aria-hidden': true,
    className,
    size: 14,
    'data-icon-kind': 'artwork',
    strokeWidth: 2,
  } as const

  switch (name) {
    case 'task-planning':
      return <ListChecks {...props} />
    case 'plugin':
      return <Plug {...props} />
    case 'browser':
    case 'chrome':
      return <Eye {...props} />
    case 'spreadsheets':
      return <FileSpreadsheet {...props} />
    case 'presentations':
      return <Presentation {...props} />
    case 'github':
      return <GitBranch {...props} />
    case 'computer-use':
      return <Sparkles {...props} />
  }
}
