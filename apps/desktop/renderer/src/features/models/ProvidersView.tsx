import type React from 'react'
import { useState } from 'react'
import { GlobalErrorModal } from '../../components/GlobalErrorModal.js'
import { ProvidersPage } from './ModelCenterView.js'

/**
 * 一级供应商工作台：承接工作台的错误与通知弹窗，
 * 详情、连接与编辑弹窗仍复用现有 ModelCenterWorkbench。
 */
export function ProvidersView(): React.ReactNode {
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [noticeMessage, setNoticeMessage] = useState<string | null>(null)
  return (
    <div className="providers-page tw:flex tw:h-full tw:min-h-0 tw:w-full tw:flex-col tw:overflow-hidden tw:bg-app-canvas tw:text-app-text">
      <GlobalErrorModal message={errorMessage} onDismiss={() => setErrorMessage(null)} />
      <GlobalErrorModal
        message={noticeMessage}
        onDismiss={() => setNoticeMessage(null)}
        tone="status"
      />
      <ProvidersPage onError={setErrorMessage} onNotice={setNoticeMessage} />
    </div>
  )
}
