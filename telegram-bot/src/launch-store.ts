/**
 * PumpFun Telegram Bot — Launch Monitor Store
 *
 * Tracks which chats have /monitor active and their filter preferences.
 * Simple in-memory Map — no persistence needed.
 */

import { log } from './logger.js';

// ============================================================================
// Types
// ============================================================================

export interface LaunchMonitorEntry {
    /** Telegram chat ID */
    chatId: number;
    /** Who activated monitoring */
    activatedBy: number;
    /** Only show tokens with GitHub links */
    githubOnly: boolean;
    /** Active status */
    active: boolean;
    /** When activated (unix ms) */
    activatedAt: number;
}

// ============================================================================
// In-memory store
// ============================================================================

const monitors = new Map<number, LaunchMonitorEntry>();

// ============================================================================
// Operations
// ============================================================================

/** Activate (or update) the launch monitor for a chat. */
export function activateMonitor(
    chatId: number,
    userId: number,
    githubOnly: boolean,
): LaunchMonitorEntry {
    const entry: LaunchMonitorEntry = {
        activatedAt: Date.now(),
        activatedBy: userId,
        active: true,
        chatId,
        githubOnly,
    };
    monitors.set(chatId, entry);
    log.info(
        'Launch monitor activated for chat %d (githubOnly=%s)',
        chatId,
        githubOnly,
    );
    return entry;
}

/** Deactivate the launch monitor for a chat. */
export function deactivateMonitor(chatId: number): boolean {
    const entry = monitors.get(chatId);
    if (!entry || !entry.active) return false;
    entry.active = false;
    log.info('Launch monitor deactivated for chat %d', chatId);
    return true;
}

/** Return all active monitor entries. */
export function getActiveMonitors(): LaunchMonitorEntry[] {
    return Array.from(monitors.values()).filter((e) => e.active);
}

/** Check whether a chat has an active monitor. */
export function isMonitorActive(chatId: number): boolean {
    const entry = monitors.get(chatId);
    return !!entry?.active;
}

/** Get the monitor entry for a chat (active or not). */
export function getMonitorEntry(chatId: number): LaunchMonitorEntry | undefined {
    return monitors.get(chatId);
}
