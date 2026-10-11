import { resolve, sep } from 'node:path'

const normalizedPathKey = (value: string) => {
  const normalized = resolve(value).replace(/[\\/]+$/, '')
  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

export const pathContains = (parent: string, candidate: string) => {
  const parentKey = normalizedPathKey(parent)
  const candidateKey = normalizedPathKey(candidate)
  return candidateKey === parentKey || candidateKey.startsWith(`${parentKey}${sep}`)
}
