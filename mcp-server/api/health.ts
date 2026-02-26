import type { VercelRequest, VercelResponse } from '@vercel/node';

export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({
    name: 'solana-wallet-toolkit',
    version: '1.0.0',
    description: 'Pump SDK MCP Server — Vercel deployment',
    transport: 'streamable-http',
    endpoint: '/mcp',
    stateless: true,
    note: 'Stateless deployment. Use POST /mcp for MCP JSON-RPC requests.',
  });
}
