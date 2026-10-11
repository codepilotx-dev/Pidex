import { useCallback, useEffect, useRef, useState } from 'react'
import { desktopClipboard } from '../../../services/desktop-client/index.js'

export function usePlanDocumentActions(content: string) {
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(timer.current), [])
  const copy = useCallback(() => {
    void desktopClipboard
      .writeText(content)
      .then(() => {
        setError(null)
        setCopied(true)
        clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1400)
      })
      .catch(() => setError('复制计划失败，请重试。'))
  }, [content])
  const exportMarkdown = useCallback(() => {
    const url = URL.createObjectURL(new Blob([content], { type: 'text/markdown;charset=utf-8' }))
    const link = document.createElement('a')
    link.href = url
    link.download = 'PLAN.md'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  }, [content])
  return { copied, error, copy, exportMarkdown }
}
