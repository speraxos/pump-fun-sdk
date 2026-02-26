#!/usr/bin/env node
/**
 * Streamable HTTP MCP Server for Solana Wallet Toolkit.
 *
 * Exposes the same tools, resources, and prompts as the stdio server
 * but over HTTP using the MCP Streamable HTTP transport.
 *
 * Endpoints:
 *   POST /mcp   — Streamable HTTP transport (JSON-RPC over HTTP)
 *   GET  /mcp   — SSE stream for server-initiated messages
 *   DELETE /mcp — Session termination
 *   GET  /      — Health / info JSON
 *
 * Usage:
 *   node dist/http-server.js                       # default port 3000
 *   PORT=8080 node dist/http-server.js             # custom port
 *   MCP_ENDPOINT=/api/mcp node dist/http-server.js # custom endpoint
 */
export {};
//# sourceMappingURL=http-server.d.ts.map