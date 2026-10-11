import type React from 'react'
import { Activity, Mic, Square } from 'lucide-react'
import { useEffect } from 'react'
import { Button } from '../../../components/ui/Button.js'
import { cx } from '../../../utils/Cx.js'
import { APP_ICON_SIZE, APP_ICON_STROKE_WIDTH } from '../../../components/ui/IconTokens.js'
import type { ComposerEditorHandle } from './ComposerEditor.js'
import type { ComposerDraftKey } from './ComposerTypes.js'
import { useComposerDictation } from './UseComposerDictation.js'

/* The dictation dot pulses through the recording state only; the mic glyph keeps
   the shared loading spin below `prefers-reduced-motion`. */
const DICTATION_DOT_CLASS = 'composer-dictation-dot tw:size-1.5 tw:rounded-pill tw:bg-current'
const DICTATION_SPIN_CLASS = 'tw:animate-spin tw:motion-reduce:animate-none'

type Props = {
  draftKey: ComposerDraftKey
  editorRef: React.RefObject<ComposerEditorHandle | null>
  enabled: boolean
  registerToggle: (toggle: (() => void) | null) => void
}

export function ComposerDictationControl({
  draftKey,
  editorRef,
  enabled,
  registerToggle,
}: Props): React.ReactNode {
  const dictation = useComposerDictation({
    enabled,
    draftKey,
    onTranscript: (text) => editorRef.current?.insertText(text),
  })
  useEffect(() => {
    registerToggle(dictation.toggle)
    return () => registerToggle(null)
  }, [dictation.toggle, registerToggle])

  if (!dictation.status || dictation.status.state === 'unsupported') return null

  return (
    <>
      {dictation.phase !== 'idle' || dictation.error ? (
        <span
          className={cx(
            'composer-dictation-status tw:mx-1 tw:mt-0 tw:mb-2 tw:flex tw:items-center tw:gap-2 tw:type-caption',
            dictation.phase === 'error' ? 'tw:text-app-warning' : 'tw:text-app-text-soft',
            `is-${dictation.phase}`,
          )}
          role={dictation.phase === 'error' ? 'alert' : 'status'}
        >
          <span aria-hidden="true" className={DICTATION_DOT_CLASS} />
          <span>{dictationStatusText(dictation.phase, dictation.elapsedMs, dictation.error)}</span>
        </span>
      ) : null}
      <Button
        isIconOnly
        aria-label={dictation.phase === 'recording' ? '停止语音输入' : '语音输入'}
        aria-pressed={dictation.phase === 'recording'}
        className={`composer-mic-button${dictation.phase === 'recording' ? ' is-recording' : ''}`}
        color={dictation.phase === 'recording' ? 'danger' : 'ghostSecondary'}
        disabled={!dictation.available}
        onClick={dictation.toggle}
        size="composer"
        title={
          dictation.phase === 'recording'
            ? '停止语音输入 Ctrl+Shift+D'
            : dictation.status?.state === 'ready'
              ? '语音输入 Ctrl+Shift+D'
              : (dictation.status?.error?.message ?? '语音模型正在准备中')
        }
      >
        {dictation.phase === 'recording' ? (
          <Square className={DICTATION_SPIN_CLASS} size={APP_ICON_SIZE} fill="currentColor" />
        ) : dictation.phase === 'processing' ? (
          <Activity aria-hidden="true" className={DICTATION_SPIN_CLASS} size={APP_ICON_SIZE} />
        ) : (
          <Mic size={APP_ICON_SIZE} strokeWidth={APP_ICON_STROKE_WIDTH} />
        )}
      </Button>
    </>
  )
}

function dictationStatusText(
  phase: 'idle' | 'starting' | 'recording' | 'processing' | 'error',
  elapsedMs: number,
  message: string | null,
): string {
  if (message) return message
  if (phase === 'starting') return '正在连接麦克风…'
  if (phase === 'recording') {
    const seconds = Math.floor(elapsedMs / 1_000)
    return `听写 ${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`
  }
  if (phase === 'processing') return '正在本地转写…'
  return '语音输入失败。'
}
