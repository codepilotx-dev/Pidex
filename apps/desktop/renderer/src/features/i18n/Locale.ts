export type LanguagePreference = 'system' | 'zh-CN' | 'en-US'
export type AppLocale = Exclude<LanguagePreference, 'system'>

export function resolveAppLocale(
  preference: LanguagePreference,
  systemLanguage: string,
): AppLocale {
  if (preference !== 'system') return preference
  return systemLanguage.toLowerCase().startsWith('en') ? 'en-US' : 'zh-CN'
}
