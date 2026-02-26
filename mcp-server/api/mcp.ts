/**
 * Vercel Serverless Function — MCP Streamable HTTP endpoint.
 *
 * Runs the Solana Wallet MCP Server as a stateless Vercel function.
 * Each invocation creates a fresh MCP server, handles the JSON-RPC
 * request, and tears down.
 *
 * Endpoints (via vercel.json rewrites):
 *   POST /mcp   — Streamable HTTP transport (JSON-RPC over HTTP)
 *   GET  /mcp   — Returns 405 (SSE not supported in stateless mode)
 *   DELETE /mcp — Returns 405 (no persistent sessions)
 *
 * Limitations:
 *   - Stateless: `saveId` / `keypairId` references do NOT persist
 *     across requests. Each request gets a fresh ServerState.
 *   - No SSE push: server-initiated notifications are not supported.
 *   - Vercel function timeout applies (10 s hobby / 60 s pro).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node';
import { randomUUID } from 'node:crypto';

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';

import { ServerState, ServerCapabilities } from '../src/types/index.js';
import { registerToolHandlers } from '../src/handlers/tools.js';
import { registerResourceHandlers } from '../src/handlers/resources.js';
import { registerPromptHandlers } from '../src/handlers/prompts.js';

// ---------------------------------------------------------------------------
// Server factory (same as http-server.ts)
// ---------------------------------------------------------------------------

function getCapabilities(): ServerCapabilities {
  return {
    tools: { listChanged: true },
    resources: { subscribe: false, listChanged: true },
    prompts: { listChanged: true },
  };
}

function createMCPServer(state: ServerState): Server {
  const server = new Server(
    { name: 'solana-wallet-toolkit', version: '1.0.0' },
    { capabilities: getCapabilities() },
  );

  registerToolHandlers(server, state);
  registerResourceHandlers(server, state);
  registerPromptHandlers(server, state);

  server.onerror = (error) => {
    console.error('[MCP Error]', error);
  };

  return server;
}

// ---------------------------------------------------------------------------
// CORS
// ---------------------------------------------------------------------------

function setCorsHeaders(res: VercelResponse): void {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Content-Type, mcp-session-id, Last-Event-ID',
  );
  res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export default async function handler(
  req: VercelRequest,
  res: VercelResponse,
): Promise<void> {
  setCorsHeaders(res);

  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  // Only POST is meaningful in stateless mode
  if (req.method !== 'POST') {
    res.status(405).json({
      jsonrpc: '2.0',
      error: {
        code: -32000,
        message:
          'Method not allowed. This is a stateless Vercel deployment — only POST is supported. ' +
          'SSE (GET) and session termination (DELETE) require the persistent HTTP server or Cloudflare Workers deployment.',
      },
      id: null,
    });
    return;
  }

  // Create a fresh per-request MCP server + state
  const state: ServerState = {
    initialized: false,
    clientCapabilities: {},
    generatedKeypairs: new Map(),
  };

  const server = createMCPServer(state);

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  await server.connect(transport);

  try {
    // Delegate to the MCP transport which reads the body and writes the response
    await transport.handleRequest(req, res);
  } finally {
    // Zeroize any sensitive key material before the function exits
    for (const [, keypair] of state.generatedKeypairs) {
      keypair.secretKey.fill(0);
    }
    state.generatedKeypairs.clear();

    // Close transport + server
    try {
      await transport.close();
      await server.close();
    } catch {
      // Ignore close errors
    }
  }
}
