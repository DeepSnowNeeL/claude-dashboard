// Achievements counted by the engine (what a session's driver does not see): developer messages and their
// origin, cards, session creations, interruptions, sessions in parallel, unread items, mockups.
import { record, add, gainXp, markDay, achievementState, save, sessionAchievements } from './progress.mjs';
import { analyzeMessage, momentOf } from './achievements/message.mjs';
import { XP } from './achievements/definitions.mjs';
import { sessions, drivers } from './registry.mjs';

/** Origin of a request relayed by the page (x-dash-origin header): 'pc', 'wifi' or 'internet'. */
export const originOf = req => (['wifi', 'internet'].includes(req.headers['x-dash-origin']) ? req.headers['x-dash-origin'] : 'pc');

const DAY_MS = 864e5;

/** Message sent by the developer from the page (not a message from another session). */
export function onDevMessage(slug, text, origin = 'pc', { devTurn = true } = {}) {
  const data = sessions.get(slug)?.data, p = drivers.get(slug), ach = sessionAchievements(slug);
  const now = new Date(), e = achievementState();
  gainXp(XP.message);

  const a = analyzeMessage(text, data?.decisions);
  if (a.short) add('go', 1, slug);
  if (a.thanks) add('polite', 1, slug);
  if (a.perfect) add('perfection', 1, slug);
  if (a.huh) record('huh', 1, slug);
  if (a.allCaps) record('outburst', 1, slug);
  for (const l of a.lines) {
    gainXp(XP.decisionLine);
    if (l.explain) { add('teacher', 1, slug); continue; }
    add('decider', 1, slug);
    if (l.follows) record('eyes-closed', ++e.decisions.recoStreak, slug);
    else { e.decisions.recoStreak = 0; add('rebel', 1, slug); }
    save();
  }

  // Rhythm (local time)
  const m = momentOf(now);
  if (m.night && markDay('nights', m.night)) add('night-owl', 1, slug);
  if (m.morning && markDay('mornings', m.morning)) add('early-bird', 1, slug);
  if (m.weekend) {
    markDay('weekends', `${m.weekend.key}:${m.weekend.day}`);
    const w = e.days.weekends;
    if (w.includes(`${m.weekend.key}:sat`) && w.includes(`${m.weekend.key}:sun`) && markDay('weekends', `${m.weekend.key}:ok`)) add('no-weekend', 1, slug);
  }
  if (m.holiday) record('holiday', 1, slug);
  const streak = e.days.streak;
  if (streak?.last !== m.day) {
    e.days.streak = { last: m.day, n: streak?.last === m.eve ? streak.n + 1 : 1 };
    record('streak', e.days.streak.n, slug);
    save();
  }

  // Reflex: less than 30 s after the end of Claude's turn (once per turn end)
  if (p?.turnEndedAt && !p.busy && now - p.turnEndedAt < 30_000) add('reflex', 1, slug);
  if (p) p.turnEndedAt = null;

  // Fossil, Marathon: timestamps of the conversation itself (data.updatedAt moves for everything)
  const lastExchange = ach.get('lastExchange'), start = ach.get('start');
  if (lastExchange) record('fossil', (now - Date.parse(lastExchange)) / DAY_MS, slug);
  if (start) record('marathon', (now - Date.parse(start)) / DAY_MS, slug);
  else ach.set('start', now.toISOString());
  ach.set('lastExchange', now.toISOString());

  onOrigin(slug, origin);
  if (p && devTurn && !String(text).trim().startsWith('!')) p.devTurn = true; // the next turn is not "autonomous" ("!" does not start a turn)
}

/** Answer to a card (question, permission): from the phone, it counts for Remote pilot. */
export function onOrigin(slug, origin) {
  if (origin === 'pc') return;
  add('remote-pilot', 1, slug);
  if (origin === 'internet' && markDay('globe', momentOf().day)) add('globetrotter', 1, slug);
}

/** Session created from the page (with or without a first message). */
export function onCreate(slug, origin, text) {
  gainXp(XP.launch);
  const e = achievementState();
  if (!e.sessionCreated) { e.sessionCreated = true; save(); record('first-flight', 1, slug); }
  if (origin !== 'pc') add('couch', 1, slug);
  if (text) onDevMessage(slug, text, origin, { devTurn: false }); // its first turn has already left, already marked
}

/** A session launches another one (launch_session). */
export function onLaunch(parent) {
  gainXp(XP.launch);
  record('conductor', sessionAchievements(parent).stat('launched'), parent);
}

export const onInterrupt = slug => add('red-button', 1, slug);
/** `type`: 'created' or 'removed'. */
export const onWorktree = (type, slug = null) => add(type === 'removed' ? 'lumberjack' : 'arborist', 1, slug);

/** After a "seen": if nothing is unread any more, the number of open sessions counts for Inbox zero. */
export function onSeen(unreadTotal) {
  if (unreadTotal > 0) return;
  record('inbox-zero', [...sessions.values()].filter(v => v.data.status !== 'done').length);
}

/** Sessions working, and waiting for you (last turn within the hour or blocked on a card), at the same time. */
export function recordParallel() {
  const alive = [...drivers.entries()].filter(([, p]) => !p.closed && !p.dead);
  record('juggler', alive.filter(([, p]) => p.busy).length);
  const hourAgo = Date.now() - 3600_000;
  // Blocked on a card: its turn is still running (busy), it counts anyway
  record('traffic-jam', alive.filter(([slug, p]) => p.blocked?.()
    || (!p.busy && sessions.get(slug)?.data.status === 'waiting' && (p.lastTurnAt || 0) > hourAgo)).length);
}

/** Tracker panel mockups: the highest version counts for Perfectionist. */
export function onMockups(slug, mockups) {
  if (!Array.isArray(mockups)) return;
  for (const m of mockups) record('perfectionist', 1 + (Array.isArray(m?.versions) ? m.versions.length : 0), slug);
}
