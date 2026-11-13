// Subscription usage: read only (the block is drawn by components/usage.js).
import { api } from '../core/api.js';

/** Consumption of a session (Claude Code id): tokens, weight, dashboard share; null without a request. */
export const readSessionConsumption = sessionId => api(`/api/usage/session?id=${encodeURIComponent(sessionId)}`);
/** /usage and /context of the CLI for a driven session: { session, behaviors, context } (the engine resumes it if needed). */
export const readUsageCli = slug => api(`/api/sessions/${slug}/usage-cli`);
/** Comparison over 7 days: dashboard sessions / terminal (first computation: a few seconds). */
export const readComparison = () => api('/api/usage/comparison');

/** Subscription limits; null if the experimental API breaks. */
export async function readUsage() {
  try { return await api('/api/usage'); } catch { return null; }
}
