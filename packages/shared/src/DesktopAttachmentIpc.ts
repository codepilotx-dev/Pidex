export const DESKTOP_ATTACHMENT_IPC_CHANNELS = {
  saveToDownloads: 'desktop-attachment:save-to-downloads',
  chooseComposerFiles: 'desktop-attachment:choose-composer-files',
  grantComposerPaths: 'desktop-attachment:grant-composer-paths',
  readComposerPathGrant: 'desktop-attachment:read-composer-path-grant',
  listComposerPathGrant: 'desktop-attachment:list-composer-path-grant',
} as const

export type DesktopAttachmentSaveInput = {
  kind: 'image' | 'text'
  name: string
  mediaType: string
  encoding: 'base64' | 'utf8'
  data: string
}

export type DesktopAttachmentSaveResult = {
  fileName: string
}

export type DesktopComposerPathKind = 'file' | 'directory'

export type DesktopComposerPathGrant = {
  grantId: string
  name: string
  path: string
  pathKind: DesktopComposerPathKind
  mediaType: string
  sizeBytes: number
}

export type DesktopComposerPathReadInput = {
  grantId: string
  relativePath?: string
  range?: {
    offset?: number
    length?: number
  }
}

export type DesktopComposerPathPreview = {
  name: string
  relativePath: string
  mediaType: string
  sizeBytes: number
  kind: 'image' | 'text' | 'binary'
  encoding?: 'base64' | 'utf8'
  data?: string
  truncated?: boolean
}

export type DesktopComposerPathListInput = {
  grantId: string
  relativePath?: string
  cursor?: string
  limit?: number
}

export type DesktopComposerPathEntry = {
  name: string
  relativePath: string
  pathKind: DesktopComposerPathKind
  mediaType: string
  sizeBytes: number
}

export type DesktopComposerPathListResult = {
  entries: DesktopComposerPathEntry[]
  nextCursor: string | null
}

export interface DesktopAttachmentIpcBridge {
  saveAttachmentToDownloads(input: DesktopAttachmentSaveInput): Promise<DesktopAttachmentSaveResult>
  chooseComposerFiles(): Promise<DesktopComposerPathGrant[]>
  grantComposerPaths(paths: readonly string[]): Promise<DesktopComposerPathGrant[]>
  getPathForFile(file: File): string
  readComposerPathGrant(input: DesktopComposerPathReadInput): Promise<DesktopComposerPathPreview>
  listComposerPathGrant(input: DesktopComposerPathListInput): Promise<DesktopComposerPathListResult>
}
