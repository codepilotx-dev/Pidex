import { describe, expect, test } from 'bun:test'
import { createIsolatedProcessEnvironment, mergeProcessEnvironment } from './ProcessEnvironment'

describe('发布进程环境', () => {
  test('Windows 风格的大小写异名覆盖不会保留 runner 注入值', () => {
    expect(
      mergeProcessEnvironment(
        {
          pidex_agent_url: 'http://runner.invalid',
          Path: 'runner-path',
          KEEP: 'yes',
        },
        {
          PIDEX_AGENT_URL: undefined,
          PATH: 'release-path',
        },
      ),
    ).toEqual({
      PIDEX_AGENT_URL: undefined,
      PATH: 'release-path',
      KEEP: 'yes',
    })
  })

  test('发布 smoke 仅保留显式注入的内部环境', () => {
    expect(
      createIsolatedProcessEnvironment(
        {
          pidex_agent_url: 'http://runner.invalid',
          Pidex_Static_Dir: 'runner-static',
          GITHUB_EVENT_PATH: 'event.json',
          Runner_Temp: 'runner-temp',
          ACTIONS_CACHE_URL: 'https://cache.invalid',
          CSC_KEY_PASSWORD: 'signing-password',
          KEEP: 'yes',
        },
        {
          PIDEX_AUTH_TOKEN: 'smoke-token',
          PIDEX_DATA_DIR: 'smoke-data',
        },
      ),
    ).toEqual({
      KEEP: 'yes',
      PIDEX_AUTH_TOKEN: 'smoke-token',
      PIDEX_DATA_DIR: 'smoke-data',
    })
  })
})
