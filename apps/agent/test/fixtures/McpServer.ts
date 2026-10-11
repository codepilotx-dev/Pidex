import { runMcpDebugServer } from '../../scripts/McpDebugServer'

// Keep the fixture entry point and its historical zero-port HTTP default stable.
await runMcpDebugServer(process.argv.slice(2), {
  port: 0,
  allowInlineAuthToken: true,
})
