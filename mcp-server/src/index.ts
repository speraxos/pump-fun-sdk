#!/usr/bin/env node

// Public API — re-export registerPump for use by other MCP servers
export { registerPump, TOOLS } from './register.js';

import { SolanaWalletMCPServer } from './server.js';

async function main(): Promise<void> {
  const server = new SolanaWalletMCPServer();

  try {
    await server.start();
  } catch (error) {
    console.error('Failed to start MCP server:', error);
    process.exit(1);
  }
}

main();

