// Fields a session may set through its update_board tool (Tracker panel, header). Pure, tested in
// tests/board-fields.test.mjs.

/**
 * Keys the engine owns: identity of the session (folder, Claude conversation, permission mode), counters, what the
 * developer chose (pinned title, profile preview). Set through update_board, they would let a session in "ask" mode
 * change its own mode or folder at its next resume, or fake its counters: ignored.
 */
export const ENGINE_KEYS = new Set(['slug', 'cwd', 'project', 'mode', 'prePlanMode', 'autoMode', 'sessionId', 'driven', 'model', 'stats', 'seen',
  'updatedAt', 'endedAt', 'archivedAt', 'titlePinned', 'autoTitle', 'trackerPreview', 'reportedSchemas', 'tracker',
  'paused', 'stopped', 'busy', 'activity', 'receivedAt', '__proto__', 'constructor', 'prototype']);

/** http(s) URL, or null: a link of the panel never gets another scheme (javascript:, file:…). */
const httpUrl = v => (typeof v === 'string' && /^https?:\/\/\S+$/i.test(v.trim()) ? v.trim() : null);

/**
 * Fields of update_board that may be merged: without the engine's keys, `ticketUrl` only as an http(s) URL (or null to
 * clear it). Returns `{ fields, ignored }` (`ignored`: the keys left out, told to Claude).
 */
export function boardFields(input) {
  const fields = {}, ignored = [];
  if (!input || typeof input !== 'object' || Array.isArray(input)) return { fields, ignored };
  for (const [k, v] of Object.entries(input)) {
    if (ENGINE_KEYS.has(k)) { ignored.push(k); continue; }
    if (k === 'ticketUrl' && v !== null && !httpUrl(v)) { ignored.push(k); continue; }
    fields[k] = k === 'ticketUrl' && v !== null ? httpUrl(v) : v;
  }
  return { fields, ignored };
}
