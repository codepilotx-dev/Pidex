import { expect, test } from 'bun:test'
import { artifactDigest, downloadCua } from './CuaArtifact'

test('CUA only accepts matching release asset digests; only absent releases fall back', async () => {
  const original = globalThis.fetch
  const bytes = new TextEncoder().encode('fixture executable')
  const url = 'https://github.com/codepilotx-dev/Pidex/releases/download/cua-test/cpx-cua.exe'
  try {
    globalThis.fetch = (async () => new Response(null, { status: 404 })) as typeof fetch
    expect(await downloadCua('cua-test')).toBeUndefined()
    globalThis.fetch = (async () => new Response(null, { status: 403 })) as typeof fetch
    await expect(downloadCua('cua-test')).rejects.toThrow('HTTP 403')
    for (const digest of [artifactDigest(bytes), `sha256:${'0'.repeat(64)}`]) {
      globalThis.fetch = (async (input) =>
        new URL(String(input)).hostname === 'api.github.com'
          ? Response.json({ assets: [{ name: 'cpx-cua.exe', digest, browser_download_url: url }] })
          : new Response(bytes)) as typeof fetch
      if (digest === artifactDigest(bytes)) expect(await downloadCua('cua-test')).toEqual(bytes)
      else await expect(downloadCua('cua-test')).rejects.toThrow('SHA-256 不匹配')
    }
  } finally {
    globalThis.fetch = original
  }
})
