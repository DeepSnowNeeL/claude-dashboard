// Levels, XP and achievements: state on disk (progress.json), raw records, announcements (SSE `achievement`).
// "Milestone earned" is never stored: it is recomputed from the records and the definitions on every change,
// so a threshold changed in engine/achievements/definitions.mjs applies by itself (buff announced, nerf removed).
import fs from 'node:fs';
import path from 'node:path';
import { DASH_DIR } from '../common.mjs';
import { FAMILIES, BONUS, nameOf, descOf, rankView, categoriesView, RANKS } from './achievements/definitions.mjs';
import { compute, isRound } from './achievements/compute.mjs';
import { sessions } from './registry.mjs';
import { broadcastAchievement } from './broadcast.mjs';
import { writeSession } from './board.mjs';

export const PROGRESS_FILE = path.join(DASH_DIR, 'progress.json');

const localDay = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const empty = () => ({
  version: 1, start: new Date().toISOString(), activityXp: 0, dayXp: { date: localDay(), xp: 0 }, records: {},
  announcements: [], seen: [], days: { nights: [], mornings: [], weekends: [], globe: [], streak: null },
  decisions: { recoStreak: 0 }, plan: null, sessionCreated: false,
});

let state = empty(), defs = FAMILIES, last = null, plannedWrite = null;
// Recent announcements, numbered, for the app (it polls instead of listening to the SSE)
const announcementsMem = [];
let announcementNumber = 0;

/** Writes right away (tests, shutdown); otherwise writes are grouped, at most one per second. */
export function writeProgress() {
  clearTimeout(plannedWrite);
  plannedWrite = null;
  fs.mkdirSync(path.dirname(PROGRESS_FILE), { recursive: true });
  fs.writeFileSync(`${PROGRESS_FILE}.tmp`, JSON.stringify(state, null, 2));
  fs.renameSync(`${PROGRESS_FILE}.tmp`, PROGRESS_FILE);
}
function scheduleWrite() {
  if (plannedWrite) return;
  plannedWrite = setTimeout(() => { try { writeProgress(); } catch (e) { console.warn(`progress: ${e.message}`); } }, 1000);
  plannedWrite.unref?.();
}

function announce(ev) {
  const a = { n: ++announcementNumber, ...ev };
  announcementsMem.push(a);
  if (announcementsMem.length > 200) announcementsMem.shift();
  broadcastAchievement(a);
}

/** Recomputes; announces newly earned milestones and the level gained; forgets removed milestones (nerf). */
function recompute() {
  const c = compute(state, defs);
  const fresh = c.earned.filter(o => !state.announcements.includes(o));
  const removed = state.announcements.filter(o => !c.earned.includes(o));
  if (removed.length) {
    state.announcements = state.announcements.filter(o => c.earned.includes(o));
    state.seen = state.seen.filter(o => c.earned.includes(o));
  }
  for (const key of fresh) {
    const [id, i] = key.split(':');
    const f = c.families.find(x => x.id === id), m = f.milestones[Number(i)];
    announce({
      type: 'milestone', family: id, tier: m.tier, number: f.thresholds.length > 1 ? Number(i) + 1 : null, name: nameOf(f), emoji: f.emoji,
      desc: descOf(f), threshold: m.threshold, xp: BONUS[m.tier],
      slug: m.slug, sessionTitle: m.slug ? sessions.get(m.slug)?.data.title || null : null,
    });
    state.announcements.push(key);
  }
  if (last && c.level > last.level) {
    announce({ type: 'level', level: c.level, rank: rankView(c.rank).name, emoji: c.rank.emoji, newRank: c.rank.level > last.rank.level });
  }
  last = c;
  if (fresh.length || removed.length) scheduleWrite();
}

/** Reads progress.json (missing: start from zero; unreadable: set aside as .corrupt) then recomputes. */
export function loadProgress(families = FAMILIES) {
  defs = families;
  last = null;
  state = empty();
  if (fs.existsSync(PROGRESS_FILE)) {
    try {
      const read = JSON.parse(fs.readFileSync(PROGRESS_FILE, 'utf8'));
      state = { ...empty(), ...read, days: { ...empty().days, ...read.days }, decisions: { ...empty().decisions, ...read.decisions } };
    } catch (e) {
      console.warn(`progress.json unreadable (${e.message}): set aside, starting from zero`);
      fs.renameSync(PROGRESS_FILE, `${PROGRESS_FILE}.corrupt`);
    }
  } else scheduleWrite();
  recompute();
  return state;
}

/** "max" record: keeps the highest value, log dated at round values (see isRound). */
export function record(id, value, slug = null) {
  const v = Math.floor(Number(value));
  if (!Number.isFinite(v) || v <= 0) return;
  const r = state.records[id] ||= { value: 0, log: [] };
  if (v <= r.value) return;
  r.value = v;
  const prev = r.log.at(-1);
  r.log.push([v, new Date().toISOString(), slug]);
  // Between two round values, only the latest value is kept: the log stays short
  if (prev && !isRound(prev[0]) && bracket(prev[0]) === bracket(v)) r.log.splice(-2, 1);
  scheduleWrite();
  recompute();
}
/** Highest round value lower than or equal to v. */
function bracket(v) {
  if (v <= 10) return Math.floor(v);
  let e = 1;
  while (v / e >= 100) e *= 10;
  const m = v / e; // between 10 and 100
  return Math.max(...[10, 12, 15, 20, 25, 30, 40, 50, 60, 75].filter(b => b <= m)) * e;
}
/** "total" counter. */
export const add = (id, n = 1, slug = null) => record(id, (state.records[id]?.value || 0) + n, slug);

export function gainXp(n) {
  if (!(n > 0)) return;
  state.activityXp += n;
  const j = localDay();
  if (state.dayXp?.date !== j) state.dayXp = { date: j, xp: 0 };
  state.dayXp.xp += n;
  scheduleWrite();
  recompute();
}

/** Distinct days (nights, mornings, weekends, globe): returns true if `key` is new for this set. */
export function markDay(set, key) {
  const l = state.days[set] ||= [];
  if (l.includes(key)) return false;
  l.push(key);
  if (l.length > 400) l.shift();
  scheduleWrite();
  return true;
}

/** The raw state, for the modules that keep a sub-state in it (decisions, plan, days.streak). Write then `save()`. */
export const achievementState = () => state;
export const save = () => scheduleWrite();

export function markAchievementsSeen() {
  state.seen = [...state.announcements];
  scheduleWrite();
}
export const announcementsSince = n => ({ n: announcementNumber, announcements: announcementsMem.filter(a => a.n > (Number(n) || 0)) });

/** What the page sees: level, XP, families with their milestones; unearned secrets stay hidden. */
export function progressView() {
  const c = last || compute(state, defs);
  const families = c.families.map(f => {
    const earned = f.milestones.some(m => m.earned);
    if (f.secret && !earned) return { id: f.id, cat: f.cat, secret: true, hidden: true, milestones: f.milestones.map(m => ({ tier: m.tier, earned: false })) };
    return {
      id: f.id, cat: f.cat, name: nameOf(f), emoji: f.emoji, desc: descOf(f), measure: f.measure, unit: f.unit || null, secret: !!f.secret,
      value: f.value, milestones: f.milestones, isNew: f.milestones.some((m, i) => m.earned && !state.seen.includes(`${f.id}:${i}`)),
    };
  });
  const total = c.families.reduce((n, f) => n + f.milestones.length, 0);
  return {
    categories: categoriesView(), ranks: RANKS.map(rankView), xp: c.xp, dayXp: state.dayXp?.date === localDay() ? state.dayXp.xp : 0,
    level: c.level, rank: rankView(c.rank), nextRank: rankView(c.nextRank), levelXp: c.levelXp, nextLevelXp: c.nextLevelXp,
    earned: c.earned.length, total, newCount: c.earned.filter(o => !state.seen.includes(o)).length, families,
  };
}

/**
 * Callback given to a session's driver (ctx.achievements): records and XP, plus its own counters in
 * `data.stats.achievements` (reset by /clear with the rest of the counters).
 */
export function sessionAchievements(slug) {
  const stats = () => {
    const d = sessions.get(slug)?.data;
    if (!d) return null;
    d.stats ||= {};
    return (d.stats.achievements ||= {});
  };
  let sessionWrite = null;
  const writeSoon = () => {
    if (sessionWrite) return;
    sessionWrite = setTimeout(() => {
      sessionWrite = null;
      try { if (sessions.has(slug)) writeSession(slug); } catch (e) { console.warn(`stats of ${slug}: ${e.message}`); }
    }, 2000);
    sessionWrite.unref?.();
  };
  return {
    record: (id, v) => record(id, v, slug),
    add: (id, n = 1) => add(id, n, slug),
    xp: n => gainXp(n),
    /** Adds `delta` to the session counter and returns its new value. */
    stat(key, delta = 1) { const st = stats(); if (!st) return 0; st[key] = (st[key] || 0) + delta; writeSoon(); return st[key]; },
    set(key, v) { const st = stats(); if (st) { st[key] = v; writeSoon(); } },
    get: key => stats()?.[key],
  };
}
