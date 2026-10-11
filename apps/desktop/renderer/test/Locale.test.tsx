import { describe, expect, test } from 'bun:test'
import { resolveAppLocale } from '../src/features/i18n/Locale.js'
import { enUS } from '../src/features/i18n/Messages.en.js'
import { createDesktopSettingsDraft } from '../src/features/settings/UseDesktopSettings.js'
import {
  defaultDesktopStoredSettings,
  normalizeDesktopStoredSettings,
} from '../shared/SettingsSchema.js'
import { renderToStaticMarkup } from 'react-dom/server'
import { LocaleProvider, useLocale } from '../src/features/i18n/LocaleProvider.js'

describe('界面语言', () => {
  test('跟随英语系统，其他系统语言回退简体中文', () => {
    expect(resolveAppLocale('system', 'en-GB')).toBe('en-US')
    expect(resolveAppLocale('system', 'ja-JP')).toBe('zh-CN')
    expect(resolveAppLocale('zh-CN', 'en-US')).toBe('zh-CN')
  })

  test('英语词条都提供非空译文', () => {
    for (const [source, translated] of Object.entries(enUS)) {
      expect(source.trim()).not.toBe('')
      expect(translated.trim()).not.toBe('')
    }
  })

  test('语言偏好经设置草稿保存并往返保留', async () => {
    let persisted = defaultDesktopStoredSettings()
    const draft = createDesktopSettingsDraft(persisted, async (next) => {
      persisted = normalizeDesktopStoredSettings(next)
      return persisted
    })
    draft.setValue('language', 'en-US')
    await draft.save()
    expect(draft.values.language).toBe('en-US')
    expect(normalizeDesktopStoredSettings(persisted).language).toBe('en-US')
  })

  test('切换偏好后当前渲染使用对应词条', () => {
    function Label() {
      return <span>{useLocale().t('设置')}</span>
    }
    expect(
      renderToStaticMarkup(
        <LocaleProvider preference="zh-CN">
          <Label />
        </LocaleProvider>,
      ),
    ).toContain('设置')
    expect(
      renderToStaticMarkup(
        <LocaleProvider preference="en-US">
          <Label />
        </LocaleProvider>,
      ),
    ).toContain('Settings')
  })
})
