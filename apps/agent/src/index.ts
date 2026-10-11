// Dispatches before the agent bootstrap so the node_repl child never starts the
// database, HTTP server or desktop business services.
if (process.argv.includes('--pidex-node-repl')) {
  // The child module runs itself on import and exits when the cell finishes.
  await import('./nodeRepl/Child')
} else {
  const server = await import('./ServerMain')
  await server.startAgentServer()
}

export {}
