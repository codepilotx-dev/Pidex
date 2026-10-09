import { describe, expect, test } from 'bun:test'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

/**
 * 发布与自动更新目标固定指向现有 GitHub 仓库。品牌清理只改产品展示名与安装身份，
 * 不得改动 owner／repo：一旦改动，打包产物的 app-update.yml 会指向不存在的仓库，
 * 自动更新静默失效。这里用配置契约把三处独立来源钉在同一个仓库上。
 */
const EXPECTED_OWNER = 'codepilotx-dev'
const EXPECTED_REPO = 'Pidex'

describe('desktop publish target', () => {
  test('package.json publish block keeps the real repository', async () => {
    const manifest = JSON.parse(await read('../package.json')) as {
      build?: { publish?: { provider?: string; owner?: string; repo?: string } }
    }
    expect(manifest.build?.publish).toEqual({
      provider: 'github',
      owner: EXPECTED_OWNER,
      repo: EXPECTED_REPO,
    })
  })

  test('agent release notes and packaging verifier agree on the same repository', async () => {
    const releaseNotes = await read(
      '../../../agent/src/release-notes/ReleaseNotesService.ts',
    )
    expect(releaseNotes).toContain(`${EXPECTED_OWNER}/${EXPECTED_REPO}`)

    const verifier = await read('../../../../scripts/VerifyWinX64Package.ts')
    expect(verifier).toContain(`['repo', '${EXPECTED_REPO}']`)
  })
})

async function read(relativePath: string): Promise<string> {
  const content = await readFile(fileURLToPath(new URL(relativePath, import.meta.url)), 'utf8')
  return content.replace(/\r\n/g, '\n')
}
