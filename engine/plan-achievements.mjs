// Plan achievements: usage sampled every minute (the only probe, held by the engine) and limit rejections from
// the sessions; the computation is in achievements/plan.mjs.
import { subscriptionUsage } from '../driver.mjs';
import { advancePlan, msOf } from './achievements/plan.mjs';
import { record, add, achievementState, save } from './progress.mjs';

// Reset rounded to the minute: usage and rate_limit_event do not give it in the same form
const minute = v => (v == null ? null : Math.round(msOf(v) / 60000) * 60000);

function apply(sample) {
  const e = achievementState();
  const { state, events } = advancePlan(e.plan, sample, new Date());
  e.plan = state;
  save();
  for (const x of events) (x.type === 'record' ? record : add)(x.id, x.value);
}

async function takeSample() {
  const u = await subscriptionUsage().catch(() => null);
  // Experimental API down (empty answer, or last good answer served again): nothing counts
  if (!u?.limits?.length || !(Date.now() - (u.sampledAt || 0) < 5 * 60_000)) return;
  const byKind = k => u.limits.find(l => l.kind === k);
  const lim = l => l && l.percent != null && { pct: l.percent, reset: minute(l.reset) };
  apply({
    plan: u.plan || null,
    week: lim(byKind('weekly_all')) || undefined,
    fiveHours: lim(byKind('session')) || undefined,
    modelWeeks: u.limits.filter(l => l.kind && !['session', 'weekly_all'].includes(l.kind)).map(lim).filter(Boolean),
  });
}

/** Limit rejection seen by a session (rate_limit_event "rejected"): counts right away. */
export function onRateLimit(r) {
  if (r?.status !== 'rejected') return;
  const type = r.rateLimitType === 'five_hour' ? 'five_hour' : String(r.rateLimitType || '').startsWith('seven_day') ? 'seven_day' : null;
  if (type) apply({ rejection: { type, reset: minute(r.resetsAt) } });
}

export function startPlanAchievements() {
  setTimeout(takeSample, 10_000).unref?.();
  setInterval(takeSample, 60_000).unref?.();
}
