import { expect, test } from 'bun:test'
import type { DesktopGithubRepository } from '../shared/Types.js'
import {
  filterGithubRepositories,
  formatGithubPushedAt,
  sortGithubRepositories,
  visibleGithubRepositories,
} from '../src/features/git-board/GitBoardGithubRepositories.js'

function repository(
  name: string,
  overrides: Partial<DesktopGithubRepository> = {},
): DesktopGithubRepository {
  return {
    id: name.length,
    name,
    fullName: `pidex/${name}`,
    owner: 'pidex',
    private: false,
    fork: false,
    archived: false,
    disabled: false,
    cloneUrl: `https://github.com/pidex/${name}.git`,
    sshUrl: `git@github.com:pidex/${name}.git`,
    htmlUrl: `https://github.com/pidex/${name}`,
    description: null,
    defaultBranch: 'main',
    pushedAt: null,
    updatedAt: null,
    ...overrides,
  }
}

test('仓库默认按最近推送时间倒序，未推送仓库排在最后', () => {
  const older = repository('older', { pushedAt: '2026-01-02T00:00:00Z' })
  const newer = repository('newer', { pushedAt: '2026-03-04T00:00:00Z' })
  const empty = repository('empty')
  expect(sortGithubRepositories([older, empty, newer]).map((item) => item.fullName)).toEqual([
    'pidex/newer',
    'pidex/older',
    'pidex/empty',
  ])
  // 输入数组不能被原地修改。
  const input = [older, newer]
  sortGithubRepositories(input)
  expect(input.map((item) => item.fullName)).toEqual(['pidex/older', 'pidex/newer'])
})

test('相同推送时间按全名稳定排序，非法时间按未推送处理', () => {
  const pushedAt = '2026-02-02T00:00:00Z'
  const beta = repository('beta', { pushedAt })
  const alpha = repository('alpha', { pushedAt })
  const broken = repository('broken', { pushedAt: 'not-a-date' })
  expect(sortGithubRepositories([beta, broken, alpha]).map((item) => item.fullName)).toEqual([
    'pidex/alpha',
    'pidex/beta',
    'pidex/broken',
  ])
})

test('搜索匹配全名和描述，忽略大小写与首尾空白', () => {
  const board = repository('git-board', { description: '看板仓库' })
  const cli = repository('pidex-cli', { description: 'Terminal entry' })
  const empty = repository('empty')
  expect(filterGithubRepositories([board, cli, empty], '  GIT-BOARD ')).toEqual([board])
  expect(filterGithubRepositories([board, cli, empty], 'terminal')).toEqual([cli])
  expect(filterGithubRepositories([board, cli, empty], '看板')).toEqual([board])
  // 无描述仓库不会因为描述为空而被排除。
  expect(filterGithubRepositories([board, cli, empty], 'pidex/')).toHaveLength(3)
  expect(filterGithubRepositories([board, cli, empty], '')).toHaveLength(3)
  expect(filterGithubRepositories([board, cli, empty], '   ')).toHaveLength(3)
})

test('可见列表先排序再过滤，搜索不改变默认顺序', () => {
  const older = repository('older', {
    pushedAt: '2026-01-02T00:00:00Z',
    description: 'board tools',
  })
  const newer = repository('newer', {
    pushedAt: '2026-03-04T00:00:00Z',
    description: 'board tools',
  })
  const unrelated = repository('other', { pushedAt: '2026-04-05T00:00:00Z' })
  expect(
    visibleGithubRepositories([older, unrelated, newer], '').map((item) => item.fullName),
  ).toEqual(['pidex/other', 'pidex/newer', 'pidex/older'])
  // 只命中描述的两项保持“较新在前”的排序结果，顺序来自排序而不是输入顺序。
  expect(
    visibleGithubRepositories([older, unrelated, newer], 'board tools').map((item) => item.name),
  ).toEqual(['newer', 'older'])
  expect(visibleGithubRepositories([older, newer], 'no-such-repository')).toEqual([])
})

test('最后推送时间在缺失或非法时返回 null', () => {
  const format = (value: Date | number): string => new Date(value).toISOString().slice(0, 10)
  expect(formatGithubPushedAt('2026-03-04T00:00:00Z', format)).toBe('2026-03-04')
  expect(formatGithubPushedAt(null, format)).toBeNull()
  expect(formatGithubPushedAt('not-a-date', format)).toBeNull()
})
