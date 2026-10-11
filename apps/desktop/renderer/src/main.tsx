import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App.js'
import { initializeRendererDataEpoch } from './services/desktop-client/DataEpoch.js'
import { installStartupSplashHandoff } from './startup/StartupSplashHandoff.js'
import './styles/tailwind.css'

// 启动遮罩 handoff 在 startup/StartupSplashHandoff.ts：静态 splash 在入口 JS
// 与主 CSS 就绪前保持画面稳定，只有真实 ProseMirror 编辑器可输入或显式
// `data-startup-surface-ready` 标记出现才移除；20 秒 fail-safe 兜底异常。
installStartupSplashHandoff()

initializeRendererDataEpoch()

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
