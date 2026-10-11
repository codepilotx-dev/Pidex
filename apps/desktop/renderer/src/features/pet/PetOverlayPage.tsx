import { APP_ICON_SIZE, APP_ICON_SIZES } from '../../components/ui/IconTokens.js'
import React, { useEffect, useRef, useState } from 'react'
import { ExternalLink, Send, X } from 'lucide-react'
import { PetSprite } from './PetSprite.js'
import { PetQuickReply } from './PetQuickReply.js'
import { usePetOverlayController } from './UsePetOverlayController.js'
import { resolvePetDragAnimation } from './PetDirectionModel.js'
import type { PetAnimationName } from './PetAnimationModel.js'
import { usePetLookFrame } from './UsePetLookFrame.js'
import '../../styles/lazy/pet-overlay.css'

export function PetOverlayPage(): React.ReactNode {
  const controller = usePetOverlayController()
  const [greeting, setGreeting] = useState(true)
  const [dragAnimation, setDragAnimation] = useState<PetAnimationName | null>(null)
  const [keyboardActive, setKeyboardActive] = useState(false)
  const [reply, setReply] = useState('')
  const [replyError, setReplyError] = useState<string | null>(null)
  const [replySubmitting, setReplySubmitting] = useState(false)
  const dragScreenXRef = useRef<number | null>(null)
  const avatarRef = useRef<HTMLDivElement | null>(null)
  const lookFrame = usePetLookFrame(
    avatarRef,
    controller.pet?.spriteVersionNumber,
    dragAnimation === null,
  )

  useEffect(() => {
    const root = document.documentElement
    root.dataset.windowKind = 'pet-overlay'
    root.classList.add('pet-overlay-surface')
    document.body.classList.add('pet-overlay-surface')
    const timer = window.setTimeout(() => setGreeting(false), 15_000)
    return () => {
      delete root.dataset.windowKind
      root.classList.remove('pet-overlay-surface')
      document.body.classList.remove('pet-overlay-surface')
      window.clearTimeout(timer)
    }
  }, [])

  const setInteractive = (interactive: boolean): void => {
    window.DesktopBridge?.setPetPointerPassthrough(!interactive)
  }

  const setKeyboardFocus = (focused: boolean): void => {
    setKeyboardActive(focused)
    setInteractive(focused)
    void window.DesktopBridge?.requestPetKeyboardFocus(focused)
  }

  const notification = controller.notification
  useEffect(() => {
    setReply('')
    setReplyError(null)
    setKeyboardActive(false)
    window.DesktopBridge?.setPetPointerPassthrough(true)
    void window.DesktopBridge?.requestPetKeyboardFocus(false)
  }, [notification?.id])

  if (!controller.pet) {
    return (
      <main
        className="pet-overlay-page tw:relative tw:size-full tw:select-none tw:pointer-events-none"
        data-startup-surface-ready="true"
      >
        <div
          className="pet-overlay-empty pet-overlay-interactive tw:absolute tw:top-2 tw:right-2 tw:left-2 tw:flex tw:max-h-55 tw:min-h-[70px] tw:flex-col tw:items-stretch tw:gap-2 tw:overflow-auto tw:rounded-xl tw:border tw:border-app-border tw:bg-app-raised tw:px-4 tw:py-3 tw:text-app-text tw:shadow-lg tw:backdrop-blur-none tw:pointer-events-auto"
          onPointerEnter={() => setInteractive(true)}
          onPointerLeave={() => setInteractive(false)}
        >
          请先在“设置 → 宠物”安装一个宠物包。
        </div>
      </main>
    )
  }

  return (
    <main
      className="pet-overlay-page tw:relative tw:size-full tw:select-none tw:pointer-events-none"
      data-startup-surface-ready="true"
    >
      {notification || greeting ? (
        <section
          className="pet-overlay-pill pet-overlay-interactive tw:absolute tw:top-2 tw:right-2 tw:left-2 tw:flex tw:max-h-55 tw:min-h-[70px] tw:flex-col tw:items-stretch tw:gap-2 tw:overflow-auto tw:rounded-xl tw:border tw:border-app-border tw:bg-app-raised tw:px-4 tw:py-3 tw:text-app-text tw:shadow-lg tw:backdrop-blur-none tw:pointer-events-auto"
          onBlurCapture={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
              return
            }
            setKeyboardFocus(false)
          }}
          onFocusCapture={() => setKeyboardFocus(true)}
          onPointerDown={() => setInteractive(true)}
          onPointerEnter={() => setInteractive(true)}
          onPointerLeave={() => {
            if (!keyboardActive) setInteractive(false)
          }}
        >
          <div className="pet-overlay-pill-header tw:flex tw:items-center tw:gap-2">
            <div className="pet-overlay-pill-copy tw:flex tw:min-w-0 tw:flex-1 tw:flex-col">
              <strong className="tw:truncate">
                {notification?.title ?? `你好，我是 ${controller.pet.displayName}`}
              </strong>
              <span className="tw:truncate tw:type-body-sm tw:text-app-text-meta">
                {notification?.detail ?? '我会在任务需要你时提醒你。'}
              </span>
            </div>
            {notification ? (
              <div className="pet-overlay-pill-actions tw:flex tw:items-center tw:gap-1">
                <button
                  aria-label="打开任务"
                  className="tw:grid tw:size-7.5 tw:cursor-pointer tw:place-items-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:hover:bg-app-hover"
                  onClick={() => void controller.openThread(notification.threadId)}
                  type="button"
                >
                  <ExternalLink size={APP_ICON_SIZE} />
                </button>
                <button
                  aria-label="关闭提醒"
                  className="tw:grid tw:size-7.5 tw:cursor-pointer tw:place-items-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:hover:bg-app-hover"
                  onClick={() => controller.dismiss(notification.id)}
                  type="button"
                >
                  <X size={APP_ICON_SIZES.sm} />
                </button>
              </div>
            ) : null}
          </div>
          {notification?.request ? (
            <div className="pet-overlay-pill-body tw:border-t tw:border-app-border tw:pt-1">
              <PetQuickReply
                disabled={replySubmitting}
                request={notification.request}
                onRespond={(_request, decision) => controller.respond(notification, decision)}
              />
            </div>
          ) : null}
          {notification ? (
            <form
              className="pet-overlay-reply-form tw:grid tw:grid-cols-[minmax(0,1fr)_auto] tw:gap-2"
              onSubmit={(event) => {
                event.preventDefault()
                const text = reply.trim()
                if (!text || replySubmitting) return
                setReplySubmitting(true)
                setReplyError(null)
                void controller
                  .reply(notification, text)
                  .then(() => {
                    setReply('')
                    setKeyboardFocus(false)
                    if (document.activeElement instanceof HTMLElement) {
                      document.activeElement.blur()
                    }
                  })
                  .catch((error) => {
                    setReplyError(error instanceof Error ? error.message : '回复失败，请重试。')
                  })
                  .finally(() => setReplySubmitting(false))
              }}
            >
              <input
                aria-label="快捷回复"
                className="tw:h-7.5 tw:min-w-0 tw:rounded-md tw:border tw:border-app-border tw:bg-app-raised tw:px-2 tw:text-app-text tw:type-body tw:outline-none tw:focus:border-app-focus"
                disabled={replySubmitting}
                placeholder="回复这个任务…"
                value={reply}
                onChange={(event) => {
                  setReply(event.target.value)
                  setReplyError(null)
                }}
              />
              <button
                aria-label="发送回复"
                className="tw:grid tw:size-7.5 tw:cursor-pointer tw:place-items-center tw:rounded-md tw:border-0 tw:bg-transparent tw:p-0 tw:text-inherit tw:hover:bg-app-hover tw:disabled:cursor-not-allowed tw:disabled:opacity-50"
                disabled={replySubmitting || !reply.trim()}
                type="submit"
              >
                <Send size={APP_ICON_SIZE} />
              </button>
              {replyError ? (
                <span
                  aria-live="polite"
                  className="pet-overlay-reply-error tw:col-span-full tw:type-caption tw:text-app-danger"
                >
                  {replyError}
                </span>
              ) : null}
            </form>
          ) : null}
        </section>
      ) : null}

      <div
        ref={avatarRef}
        className="pet-overlay-avatar pet-overlay-interactive tw:absolute tw:right-5 tw:bottom-2.5 tw:grid tw:cursor-grab tw:touch-none tw:place-items-end tw:active:cursor-grabbing tw:pointer-events-auto"
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragScreenXRef.current = event.screenX
          setDragAnimation(controller.animation)
          window.DesktopBridge?.beginPetDrag()
        }}
        onPointerEnter={() => setInteractive(true)}
        onPointerLeave={() => setInteractive(false)}
        onPointerMove={(event) => {
          if (event.currentTarget.hasPointerCapture(event.pointerId)) {
            const previousScreenX = dragScreenXRef.current ?? event.screenX
            const deltaX = event.screenX - previousScreenX
            setDragAnimation((current) =>
              resolvePetDragAnimation(current ?? controller.animation, deltaX),
            )
            if (Math.abs(deltaX) >= 4) dragScreenXRef.current = event.screenX
            window.DesktopBridge?.updatePetDrag()
          }
        }}
        onPointerUp={(event) => {
          event.currentTarget.releasePointerCapture(event.pointerId)
          dragScreenXRef.current = null
          setDragAnimation(null)
          window.DesktopBridge?.endPetDrag()
        }}
        onPointerCancel={() => {
          dragScreenXRef.current = null
          setDragAnimation(null)
          window.DesktopBridge?.endPetDrag()
        }}
      >
        <PetSprite
          animation={dragAnimation ?? controller.animation}
          lookFrame={dragAnimation === null ? lookFrame : null}
          size={controller.size}
          spriteVersionNumber={controller.pet.spriteVersionNumber}
          spritesheetUrl={controller.pet.spritesheetUrl}
        />
      </div>
    </main>
  )
}
