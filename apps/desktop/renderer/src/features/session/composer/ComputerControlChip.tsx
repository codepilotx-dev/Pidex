import type React from 'react'
import { useState } from 'react'
import { MonitorSmartphone } from 'lucide-react'
import { useComputerState } from './UseComputerState.js'
import { desktopClient } from '../../../services/desktop-client/index.js'
import { Button } from '../../../components/ui/Button.js'
import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'

/**
 * Chat-scoped computer control indicator. It renders nothing unless this chat
 * owns the current control turn, so no standalone computer panel is needed.
 */
export function ComputerControlChip({ threadId }: { threadId: string | null }): React.ReactNode {
  const { state } = useComputerState()
  const [stopping, setStopping] = useState(false)

  if (!threadId || !state || state.ownerThreadId !== threadId) return null
  const controlled = state.busy && state.ownerTurnId !== null

  return (
    <>
      <span className="toolbar-divider tw:inline-block tw:h-3.5 tw:w-px tw:shrink-0 tw:bg-app-border-subtle" />
      <span
        className="chip-button composer-plan-mode-chip active tw:relative tw:bg-app-selected tw:text-app-accent-fg tw:type-secondary tw:hover:bg-app-selected"
        title="当前聊天正在控制电脑；停止后需要新的对话回合才能继续"
      >
        <MonitorSmartphone aria-hidden="true" size={APP_ICON_SIZE} />
        <span>{controlled ? `电脑操作中：${state.targetName ?? '电脑'}` : '电脑控制中'}</span>
        <Button
          color="secondary"
          disabled={stopping}
          onClick={() => {
            setStopping(true)
            void desktopClient
              .stopComputer()
              .catch(() => undefined)
              .finally(() => setStopping(false))
          }}
        >
          停止
        </Button>
      </span>
    </>
  )
}
