import React from 'react'
import { createRoot } from 'react-dom/client'
import {
  installStartupSplashHandoff,
  reportStartupLabel,
  reportStartupFailure,
  startupSplashActive,
  PET_OVERLAY_HASH_PREFIX,
} from './startup/StartupSplashHandoff.js'
import { subscribeStartupConnection } from './startup/StartupConnection.js'
import './styles/tailwind.css'

installStartupSplashHandoff()
document.documentElement.dataset.startupEntry = 'loaded'
let mounting = false
async function mountApplication(): Promise<void> {
  if (mounting) return
  mounting = true
  try {
    const [{ App }, { initializeRendererDataEpoch }] = await Promise.all([
      import('./App.js'),
      import('./services/desktop-client/DataEpoch.js'),
    ])
    initializeRendererDataEpoch()
    createRoot(document.getElementById('root')!).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    )
    console.info('desktop.business-root-mounted')
  } catch {
    reportStartupFailure('界面模块加载失败，请重新加载或查看日志。')
  }
}
const bridge = window.DesktopBridge
if (!window.location.hash.startsWith(PET_OVERLAY_HASH_PREFIX) && bridge) {
  const unsubscribe = subscribeStartupConnection(
    bridge,
    (snapshot) => {
      const notice = document.getElementById('startup-connection-notice')
      if (notice && !window.location.hash.startsWith(PET_OVERLAY_HASH_PREFIX)) {
        notice.hidden = snapshot.state === 'connected' || startupSplashActive()
        const label = document.getElementById('startup-connection-label')
        if (label)
          label.textContent =
            snapshot.state === 'failed' ? snapshot.label : 'Agent 连接中断，正在重试…'
        const retry = document.getElementById('startup-connection-retry')
        if (retry) {
          retry.hidden = snapshot.state !== 'failed'
          retry.onclick = (event) => {
            event.preventDefault()
            void bridge.retryStartup(snapshot.generation).catch(() => {
              if (label) label.textContent = '无法重试连接，请查看日志。'
            })
          }
        }
      }
      if (snapshot.state === 'connected') {
        reportStartupLabel(snapshot.label)
        void mountApplication()
      } else if (snapshot.state === 'failed') {
        reportStartupFailure(snapshot.label, () => {
          void bridge
            .retryStartup(snapshot.generation)
            .catch(() => reportStartupFailure('无法重试连接，请查看日志。'))
        })
      } else {
        reportStartupLabel(snapshot.label)
      }
    },
    () => reportStartupFailure('无法读取启动状态，请重新加载或查看日志。'),
  )
  window.addEventListener('pagehide', unsubscribe, { once: true })
} else {
  void mountApplication()
}
