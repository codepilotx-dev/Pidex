import { describe, expect, test } from 'bun:test'
import { composerAttachmentsFromPathGrants } from '../src/services/desktop-client/ComposerPathAttachmentSupport.js'
import { buildAgentAttachmentUploads } from '../src/services/desktop-client/AttachmentUploadSupport.js'

describe('composer local path attachments', () => {
  test('snapshots a path-backed image exactly once and keeps other paths live', async () => {
    const attachments = await composerAttachmentsFromPathGrants(
      [
        {
          grantId: 'image-grant',
          name: 'screen.png',
          path: 'C:\\outside\\screen.png',
          pathKind: 'file',
          mediaType: 'image/png',
          sizeBytes: 3,
        },
        {
          grantId: 'directory-grant',
          name: 'docs',
          path: 'C:\\outside\\docs',
          pathKind: 'directory',
          mediaType: 'inode/directory',
          sizeBytes: 0,
        },
      ],
      {
        readComposerPathGrant: async () => ({
          name: 'screen.png',
          relativePath: '',
          mediaType: 'image/png',
          sizeBytes: 3,
          kind: 'image',
          encoding: 'base64',
          data: 'aW1n',
        }),
      },
    )

    expect(attachments).toHaveLength(2)
    expect(attachments[0]).toMatchObject({
      kind: 'image',
      storage: 'managed',
      contentBase64: 'aW1n',
    })
    expect(attachments[0]).not.toHaveProperty('localGrantId')
    expect(attachments[1]).toMatchObject({
      storage: 'local-path',
      pathKind: 'directory',
      localGrantId: 'directory-grant',
    })
  })

  test('never sends a live path through attachment/import', async () => {
    const uploads = await buildAgentAttachmentUploads(
      {
        text: 'read docs',
        attachments: [
          {
            id: 'directory-grant',
            name: 'docs',
            path: 'C:\\outside\\docs',
            pathKind: 'directory',
            localGrantId: 'directory-grant',
            storage: 'local-path',
            mediaType: 'inode/directory',
            sizeBytes: 0,
            kind: 'document',
            status: 'ready',
          },
        ],
      },
      async () => {
        throw new Error('local path must not call attachment/read')
      },
    )
    expect(uploads).toEqual([])
  })
})
