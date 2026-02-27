/**
 * PumpFun API — REST Server
 *
 * Scalable HTTP API built with Hono. Features:
 * - API key authentication
 * - Per-client rate limiting (sliding window)
 * - Paginated list endpoints
 * - SSE real-time claim streaming
 * - Webhook delivery for claim events
 * - Health check endpoint (no auth)
 *
 * Designed for horizontal scaling:
 * - Stateless request handling (swap file store for Redis/Postgres)
 * - SSE per-instance (use Redis pub/sub for multi-instance fan-out)
 * - Webhook delivery is fire-and-forget with retries
 */

import { createServer, type Server } from 'node:http';
import { log } from '../logger.js';
import type { PumpFunMonitor } from '../monitor.js';
import { findMatchingWatches as findMatchingBotWatches } from '../store.js';
import type { FeeClaimEvent } from '../types.js';
import {
    addApiWatch,
    findMatchingApiWatches,
    getApiWatch,
    getApiWatchCount,
    getApiWatchesForClient,
    getClientWatchCount,
    loadApiWatches,
    removeApiWatch,
    updateApiWatch,
} from './apiStore.js';
import { ClaimBuffer } from './claimBuffer.js';
import { RateLimiter } from './rateLimiter.js';
import type {
    ApiConfig,
    ApiError,
    ClaimResponse,
    CreateWatchBody,
    HealthResponse,
    PaginatedResponse,
    StatusResponse,
    UpdateWatchBody,
    WatchResponse,
} from './types.js';
import { dispatchWebhooks } from './webhooks.js';

// ============================================================================
// API Config Loader
// ============================================================================

export function loadApiConfig(): ApiConfig {
    return {
        apiKeys: process.env.API_KEYS
            ? process.env.API_KEYS.split(',').map((k) => k.trim()).filter(Boolean)
            : [],
        claimBufferSize: Number.parseInt(process.env.CLAIM_BUFFER_SIZE || '10000', 10),
        corsOrigins: process.env.CORS_ORIGINS || '*',
        maxWatchesPerClient: Number.parseInt(process.env.MAX_WATCHES_PER_CLIENT || '100', 10),
        port: Number.parseInt(process.env.API_PORT || '3000', 10),
        rateLimitMax: Number.parseInt(process.env.RATE_LIMIT_MAX || '100', 10),
        rateLimitWindowMs: Number.parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000', 10),
    };
}

// ============================================================================
// API Server
// ============================================================================

export class PumpFunApi {
    private config: ApiConfig;
    private monitor: PumpFunMonitor;
    private rateLimiter: RateLimiter;
    private claimBuffer: ClaimBuffer;
    private server: Server | null = null;
    private startedAt = 0;

    constructor(config: ApiConfig, monitor: PumpFunMonitor) {
        this.config = config;
        this.monitor = monitor;
        this.rateLimiter = new RateLimiter(config);
        this.claimBuffer = new ClaimBuffer(config.claimBufferSize);

        // Load persisted API watches
        loadApiWatches();
    }

    /**
     * Handle an incoming claim event from the monitor.
     * Buffers it, dispatches webhooks, and notifies SSE subscribers.
     */
    handleClaim(event: FeeClaimEvent): void {
        this.claimBuffer.push(event);

        // Dispatch webhooks to matching API watches
        const matchingApiWatches = findMatchingApiWatches(event.claimerWallet);
        if (matchingApiWatches.length > 0) {
            const claimResp: ClaimResponse = {
                amountLamports: event.amountLamports,
                amountSol: event.amountSol,
                claimLabel: event.claimLabel,
                claimType: event.claimType,
                claimerWallet: event.claimerWallet,
                isCashback: event.isCashback,
                programId: event.programId,
                slot: event.slot,
                timestamp: new Date(event.timestamp * 1000).toISOString(),
                tokenMint: event.tokenMint,
                tokenName: event.tokenName,
                tokenSymbol: event.tokenSymbol,
                txSignature: event.txSignature,
            };
            dispatchWebhooks(claimResp, matchingApiWatches).catch((err) =>
                log.error('Webhook dispatch error:', err),
            );
        }
    }

    /** Start the HTTP server. */
    async start(): Promise<void> {
        this.startedAt = Date.now();

        this.server = createServer(async (req, res) => {
            try {
                await this.handleRequest(req, res);
            } catch (err) {
                log.error('Unhandled API error:', err);
                this.sendJson(res, 500, {
                    code: 'INTERNAL_ERROR',
                    error: 'Internal server error',
                    statusCode: 500,
                });
            }
        });

        return new Promise((resolve) => {
            this.server!.listen(this.config.port, () => {
                log.info('API server listening on port %d', this.config.port);
                resolve();
            });
        });
    }

    /** Stop the HTTP server. */
    stop(): void {
        this.rateLimiter.stop();
        if (this.server) {
            this.server.close();
            log.info('API server stopped');
        }
    }

    // ════════════════════════════════════════════════════════════════════
    // Request Router
    // ════════════════════════════════════════════════════════════════════

    private async handleRequest(
        req: import('node:http').IncomingMessage,
        res: import('node:http').ServerResponse,
    ): Promise<void> {
        const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
        const method = req.method?.toUpperCase() || 'GET';
        const path = url.pathname;

        // CORS headers
        res.setHeader('Access-Control-Allow-Origin', this.config.corsOrigins);
        res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-API-Key');
        res.setHeader('Access-Control-Expose-Headers', 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset');

        if (method === 'OPTIONS') {
            res.writeHead(204);
            res.end();
            return;
        }

        // ── Health check (no auth) ──────────────────────────────────────
        if (path === '/api/v1/health' && method === 'GET') {
            return this.handleHealth(res);
        }

        // ── Auth ────────────────────────────────────────────────────────
        const clientId = this.authenticate(req);
        if (!clientId) {
            return this.sendJson(res, 401, {
                code: 'UNAUTHORIZED',
                error: 'Invalid or missing API key. Set X-API-Key header or Authorization: Bearer <key>.',
                statusCode: 401,
            });
        }

        // ── Rate limiting ───────────────────────────────────────────────
        const rateCheck = this.rateLimiter.check(clientId);
        res.setHeader('X-RateLimit-Limit', rateCheck.limit.toString());
        res.setHeader('X-RateLimit-Remaining', rateCheck.remaining.toString());
        res.setHeader('X-RateLimit-Reset', Math.ceil(rateCheck.resetMs / 1000).toString());

        if (!rateCheck.allowed) {
            res.setHeader('Retry-After', Math.ceil(rateCheck.resetMs / 1000).toString());
            return this.sendJson(res, 429, {
                code: 'RATE_LIMITED',
                error: `Rate limit exceeded. Try again in ${Math.ceil(rateCheck.resetMs / 1000)}s.`,
                statusCode: 429,
            });
        }

        // ── Route matching ──────────────────────────────────────────────

        // GET /api/v1/status
        if (path === '/api/v1/status' && method === 'GET') {
            return this.handleStatus(res);
        }

        // GET /api/v1/claims
        if (path === '/api/v1/claims' && method === 'GET') {
            return this.handleGetClaims(url, res);
        }

        // GET /api/v1/claims/stream (SSE)
        if (path === '/api/v1/claims/stream' && method === 'GET') {
            return this.handleClaimStream(req, res, clientId, url);
        }

        // Watches CRUD
        if (path === '/api/v1/watches') {
            if (method === 'GET') return this.handleListWatches(url, clientId, res);
            if (method === 'POST') return this.handleCreateWatch(req, clientId, res);
        }

        // /api/v1/watches/:id
        const watchMatch = path.match(/^\/api\/v1\/watches\/([a-zA-Z0-9_]+)$/);
        if (watchMatch) {
            const watchId = watchMatch[1];
            if (method === 'GET') return this.handleGetWatch(watchId, clientId, res);
            if (method === 'PATCH' || method === 'PUT') return this.handleUpdateWatch(req, watchId, clientId, res);
            if (method === 'DELETE') return this.handleDeleteWatch(watchId, clientId, res);
        }

        // 404
        this.sendJson(res, 404, {
            code: 'NOT_FOUND',
            error: `Route not found: ${method} ${path}`,
            statusCode: 404,
        });
    }

    // ════════════════════════════════════════════════════════════════════
    // Auth
    // ════════════════════════════════════════════════════════════════════

    private authenticate(req: import('node:http').IncomingMessage): string | null {
        // If no API keys configured, allow all with a default client ID
        if (this.config.apiKeys.length === 0) {
            return 'default';
        }

        // Check X-API-Key header
        const apiKey = req.headers['x-api-key'] as string | undefined;
        if (apiKey && this.config.apiKeys.includes(apiKey)) {
            return this.hashKey(apiKey);
        }

        // Check Authorization: Bearer <key>
        const auth = req.headers.authorization;
        if (auth?.startsWith('Bearer ')) {
            const token = auth.slice(7).trim();
            if (this.config.apiKeys.includes(token)) {
                return this.hashKey(token);
            }
        }

        return null;
    }

    /** Simple hash of API key for use as client ID (don't store raw keys). */
    private hashKey(key: string): string {
        let hash = 0;
        for (let i = 0; i < key.length; i++) {
            const char = key.charCodeAt(i);
            hash = ((hash << 5) - hash + char) | 0;
        }
        return `client_${Math.abs(hash).toString(36)}`;
    }

    // ════════════════════════════════════════════════════════════════════
    // Handlers
    // ════════════════════════════════════════════════════════════════════

    private handleHealth(res: import('node:http').ServerResponse): void {
        const state = this.monitor.getState();
        const response: HealthResponse = {
            monitor: {
                claimsDetected: state.claimsDetected,
                mode: state.mode,
                running: state.isRunning,
            },
            status: state.isRunning ? 'ok' : 'degraded',
            timestamp: new Date().toISOString(),
            uptime: this.startedAt ? Date.now() - this.startedAt : 0,
            version: '1.0.0',
        };
        this.sendJson(res, 200, response);
    }

    private handleStatus(res: import('node:http').ServerResponse): void {
        const state = this.monitor.getState();
        const watchCounts = getApiWatchCount();
        const response: StatusResponse = {
            claims: {
                buffered: this.claimBuffer.size,
                total: this.claimBuffer.total,
            },
            monitor: state,
            uptime: this.startedAt ? Date.now() - this.startedAt : 0,
            watches: watchCounts,
        };
        this.sendJson(res, 200, response);
    }

    // ── Claims ──────────────────────────────────────────────────────────

    private handleGetClaims(
        url: URL,
        res: import('node:http').ServerResponse,
    ): void {
        const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10));
        const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10)));

        const result = this.claimBuffer.query({
            claimType: url.searchParams.get('claimType') || undefined,
            isCashback: url.searchParams.has('isCashback')
                ? url.searchParams.get('isCashback') === 'true'
                : undefined,
            limit,
            maxAmountSol: url.searchParams.has('maxAmountSol')
                ? Number.parseFloat(url.searchParams.get('maxAmountSol')!)
                : undefined,
            minAmountSol: url.searchParams.has('minAmountSol')
                ? Number.parseFloat(url.searchParams.get('minAmountSol')!)
                : undefined,
            page,
            since: url.searchParams.get('since') || undefined,
            tokenMint: url.searchParams.get('tokenMint') || undefined,
            until: url.searchParams.get('until') || undefined,
            wallet: url.searchParams.get('wallet') || undefined,
        });

        const totalPages = Math.ceil(result.total / limit);

        const response: PaginatedResponse<ClaimResponse> = {
            data: result.data,
            pagination: {
                hasNext: page < totalPages,
                hasPrev: page > 1,
                limit,
                page,
                total: result.total,
                totalPages,
            },
        };
        this.sendJson(res, 200, response);
    }

    // ── Claims SSE Stream ───────────────────────────────────────────────

    private handleClaimStream(
        req: import('node:http').IncomingMessage,
        res: import('node:http').ServerResponse,
        clientId: string,
        url: URL,
    ): void {
        const walletFilter = url.searchParams.get('wallet')?.toLowerCase();
        const cashbackFilter = url.searchParams.has('isCashback')
            ? url.searchParams.get('isCashback') === 'true'
            : undefined;

        res.writeHead(200, {
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
            'Content-Type': 'text/event-stream',
            'X-Accel-Buffering': 'no', // nginx proxy compatibility
        });

        // Send initial connection event
        res.write(`event: connected\ndata: ${JSON.stringify({ clientId, timestamp: new Date().toISOString() })}\n\n`);

        // Heartbeat every 30s to keep connection alive
        const heartbeat = setInterval(() => {
            res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
        }, 30_000);

        const subscriberId = `${clientId}_${Date.now()}`;
        const unsubscribe = this.claimBuffer.subscribe(subscriberId, (claim) => {
            // Apply filters
            if (walletFilter && claim.claimerWallet.toLowerCase() !== walletFilter) return;
            if (cashbackFilter !== undefined && claim.isCashback !== cashbackFilter) return;

            res.write(`event: claim\ndata: ${JSON.stringify(claim)}\n\n`);
        });

        // Cleanup on disconnect
        req.on('close', () => {
            clearInterval(heartbeat);
            unsubscribe();
            log.debug('SSE client disconnected: %s', subscriberId);
        });
    }

    // ── Watches CRUD ────────────────────────────────────────────────────

    private handleListWatches(
        url: URL,
        clientId: string,
        res: import('node:http').ServerResponse,
    ): void {
        const page = Math.max(1, Number.parseInt(url.searchParams.get('page') || '1', 10));
        const limit = Math.min(100, Math.max(1, Number.parseInt(url.searchParams.get('limit') || '50', 10)));
        const activeOnly = url.searchParams.get('active') !== 'false';

        let watches = getApiWatchesForClient(clientId);
        if (activeOnly) {
            watches = watches.filter((w) => w.active);
        }

        const total = watches.length;
        const totalPages = Math.ceil(total / limit);
        const offset = (page - 1) * limit;
        const pageData = watches.slice(offset, offset + limit).map(this.toWatchResponse);

        const response: PaginatedResponse<WatchResponse> = {
            data: pageData,
            pagination: {
                hasNext: page < totalPages,
                hasPrev: page > 1,
                limit,
                page,
                total,
                totalPages,
            },
        };
        this.sendJson(res, 200, response);
    }

    private async handleCreateWatch(
        req: import('node:http').IncomingMessage,
        clientId: string,
        res: import('node:http').ServerResponse,
    ): Promise<void> {
        const body = await this.readBody<CreateWatchBody>(req);
        if (!body) {
            return this.sendJson(res, 400, {
                code: 'INVALID_BODY',
                error: 'Request body must be valid JSON with a "wallet" field.',
                statusCode: 400,
            });
        }

        if (!body.wallet || typeof body.wallet !== 'string') {
            return this.sendJson(res, 400, {
                code: 'MISSING_WALLET',
                error: '"wallet" field is required and must be a string.',
                statusCode: 400,
            });
        }

        // Validate Solana address
        if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(body.wallet)) {
            return this.sendJson(res, 400, {
                code: 'INVALID_WALLET',
                error: 'Invalid Solana wallet address. Must be a base58-encoded public key (32-44 characters).',
                statusCode: 400,
            });
        }

        // Validate webhook URL if provided
        if (body.webhookUrl) {
            try {
                const webhookParsed = new URL(body.webhookUrl);
                if (!['http:', 'https:'].includes(webhookParsed.protocol)) {
                    throw new Error('bad protocol');
                }
            } catch {
                return this.sendJson(res, 400, {
                    code: 'INVALID_WEBHOOK',
                    error: 'webhookUrl must be a valid HTTP(S) URL.',
                    statusCode: 400,
                });
            }
        }

        // Check per-client watch limit
        const currentCount = getClientWatchCount(clientId);
        if (currentCount >= this.config.maxWatchesPerClient) {
            return this.sendJson(res, 409, {
                code: 'WATCH_LIMIT',
                error: `Maximum watches per client reached (${this.config.maxWatchesPerClient}). Remove some watches first.`,
                statusCode: 409,
            });
        }

        // Check for duplicates
        const existing = getApiWatchesForClient(clientId);
        if (existing.some((w) => w.recipientWallet.toLowerCase() === body.wallet.toLowerCase() && w.active)) {
            return this.sendJson(res, 409, {
                code: 'DUPLICATE_WATCH',
                error: 'This wallet is already being watched.',
                statusCode: 409,
            });
        }

        const watch = addApiWatch(
            clientId,
            body.wallet,
            body.label,
            body.tokenFilter,
            body.webhookUrl,
        );

        this.sendJson(res, 201, this.toWatchResponse(watch));
    }

    private handleGetWatch(
        watchId: string,
        clientId: string,
        res: import('node:http').ServerResponse,
    ): void {
        const watch = getApiWatch(watchId, clientId);
        if (!watch) {
            return this.sendJson(res, 404, {
                code: 'WATCH_NOT_FOUND',
                error: `Watch "${watchId}" not found.`,
                statusCode: 404,
            });
        }
        this.sendJson(res, 200, this.toWatchResponse(watch));
    }

    private async handleUpdateWatch(
        req: import('node:http').IncomingMessage,
        watchId: string,
        clientId: string,
        res: import('node:http').ServerResponse,
    ): Promise<void> {
        const body = await this.readBody<UpdateWatchBody>(req);
        if (!body) {
            return this.sendJson(res, 400, {
                code: 'INVALID_BODY',
                error: 'Request body must be valid JSON.',
                statusCode: 400,
            });
        }

        // Validate webhook URL if provided
        if (body.webhookUrl !== undefined && body.webhookUrl !== '') {
            try {
                const webhookParsed = new URL(body.webhookUrl);
                if (!['http:', 'https:'].includes(webhookParsed.protocol)) {
                    throw new Error('bad protocol');
                }
            } catch {
                return this.sendJson(res, 400, {
                    code: 'INVALID_WEBHOOK',
                    error: 'webhookUrl must be a valid HTTP(S) URL.',
                    statusCode: 400,
                });
            }
        }

        const updated = updateApiWatch(watchId, clientId, body);
        if (!updated) {
            return this.sendJson(res, 404, {
                code: 'WATCH_NOT_FOUND',
                error: `Watch "${watchId}" not found.`,
                statusCode: 404,
            });
        }
        this.sendJson(res, 200, this.toWatchResponse(updated));
    }

    private handleDeleteWatch(
        watchId: string,
        clientId: string,
        res: import('node:http').ServerResponse,
    ): void {
        const removed = removeApiWatch(watchId, clientId);
        if (!removed) {
            return this.sendJson(res, 404, {
                code: 'WATCH_NOT_FOUND',
                error: `Watch "${watchId}" not found.`,
                statusCode: 404,
            });
        }
        this.sendJson(res, 200, { message: 'Watch removed successfully.' });
    }

    // ════════════════════════════════════════════════════════════════════
    // Helpers
    // ════════════════════════════════════════════════════════════════════

    private toWatchResponse(watch: import('./types.js').ApiWatchEntry): WatchResponse {
        return {
            active: watch.active,
            clientId: watch.clientId,
            createdAt: new Date(watch.createdAt).toISOString(),
            id: watch.id,
            label: watch.label,
            tokenFilter: watch.tokenFilter,
            wallet: watch.recipientWallet,
            webhookUrl: watch.webhookUrl,
        };
    }

    private sendJson(
        res: import('node:http').ServerResponse,
        status: number,
        body: unknown,
    ): void {
        const json = JSON.stringify(body);
        res.writeHead(status, {
            'Content-Length': Buffer.byteLength(json),
            'Content-Type': 'application/json',
        });
        res.end(json);
    }

    private readBody<T>(req: import('node:http').IncomingMessage): Promise<T | null> {
        return new Promise((resolve) => {
            const chunks: Buffer[] = [];
            let size = 0;
            const MAX_BODY = 64 * 1024; // 64KB

            req.on('data', (chunk: Buffer) => {
                size += chunk.length;
                if (size > MAX_BODY) {
                    resolve(null);
                    req.destroy();
                    return;
                }
                chunks.push(chunk);
            });

            req.on('end', () => {
                try {
                    const raw = Buffer.concat(chunks).toString('utf-8');
                    resolve(JSON.parse(raw) as T);
                } catch {
                    resolve(null);
                }
            });

            req.on('error', () => resolve(null));
        });
    }
}
