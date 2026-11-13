// Subscription usage, for the block at the bottom of the session list.
import { query } from '@anthropic-ai/claude-agent-sdk';
import { t } from '../public/i18n/index.js';

// Subscription usage: a probe query that never sends a message, asked at most once per minute.
// The SDK API is experimental (method name bound to change): a failure, or an answer without limits (it happens
// at times), returns the last good answer; null only if there never was one, the page then hides the block.
let probe = null, usageCache = null, usageCacheAt = 0, lastGood = null;
export async function subscriptionUsage() {
  if (usageCache && Date.now() - usageCacheAt < 60_000) return usageCache;
  try {
    probe ??= query({ prompt: (async function* () { await new Promise(() => {}); })(), options: { settingSources: [] } });
    const u = await probe.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true });
    const limits = (u.rate_limits?.limits || []).map(l => ({
      label: l.kind === 'session' ? t('driver.usage.session') : l.kind === 'weekly_all' ? t('driver.usage.week')
        : t('driver.usage.weekModel', { model: l.scope?.model?.display_name || l.kind }),
      percent: l.percent, level: l.severity, reset: l.resets_at, kind: l.kind,
    }));
    // Signed-in account: optional, its failure does not hide the limits
    const account = await probe.accountInfo().catch(() => null);
    const x = u.rate_limits?.extra_usage;
    const extra = x && { active: !!x.is_enabled, percent: x.utilization, used: x.used_credits, limit: x.monthly_limit, currency: x.currency, decimals: x.decimal_places ?? 2, reason: x.disabled_reason };
    usageCache = { plan: u.subscription_type, limits, extra, email: account?.email, organization: account?.organization, sampledAt: Date.now() };
    if (limits.length) lastGood = usageCache; else usageCache = lastGood || usageCache;
    usageCacheAt = Date.now();
  } catch {
    probe = null;
    usageCache = lastGood;
    usageCacheAt = Date.now(); // new try in a minute
  }
  return usageCache;
}
