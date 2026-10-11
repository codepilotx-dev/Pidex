import React from 'react'
import { Check, Copy } from 'lucide-react'

import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import { Button } from '../../../components/ui/Button.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { desktopClipboard } from '../../../services/desktop-client/index.js'

/**
 * Shared copy affordance for conversation items and result cards: keyboard
 * reachable, announces the copied state and never bubbles into a parent toggle.
 */
export function CopyButton({
  ariaLabel = '复制',
  className,
  text,
}: {
  ariaLabel?: string
  className?: string
  text: string
}): React.ReactNode {
  const [copied, setCopied] = React.useState(false)
  return (
    <Tooltip content={copied ? '已复制' : ariaLabel}>
      <Button
        isIconOnly
        aria-label={copied ? `${ariaLabel}：已复制` : ariaLabel}
        className={className}
        color="ghostSecondary"
        size="toolbar"
        title={copied ? '已复制' : ariaLabel}
        onClick={(event) => {
          event.stopPropagation()
          void desktopClipboard.writeText(text).then(() => {
            setCopied(true)
            window.setTimeout(() => setCopied(false), 1400)
          })
        }}
      >
        {copied ? (
          <Check aria-hidden="true" size={APP_ICON_SIZE} />
        ) : (
          <Copy aria-hidden="true" size={APP_ICON_SIZE} />
        )}
      </Button>
    </Tooltip>
  )
}
