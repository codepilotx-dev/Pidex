import { describe, expect, test } from 'bun:test'
import { join, resolve } from 'node:path'
import {
  resolveAgentDataDirectory,
  resolveBuiltinPluginsDirectory,
  resolveBuiltinSkillsDirectory,
  resolveAgentLogDirectory,
  resolveAgentPetsDirectory,
  resolveAgentStorageLayout,
} from '../src/config/Config'

describe('Agent data directories', () => {
  test('defaults all Agent-owned data to the current user home', () => {
    const userHome = resolve('C:/Users/Example')
    const environment = { CODEX_HOME: resolve('D:/codex-home') }

    expect(resolveAgentDataDirectory(environment, userHome)).toBe(join(userHome, '.pidex'))
    expect(resolveAgentLogDirectory(environment, userHome)).toBe(join(userHome, '.pidex', 'logs'))
    expect(resolveAgentPetsDirectory(environment, userHome)).toBe(join(userHome, '.pidex', 'pets'))
  })

  test('keeps Pidex-specific overrides authoritative', () => {
    const environment = {
      PIDEX_DATA_DIR: resolve('D:/agent-data'),
      PIDEX_LOG_DIR: resolve('D:/agent-logs'),
      PIDEX_PETS_DIR: resolve('D:/agent-pets'),
      CODEX_HOME: resolve('D:/codex-home'),
    }

    expect(resolveAgentDataDirectory(environment)).toBe(environment.PIDEX_DATA_DIR)
    expect(resolveAgentLogDirectory(environment)).toBe(environment.PIDEX_LOG_DIR)
    expect(resolveAgentPetsDirectory(environment)).toBe(environment.PIDEX_PETS_DIR)
    expect(
      resolveBuiltinSkillsDirectory({
        PIDEX_BUILTIN_SKILLS_DIR: resolve('D:/agent-skills'),
      }),
    ).toBe(resolve('D:/agent-skills'))
    expect(
      resolveBuiltinPluginsDirectory({
        PIDEX_BUILTIN_PLUGINS_DIR: resolve('D:/agent-plugins'),
      }),
    ).toBe(resolve('D:/agent-plugins'))
  })

  test('derives every managed directory from the selected data root', () => {
    const dataRoot = resolve('D:/PidexData/.pidex')
    const layout = resolveAgentStorageLayout(
      { PIDEX_DATA_DIR: dataRoot },
      resolve('C:/Users/Example'),
    )

    expect(layout).toMatchObject({
      dataRoot,
      userConfig: join(dataRoot, 'config.json'),
      hooksFile: join(dataRoot, 'hooks.json'),
      skillsRoot: join(dataRoot, 'skills'),
      pluginsRoot: join(dataRoot, 'plugins'),
      pluginCacheRoot: join(dataRoot, 'plugins', 'cache'),
      pluginInstallStagingRoot: join(dataRoot, 'plugins', '.install-staging'),
      attachmentsRoot: join(dataRoot, 'attachments'),
      petsRoot: join(dataRoot, 'pets'),
      toolingRoot: join(dataRoot, 'tooling'),
      speechRoot: join(dataRoot, 'speech'),
      workspacesRoot: join(dataRoot, 'workspaces'),
      logsRoot: join(dataRoot, 'logs'),
    })
  })
})
