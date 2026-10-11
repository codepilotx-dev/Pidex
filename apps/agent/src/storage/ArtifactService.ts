import { Buffer } from 'node:buffer'
import type { AgentDatabase } from './database/AgentDatabase'
import {
  ArtifactRepository,
  type NewArtifactRecord,
  type StoredArtifact,
} from './repositories/ArtifactRepository'
import { ContentBlobStore } from './ContentBlobStore'
import { AgentError } from '../Domain'

export type ArtifactBlobInput = {
  artifactId: string
  name: string
  mimeType: string
  data: string
}

export type StoredArtifactBlob = {
  artifactId: string
  sha256: string
  sizeBytes: number
}

export type ArtifactReadResult = {
  artifact: StoredArtifact
  data: Uint8Array
}

/**
 * Tool-result artifact boundary. Catalog rows live in SQLite and are inserted
 * inside the owning item/event transaction; content is stored content-addressed
 * through the shared immutable blob store. Artifact IDs are the only thing that
 * travels in items and events, so binary payloads never enter event text.
 */
export class ArtifactService {
  private constructor(
    private readonly blobs: ContentBlobStore,
    private readonly repo: ArtifactRepository,
  ) {}

  static async open(dataDir: string, db: AgentDatabase) {
    return new ArtifactService(
      await ContentBlobStore.open(dataDir),
      new ArtifactRepository(db.sqlite),
    )
  }

  hasArtifactsTable(): boolean {
    return this.repo.hasArtifactsTable()
  }

  insertArtifact(record: NewArtifactRecord): void {
    this.repo.insert(record)
  }

  listByItem(itemId: string): StoredArtifact[] {
    return this.repo.listByItem(itemId)
  }

  /** Writes base64 artifact content to the immutable blob store (no DB writes). */
  async persistBlobs(inputs: readonly ArtifactBlobInput[]): Promise<StoredArtifactBlob[]> {
    const results: StoredArtifactBlob[] = []
    for (const input of inputs) {
      let data: Uint8Array
      try {
        data = new Uint8Array(Buffer.from(input.data, 'base64'))
      } catch {
        continue
      }
      if (data.byteLength === 0) continue
      if (data.byteLength > 50 * 1024 * 1024) {
        throw new AgentError('ARTIFACT_TOO_LARGE', 'Artifact 超过 50MB 上限', 413)
      }
      const stored = await this.blobs.put(data)
      results.push({
        artifactId: input.artifactId,
        sha256: stored.sha256,
        sizeBytes: data.byteLength,
      })
    }
    return results
  }

  async read(artifactId: string, threadId: string): Promise<ArtifactReadResult> {
    const artifact = this.repo.requireForThread(artifactId, threadId)
    const data = await this.blobs.read(artifact.storagePath)
    return { artifact, data }
  }
}
