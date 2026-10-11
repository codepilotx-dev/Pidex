import { mkdir, writeFile } from 'node:fs/promises'
import { getPlaywrightInjectedScriptSource } from '../src/browser/PlaywrightInjectedScriptSource'
await mkdir('dist/browser', { recursive: true })
await writeFile('dist/browser/playwright-injected.txt', getPlaywrightInjectedScriptSource(), 'utf8')
