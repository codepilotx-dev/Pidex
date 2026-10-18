import type { DesktopGithubRepository } from '../../../shared/Types.js'

/**
 * GitHub 仓库页的纯函数：排序、搜索和推送时间展示。
 * 组件只负责状态与副作用，这些规则必须可以被单测直接覆盖。
 */

/** 最近推送时间降序；没有推送时间（从未推送的空仓库）排在最后，同值时按全名稳定排序。 */
export function sortGithubRepositories(
  repositories: readonly DesktopGithubRepository[],
): DesktopGithubRepository[] {
  return [...repositories].sort((left, right) => {
    const leftPushed = githubRepositoryPushedTime(left)
    const rightPushed = githubRepositoryPushedTime(right)
    if (leftPushed !== rightPushed) return rightPushed - leftPushed
    return left.fullName.localeCompare(right.fullName)
  })
}

/** 搜索覆盖全名与描述（大小写不敏感）；空白关键字返回全部仓库。 */
export function filterGithubRepositories(
  repositories: readonly DesktopGithubRepository[],
  keyword: string,
): DesktopGithubRepository[] {
  const needle = keyword.trim().toLocaleLowerCase()
  if (!needle) return [...repositories]
  return repositories.filter((repository) =>
    `${repository.fullName}\n${repository.description ?? ''}`.toLocaleLowerCase().includes(needle),
  )
}

/** 先按最近推送排序，再按关键字过滤，保证搜索只收窄展示列表而不改变顺序。 */
export function visibleGithubRepositories(
  repositories: readonly DesktopGithubRepository[],
  keyword: string,
): DesktopGithubRepository[] {
  return filterGithubRepositories(sortGithubRepositories(repositories), keyword)
}

function githubRepositoryPushedTime(repository: DesktopGithubRepository): number {
  if (!repository.pushedAt) return 0
  const time = Date.parse(repository.pushedAt)
  return Number.isNaN(time) ? 0 : time
}

/** 最后推送时间；格式化交给调用方传入的 locale 格式化器，避免组件内重复实现。 */
export function formatGithubPushedAt(
  pushedAt: string | null,
  format: (value: Date | number, options?: Intl.DateTimeFormatOptions) => string,
): string | null {
  if (!pushedAt) return null
  const time = Date.parse(pushedAt)
  if (Number.isNaN(time)) return null
  return format(time, { dateStyle: 'medium' })
}
