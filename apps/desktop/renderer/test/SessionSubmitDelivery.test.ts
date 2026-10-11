import { describe, expect, test } from 'bun:test'
import { resolveSessionMessageDelivery } from '../src/features/session/state/SessionActions.js'
import { buildAgentAttachmentUploads } from '../src/services/desktop-client/AttachmentUploadSupport.js'

describe('session message delivery', () => {
  test('steers active turns and starts idle threads by default', () => {
    expect(resolveSessionMessageDelivery('running', 'default')).toBe('steer')
    expect(resolveSessionMessageDelivery('waiting', undefined)).toBe('steer')
    expect(resolveSessionMessageDelivery('idle', 'default')).toBe('start')
  })

  test('keeps Ctrl+Enter follow-ups explicit in every session state', () => {
    expect(resolveSessionMessageDelivery('running', 'follow-up')).toBe('follow-up')
    expect(resolveSessionMessageDelivery('idle', 'follow-up')).toBe('follow-up')
  })
})

describe('edited message attachment delivery', () => {
  test('reimports retained attachments together with deduplicated draft attachments', async () => {
    const readIds: string[] = []
    const uploads = await buildAgentAttachmentUploads(
      {
        text: '重新发送',
        retainedAttachmentIds: ['history-image', 'history-image', 'history-text'],
        attachments: [
          {
            id: 'draft-text',
            name: 'draft.txt',
            path: 'draft.txt',
            mediaType: 'text/plain',
            sizeBytes: 5,
            kind: 'text',
            status: 'ready',
            textContent: 'draft',
          },
          {
            id: 'draft-text',
            name: 'draft.txt',
            path: 'draft.txt',
            mediaType: 'text/plain',
            sizeBytes: 5,
            kind: 'text',
            status: 'ready',
            textContent: 'draft',
          },
        ],
      },
      async (attachmentId) => {
        readIds.push(attachmentId)
        const image = attachmentId === 'history-image'
        return {
          attachment: {
            id: attachmentId,
            kind: image ? 'image' : 'text',
            name: image ? 'history.png' : 'history.txt',
            mediaType: image ? 'image/png' : 'text/plain',
            sizeBytes: image ? 3 : 4,
            sha256: `${attachmentId}-sha`,
            createdAt: 1,
          },
          data: image ? 'aW1n' : 'text',
          encoding: image ? 'base64' : 'utf8',
          range: { offset: 0, length: image ? 3 : 4, total: image ? 3 : 4 },
        }
      },
    )

    expect(readIds).toEqual(['history-image', 'history-text'])
    expect(uploads).toEqual([
      {
        kind: 'image',
        name: 'history.png',
        mediaType: 'image/png',
        data: 'aW1n',
        encoding: 'base64',
      },
      {
        kind: 'text',
        name: 'history.txt',
        mediaType: 'text/plain',
        data: 'text',
        encoding: 'utf8',
      },
      {
        kind: 'text',
        name: 'draft.txt',
        mediaType: 'text/plain',
        data: 'draft',
        encoding: 'utf8',
      },
    ])
  })

  test('rejects combined retained and draft attachments above the existing limit', async () => {
    await expect(
      buildAgentAttachmentUploads(
        {
          text: '重新发送',
          retainedAttachmentIds: Array.from({ length: 8 }, (_, index) => `history-${index}`),
          attachments: [
            {
              id: 'draft-text',
              name: 'draft.txt',
              path: 'draft.txt',
              mediaType: 'text/plain',
              sizeBytes: 5,
              kind: 'text',
              status: 'ready',
              textContent: 'draft',
            },
          ],
        },
        async () => {
          throw new Error('不应读取附件')
        },
      ),
    ).rejects.toThrow('每次最多发送 8 个附件。')
  })
})
