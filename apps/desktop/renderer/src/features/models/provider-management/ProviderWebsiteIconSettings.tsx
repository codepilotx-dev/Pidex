import { useState } from 'react'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { toUserErrorMessage } from '../../../utils/Errors.js'
import { ProviderIcon } from '../ProviderIcon.js'

export function ProviderWebsiteIconSettings({ providerID, logoURL, address, onNotice, onError }: {
  providerID: string
  logoURL?: string
  address: string
  onNotice: (message: string) => void
  onError: (message: string) => void
}) {
  const [website, setWebsite] = useState(() => {
    try { return new URL(address).origin } catch { return '' }
  })
  const [busy, setBusy] = useState(false)
  const bridge = window.DesktopBridge
  if (!bridge?.setProviderWebsiteIcon) return null

  async function update(restore: boolean) {
    setBusy(true)
    try {
      await bridge!.setProviderWebsiteIcon({ providerID, ...(restore ? {} : { website: website.trim() }) })
      onNotice(restore ? '已恢复默认图标' : '网站图标已保存')
    } catch (error) { onError(toUserErrorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <div className="tw:grid tw:gap-2">
      <div className="tw:flex tw:items-center tw:gap-2">
        <ProviderIcon providerID={providerID} logoURL={logoURL} className="tw:size-6 tw:shrink-0" imageClassName="tw:object-contain" />
        <Input aria-label="图标来源网站" placeholder="https://example.com" value={website} disabled={busy} onChange={(event) => setWebsite(event.target.value)} />
      </div>
      <div className="tw:flex tw:flex-wrap tw:gap-2">
        <Button size="sm" shape="default" color="secondary" loading={busy} disabled={busy || !website.trim()} onClick={() => void update(false)}>从网站获取</Button>
        <Button size="sm" shape="default" variant="outline" disabled={busy} onClick={() => void update(true)}>恢复默认图标</Button>
      </div>
      <p className="tw:m-0 tw:text-app-text-soft tw:type-body-sm">图标单独保存并立即生效，仅访问公网 HTTPS 网站。</p>
    </div>
  )
}
