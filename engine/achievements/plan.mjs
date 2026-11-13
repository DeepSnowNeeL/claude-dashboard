// Plan achievements, pure computation: a usage sample (every minute, or a limit rejection) advances a small
// state. Plan changes are frequent: a change of plan or of reset date, or a % going down, never adds anything to
// the day's usage (only the increases between two comparable samples count).

/** Instant in ms of a reset date (seconds, ms or ISO). */
export const msOf = v => (typeof v === 'number' ? (v < 1e12 ? v * 1000 : v) : Date.parse(v) || 0);
const localDay = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

const DEFAULT = { plan: null, weekReset: null, day: null, lastPct: null, dayUsage: 0, weekMaxPct: 0, planChanged: false, sampledDays: [], windows5h: [], fullWeeks: [] };

/**
 * @param {object|null} state previous state (progress.json → plan)
 * @param {{ plan?, week?: { pct, reset }, fiveHours?: { pct, reset }, modelWeeks?: { pct, reset }[], rejection?: { type: 'five_hour'|'seven_day', reset } }} sample
 * @param {Date} now
 * @returns {{ state: object, events: { id: string, type: 'record'|'add', value: number }[] }}
 */
export function advancePlan(state, sample, now = new Date()) {
  const e = { ...DEFAULT, ...state };
  e.sampledDays = [...e.sampledDays]; e.windows5h = [...e.windows5h]; e.fullWeeks = [...e.fullWeeks];
  const ev = [];
  const j = localDay(now);
  const s = sample.week;
  let rupture = false;

  if (sample.plan && e.plan && sample.plan !== e.plan) { e.planChanged = true; rupture = true; }
  if (sample.plan) e.plan = sample.plan;

  if (s && s.reset != null) {
    if (e.weekReset != null && String(s.reset) !== String(e.weekReset)) {
      rupture = true;
      // Week over (we passed the old reset date): summary, unless the plan changed in the meantime
      const over = now.getTime() >= msOf(e.weekReset) - 60_000;
      if (over && !e.planChanged) {
        if (e.weekMaxPct >= 95 && e.weekMaxPct < 100) ev.push({ id: 'on-the-edge', type: 'add', value: 1 });
        else if (e.weekMaxPct < 20 && e.sampledDays.length >= 3) ev.push({ id: 'ascetic', type: 'add', value: 1 });
      }
      e.weekMaxPct = 0; e.sampledDays = []; e.windows5h = [];
      e.planChanged = !over; // reset moved without being reached: plan change
    }
    e.weekReset = s.reset;

    // Day's usage: sum of the increases between comparable samples
    if (e.day !== j) { e.day = j; e.dayUsage = 0; }
    else if (!rupture && e.lastPct != null && s.pct > e.lastPct) e.dayUsage += s.pct - e.lastPct;
    e.lastPct = s.pct;
    if (e.dayUsage > 0) ev.push({ id: 'big-appetite', type: 'record', value: Math.floor(e.dayUsage) });

    e.weekMaxPct = Math.max(e.weekMaxPct, s.pct);
    if (!e.sampledDays.includes(j)) e.sampledDays.push(j);
  }

  // 5-hour window at 100%: counted once (identified by its reset)
  const five = sample.rejection?.type === 'five_hour' ? sample.rejection.reset : sample.fiveHours?.pct >= 100 ? sample.fiveHours.reset : null;
  if (five != null && !e.windows5h.includes(String(five))) {
    e.windows5h.push(String(five));
    ev.push({ id: 'wall-5h', type: 'add', value: 1 }, { id: 'hell-week', type: 'record', value: e.windows5h.length });
  }

  // Week at 100% (overall or per model): counted once per week
  const full = sample.rejection?.type === 'seven_day' || (s && s.pct >= 100) || (sample.modelWeeks || []).some(x => x.pct >= 100);
  const weekKey = String(e.weekReset ?? sample.rejection?.reset ?? '');
  if (full && weekKey && !e.fullWeeks.includes(weekKey)) {
    e.fullWeeks.push(weekKey);
    if (e.fullWeeks.length > 20) e.fullWeeks.shift();
    ev.push({ id: 'out-of-fuel', type: 'add', value: 1 });
  }
  return { state: e, events: ev };
}
