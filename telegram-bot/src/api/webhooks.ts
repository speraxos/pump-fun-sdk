/**
 * PumpFun API — Webhook Dispatcher
 *
 * Delivers claim events to registered webhook URLs with retry logic.
 * Uses exponential backoff and a concurrent delivery queue.
 */

import { log } from '../logger.js';
import type { FeeClaimEvent } from '../types.js';
import type { ApiWatchEntry, ClaimResponse } from './types.js';

const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1_000;

/** Dispatch a claim event to all matching webhook URLs. */
export async function dispatchWebhooks(
    claim: ClaimResponse,
    watches: ApiWatchEntry[],
): Promise<void> {
    const webhookWatches = watches.filter((w) => w.webhookUrl);
    if (webhookWatches.length === 0) return;

    // Deduplicate webhook URLs (multiple watches might share the same URL)
    const uniqueUrls = new Map<string, ApiWatchEntry[]>();
    for (const watch of webhookWatches) {
        const url = watch.webhookUrl!;
        const existing = uniqueUrls.get(url) || [];
        existing.push(watch);
        uniqueUrls.set(url, existing);
    }

    const deliveries = Array.from(uniqueUrls.entries()).map(
        ([url, relatedWatches]) =>
            deliverWithRetry(url, {
                event: 'claim.detected',
                data: claim,
                watchIds: relatedWatches.map((w) => w.id),
                timestamp: new Date().toISOString(),
            }),
    );

    // Fire-and-forget — don't block the main flow
    await Promise.allSettled(deliveries);
}

async function deliverWithRetry(
    url: string,
    payload: unknown,
    attempt = 0,
): Promise<void> {
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'PumpFun-API/1.0',
                'X-PumpFun-Event': 'claim.detected',
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10_000),
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        log.debug('Webhook delivered to %s', url);
    } catch (err) {
        if (attempt < MAX_RETRIES) {
            const delay = BASE_DELAY_MS * 2 ** attempt;
            log.warn(
                'Webhook to %s failed (attempt %d/%d), retrying in %dms: %s',
                url,
                attempt + 1,
                MAX_RETRIES,
                delay,
                err,
            );
            await new Promise((r) => setTimeout(r, delay));
            return deliverWithRetry(url, payload, attempt + 1);
        }
        log.error('Webhook to %s failed after %d retries: %s', url, MAX_RETRIES, err);
    }
}
