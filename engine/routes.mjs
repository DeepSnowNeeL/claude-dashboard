// Engine routes (port 4748, local): table 'METHOD /path' → handler(req, res, { p, url, params }),
// dispatched by server/router.mjs. The ':slug' and ':key' segments arrive raw: validated here as the former
// regular expressions did (slug in lowercase, digits and dashes; agent or shell key without spaces).
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { feedFromHistory, agentFeedFromHistory, MODES, FILES_DIR, attachmentUrl } from '../driver.mjs';
import { sendJson, readBody, readBinary, serveFile, applyLanguage } from '../common.mjs';
import { t, LANGUAGES } from '../public/i18n/index.js';
import * as trackers from '../trackers.mjs';
import { sessions, drivers, resumable, newSession, resume, endSession, summarize, workInProgress } from './sessions.mjs';
import { sseClients, broadcast, broadcastRestarting } from './broadcast.mjs';
import { SESSIONS_DIR, updateBoard, count, markSeen } from './board.mjs';
import { ARCHIVE_DIR, readOptions, OPTIONS_FILE, archiveSession, archiveOf, autoArchive } from './archives.mjs';
import { isAllowed } from './guard.mjs';
import { isSensitive } from '../server/sensitive.mjs';
import { createWorktree } from '../projects.mjs';
import { progressView, markAchievementsSeen, announcementsSince } from './progress.mjs';
import { originOf, onDevMessage, onOrigin, onCreate, onInterrupt, onWorktree, onSeen } from './achievement-counters.mjs';
import { subscriptionUsage } from '../driver.mjs';

let deferredStop = null;

const SLUG = /^[a-z0-9-]+$/;
const KEY = /^[A-Za-z0-9_-]+$/;
const notFound = res => { res.writeHead(404); res.end(); };
/** Wraps a handler: invalid slug (and agent or shell key), like a path that did not match. */
const valid = g => (req, res, c) => (SLUG.test(c.params.slug) && (c.params.key === undefined || KEY.test(c.params.key)) ? g(req, res, c) : notFound(res));
const err = (key, params) => ({ error: t(`engine.errors.${key}`, params) });

// Resume a past session (launched from the terminal or from before): it enters the dashboard, driven by the page
async function resumeSession(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, err('invalidJsonDetail', { message: e.message })); }
  const { sessionId, cwd } = body;
  if (!sessionId || !cwd || !fs.existsSync(cwd)) return sendJson(res, 400, err('sessionIdCwdRequired'));
  const already = [...sessions].find(([, v]) => v.data.sessionId === sessionId);
  if (already) return sendJson(res, 200, { slug: already[0] });
  // Archived conversation: it comes back with its panel (decisions, architecture, copied mockups…)
  const archived = archiveOf(sessionId);
  if (archived) {
    const { archivedAt, ...data } = archived;
    Object.assign(data, { cwd, status: 'waiting', statusSummary: t('engine.status.resumed'), driven: true });
    delete data.endedAt;
    sessions.set(data.slug, { data, receivedAt: new Date().toISOString() });
    updateBoard(data.slug, {});
    fs.rmSync(path.join(ARCHIVE_DIR, `${data.slug}.json`), { force: true });
    await resume(data.slug);
    return sendJson(res, 200, { slug: data.slug });
  }
  const slug = `n-${Date.now().toString(36)}`;
  const data = {
    slug, title: String(body.title || t('engine.resumedSessionTitle')).slice(0, 80), description: String(body.firstPrompt || '').slice(0, 140),
    project: path.basename(cwd), cwd, mode: 'all', status: 'waiting', step: 'framing', driven: true, sessionId,
  };
  sessions.set(slug, { data, receivedAt: new Date().toISOString() });
  updateBoard(slug, {}); // writes the JSON
  await resume(slug);
  return sendJson(res, 200, { slug });
}

// Creation of a driven session: { cwd, text, mode }
async function create(req, res) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, err('invalidJsonDetail', { message: e.message })); }
  let cwd = String(body.cwd || '').trim();
  if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) return sendJson(res, 400, err('folderNotFound', { path: cwd }));
  // "In a new worktree" ticked: it is created next to the repo and the session opens in it
  if (body.branch) {
    try { cwd = await createWorktree(cwd, body.branch); } catch (e) { return sendJson(res, 400, err('worktreeNotCreated', { message: e.message })); }
    onWorktree('created');
  }
  // Without text: the session is created empty, ready, and the first message is typed in its own input
  const text = String(body.text || '').trim();
  const slug = newSession(cwd, text, MODES[body.mode] ? body.mode : 'all');
  onCreate(slug, originOf(req), text);
  return sendJson(res, 200, { slug });
}

// Developer's active time on the session (tab in the foreground and recent activity), sent by the page
async function active(req, res, { params }) {
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, err('invalidJson')); }
  count(params.slug, { activeMs: Math.min(Number(body.ms) || 0, 120_000) }, false);
  return sendJson(res, 200, { ok: true });
}

// The page shows the session in the foreground: its new items are read ("unread" of the list, app icon)
async function seen(req, res, { params: { slug } }) {
  const feed = drivers.get(slug)?.feed;
  markSeen(slug, feed?.length ? feed[feed.length - 1].id : null);
  onSeen([...sessions].reduce((n, [s, v]) => n + summarize(s, v).unread, 0));
  return sendJson(res, 200, { ok: true });
}

// Attachments: the page sends the raw file (?name=&type=), the engine saves it and returns its path;
// GET reads it back to show it in the feed.
async function files(req, res, { url, params }) {
  const { slug, name: fileName } = params;
  const dir = path.join(FILES_DIR, slug);
  if (req.method === 'GET' && fileName) {
    const name = decodeURIComponent(fileName);
    if (name.includes('/') || name.includes('\\') || name.startsWith('.')) { res.writeHead(403); res.end(); return; }
    return serveFile(res, path.join(dir, name), { sandboxed: true });
  }
  if (req.method !== 'POST' || !sessions.has(slug)) { res.writeHead(404); res.end(); return; }
  let content;
  try { content = await readBinary(req); } catch (e) { return sendJson(res, 413, { error: e.message }); }
  const name = (url.searchParams.get('name') || 'file').replace(/[\\/:*?"<>|]+/g, '_').slice(0, 120);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${Date.now()}-${name}`);
  fs.writeFileSync(file, content);
  return sendJson(res, 200, { name, type: url.searchParams.get('type') || '', path: file, url: attachmentUrl(slug, file) });
}

// Subagents of a driven session: their conversation, and stopping an agent
const agent = action => async (req, res, { params: { slug, key } }) => {
  const s = drivers.get(slug);
  if (action === 'feed') {
    const data = sessions.get(slug)?.data;
    const f = s ? s.agentFeed(key) : resumable(data) && data.sessionId ? await agentFeedFromHistory(slug, data.sessionId, key) : null;
    return f ? sendJson(res, 200, f) : sendJson(res, 404, err('unknownSubagent'));
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  return (await s?.stopAgent(key)) ? sendJson(res, 200, { ok: true }) : sendJson(res, 409, err('agentGone'));
};
// Background shells of a driven session: their output (end of the file), and stopping them
const shell = action => async (req, res, { params: { slug, key } }) => {
  const s = drivers.get(slug);
  if (action === 'output') {
    const r = s?.shellOutput(key);
    return r ? sendJson(res, 200, r) : sendJson(res, 404, err('unknownShell'));
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  return (await s?.stopShell(key)) ? sendJson(res, 200, { ok: true }) : sendJson(res, 409, err('shellGone'));
};

// "/" commands and skills of a session (autocompletion); a paused session is resumed to know them
async function commands(req, res, { params: { slug } }) {
  const data = sessions.get(slug)?.data;
  if (!drivers.has(slug) && !resumable(data)) return sendJson(res, 200, []);
  try { return sendJson(res, 200, await (await resume(slug)).commands()); } catch (e) { return sendJson(res, 200, []); }
}
// /usage and /context of the CLI for a session (/usage window); a paused session is resumed to know them
async function usageCli(req, res, { params: { slug } }) {
  const data = sessions.get(slug)?.data;
  if (!drivers.has(slug) && !resumable(data)) return sendJson(res, 404, err('notDriven'));
  try { return sendJson(res, 200, await (await resume(slug)).usageCli()); } catch (e) { return sendJson(res, 500, { error: e.message }); }
}
// MCP servers of a session (/mcp in the page): list, then { name } to reconnect, { name, active } to toggle
const mcp = action => async (req, res, { params: { slug } }) => {
  const data = sessions.get(slug)?.data;
  if (!drivers.has(slug) && !resumable(data)) return sendJson(res, 404, err('notDriven'));
  try {
    const s = await resume(slug);
    if (!action) return sendJson(res, 200, await s.mcp());
    const body = JSON.parse((await readBody(req)) || '{}');
    if (!body.name) return sendJson(res, 400, err('serverNameMissing'));
    if (action === 'reconnect') await s.mcpReconnect(body.name); else await s.mcpToggle(body.name, body.active);
    return sendJson(res, 200, await s.mcp());
  } catch (e) { return sendJson(res, 500, { error: e.message }); }
};

// Queued messages handed back to the page to be edited again (up arrow)
async function recallQueue(req, res, { params: { slug } }) {
  const s = drivers.get(slug);
  return sendJson(res, 200, { messages: s ? s.recallQueue() : [] });
}
// Queued messages sent right away ({ when: 'now' }) or by stopping the turn ({ when: 'stop' })
async function pushQueue(req, res, { params: { slug } }) {
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch { return sendJson(res, 400, err('invalidJson')); }
  const s = drivers.get(slug);
  const busy = !!s?.busy;
  const ok = s?.pushQueue(body.when === 'stop' ? 'stop' : 'now');
  if (ok && body.when === 'stop' && busy) onInterrupt(slug);
  return ok ? sendJson(res, 200, { ok: true }) : sendJson(res, 409, err('queueEmpty'));
}

// Mermaid schema the page could not draw: { key, source, error }. Reported once per version of the schema
// (fingerprint kept in the JSON: a reload or another page does not send it again); ignored without an active session.
async function schemaError(req, res, { params: { slug } }) {
  const s = sessions.get(slug), p = drivers.get(slug);
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, err('invalidJson')); }
  const key = String(body.key || '').slice(0, 60);
  if (!s || !p || !key || s.data.status === 'done') return sendJson(res, 200, { reported: false });
  const fingerprint = createHash('sha1').update(String(body.source || '')).digest('hex').slice(0, 12);
  if (s.data.reportedSchemas?.[key] === fingerprint) return sendJson(res, 200, { reported: false });
  if (!p.reportSchema(key, body.error || 'unknown error')) return sendJson(res, 200, { reported: false });
  s.data.reportedSchemas = { ...s.data.reportedSchemas, [key]: fingerprint };
  updateBoard(slug, {});
  return sendJson(res, 200, { reported: true });
}

// Rename: { title } pins the name (Claude no longer changes it); an empty title restores the automatic name
async function rename(req, res, { params: { slug } }) {
  const s = sessions.get(slug);
  if (!s) return sendJson(res, 404, err('unknownSession'));
  let body;
  try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, err('invalidJson')); }
  const title = String(body.title || '').trim().slice(0, 80);
  if (title) {
    if (!s.data.titlePinned) s.data.autoTitle = s.data.title;
    s.data.title = title;
    s.data.titlePinned = true;
  } else {
    s.data.title = s.data.autoTitle || s.data.title;
    delete s.data.titlePinned;
    delete s.data.autoTitle;
  }
  updateBoard(slug, {}); // writes and notifies the pages
  return sendJson(res, 200, { ok: true });
}

// Conversation held by a Claude Code in the background: `claude stop <id>` releases it, the page can resume it
async function release(req, res) {
  let body = {};
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch {}
  const id = String(body.id || '');
  if (!/^[\w-]{4,64}$/.test(id)) return sendJson(res, 400, err('invalidId'));
  const claude = [path.join(os.homedir(), '.local', 'bin', 'claude.exe'), path.join(os.homedir(), '.local', 'bin', 'claude')].find(f => fs.existsSync(f)) || 'claude';
  const r = await new Promise(ok => execFile(claude, ['stop', id], { windowsHide: true, timeout: 30_000 }, (e, stdout, stderr) => ok({ e, text: `${stdout || ''}${stderr || ''}`.trim() })));
  return r.e ? sendJson(res, 500, { error: r.text || r.e.message }) : sendJson(res, 200, { ok: true, text: r.text });
}
// End: the Claude process stops, the session moves to "done" and stays viewable; a new message
// resumes it (same history). The displayed feed is kept as is until the resume.
async function end(req, res, { params: { slug } }) {
  const error = await endSession(slug);
  return error ? sendJson(res, 404, { error }) : sendJson(res, 200, { ok: true });
}
async function archive(req, res, { params: { slug } }) {
  const error = await archiveSession(slug);
  return error ? sendJson(res, 404, { error }) : sendJson(res, 200, { ok: true });
}
// App settings (Options window): { archiveAfterDays, autoCompact, language }
async function options(req, res) {
  if (req.method === 'POST') {
    let body;
    try { body = JSON.parse(await readBody(req)); } catch { return sendJson(res, 400, err('invalidJson')); }
    const options = readOptions();
    if ('archiveAfterDays' in body) options.archiveAfterDays = Math.max(0, Math.min(365, Number(body.archiveAfterDays) || 0));
    if ('autoCompact' in body) options.autoCompact = ['default', 'off'].includes(body.autoCompact) ? body.autoCompact : Math.max(100000, Math.min(1000000, Number(body.autoCompact) || 0)) || 'default';
    if ('language' in body) options.language = ['auto', ...LANGUAGES].includes(body.language) ? body.language : 'auto';
    fs.mkdirSync(path.dirname(OPTIONS_FILE), { recursive: true });
    fs.writeFileSync(OPTIONS_FILE, JSON.stringify(options, null, 2));
    applyLanguage();
    autoArchive();
    return sendJson(res, 200, options);
  }
  return sendJson(res, 200, readOptions());
}

// Actions on a driven session
const action = name => async (req, res, { params: { slug } }) => {
  const data = sessions.get(slug)?.data;
  if (name === 'feed') {
    if (drivers.has(slug)) return sendJson(res, 200, drivers.get(slug).feed);
    return sendJson(res, 200, resumable(data) && data.sessionId ? await feedFromHistory(slug, data.sessionId, data.cwd) : []);
  }
  if (req.method !== 'POST') { res.writeHead(405); res.end(); return; }
  if (!drivers.has(slug) && !resumable(data)) return sendJson(res, 409, err('cannotResume'));
  const s = await resume(slug);
  let body;
  try { body = JSON.parse((await readBody(req)) || '{}'); } catch (e) { return sendJson(res, 400, err('invalidJsonDetail', { message: e.message })); }
  if (name === 'message') {
    // Attachments: only files saved by /files for this session
    const attachments = (Array.isArray(body.attachments) ? body.attachments : [])
      .filter(x => x?.path && attachmentUrl(slug, x.path) && fs.existsSync(x.path))
      .map(x => ({ name: String(x.name || path.basename(x.path)), type: String(x.type || ''), path: path.resolve(x.path), url: attachmentUrl(slug, x.path) }));
    const text = String(body.text || '').trim();
    if (!text && !attachments.length) return sendJson(res, 400, err('emptyMessage'));
    onDevMessage(slug, text, originOf(req));
    if (body.when === 'stop' && s.busy && !text.startsWith('!')) onInterrupt(slug);
    if (text.startsWith('!') && !attachments.length) s.runCommand(text.slice(1).trim()); // as in the terminal: run right away
    else s.send(text, ['end', 'stop'].includes(body.when) ? body.when : 'now', attachments);
  } else if (name === 'message-agent') {
    const text = String(body.text || '').trim();
    if (!text) return sendJson(res, 400, err('emptyMessage'));
    const error = await s.sendToAgent(String(body.key || ''), text);
    if (error) return sendJson(res, 409, { error });
  } else if (name === 'withdraw') {
    if (!s.withdraw(body.id)) return sendJson(res, 404, err('messageGone'));
  } else if (name === 'answer') {
    if (!s.answer(body.id, body.answer)) return sendJson(res, 404, err('cardGone'));
    onOrigin(slug, originOf(req));
  } else if (name === 'interrupt') { if (!s.stopCommand()) { if (s.busy) onInterrupt(slug); await s.interrupt(); } }
  else if (name === 'mode') await s.setMode(body.mode);
  return sendJson(res, 200, { ok: true });
};

async function session(req, res, { params: { slug } }) {
  const existing = sessions.get(slug);
  if (req.method === 'GET') {
    if (!existing) return sendJson(res, 404, err('unknownSession'));
    const drv = drivers.get(slug);
    const rep = !drv && resumable(existing.data);
    return sendJson(res, 200, {
      ...existing.data, driven: !!drv || rep, paused: rep, stopped: !!existing.data.driven && !drv && !rep,
      busy: !!drv?.busy, mode: drv?.mode ?? existing.data.mode, activity: drv?.activity || null,
      // Tracker profile that applies (the /tracker preview comes first): the panel draws it as is
      tracker: existing.data.trackerPreview ? { profile: trackers.localizeProfile(existing.data.trackerPreview), source: 'preview' } : trackers.profileOf(existing.data.cwd),
    });
  }

  // Terminal sessions (tableau-de-bord skill, dash.mjs push / status)
  if (req.method === 'POST') {
    let data;
    try { data = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, err('invalidJsonDetail', { message: e.message })); }
    if (data.slug !== slug) return sendJson(res, 400, err('slugMismatch', { json: data.slug, url: slug }));
    if (!data.title || !data.step) return sendJson(res, 400, err('titleStepRequired'));
    sessions.set(slug, { data, receivedAt: new Date().toISOString() });
    broadcast(slug);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'PATCH') {
    if (!existing) return sendJson(res, 404, err('unknownSessionPush'));
    let patch;
    try { patch = JSON.parse(await readBody(req)); } catch (e) { return sendJson(res, 400, err('invalidJsonDetail', { message: e.message })); }
    if (patch.status) existing.data.status = patch.status;
    if (patch.statusSummary !== undefined) existing.data.statusSummary = patch.statusSummary;
    existing.data.updatedAt = new Date().toISOString();
    broadcast(slug);
    return sendJson(res, 200, { ok: true });
  }

  if (req.method === 'DELETE') {
    sessions.delete(slug);
    drivers.get(slug)?.close();
    drivers.delete(slug);
    const f = path.join(SESSIONS_DIR, `${slug}.json`);
    if (fs.existsSync(f)) {
      fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
      fs.renameSync(f, path.join(ARCHIVE_DIR, `${slug}.json`));
    }
    broadcast(slug);
    return sendJson(res, 200, { ok: true });
  }

  notFound(res); // other method: like a path without a route
}

// /f/<slug>/<absolute path>: mockups and their relative resources
async function mockupFile(req, res, { p }) {
  const m = p.match(/^\/f\/([a-z0-9-]+)\/(.+)$/);
  if (!m) return notFound(res);
  const s = sessions.get(m[1]);
  const requested = decodeURIComponent(m[2]);
  // Sensitive file (credentials, keys…): never, even under the repo of a mockup
  const fromPc = req.headers['x-dash-origin'] === 'pc';
  if (!s || requested.split(/[\\/]/).includes('..') || !isAllowed(s.data, requested) || isSensitive(requested, { fromPc })) { res.writeHead(403); res.end(t('engine.errors.forbidden')); return; }
  return serveFile(res, path.resolve(requested), { sandboxed: true });
}

export default {
  'GET /api/ping': async (req, res) => sendJson(res, 200, { ok: true, engine: true }),
  'GET /api/state': async (req, res) => sendJson(res, 200, { running: workInProgress(), drivers: drivers.size }),
  // Engine shutdown (dash.mjs restart-moteur): refused while work is running, unless forced
  'POST /api/engine/stop': async (req, res, { url }) => {
    // Deferred: the engine stops by itself as soon as everything is idle (useful from a driven session, whose
    // own turn would block an immediate stop); the page restarts it right away.
    if (url.searchParams.get('deferred') === '1') {
      clearInterval(deferredStop);
      deferredStop = setInterval(() => { if (!workInProgress().length) { broadcastRestarting(); setTimeout(() => process.exit(0), 100); clearInterval(deferredStop); } }, 2000);
      return sendJson(res, 200, { ok: true, deferred: true, running: workInProgress() });
    }
    const running = workInProgress();
    if (running.length && url.searchParams.get('force') !== '1') return sendJson(res, 409, { ...err('workInProgress'), running });
    sendJson(res, 200, { ok: true });
    broadcastRestarting();
    setTimeout(() => process.exit(0), 100);
  },
  // The page reports a change that is not a session (projects, groups): the pages reload their list.
  'POST /api/signal': async (req, res) => { broadcast('*'); return sendJson(res, 200, { ok: true }); },
  // Subscription usage (bottom of the list): the only probe, here, also feeds the plan achievements
  'GET /api/usage': async (req, res) => sendJson(res, 200, await subscriptionUsage()),
  // Levels and achievements
  'GET /api/progress': async (req, res) => sendJson(res, 200, progressView()),
  'POST /api/progress/seen': async (req, res) => { markAchievementsSeen(); return sendJson(res, 200, { ok: true }); },
  'GET /api/progress/announcements': async (req, res, { url }) => sendJson(res, 200, announcementsSince(url.searchParams.get('since'))),
  // What the page sees and the engine does not (worktree removed from its right-click menu)
  'POST /api/progress/event': async (req, res) => {
    let body = {};
    try { body = JSON.parse((await readBody(req)) || '{}'); } catch {}
    if (body.type === 'worktree-removed') onWorktree('removed');
    return sendJson(res, 200, { ok: true });
  },
  'GET /api/events': async (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
    res.write(': ok\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
  },
  'POST /api/sessions/resume': resumeSession,
  'POST /api/sessions': create,
  'GET /api/sessions': async (req, res) => sendJson(res, 200, [...sessions].map(([s, v]) => summarize(s, v))),
  'POST /api/sessions/:slug/active': valid(active),
  'POST /api/sessions/:slug/seen': valid(seen),
  'POST /api/sessions/:slug/files': valid(files),
  'GET /api/sessions/:slug/files/:name': valid(files),
  'GET /api/sessions/:slug/agents/:key/feed': valid(agent('feed')),
  'POST /api/sessions/:slug/agents/:key/stop': valid(agent('stop')),
  'GET /api/sessions/:slug/shells/:key/output': valid(shell('output')),
  'POST /api/sessions/:slug/shells/:key/stop': valid(shell('stop')),
  'GET /api/sessions/:slug/commands': valid(commands),
  'GET /api/sessions/:slug/usage-cli': valid(usageCli),
  'GET /api/sessions/:slug/mcp': valid(mcp(undefined)),
  'POST /api/sessions/:slug/mcp/reconnect': valid(mcp('reconnect')),
  'POST /api/sessions/:slug/mcp/toggle': valid(mcp('toggle')),
  'POST /api/sessions/:slug/recall-queue': valid(recallQueue),
  'POST /api/sessions/:slug/push-queue': valid(pushQueue),
  'POST /api/sessions/:slug/rename': valid(rename),
  'POST /api/sessions/:slug/schema-error': valid(schemaError),
  'POST /api/sessions/:slug/release': valid(release),
  'POST /api/sessions/:slug/end': valid(end),
  'POST /api/sessions/:slug/archive': valid(archive),
  'GET /api/options': options,
  'POST /api/options': options,
  'GET /api/sessions/:slug/feed': valid(action('feed')),
  'POST /api/sessions/:slug/message': valid(action('message')),
  'POST /api/sessions/:slug/message-agent': valid(action('message-agent')),
  'POST /api/sessions/:slug/withdraw': valid(action('withdraw')),
  'POST /api/sessions/:slug/answer': valid(action('answer')),
  'POST /api/sessions/:slug/interrupt': valid(action('interrupt')),
  'POST /api/sessions/:slug/mode': valid(action('mode')),
  'GET /api/sessions/:slug': valid(session),
  'POST /api/sessions/:slug': valid(session),
  'PATCH /api/sessions/:slug': valid(session),
  'DELETE /api/sessions/:slug': valid(session),
  'GET /f/*': mockupFile,
};
