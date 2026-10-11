import type { EnvironmentDeltaStore } from '../../local-environment/EnvironmentDeltaStore'
import type { SideChatRepository } from '../../storage/repositories/SideChatRepository'

/** Captures external side-chat resources before their owning source thread cascades away. */
export class SideChatEnvironmentCleanup {
  constructor(
    private readonly repository: SideChatRepository,
    private readonly environments: EnvironmentDeltaStore,
  ) {}

  prepareSource(sourceThreadID: string, next?: () => Promise<void>): () => Promise<void> {
    const bindingIDs = this.repository.bindingIDsForSource(sourceThreadID)
    return async () => {
      await next?.()
      for (const bindingID of bindingIDs) {
        await this.environments.remove(bindingID).catch(() => undefined)
      }
    }
  }
}
