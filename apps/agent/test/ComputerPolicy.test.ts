import { afterEach, expect, test } from 'bun:test'
import { mkdtemp, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { ConfigService } from '../src/config/ConfigService'
import type { ComputerIdentity } from '@pidex/agent-protocol'
import { ComputerPolicyService } from '../src/computer/ComputerPolicyService'
import { removeFixturePaths } from './FixtureCleanup'

const paths: string[] = []
const services: ComputerPolicyService[] = []
afterEach(async () => {
  services.splice(0).forEach((service) => service.dispose())
  await removeFixturePaths(paths.splice(0))
})
const signed: ComputerIdentity = {
  kind: 'signed',
  fingerprint: 'a'.repeat(64),
  legacyAppId: 'exe:test',
  publisher: 'CN=CPX',
  product: 'Editor',
  binary: 'editor.exe',
}
async function fixture(user: Record<string, unknown> = {}, machine?: string) {
  const root = await mkdtemp(join(tmpdir(), 'cpx-policy-'))
  paths.push(root)
  const path = join(root, 'requirements.toml')
  if (machine !== undefined) await writeFile(path, machine, 'utf8')
  const config = {
    read: async () => ({
      layers: [
        { kind: 'user', config: { computer_use: user } },
        { kind: 'project', config: { computer_use: { default_app_access: 'allow' } } },
      ],
      diagnostics: [],
    }),
    subscribe: () => () => {},
  } as unknown as ConfigService
  const policy = new ComputerPolicyService(config, path)
  services.push(policy)
  await policy.initialize()
  return { policy, path }
}
test('默认允许只是策略通过，默认永久授权可用', async () => {
  const { policy } = await fixture()
  expect(policy.evaluate(signed)).toMatchObject({ access: 'allow' })
  expect(policy.state()).toMatchObject({
    valid: true,
    managed: false,
    allowPersistentApproval: true,
  })
})
test('管理员拒绝不能被用户或项目允许放宽，专属匹配中的拒绝优先', async () => {
  const { policy } = await fixture(
    { windows: { exes: [{ publisher_name: 'CN=CPX', product_name: 'Editor', access: 'allow' }] } },
    '[computer_use]\ndefault_app_access="deny"',
  )
  expect(policy.evaluate(signed)).toMatchObject({ access: 'deny', source: 'managed' })
  const denied = await fixture({
    windows: {
      exes: [
        { publisher_name: 'CN=CPX', product_name: 'Editor', access: 'allow' },
        {
          publisher_name: 'CN=CPX',
          product_name: 'Editor',
          binary_name: 'EDITOR.EXE',
          access: 'deny',
        },
      ],
    },
  })
  expect(denied.policy.evaluate(signed)).toMatchObject({ access: 'deny', source: 'user' })
})
test('每个来源独立匹配规则，否则采用默认值；未签名不能命中发布者允许', async () => {
  const { policy } = await fixture({
    default_app_access: 'deny',
    windows: {
      exes: [{ publisher_name: 'CN=CPX', product_name: 'Editor', access: 'allow' }],
      aumids: { 'CPX!App': 'allow' },
    },
  })
  expect(policy.evaluate(signed).access).toBe('allow')
  expect(policy.evaluate({ ...signed, kind: 'unsigned', sha256: 'a'.repeat(64) }).access).toBe(
    'deny',
  )
  expect(
    policy.evaluate({
      kind: 'packaged',
      fingerprint: 'b'.repeat(64),
      legacyAppId: 'aumid:CPX!App',
      aumid: 'CPX!App',
    }).access,
  ).toBe('allow')
})
test('任一来源禁用永久允许，不改变普通审批资格', async () => {
  const { policy } = await fixture({}, '[computer_use]\nallow_persistent_approval=false')
  expect(policy.state().allowPersistentApproval).toBe(false)
  expect(policy.evaluate(signed).access).toBe('allow')
  expect(
    (await fixture({ allow_persistent_approval: false })).policy.state().allowPersistentApproval,
  ).toBe(false)
})
test('存在但损坏的策略拒绝访问，缺失采用默认值', async () => {
  const { policy } = await fixture({}, '[computer_use\n')
  expect(policy.state().valid).toBe(false)
  expect(policy.evaluate(signed)).toMatchObject({ access: 'deny', source: 'managed' })
  expect((await fixture({ default_app_access: 'typo' })).policy.state().valid).toBe(false)
})
test('机器策略变化通过文件监听通知控制服务', async () => {
  const { policy, path } = await fixture()
  let changes = 0
  policy.subscribe(() => {
    changes++
  })
  await writeFile(path, '[computer_use]\ndefault_app_access="deny"', 'utf8')
  for (let attempt = 0; attempt < 30 && policy.evaluate(signed).access !== 'deny'; attempt++)
    await Bun.sleep(100)
  expect(changes).toBeGreaterThanOrEqual(1)
  expect(policy.evaluate(signed).access).toBe('deny')
})
test('损坏或缺失可信身份拒绝，不能降级为路径身份', async () => {
  const { policy } = await fixture()
  expect(policy.evaluate().access).toBe('deny')
  expect(policy.evaluate({ ...signed, kind: 'invalid' }).source).toBe('identity')
  expect(policy.evaluate({ ...signed, publisher: undefined }).access).toBe('deny')
})
