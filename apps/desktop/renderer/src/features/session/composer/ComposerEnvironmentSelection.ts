import type { EnvironmentDomainClient } from '../../../services/desktop-client/EnvironmentDomainClient.js'
import { notifyProjectCatalogChanged } from '../../projects/ProjectCatalogEvents.js'

export type ComposerEnvironmentCatalog = Awaited<
  ReturnType<EnvironmentDomainClient['listProjectEnvironments']>
>

export type ComposerEnvironmentSelectionClient = Pick<
  EnvironmentDomainClient,
  'listProjectEnvironments' | 'selectProjectEnvironment'
>

/**
 * 环境选择沿用项目级选择接口：先持久化，再回读目录，最后通知其他界面刷新，
 * 保证首页设置与项目环境设置页看到同一份状态。
 */
export async function selectComposerProjectEnvironment(input: {
  client: ComposerEnvironmentSelectionClient
  projectId: string
  environmentId: string
  notify?: () => void
}): Promise<ComposerEnvironmentCatalog> {
  await input.client.selectProjectEnvironment(input.projectId, input.environmentId)
  const catalog = await input.client.listProjectEnvironments(input.projectId)
  ;(input.notify ?? notifyProjectCatalogChanged)()
  return catalog
}

/** 默认项优先使用项目已选环境，否则回退到列表首项。 */
export function selectedComposerEnvironmentId(
  catalog: ComposerEnvironmentCatalog | null,
): string | null {
  if (!catalog) return null
  return (
    catalog.environments.find((environment) => environment.id === catalog.selectedEnvironmentId)
      ?.id ??
    catalog.environments[0]?.id ??
    null
  )
}
