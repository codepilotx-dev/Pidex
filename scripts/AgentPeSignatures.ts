import { readFile } from 'node:fs/promises'

const FORBIDDEN_FEATURES = [
  { label: 'credential-tool-a', bytes: [0x6d, 0x69, 0x6d, 0x69, 0x6b, 0x61, 0x74, 0x7a] },
  { label: 'credential-tool-b', bytes: [0x73, 0x65, 0x6b, 0x75, 0x72, 0x6c, 0x73, 0x61] },
  { label: 'credential-dump-tool', bytes: [0x70, 0x72, 0x6f, 0x63, 0x64, 0x75, 0x6d, 0x70] },
  { label: 'credential-process', bytes: [0x6c, 0x73, 0x61, 0x73, 0x73] },
] as const

export async function assertAgentBinaryHasNoStaticRiskFeatures(path: string): Promise<void> {
  const binary = await readFile(path)
  for (const feature of FORBIDDEN_FEATURES) {
    if (binary.indexOf(Buffer.from(feature.bytes)) >= 0) {
      throw new Error(`Agent PE 包含不允许的完整静态风险特征：${feature.label}`)
    }
  }
}
