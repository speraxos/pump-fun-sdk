/**
 * Cloudflare Workers entry point for the Solana Wallet MCP Server.
 *
 * Uses Cloudflare Durable Objects via the `agents` SDK to maintain
 * per-session state (generated keypairs) across MCP protocol messages.
 *
 * Endpoints:
 *   GET  /sse            — SSE transport (connect)
 *   POST /sse/message    — SSE transport (send message)
 *   POST /mcp            — Streamable HTTP transport
 *   GET  /               — Health / info JSON
 */
import { McpAgent } from "agents/mcp";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
type Env = {
    MCP_OBJECT: DurableObjectNamespace<SolanaWalletMCP>;
};
export declare class SolanaWalletMCP extends McpAgent<Env> {
    server: McpServer;
    /** Per-session state — lives as long as the Durable Object instance. */
    private mcpState;
    init(): Promise<void>;
}
declare const _default: {
    fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response>;
};
export default _default;
//# sourceMappingURL=worker.d.ts.map