import { stat } from 'node:fs/promises'

export const fileState = async (path: string) => {
  const metadata = await stat(path, { bigint: true }).catch(() => null)
  if (!metadata) return 'missing'
  return `${metadata.size}:${metadata.mtimeNs}:${metadata.ctimeNs}`
}
