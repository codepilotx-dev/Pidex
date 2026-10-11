export type AttachmentKind = 'image' | 'document' | 'text' | 'audio' | 'video' | 'binary'

export type Attachment = {
  kind: AttachmentKind
  name: string
  path?: string
  mediaType?: string
  sizeBytes?: number
  contentBase64?: string
  textContent?: string
}

export type UserMessage = {
  text: string
  attachments?: Attachment[]
}
