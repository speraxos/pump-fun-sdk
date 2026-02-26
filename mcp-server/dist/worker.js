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
import { z } from "zod";
import { handleToolCall } from "./tools/index.js";
import { handleGetPrompt } from "./prompts/index.js";
import { TOOLS } from "./handlers/tools.js";
import { PROMPTS } from "./handlers/prompts.js";
// ---------------------------------------------------------------------------
// JSON-Schema → Zod conversion helpers
// ---------------------------------------------------------------------------
/** Convert a single JSON Schema property definition to a Zod type. */
function jsonPropToZod(prop, required) {
    let s;
    switch (prop.type) {
        case "string":
            s = z.string();
            break;
        case "number":
            s = z.number();
            break;
        case "boolean":
            s = z.boolean();
            break;
        default:
            s = z.unknown();
    }
    return required ? s : s.optional();
}
/** Convert the JSON Schema `inputSchema` of a tool to a Zod raw shape. */
function toZodShape(schema) {
    const req = new Set(schema.required ?? []);
    const shape = {};
    for (const [key, val] of Object.entries(schema.properties)) {
        shape[key] = jsonPropToZod(val, req.has(key));
    }
    return shape;
}
// ---------------------------------------------------------------------------
// Durable Object — MCP Agent
// ---------------------------------------------------------------------------
export class SolanaWalletMCP extends McpAgent {
    server = new McpServer({
        name: "solana-wallet-toolkit",
        version: "1.0.0",
    });
    /** Per-session state — lives as long as the Durable Object instance. */
    mcpState = {
        initialized: false,
        clientCapabilities: {},
        generatedKeypairs: new Map(),
    };
    async init() {
        // ── Tools ────────────────────────────────────────────────────────
        for (const tool of TOOLS) {
            const shape = toZodShape(tool.inputSchema);
            this.server.tool(tool.name, tool.description, shape, async (args) => handleToolCall(tool.name, args, this.mcpState));
        }
        // ── Prompts ──────────────────────────────────────────────────────
        for (const prompt of PROMPTS) {
            const hasArgs = prompt.arguments && prompt.arguments.length > 0;
            if (hasArgs) {
                const promptShape = {};
                for (const arg of prompt.arguments) {
                    promptShape[arg.name] = arg.required
                        ? z.string().describe(arg.description ?? "")
                        : z.string().optional().describe(arg.description ?? "");
                }
                this.server.prompt(prompt.name, prompt.description ?? "", promptShape, async (args) => handleGetPrompt(prompt.name, args, this.mcpState));
            }
            else {
                this.server.prompt(prompt.name, prompt.description ?? "", async () => handleGetPrompt(prompt.name, {}, this.mcpState));
            }
        }
    }
}
// ---------------------------------------------------------------------------
// Worker fetch handler
// ---------------------------------------------------------------------------
export default {
    async fetch(request, env, ctx) {
        const url = new URL(request.url);
        // Route MCP traffic to the Durable Object
        if (url.pathname === "/sse" ||
            url.pathname.startsWith("/sse/") ||
            url.pathname === "/mcp") {
            const id = env.MCP_OBJECT.idFromName("default");
            return env.MCP_OBJECT.get(id).fetch(request);
        }
        // CORS preflight
        if (request.method === "OPTIONS") {
            return new Response(null, {
                headers: {
                    "Access-Control-Allow-Origin": "*",
                    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                    "Access-Control-Allow-Headers": "Content-Type",
                },
            });
        }
        // Health / info
        return new Response(JSON.stringify({
            name: "solana-wallet-toolkit",
            version: "1.0.0",
            description: "Solana Wallet MCP Server — Cloudflare Workers",
            endpoints: {
                sse: "/sse",
                streamableHttp: "/mcp",
            },
        }), { headers: { "content-type": "application/json" } });
    },
};
//# sourceMappingURL=worker.js.map