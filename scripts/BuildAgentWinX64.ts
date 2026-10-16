import { cp, mkdir, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'
import { assertAgentBinaryHasNoStaticRiskFeatures } from './AgentPeSignatures'

const root = resolve(import.meta.dir, '..')
const agentRoot = resolve(root, 'apps/agent')
const outputDirectory = resolve(agentRoot, 'dist/x64')
const output = resolve(outputDirectory, 'pidex-agent.exe')
const temporaryOutput = `${output}.building.exe`
const builtinSkillsSource = resolve(agentRoot, 'resources/skills')
const builtinSkillsOutput = resolve(outputDirectory, 'skills')
const builtinPluginsSource = resolve(agentRoot, 'resources/plugins')
const builtinPluginsOutput = resolve(outputDirectory, 'plugins')

await mkdir(outputDirectory, { recursive: true })
await rm(temporaryOutput, { force: true })

const build = Bun.spawn(
  [
    'bun',
    'build',
    'src/index.ts',
    '--compile',
    '--target=bun-windows-x64',
    `--outfile=${temporaryOutput}`,
  ],
  {
    cwd: agentRoot,
    stdin: 'inherit',
    stdout: 'inherit',
    stderr: 'inherit',
  },
)

const exitCode = await build.exited
if (exitCode !== 0) process.exit(exitCode)

try {
  await assertAgentBinaryHasNoStaticRiskFeatures(temporaryOutput)
  await rm(output, { force: true })
  await rename(temporaryOutput, output)
  await rm(builtinSkillsOutput, { recursive: true, force: true })
  await cp(builtinSkillsSource, builtinSkillsOutput, { recursive: true })
  await rm(builtinPluginsOutput, { recursive: true, force: true })
  await cp(builtinPluginsSource, builtinPluginsOutput, { recursive: true })
  console.log(`[Pidex] Agent x64 PE verified: ${output}`)
} catch (error) {
  await rm(temporaryOutput, { force: true })
  throw error
}
