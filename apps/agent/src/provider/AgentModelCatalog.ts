import type { PiModelService } from './pi/PiModelService'

/** The model surface consumed by the Agent and transport layers. */
export type AgentModelCatalog = Pick<
  PiModelService,
  'list' | 'models' | 'resolve' | 'getModel' | 'refresh' | 'reload' | 'catalogRevision' | 'dispose'
>
