import { afterEach, describe, expect, test } from 'bun:test'
import type { DesktopClipboardIpcBridge } from '@pidex/shared/desktop-clipboard-ipc'
import type {
  ClipboardDocument,
  ClipboardTextarea,
  DesktopClipboardWindow,
} from '../src/services/desktop-client/ClipboardClient.js'

const { createDesktopClipboardClient } =
  await import('../src/services/desktop-client/ClipboardClient.js')

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'ClipboardItem')
})

function createFakeDocument(options: { execResult?: boolean } = {}) {
  const execResult = options.execResult ?? true
  const textareas: Array<
    ClipboardTextarea & {
      setAttributeCalls: Array<{ name: string; value: string }>
      selectCalls: number
      removed: boolean
    }
  > = []
  const appended: unknown[] = []
  let execCommandCalls = 0

  const document: ClipboardDocument = {
    createElement: () => {
      const textarea = {
        value: '',
        setAttributeCalls: [] as Array<{ name: string; value: string }>,
        selectCalls: 0,
        removed: false,
        setAttribute: (name: string, value: string) => {
          textarea.setAttributeCalls.push({ name, value })
        },
        style: { position: '', opacity: '' },
        select: () => {
          textarea.selectCalls += 1
        },
        remove: () => {
          textarea.removed = true
        },
      }
      textareas.push(textarea)
      return textarea
    },
    execCommand: () => {
      execCommandCalls += 1
      return execResult
    },
    body: {
      append: (...nodes: unknown[]) => {
        appended.push(...nodes)
      },
    },
  }

  return {
    document,
    textareas,
    appended,
    get execCommandCalls() {
      return execCommandCalls
    },
  }
}

describe('desktop clipboard client', () => {
  test('forwards the three methods to the Electron typed bridge', async () => {
    const textInputs: Array<{ text: string }> = []
    const richInputs: Array<{ text: string; html: string }> = []
    const credentialIds: string[] = []
    const bridgeReceivers: unknown[] = []
    const bridge: DesktopClipboardIpcBridge = {
      writeClipboardText: async function (this: unknown, input) {
        bridgeReceivers.push(this)
        textInputs.push(input)
      },
      writeClipboardRichText: async function (this: unknown, input) {
        bridgeReceivers.push(this)
        richInputs.push(input)
      },
      copyProviderApiKey: async function (this: unknown, credentialId) {
        bridgeReceivers.push(this)
        credentialIds.push(credentialId)
        return { clearAfterMs: 60000 }
      },
    }
    const client = createDesktopClipboardClient({
      DesktopBridge: bridge,
    })

    await client.writeText('plain')
    await client.writeRichText({ text: 'plain', html: '<b>rich</b>' })
    const result = await client.copyProviderApiKey('credential-1')

    expect(textInputs).toEqual([{ text: 'plain' }])
    expect(richInputs).toEqual([{ text: 'plain', html: '<b>rich</b>' }])
    expect(credentialIds).toEqual(['credential-1'])
    expect(result).toEqual({ clearAfterMs: 60000 })
    expect(bridgeReceivers).toEqual([bridge, bridge, bridge])
  })

  test('does not fall back to the browser when Electron IPC rejects', async () => {
    let browserWrites = 0
    const bridge: DesktopClipboardIpcBridge = {
      writeClipboardText: async () => {
        throw new Error('electron text failure')
      },
      writeClipboardRichText: async () => {
        throw new Error('electron rich failure')
      },
      copyProviderApiKey: async () => ({ clearAfterMs: 60000 }),
    }
    const win: DesktopClipboardWindow = {
      DesktopBridge: bridge,
      navigator: {
        clipboard: {
          writeText: async () => {
            browserWrites += 1
          },
          write: async () => {
            browserWrites += 1
          },
        },
      },
    }
    const client = createDesktopClipboardClient(win)

    await expect(client.writeText('x')).rejects.toThrow('electron text failure')
    await expect(client.writeRichText({ text: 'x', html: '<b>x</b>' })).rejects.toThrow(
      'electron rich failure',
    )
    expect(browserWrites).toBe(0)
  })

  test('writes plain text via navigator.clipboard.writeText in a browser', async () => {
    const fake = createFakeDocument()
    const written: string[] = []
    const clipboardReceivers: unknown[] = []
    const clipboard = {
      writeText: async function (this: unknown, text: string) {
        clipboardReceivers.push(this)
        written.push(text)
      },
    }
    const win: DesktopClipboardWindow = {
      navigator: { clipboard },
      document: fake.document,
    }
    const client = createDesktopClipboardClient(win)

    await client.writeText('browser plain')

    expect(written).toEqual(['browser plain'])
    expect(clipboardReceivers).toEqual([clipboard])
    expect(fake.textareas).toHaveLength(0)
  })

  test('writes text/plain and text/html via ClipboardItem when supported', async () => {
    class FakeClipboardItem {
      readonly types: string[]
      constructor(items: Record<string, string | Blob>) {
        this.types = Object.keys(items)
      }
    }
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      writable: true,
      value: FakeClipboardItem,
    })

    const richItems: Array<{ types: ReadonlyArray<string> } | undefined> = []
    const clipboardReceivers: unknown[] = []
    const clipboard = {
      write: async function (
        this: unknown,
        items: ReadonlyArray<{ types: ReadonlyArray<string> }>,
      ) {
        clipboardReceivers.push(this)
        richItems.push(items[0])
      },
    }
    const win: DesktopClipboardWindow = {
      navigator: { clipboard },
    }
    const client = createDesktopClipboardClient(win)

    await client.writeRichText({ text: 'plain', html: '<b>rich</b>' })

    expect(richItems).toHaveLength(1)
    expect(richItems[0]?.types).toEqual(['text/html', 'text/plain'])
    expect(clipboardReceivers).toEqual([clipboard])
  })

  test('degrades rich copy to plain text when ClipboardItem is unsupported', async () => {
    const written: string[] = []
    const win: DesktopClipboardWindow = {
      navigator: {
        clipboard: {
          writeText: async (text) => {
            written.push(text)
          },
        },
      },
    }
    const client = createDesktopClipboardClient(win)

    await client.writeRichText({ text: 'degraded plain', html: '<b>rich</b>' })

    expect(written).toEqual(['degraded plain'])
  })

  test('degrades rich copy to plain text when the rich write rejects', async () => {
    class FakeClipboardItem {
      readonly types: string[]
      constructor(items: Record<string, string | Blob>) {
        this.types = Object.keys(items)
      }
    }
    Object.defineProperty(globalThis, 'ClipboardItem', {
      configurable: true,
      writable: true,
      value: FakeClipboardItem,
    })

    const written: string[] = []
    const win: DesktopClipboardWindow = {
      navigator: {
        clipboard: {
          write: async () => {
            throw new Error('rich rejected')
          },
          writeText: async (text) => {
            written.push(text)
          },
        },
      },
    }
    const client = createDesktopClipboardClient(win)

    await client.writeRichText({ text: 'after failure', html: '<b>x</b>' })

    expect(written).toEqual(['after failure'])
  })

  test('rejects API key copy without a bridge and never echoes the credential id', async () => {
    const client = createDesktopClipboardClient()

    const message = String(
      await client.copyProviderApiKey('secret-credential').catch((error) => error),
    )

    expect(message).toContain('安全复制仅在桌面应用中可用。')
    expect(message).not.toContain('secret-credential')
  })

  test('falls back to a temporary textarea and removes it afterwards', async () => {
    const fake = createFakeDocument()
    const win: DesktopClipboardWindow = {
      document: fake.document,
    }
    const client = createDesktopClipboardClient(win)

    await client.writeText('legacy text')

    expect(fake.textareas).toHaveLength(1)
    const textarea = fake.textareas[0]
    expect(textarea?.value).toBe('legacy text')
    expect(textarea?.style).toEqual({ position: 'fixed', opacity: '0' })
    expect(textarea?.setAttributeCalls).toEqual([{ name: 'readonly', value: '' }])
    expect(textarea?.selectCalls).toBe(1)
    expect(textarea?.removed).toBe(true)
    expect(fake.appended).toEqual([textarea])
    expect(fake.execCommandCalls).toBe(1)
  })

  test('throws the fixed safe error and still removes the textarea when execCommand fails', async () => {
    const fake = createFakeDocument({ execResult: false })
    const win: DesktopClipboardWindow = {
      document: fake.document,
    }
    const client = createDesktopClipboardClient(win)

    await expect(client.writeText('will fail')).rejects.toThrow('复制不可用。')

    expect(fake.execCommandCalls).toBe(1)
    expect(fake.textareas[0]?.removed).toBe(true)
  })

  test('falls back to the textarea path when navigator writeText rejects', async () => {
    const fake = createFakeDocument()
    const win: DesktopClipboardWindow = {
      navigator: {
        clipboard: {
          writeText: async () => {
            throw new Error('navigator denied')
          },
        },
      },
      document: fake.document,
    }
    const client = createDesktopClipboardClient(win)

    await client.writeText('via textarea')

    expect(fake.textareas).toHaveLength(1)
    expect(fake.execCommandCalls).toBe(1)
    expect(fake.textareas[0]?.removed).toBe(true)
  })

  test('throws the fixed safe error when no copy mechanism exists', async () => {
    const client = createDesktopClipboardClient()

    await expect(client.writeText('nothing works')).rejects.toThrow('复制不可用。')
  })
})
