// Driven sessions: creation, resume, end, callbacks given to driver.mjs, summary for the list, work in progress.
import path from 'node:path';
import { createSession, feedFromHistory } from '../driver.mjs';
import { norm } from '../common.mjs';
import { t } from '../public/i18n/index.js';
import { tree, readGroups } from '../projects.mjs';
import { sessions, drivers } from './registry.mjs';
import { broadcast, broadcastFeed } from './broadcast.mjs';
import { updateBoard, count, clearBoard } from './board.mjs';
import { sessionAchievements } from './progress.mjs';
import { onRateLimit } from './plan-achievements.mjs';
import { onLaunch, recordParallel } from './achievement-counters.mjs';

export { sessions, drivers };

/** Driven session whose engine restarted: its JSON keeps the Claude session_id, it is resumed on demand. */
// Without sessionId: session created empty (▶ New session) before a restart; its first message starts a new
// conversation instead of resuming one
export const resumable = data => !!(data?.driven && data.cwd);

const callbacks = slug => ({
  updateBoard: fields => updateBoard(slug, fields), emit: ev => broadcastFeed(slug, ev),
  count: d => count(slug, d), notifyChange: () => broadcast(slug), clearBoard: () => clearBoard(slug),
  // Claude process stopped by itself (crash, conversation held elsewhere): forgotten, the next message restarts it
  onStopped: () => { if (drivers.get(slug)?.dead) { drivers.delete(slug); broadcast(slug); } },
  // Levels and achievements: records, XP and the session's own counters (data.stats.achievements)
  achievements: { ...sessionAchievements(slug), plan: onRateLimit, parallel: recordParallel },
  // Tools launch_session, list_sessions, message_session: a session acts on the others
  launch: async ({ cwd, text, mode }) => { const created = newSession(cwd, text, mode); onLaunch(slug); return created; },
  // Displayed title (the one set by the developer if they renamed it), project, worktree and group as in the tree
  list: async () => {
    const list = [...sessions].map(([s, v]) => summarize(s, v));
    const projects = await tree(list.map(x => x.cwd)).catch(() => []);
    const groups = readGroups();
    return list.map(({ slug, title, ticket, description, step, status, statusSummary, cwd, busy }) => {
      const project = projects.find(p => p.worktrees.some(w => norm(w.path) === norm(cwd || '')));
      const worktree = project?.worktrees.find(w => norm(w.path) === norm(cwd || ''));
      return {
        slug, title, ticket, description, step, status, statusSummary, busy, cwd,
        project: project?.name || null, branch: worktree?.branch || null, mainWorktree: worktree ? worktree.main : null,
        group: (project && groups.find(g => g.projects.includes(project.id))?.name) || null,
      };
    });
  },
  // Answers go to Claude (MCP tool results): English
  end: async target => (target === slug ? 'A session cannot end itself' : !sessions.has(target) ? `Unknown session: ${target}` : endSession(target)),
  write: async (target, text) => {
    if (!sessions.has(target)) return `Unknown session: ${target}`;
    if (!drivers.has(target) && !resumable(sessions.get(target).data)) return `${target} is not driven by the page`;
    // Envelope recognised by the page ("message from another session" card, link to the sender)
    const from = sessions.get(slug)?.data.title || slug;
    (await resume(target)).send(`<session-message from="${slug}" title="${String(from).replace(/"/g, "'")}">\n${text}\n</session-message>`, 'end');
    return null;
  },
});

/**
 * End a session (End button, end_session tool): its Claude process stops, it moves to "done" and stays
 * viewable; a message resumes it. Returns null, or the error.
 */
export async function endSession(slug) {
  if (!sessions.has(slug)) return t('engine.errors.unknownSessionSlug', { slug });
  const s = drivers.get(slug);
  drivers.delete(slug);
  await s?.close();
  updateBoard(slug, { status: 'done', statusSummary: t('engine.status.ended'), endedAt: new Date().toISOString() });
  return null;
}

/** New driven session in `cwd`, with its first message. Returns its slug. */
export function newSession(cwd, text, mode = 'all') {
  const slug = `n-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 4)}`;
  const empty = !String(text || '').trim(); // created with one click ("+" of a worktree): it waits for its first message
  const data = { slug, title: t('engine.newSessionTitle'), description: String(text || '').slice(0, 140), project: path.basename(cwd), cwd, mode, status: empty ? 'waiting' : 'working', ...(empty ? { statusSummary: t('engine.status.ready') } : {}), step: 'framing', driven: true };
  sessions.set(slug, { data, receivedAt: new Date().toISOString() });
  const s = createSession({ slug, cwd, mode, ...callbacks(slug) });
  drivers.set(slug, s);
  s.devTurn = true; // the first turn is not "autonomous"
  if (!empty) s.send(String(text));
  else updateBoard(slug, {}); // writes its JSON right away (otherwise nothing on disk before the first message)
  broadcast('*'); // the list and the tree of the pages (new worktree included)
  return slug;
}

/** Restarts the query of a resumable session, with the feed rebuilt from its history. */
export async function resume(slug) {
  if (drivers.has(slug)) return drivers.get(slug);
  const { data } = sessions.get(slug);
  const initialFeed = data.sessionId ? await feedFromHistory(slug, data.sessionId, data.cwd) : [];
  if (drivers.has(slug)) return drivers.get(slug); // concurrent resume while reading the history
  const s = createSession({ slug, cwd: data.cwd, mode: data.mode || 'all', resume: data.sessionId, initialFeed, ...callbacks(slug) });
  drivers.set(slug, s);
  // Session from before the counters: exchanges are found in the history, not Claude's time.
  if (!data.stats) count(slug, { exchanges: initialFeed.filter(ev => ev.t === 'user').length });
  return s;
}

export function summarize(slug, { data, receivedAt }) {
  const { title, ticket, description, status, step, statusSummary, project, cwd, sessionId } = data;
  const p = drivers.get(slug);
  return {
    slug, title, ticket, description, status, step, statusSummary, project, cwd, sessionId, updatedAt: data.updatedAt || receivedAt,
    driven: !!p || resumable(data), busy: !!p?.busy, runningAgents: p?.runningAgents() || 0, runningShells: p?.runningShells?.() || 0,
    blocked: p?.blocked?.() || null,
    // New items (Claude's text, agent or shell done, error) since the developer looked at the session
    unread: Math.max(0, (data.stats?.newItems || 0) - (data.seen?.n || 0)),
  };
}

/** What an engine restart would cut: running turns, subagents, background shells, "!" commands. */
export function workInProgress() {
  return [...drivers].flatMap(([slug, p]) => {
    const what = [
      p.busy && t('engine.work.turn'),
      p.runningAgents() && t('engine.work.agents', { n: p.runningAgents() }),
      p.runningShells?.() && t('engine.work.shells', { n: p.runningShells() }),
      p.commandRunning?.() && t('engine.work.command'),
    ].filter(Boolean);
    return what.length ? [{ slug, title: sessions.get(slug)?.data.title, what }] : [];
  });
}
