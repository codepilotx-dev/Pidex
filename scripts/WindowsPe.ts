import { open } from 'node:fs/promises'

const PE_SIGNATURE = 0x00004550
const X64_MACHINE = 0x8664

export async function assertWindowsX64PE(path: string): Promise<void> {
  const file = await open(path, 'r')
  try {
    const dosHeader = Buffer.alloc(64)
    const dosRead = await file.read(dosHeader, 0, dosHeader.length, 0)
    if (dosRead.bytesRead !== dosHeader.length || dosHeader.readUInt16LE(0) !== 0x5a4d) {
      throw new Error(`${path} 不是有效的 Windows PE 文件`)
    }

    const peOffset = dosHeader.readUInt32LE(0x3c)
    const peHeader = Buffer.alloc(6)
    const peRead = await file.read(peHeader, 0, peHeader.length, peOffset)
    if (peRead.bytesRead !== peHeader.length || peHeader.readUInt32LE(0) !== PE_SIGNATURE) {
      throw new Error(`${path} 缺少有效的 PE header`)
    }
    const machine = peHeader.readUInt16LE(4)
    if (machine !== X64_MACHINE) {
      throw new Error(`${path} 架构错误：machine=0x${machine.toString(16)}，期望 x64`)
    }
  } finally {
    await file.close()
  }
}
