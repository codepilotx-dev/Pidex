import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { expectSourceContains } from './SourceContract.js'

/**
 * Electron 默认把 userData 建在 appData/<应用名> 下。main.ts 必须显式固定该目录并
 * 保留显式目录的优先级，否则外观设置、窗口与宠物状态、会话索引和浏览器分区会随
 * 应用名或打包名称变化而失联。
 */
describe('desktop data directory stability', () => {
  test('pins the default userData directory to the product name', async () => {
    const source = await readSource('../src/Main.ts')
    expectSourceContains(source, "const USER_DATA_DIRECTORY_NAME = 'Pidex Desktop'")
    expectSourceContains(
      source,
      "join(app.getPath('appData'), USER_DATA_DIRECTORY_NAME)",
    )
    expectSourceContains(
      source,
      "app.setPath('userData', configuredUserDataDirectory ? resolve(configuredUserDataDirectory) : DEFAULT_USER_DATA_DIRECTORY)",
    )
  })

  test('keeps the application id used by installers and Windows toasts', async () => {
    const source = await readSource('../src/Main.ts')
    expectSourceContains(source, "'com.pidex.desktop'")
    expect(source).toContain('process.env.PIDEX_USER_DATA_DIR')
  })
})

async function readSource(relativePath: string): Promise<string> {
  const content = await readFile(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
  return content.replace(/\r\n/g, '\n')
}
