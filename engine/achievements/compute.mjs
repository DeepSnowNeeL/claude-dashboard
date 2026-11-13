// Pure computation of progress: raw records → earned milestones (dated by the log), XP, level, rank.
import { FAMILIES, RANKS, BONUS, tierOf } from './definitions.mjs';

/** "Round" values where a record's log keeps an entry: 1..10, 12, 15, 20, 25, 30, 40, 50, 60, 75, then ×10. */
const BASE = [10, 12, 15, 20, 25, 30, 40, 50, 60, 75];
export function isRound(v) {
  if (!Number.isInteger(v) || v < 1) return false;
  if (v <= 10) return true;
  let m = v;
  while (m >= 100 && m % 10 === 0) m /= 10;
  return m < 100 && BASE.includes(m);
}

export const levelOf = xp => Math.max(1, Math.floor(Math.sqrt(Math.max(0, xp) / 250)));
// Level 1 starts at 0 XP (levelOf never goes below 1): the bar starts there, not at 250
export const xpForLevel = n => (n <= 1 ? 0 : 250 * n * n);
export const rankOf = level => RANKS.filter(g => g.level <= level).at(-1);

/** First time the record reached `threshold` or more, from its log: [value, date, slug] or null. */
function crossing(record, threshold) {
  if (!record || record.value < threshold) return null;
  return (record.log || []).find(([v]) => v >= threshold) || [record.value, null, null];
}

/**
 * @param {{ activityXp?: number, records?: Record<string, { value: number, log: [number, string, string][] }> }} state
 * @returns {{ xp, level, rank, nextRank, levelXp, nextLevelXp, families, earned: string[] }}
 */
export function compute(state, families = FAMILIES) {
  const records = state.records || {};
  const earned = [];
  let bonus = 0;
  const views = families.filter(f => !f.computed).map(f => {
    const r = records[f.id];
    const milestones = f.thresholds.map((threshold, i) => {
      const c = crossing(r, threshold);
      const tier = tierOf(f, i);
      if (c) { earned.push(`${f.id}:${i}`); bonus += BONUS[tier]; }
      return { threshold, tier, earned: !!c, date: c?.[1] || null, slug: c?.[2] || null };
    });
    return { ...f, value: r?.value || 0, milestones };
  });
  // Computed families (Collector): earned when all the other secrets are
  for (const f of families.filter(x => x.computed)) {
    const secrets = views.filter(v => v.secret);
    const ok = secrets.length > 0 && secrets.every(v => v.milestones.every(m => m.earned));
    const dates = ok ? secrets.flatMap(v => v.milestones.map(m => m.date)).filter(Boolean).sort() : [];
    const tier = tierOf(f, 0);
    if (ok) { earned.push(`${f.id}:0`); bonus += BONUS[tier]; }
    views.push({ ...f, value: ok ? 1 : 0, milestones: [{ threshold: 1, tier, earned: ok, date: dates.at(-1) || null, slug: null }] });
  }
  const xp = (state.activityXp || 0) + bonus;
  const level = levelOf(xp);
  const rank = rankOf(level);
  return {
    xp, level, rank, nextRank: RANKS.find(g => g.level > level) || null,
    levelXp: xpForLevel(level), nextLevelXp: xpForLevel(level + 1),
    families: views, earned,
  };
}
