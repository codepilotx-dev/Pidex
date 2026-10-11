import { useEffect, useState } from 'react'
import { desktopClient } from '../../../services/desktop-client/index.js'

export type ToolArtifactImageState =
  { status: 'loading' } | { status: 'ready'; source: string } | { status: 'error'; message: string }

export function useToolArtifactImageSource(
  threadId: string | undefined,
  artifactId: string,
  mimeType: string,
): ToolArtifactImageState {
  const [state, setState] = useState<ToolArtifactImageState>({
    status: 'loading',
  })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })
    if (!threadId) {
      setState({ status: 'error', message: '无法解析 Artifact 所属 Thread。' })
      return
    }

    void desktopClient.readArtifact(threadId, artifactId).then(
      (result) => {
        if (cancelled) return
        if (result.encoding !== 'base64' || !result.data) {
          setState({ status: 'error', message: 'Artifact 内容格式不受支持。' })
          return
        }
        setState({
          status: 'ready',
          source: `data:${mimeType || result.artifact.mimeType};base64,${result.data}`,
        })
      },
      () => {
        if (cancelled) return
        setState({ status: 'error', message: 'Artifact 加载失败。' })
      },
    )

    return () => {
      cancelled = true
    }
  }, [artifactId, mimeType, threadId])

  return state
}
