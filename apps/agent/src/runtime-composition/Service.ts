import { AgentError } from '../Domain'
import type { AgentDatabase } from '../storage/database/AgentDatabase'
import { RuntimeCompositionRepository } from '../storage/repositories/RuntimeCompositionRepository'
import {
  RUNTIME_COMPOSITION_UNAVAILABLE_CODE,
  type BoundRuntimeComposition,
  type RuntimeCompositionBindings,
  type RuntimeCompositionPlan,
  type RuntimeCompositionSnapshot,
} from './Types'

export interface RuntimeCompositionServiceOptions {
  db: AgentDatabase
}

export interface ComposedRuntimeComposition {
  readonly snapshot: RuntimeCompositionSnapshot
  readonly bindings: RuntimeCompositionBindings
}

export interface LoadOrComposeRuntimeCompositionInput {
  readonly turnID: string
  readonly agentID: string
  readonly allowEphemeralFresh: boolean
  compose(): Promise<ComposedRuntimeComposition>
  rebind(snapshot: RuntimeCompositionSnapshot): Promise<RuntimeCompositionBindings>
}

const unavailable = (message: string, cause?: unknown) =>
  new AgentError(RUNTIME_COMPOSITION_UNAVAILABLE_CODE, message, 409, cause)

const releaseQuietly = async (bindings: RuntimeCompositionBindings | undefined) => {
  await bindings?.release().catch(() => undefined)
}

const bind = (
  snapshot: RuntimeCompositionSnapshot,
  bindings: RuntimeCompositionBindings,
): BoundRuntimeComposition => {
  let released = false
  return Object.freeze({
    plan: Object.freeze({ snapshot }) satisfies RuntimeCompositionPlan,
    bindings,
    release: async () => {
      if (released) return
      released = true
      await bindings.release()
    },
  })
}

/** Shared durable composition entry point for main, side-chat and subagent turns. */
export class RuntimeCompositionService {
  readonly repository: RuntimeCompositionRepository

  constructor(options: RuntimeCompositionServiceOptions) {
    this.repository = new RuntimeCompositionRepository(options.db)
  }

  hasStorage(): boolean {
    return this.repository.hasTable()
  }

  async loadOrCompose(
    input: LoadOrComposeRuntimeCompositionInput,
  ): Promise<BoundRuntimeComposition> {
    let existing
    try {
      existing = this.repository.get(input.turnID)
    } catch (cause) {
      throw unavailable('Runtime composition snapshot is unavailable', cause)
    }
    if (existing) {
      try {
        return bind(existing.snapshot, await input.rebind(existing.snapshot))
      } catch (cause) {
        throw unavailable('Runtime composition resources are unavailable', cause)
      }
    }

    if (!this.hasStorage()) {
      if (!input.allowEphemeralFresh)
        throw unavailable('Durable runtime composition storage is unavailable')
      let ephemeral: ComposedRuntimeComposition | undefined
      try {
        ephemeral = await input.compose()
        return bind(ephemeral.snapshot, ephemeral.bindings)
      } catch (cause) {
        await releaseQuietly(ephemeral?.bindings)
        throw cause
      }
    }

    let fresh: ComposedRuntimeComposition | undefined
    try {
      fresh = await input.compose()
      const authoritative = this.repository.insertOrGet({
        turnID: input.turnID,
        agentID: input.agentID,
        compositionID: fresh.snapshot.identity.id,
        snapshot: fresh.snapshot,
      })
      if (authoritative.inserted) {
        return bind(authoritative.plan.snapshot, fresh.bindings)
      }
      await releaseQuietly(fresh.bindings)
      fresh = undefined
      return bind(authoritative.plan.snapshot, await input.rebind(authoritative.plan.snapshot))
    } catch (cause) {
      await releaseQuietly(fresh?.bindings)
      if (cause instanceof AgentError) throw cause
      throw unavailable('Runtime composition could not be persisted or rebound', cause)
    }
  }
}

export { RUNTIME_COMPOSITION_UNAVAILABLE_CODE }
export type { BoundRuntimeComposition, RuntimeCompositionBindings, RuntimeCompositionSnapshot }
