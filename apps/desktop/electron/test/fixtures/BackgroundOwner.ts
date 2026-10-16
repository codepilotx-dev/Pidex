import { LocalBackgroundRuntime } from '../../src/sidecar/BackgroundRuntime'
import { dirname } from 'node:path'

const [directory, executable, agent] = process.argv.slice(2)
const runtime = new LocalBackgroundRuntime(directory!, {
  encryptString: (text) => Buffer.from([...text].reverse().join('')),
  decryptString: (bytes) => [...bytes.toString()].reverse().join(''),
})
await runtime.initialize()
const connection = await runtime.connect({ executable: executable!, args: [agent!], cwd: dirname(agent!) }, {
  ...process.env,
  PIDEX_TEST_RUNTIME_DIR: directory,
})
process.stdout.write(`${JSON.stringify(connection)}\n`)
