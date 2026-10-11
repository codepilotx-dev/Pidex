import { APP_ICON_SIZE } from '../../../components/ui/IconTokens.js'
import React from 'react'
import { CircleAlert, RotateCcw } from 'lucide-react'

type ConversationTurnErrorBoundaryProps = {
  children: React.ReactNode
  turnId: string
}

type ConversationTurnErrorBoundaryState = {
  failed: boolean
}

export class ConversationTurnErrorBoundary extends React.Component<
  ConversationTurnErrorBoundaryProps,
  ConversationTurnErrorBoundaryState
> {
  state: ConversationTurnErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ConversationTurnErrorBoundaryState {
    return { failed: true }
  }

  componentDidUpdate(previous: ConversationTurnErrorBoundaryProps): void {
    if (previous.turnId !== this.props.turnId && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <article className="canonical-turn-error" role="alert">
        <CircleAlert size={APP_ICON_SIZE} aria-hidden="true" />
        <span>
          <strong>这一轮内容暂时无法显示</strong>
          <small>其他会话内容不受影响。</small>
        </span>
        <button type="button" onClick={() => this.setState({ failed: false })}>
          <RotateCcw size={APP_ICON_SIZE} aria-hidden="true" />
          重试
        </button>
      </article>
    )
  }
}

export class ConversationMarkdownErrorBoundary extends React.Component<
  { children: React.ReactNode; contentKey: string },
  ConversationTurnErrorBoundaryState
> {
  state: ConversationTurnErrorBoundaryState = { failed: false }

  static getDerivedStateFromError(): ConversationTurnErrorBoundaryState {
    return { failed: true }
  }

  componentDidUpdate(previous: Readonly<{ children: React.ReactNode; contentKey: string }>): void {
    if (previous.contentKey !== this.props.contentKey && this.state.failed) {
      this.setState({ failed: false })
    }
  }

  render(): React.ReactNode {
    if (!this.state.failed) return this.props.children
    return (
      <div className="canonical-markdown-error" role="alert">
        <CircleAlert size={APP_ICON_SIZE} aria-hidden="true" />
        <span>这段富文本无法渲染</span>
        <button type="button" onClick={() => this.setState({ failed: false })}>
          重试
        </button>
      </div>
    )
  }
}
