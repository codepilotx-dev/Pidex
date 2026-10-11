export function normalizeOrigin(value: string): string {
  return new URL(value).origin
}

export function isApplicationOriginUrl(
  value: string,
  allowedApplicationOrigin: string | undefined,
): boolean {
  try {
    return (
      allowedApplicationOrigin !== undefined && new URL(value).origin === allowedApplicationOrigin
    )
  } catch {
    return false
  }
}

export function isAllowedApplicationUrl(
  value: string,
  allowedApplicationOrigin: string | undefined,
): boolean {
  if (value.startsWith('data:text/html')) return true
  return isApplicationOriginUrl(value, allowedApplicationOrigin)
}

export function isSafeExternalUrl(value: string): boolean {
  try {
    const protocol = new URL(value).protocol
    return protocol === 'https:' || protocol === 'http:'
  } catch {
    return false
  }
}
