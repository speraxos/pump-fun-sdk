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
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { MCP_VERSION } from './types/index.js';
import { registerToolHandlers } from './handlers/tools.js';
import { registerResourceHandlers } from './handlers/resources.js';
import { registerPromptHandlers } from './handlers/prompts.js';
// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------
const PORT = parseInt(process.env.PORT ?? '3000', 10);
const HOST = process.env.HOST ?? '0.0.0.0';
const MCP_ENDPOINT = process.env.MCP_ENDPOINT ?? '/mcp';
/** Map of session ID → Session. Each client gets its own server + state. */
const sessions = new Map();
// ---------------------------------------------------------------------------
// Server factory
// ---------------------------------------------------------------------------
function getCapabilities() {
    return {
        tools: { listChanged: true },
        resources: { subscribe: false, listChanged: true },
        prompts: { listChanged: true },
    };
}
function createMCPServer(state) {
    const server = new Server({ name: 'solana-wallet-toolkit', version: '1.0.0' }, { capabilities: getCapabilities() });
    registerToolHandlers(server, state);
    registerResourceHandlers(server, state);
    registerPromptHandlers(server, state);
    server.onerror = (error) => {
        console.error('[MCP Error]', error);
    };
    return server;
}
// ---------------------------------------------------------------------------
// Session lifecycle
// ---------------------------------------------------------------------------
async function createSession() {
    const state = {
        initialized: false,
        clientCapabilities: {},
        generatedKeypairs: new Map(),
    };
    const server = createMCPServer(state);
    const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
            // Store session once transport assigns the ID
            const session = { transport, server, state, createdAt: new Date() };
            sessions.set(sessionId, session);
            console.error(`[HTTP] Session created: ${sessionId}`);
        },
    });
    // Clean up when transport closes
    transport.onclose = () => {
        const sid = transport.sessionId;
        if (sid) {
            cleanupSession(sid);
        }
    };
    await server.connect(transport);
    return { transport, server, state, createdAt: new Date() };
}
function cleanupSession(sessionId) {
    const session = sessions.get(sessionId);
    if (session) {
        // Zeroize sensitive key material
        for (const [, keypair] of session.state.generatedKeypairs) {
            keypair.secretKey.fill(0);
        }
        session.state.generatedKeypairs.clear();
        sessions.delete(sessionId);
        console.error(`[HTTP] Session cleaned up: ${sessionId}`);
    }
}
// ---------------------------------------------------------------------------
// CORS helpers
// ---------------------------------------------------------------------------
function setCorsHeaders(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, mcp-session-id, Last-Event-ID');
    res.setHeader('Access-Control-Expose-Headers', 'mcp-session-id');
}
// ---------------------------------------------------------------------------
// Request handler
// ---------------------------------------------------------------------------
async function handleRequest(req, res) {
    setCorsHeaders(res);
    // CORS preflight
    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
    // ── Health endpoint ──────────────────────────────────────────────
    if (url.pathname === '/' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({
            name: 'solana-wallet-toolkit',
            version: '1.0.0',
            protocol: MCP_VERSION,
            transport: 'streamable-http',
            endpoint: MCP_ENDPOINT,
            activeSessions: sessions.size,
        }));
        return;
    }
    // ── MCP endpoint ────────────────────────────────────────────────
    if (url.pathname === MCP_ENDPOINT) {
        const sessionId = req.headers['mcp-session-id'];
        // For initialization (POST without session ID), create new session
        if (req.method === 'POST' && !sessionId) {
            const session = await createSession();
            await session.transport.handleRequest(req, res);
            return;
        }
        // For existing sessions, look up the transport
        if (sessionId) {
            const session = sessions.get(sessionId);
            if (!session) {
                res.writeHead(404, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'Session not found', sessionId }));
                return;
            }
            // DELETE = terminate session
            if (req.method === 'DELETE') {
                await session.transport.close();
                cleanupSession(sessionId);
                res.writeHead(200, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ ok: true, message: 'Session terminated' }));
                return;
            }
            // POST or GET handled by transport
            await session.transport.handleRequest(req, res);
            return;
        }
        // GET without session ID — not allowed for stateful server
        if (req.method === 'GET') {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Missing mcp-session-id header' }));
            return;
        }
    }
    // ── 404 ──────────────────────────────────────────────────────────
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
}
// ---------------------------------------------------------------------------
// Start
// ---------------------------------------------------------------------------
const httpServer = createServer(handleRequest);
httpServer.listen(PORT, HOST, () => {
    console.error(`Solana Wallet MCP Server (Streamable HTTP)`);
    console.error(`  Protocol: ${MCP_VERSION}`);
    console.error(`  Endpoint: http://${HOST}:${PORT}${MCP_ENDPOINT}`);
    console.error(`  Health:   http://${HOST}:${PORT}/`);
});
// Graceful shutdown
async function shutdown() {
    console.error('\n[HTTP] Shutting down...');
    // Close all sessions
    for (const [sessionId, session] of sessions) {
        try {
            await session.transport.close();
        }
        catch {
            // Ignore close errors during shutdown
        }
        cleanupSession(sessionId);
    }
    httpServer.close(() => {
        console.error('[HTTP] Server closed');
        process.exit(0);
    });
    // Force exit after 5s
    setTimeout(() => process.exit(1), 5000).unref();
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
//# sourceMappingURL=http-server.js.map