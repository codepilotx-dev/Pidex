import type React from 'react'
import { DesktopComposer } from './composer/DesktopComposer.js'
import { useQuickChatContext } from './QuickChatContext.js'

const CHAT_COMPOSER_PLACEHOLDER = '给 Pidex 发消息'

export function ChatNewSessionView(): React.ReactNode {
  const { composerProps } = useQuickChatContext()

  return (
    <div className="quick-chat-workspace chat-home-workspace tw:flex tw:h-full tw:w-full tw:min-h-0 tw:overflow-hidden">
      <main className="quick-chat-view chat-home-view tw:flex tw:h-full tw:max-w-none tw:w-full tw:min-h-full tw:flex-col tw:items-stretch tw:justify-center tw:overflow-x-hidden tw:overflow-y-auto tw:px-8 tw:pb-4 tw:text-app-text tw:[scrollbar-gutter:stable]">
        <section className="quick-chat-composer-region chat-home-region tw:m-auto tw:flex tw:w-full tw:min-w-0 tw:flex-[0_1_auto] tw:flex-col tw:items-center tw:justify-center">
          <div className="quick-chat-hero chat-home-hero tw:flex tw:w-[var(--quick-chat-surface-width)] tw:max-w-full tw:flex-col tw:items-center tw:gap-0 tw:text-center tw:text-app-text tw:type-display tw:animate-none">
            <h1 className="tw:m-0 tw:max-w-full tw:px-2 tw:py-1 tw:text-balance tw:text-app-text tw:[font:inherit] tw:tracking-normal tw:select-none">
              随时可以开始。
            </h1>
          </div>
          {composerProps ? (
            <div className="chat-composer tw:static tw:m-0 tw:flex tw:w-[var(--quick-chat-surface-width)] tw:max-w-full tw:flex-col tw:items-center tw:gap-3 tw:pointer-events-auto">
              <DesktopComposer
                {...composerProps}
                placeholder={CHAT_COMPOSER_PLACEHOLDER}
                surface="chat"
              />
            </div>
          ) : null}
        </section>
      </main>
    </div>
  )
}
