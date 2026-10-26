import { expect, test } from 'bun:test'
import { createHash } from 'node:crypto'
import { composerAttachmentsFromPathGrants } from '../src/services/desktop-client/ComposerPathAttachmentSupport.js'
import { buildAgentAttachmentUploads } from '../src/services/desktop-client/AttachmentUploadSupport.js'

test('native PNG grant snapshot preserves source bytes through upload preparation', async () => {
  const source = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aN1sAAAAASUVORK5CYII=',
    'base64',
  )
  const attachments = await composerAttachmentsFromPathGrants(
    [
      {
        grantId: 'png-grant',
        name: 'image.png',
        path: 'C:\\fixture\\image.png',
        pathKind: 'file',
        mediaType: 'image/png',
        sizeBytes: source.length,
      },
    ],
    {
      readComposerPathGrant: async () => ({
        name: 'image.png',
        relativePath: '',
        mediaType: 'image/png',
        sizeBytes: source.length,
        kind: 'image',
        encoding: 'base64',
        data: source.toString('base64'),
      }),
    },
  )
  const uploads = await buildAgentAttachmentUploads({ text: '', attachments }, async () => {
    throw new Error('Unexpected retained attachment')
  })
  expect(uploads).toHaveLength(1)
  expect(uploads[0]!.encoding).toBe('base64')
  const uploaded = Buffer.from(uploads[0]!.data, 'base64')
  expect(uploaded.length).toBe(source.length)
  expect(createHash('sha256').update(uploaded).digest('hex')).toBe(
    createHash('sha256').update(source).digest('hex'),
  )
})
