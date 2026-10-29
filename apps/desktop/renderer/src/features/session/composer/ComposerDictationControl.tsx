import type React from 'react'
import { useEffect } from 'react'
import { Loader2, Mic, Square, X } from 'lucide-react'
import { Button } from '../../../components/ui/Button.js'
import { Tooltip } from '../../../components/ui/Tooltip.js'
import { APP_ICON_SIZE, APP_ICON_SIZES, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import type { ComposerEditorHandle } from './ComposerEditor.js'
import type { ComposerDraftKey } from './ComposerTypes.js'
import { useComposerDictation } from './UseComposerDictation.js'

export type DictationController = {
  toggle: () => void
  cancel: () => void
  isActive: boolean
}

type Props = {
  draftKey: ComposerDraftKey
  editorRef: React.RefObject<ComposerEditorHandle | null>
  enabled: boolean
  registerToggle?: (toggle: (() => void) | null) => void
  registerControl?: (control: DictationController | null) => void
}

export function ComposerDictationControl({
  draftKey,
  editorRef,
  enabled,
  registerToggle,
  registerControl,
}: Props): React.ReactNode {
  const dictation = useComposerDictation({
    enabled,
    draftKey,
    onTranscript: (text) => editorRef.current?.insertText(text),
  })

  useEffect(() => {
    const isActive = dictation.phase !== 'idle'
    registerControl?.({
      toggle: dictation.toggle,
      cancel: dictation.cancel,
      isActive,
    })
    registerToggle?.(dictation.toggle)
    return () => {
      registerControl?.(null)
      registerToggle?.(null)
    }
  }, [dictation.cancel, dictation.phase, dictation.toggle, registerControl, registerToggle])

  if (!dictation.status || dictation.status.state === 'unsupported') return null

  if (dictation.phase === 'recording') {
    return (
      <div
        className="composer-dictation-recording tw:box-border tw:h-7 tw:w-40 tw:px-2 tw:inline-flex tw:items-center tw:justify-between tw:rounded-pill tw:border tw:border-app-border-subtle tw:bg-app-bg-surface tw:shrink-0 tw:overflow-hidden"
        role="region"
        aria-label="正在语音听写"
      >
        <div className="tw:flex tw:items-center tw:gap-1.5 tw:min-w-0 tw:shrink-0">
          <canvas
            ref={dictation.bindWaveformCanvas}
            width={48}
            height={14}
            className="composer-dictation-waveform tw:w-12 tw:h-3.5 tw:text-app-accent tw:shrink-0"
            aria-hidden="true"
          />
          <span className="composer-dictation-timer tw:type-caption tw:font-mono tw:text-app-text-soft tw:tabular-nums tw:select-none tw:shrink-0">
            {formatElapsed(dictation.elapsedMs)}
          </span>
        </div>
        <div className="tw:flex tw:items-center tw:gap-0.5 tw:shrink-0">
          <Tooltip content="取消听写 · Esc" side="top">
            <Button
              isIconOnly
              aria-label="取消听写"
              className="tw:size-5 tw:p-0"
              color="ghostSecondary"
              size="compact"
              onClick={dictation.cancel}
              title="取消听写 · Esc"
            >
              <X size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
            </Button>
          </Tooltip>
          <Tooltip content="停止听写 · Ctrl+Shift+D" side="top">
            <Button
              isIconOnly
              aria-label="停止听写"
              className="tw:size-5 tw:p-0"
              color="danger"
              size="compact"
              onClick={dictation.stop}
              title="停止听写 · Ctrl+Shift+D"
            >
              <Square size={APP_ICON_SIZES.sm} fill="currentColor" />
            </Button>
          </Tooltip>
        </div>
      </div>
    )
  }

  if (dictation.phase === 'processing') {
    return (
      <div
        className="composer-dictation-processing tw:box-border tw:h-7 tw:w-40 tw:px-2 tw:inline-flex tw:items-center tw:justify-between tw:rounded-pill tw:border tw:border-app-border-subtle tw:bg-app-bg-surface tw:shrink-0 tw:overflow-hidden"
        role="status"
        aria-live="polite"
      >
        <div className="tw:flex tw:items-center tw:gap-1.5 tw:min-w-0 tw:overflow-hidden">
          <Loader2
            aria-hidden="true"
            className="tw:size-3.5 tw:animate-spin tw:motion-reduce:animate-none tw:text-app-text-soft tw:shrink-0"
            size={APP_ICON_SIZES.sm}
          />
          <span className="composer-dictation-processing-text tw:type-caption tw:text-app-text-soft tw:select-none tw:whitespace-nowrap tw:truncate">
            正在本地转写…
          </span>
        </div>
        <Tooltip content="取消听写 · Esc" side="top">
          <Button
            isIconOnly
            aria-label="取消听写"
            className="tw:size-5 tw:p-0"
            color="ghostSecondary"
            size="compact"
            onClick={dictation.cancel}
            title="取消听写 · Esc"
          >
            <X size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </Button>
        </Tooltip>
      </div>
    )
  }

  if (dictation.phase === 'error') {
    return (
      <div
        className="composer-dictation-error tw:box-border tw:h-7 tw:max-w-64 tw:inline-flex tw:items-center tw:gap-1.5 tw:bg-app-bg-surface tw:px-2 tw:rounded-pill tw:border tw:border-app-border-subtle tw:shrink-0 tw:overflow-hidden"
        role="alert"
      >
        <span
          className="composer-dictation-error-text tw:type-caption tw:text-app-danger tw:truncate tw:max-w-36 tw:select-none"
          title={dictation.error ?? '听写失败'}
        >
          {dictation.error ?? '听写失败'}
        </span>
        <Tooltip content="重新录音 · Ctrl+Shift+D" side="top">
          <Button
            aria-label="重新录音"
            className="tw:h-5 tw:px-1.5"
            color="ghostSecondary"
            size="compact"
            onClick={dictation.start}
            title="重新录音 · Ctrl+Shift+D"
          >
            <Mic size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
            <span>重新录音</span>
          </Button>
        </Tooltip>
        <Tooltip content="关闭 · Esc" side="top">
          <Button
            isIconOnly
            aria-label="关闭"
            className="tw:size-5 tw:p-0"
            color="ghostSecondary"
            size="compact"
            onClick={dictation.cancel}
            title="关闭 · Esc"
          >
            <X size={APP_ICON_SIZES.sm} strokeWidth={APP_ICON_STROKE_WIDTH} />
          </Button>
        </Tooltip>
      </div>
    )
  }

  if (dictation.phase === 'starting') {
    return (
      <Tooltip content="取消听写 · Esc" side="top">
        <Button
          isIconOnly
          aria-label="取消听写"
          className="composer-mic-button is-starting"
          color="ghostSecondary"
          size="composer"
          onClick={dictation.cancel}
          title="取消听写 · Esc"
        >
          <Loader2
            className="tw:animate-spin tw:motion-reduce:animate-none"
            size={APP_ICON_SIZE}
          />
        </Button>
      </Tooltip>
    )
  }

  const tooltipContent =
    dictation.status?.state === 'ready'
      ? '听写 · Ctrl+Shift+D'
      : (dictation.status?.error?.message ?? '语音模型尚未准备好。')

  return (
    <Tooltip content={tooltipContent} side="top">
      <Button
        isIconOnly
        aria-label="听写"
        className="composer-mic-button"
        color="ghostSecondary"
        disabled={!dictation.available}
        onClick={dictation.toggle}
        size="composer"
        title={tooltipContent}
      >
        <Mic size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
      </Button>
    </Tooltip>
  )
}

function formatElapsed(elapsedMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(elapsedMs / 1000))
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
