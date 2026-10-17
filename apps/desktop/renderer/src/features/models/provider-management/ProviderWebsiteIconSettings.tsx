import { useRef, useState } from 'react'
import { Button } from '../../../components/ui/Button.js'
import { Input } from '../../../components/ui/Input.js'
import { toUserErrorMessage } from '../../../utils/Errors.js'
import { ProviderIcon } from '../ProviderIcon.js'
import { readProviderIconUpload } from './ProviderIconUpload.js'

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
  const fileRef = useRef<HTMLInputElement | null>(null)
  const bridge = window.DesktopBridge
  const canSetWebsiteIcon = typeof bridge?.setProviderWebsiteIcon === 'function'
  const canUploadIcon = typeof bridge?.setProviderUploadedIcon === 'function'
  if (!bridge || !canSetWebsiteIcon) return null

  async function update(restore: boolean) {
    setBusy(true)
    try {
      await bridge.setProviderWebsiteIcon({ providerID, ...(restore ? {} : { website: website.trim() }) })
      onNotice(restore ? '已恢复默认图标' : '网站图标已保存')
    } catch (error) { onError(toUserErrorMessage(error)) }
    finally { setBusy(false) }
  }

  async function upload(file: File) {
    setBusy(true)
    try {
      const dataURL = await readProviderIconUpload(file)
      await bridge.setProviderUploadedIcon({ providerID, dataURL })
      onNotice('图标已更新')
    } catch (error) { onError(toUserErrorMessage(error)) }
    finally { setBusy(false) }
  }

  return (
    <div className="tw:grid tw:gap-3">
      <div className="tw:flex tw:min-w-0 tw:items-center tw:gap-3">
        <span className="provider-icon-settings-preview tw:flex tw:size-10 tw:shrink-0 tw:items-center tw:justify-center tw:overflow-hidden tw:rounded-lg tw:border tw:border-app-border-subtle tw:bg-app-control">
          <ProviderIcon providerID={providerID} logoURL={logoURL} className="tw:size-6" imageClassName="tw:object-contain" />
        </span>
        <Input
          aria-label="图标来源网站"
          className="tw:min-w-0 tw:flex-1"
          disabled={busy}
          placeholder="https://example.com"
          value={website}
          onChange={(event) => setWebsite(event.target.value)}
        />
      </div>
      <div className="tw:flex tw:flex-wrap tw:gap-2">
        {canUploadIcon ? (
          <Button size="sm" shape="default" color="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>上传图片</Button>
        ) : null}
        <Button size="sm" shape="default" color="secondary" loading={busy} disabled={busy || !website.trim()} onClick={() => void update(false)}>从网站获取</Button>
        <Button size="sm" shape="default" variant="outline" disabled={busy} onClick={() => void update(true)}>恢复默认图标</Button>
      </div>
      <input
        hidden
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml,image/x-icon,image/vnd.microsoft.icon"
        disabled={busy}
        ref={fileRef}
        type="file"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0]
          event.currentTarget.value = ''
          if (file) void upload(file)
        }}
      />
    </div>
  )
}
