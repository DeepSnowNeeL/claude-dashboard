// State of a session on disk (sessions/<slug>.json): writing, counters, merge of the Tracker panel fields.
import { t } from '../public/i18n/index.js';
import fs from 'node:fs';
import path from 'node:path';
import { DASH_DIR } from '../common.mjs';
import { sessions } from './registry.mjs';
import { broadcast } from './broadcast.mjs';
import { onMockups, recordParallel } from './achievement-counters.mjs';

export const SESSIONS_DIR = path.join(DASH_DIR, 'sessions');

export function writeSession(slug) {
  fs.mkdirSync(SESSIONS_DIR, { recursive: true });
  fs.writeFileSync(path.join(SESSIONS_DIR, `${slug}.json`), JSON.stringify(sessions.get(slug).data, null, 2));
}

/**
 * Adds to the session counters (Claude's time, exchanges, developer's active time, new items: what counts for the
 * "unread" of the list), without touching `updatedAt`.
 * `context` (tokens of the last call) and `window` (size of the model window) are replaced, not added.
 * Active time arrives every few seconds: it does not trigger a refresh of the pages.
 */
export function count(slug, delta, notify = true) {
  const s = sessions.get(slug);
  if (!s) return;
  const st = { claudeMs: 0, exchanges: 0, activeMs: 0, newItems: 0, ...s.data.stats };
  for (const [k, v] of Object.entries(delta)) {
    // Context size and model window: the latest value replaces the previous one
    if (k === 'context' || k === 'window') { if (Number.isFinite(v) && v > 0) st[k] = v; }
    else if (k in st && Number.isFinite(v) && v > 0) st[k] += v;
  }
  s.data.stats = st;
  writeSession(slug);
  if (notify) broadcast(slug);
}

/**
 * The developer looked at the session: its new items are read. `id` = last feed event at that moment, where the
 * page will place the "new since your last visit" separator next time. Returns false if nothing was unread.
 */
export function markSeen(slug, id) {
  const s = sessions.get(slug);
  const n = s?.data.stats?.newItems || 0;
  if (!s || (s.data.seen?.n || 0) === n) return false;
  s.data.seen = { n, ...(id ? { id } : {}) };
  writeSession(slug);
  broadcast(slug);
  return true;
}

/** Merges fields into the state of a session (null clears), writes it to disk and notifies the page. */
export function updateBoard(slug, fields) {
  const s = sessions.get(slug);
  if (!s) return;
  for (const [k, v] of Object.entries(fields || {})) {
    if (k === 'slug') continue;
    // Renamed by hand: the title no longer moves, the one Claude proposes is kept for a return to the automatic name
    if (k === 'title' && s.data.titlePinned) { s.data.autoTitle = v; continue; }
    if (v === null) delete s.data[k]; else s.data[k] = v;
  }
  s.data.updatedAt = new Date().toISOString();
  writeSession(slug);
  broadcast(slug);
  // Achievements: mockup versions, sessions working or waiting at the same time
  if (fields?.mockups) onMockups(slug, fields.mockups);
  if (fields && 'status' in fields) recordParallel();
}

// What /clear keeps: the technical identity of the session (folder, mode, Claude conversation, profile in preview) and
// a title chosen by hand; everything else (Tracker panel, automatic title, ticket, description, step, counters)
// starts from zero, like a new session.
const KEPT_ON_CLEAR = ['slug', 'cwd', 'project', 'mode', 'status', 'driven', 'sessionId', 'model', 'trackerPreview', 'titlePinned'];

/** /clear: empties the Tracker panel and the header of the session, writes it to disk and notifies the page. */
export function clearBoard(slug) {
  const s = sessions.get(slug);
  if (!s) return;
  const d = s.data; // emptied in place: other modules keep a reference to this object
  const title = d.titlePinned ? d.title : t('engine.newSessionTitle');
  for (const k of Object.keys(d)) if (!KEPT_ON_CLEAR.includes(k)) delete d[k];
  Object.assign(d, { title, step: 'framing', updatedAt: new Date().toISOString() });
  writeSession(slug);
  broadcast(slug);
}
