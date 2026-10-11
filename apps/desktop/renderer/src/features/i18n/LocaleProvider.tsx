import { createContext, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { resolveAppLocale, type AppLocale, type LanguagePreference } from './Locale.js'
import { enUS } from './Messages.en.js'

type LocaleContextValue = {
  locale: AppLocale
  t: (source: string) => string
  formatDate: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string
  formatNumber: (value: number, options?: Intl.NumberFormatOptions) => string
}

const LocaleContext = createContext<LocaleContextValue>({
  locale: 'zh-CN',
  t: (source) => source,
  formatDate: (date, options) => new Intl.DateTimeFormat('zh-CN', options).format(date),
  formatNumber: (number, options) => new Intl.NumberFormat('zh-CN', options).format(number),
})

export function LocaleProvider({
  children,
  preference,
}: {
  children?: ReactNode
  preference: LanguagePreference
}): ReactNode {
  const locale = resolveAppLocale(
    preference,
    typeof navigator === 'undefined' ? 'zh-CN' : navigator.language || 'zh-CN',
  )
  const value = useMemo<LocaleContextValue>(
    () => ({
      locale,
      t: (source) => (locale === 'en-US' ? (enUS[source] ?? source) : source),
      formatDate: (date, options) => new Intl.DateTimeFormat(locale, options).format(date),
      formatNumber: (number, options) => new Intl.NumberFormat(locale, options).format(number),
    }),
    [locale],
  )

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>
}

export function useLocale(): LocaleContextValue {
  return useContext(LocaleContext)
}
