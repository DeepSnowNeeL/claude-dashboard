// --- Archives: a session leaves the tree, its panel is kept -----------------------------------
// Tied to the sessionId of its Claude conversation: resuming it from the folder history (/api/sessions/resume)
// brings it back with its panel. Its mockups are copied next to it (the worktree may disappear after the merge).
import fs from 'node:fs';
import path from 'node:path';
import { DASH_DIR, norm } from '../common.mjs';
import { t } from '../public/i18n/index.js';
import * as trackers from '../trackers.mjs';
import { sessions, drivers, endSession } from './sessions.mjs';
import { broadcast } from './broadcast.mjs';
import { SESSIONS_DIR } from './board.mjs';
import { isSensitive } from '../server/sensitive.mjs';

/**
 * Folders whose files an archive may copy: the session folder, its git repo and, for a worktree, the main worktree
 * (where mockups often are). Anything else (a path the session put in its panel) stays a mere path, not copied.
 */
function archiveRoots(cwd) {
  if (!cwd) return [];
  const roots = [path.resolve(cwd)];
  for (let d = path.resolve(cwd); ; d = path.dirname(d)) {
    const git = path.join(d, '.git');
    if (fs.existsSync(git)) {
      roots.push(d);
      // Worktree: `.git` is a file "gitdir: <main>/.git/worktrees/<name>"
      try {
        const m = fs.statSync(git).isFile() && fs.readFileSync(git, 'utf8').match(/^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/]/m);
        if (m) roots.push(path.resolve(m[1]));
      } catch { /* unreadable: the repo alone */ }
      break;
    }
    if (path.dirname(d) === d) break;
  }
  return roots.map(norm);
}
const insideOf = (roots, file) => { const c = norm(file); return roots.some(r => c === r || c.startsWith(r + path.sep)); };

export const ARCHIVE_DIR = path.join(SESSIONS_DIR, 'archive');

export const OPTIONS_FILE = path.join(DASH_DIR, 'options.json');
const DEFAULT_OPTIONS = { archiveAfterDays: 1, autoCompact: 'default', language: 'auto' }; // 0: never archive automatically
export function readOptions() {
  try { return { ...DEFAULT_OPTIONS, ...JSON.parse(fs.readFileSync(OPTIONS_FILE, 'utf8')) }; } catch { return { ...DEFAULT_OPTIONS }; }
}

/** Archives a session (ended first if it is running). Returns null, or the error. */
export async function archiveSession(slug) {
  if (!sessions.has(slug)) return t('engine.errors.unknownSessionSlug', { slug });
  if (drivers.has(slug) || sessions.get(slug).data.status !== 'done') await endSession(slug);
  const data = { ...sessions.get(slug).data, archivedAt: new Date().toISOString() };
  const dir = path.join(ARCHIVE_DIR, slug);
  const roots = archiveRoots(data.cwd);
  const copy = file => {
    try {
      if (!file || !fs.existsSync(file) || norm(file).startsWith(norm(dir))) return file;
      // Credentials, keys, or a file outside the session's repo: never copied into the dashboard folder
      if (isSensitive(file, null) || !insideOf(roots, file) || !fs.statSync(file).isFile()) return file;
      fs.mkdirSync(dir, { recursive: true });
      const target = path.join(dir, `${Math.random().toString(36).slice(2, 6)}-${path.basename(file)}`);
      fs.copyFileSync(file, target);
      return target;
    } catch { return file; }
  };
  if (Array.isArray(data.mockups)) {
    data.mockups = data.mockups.map(m => ({
      ...m, path: copy(m.path), ...(Array.isArray(m.versions) ? { versions: m.versions.map(v => ({ ...v, path: copy(v.path) })) } : {}),
    }));
  }
  // Images and files blocks of the tracker profile: their paths are copied too (the worktree may disappear)
  for (const b of trackers.profileOf(data.cwd).profile.blocks.flatMap(b => b.sideBySide || [b])) {
    if (['images', 'files'].includes(b.type) && Array.isArray(data[b.key])) data[b.key] = data[b.key].map(x => (x?.path ? { ...x, path: copy(x.path) } : x));
  }
  fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  fs.writeFileSync(path.join(ARCHIVE_DIR, `${slug}.json`), JSON.stringify(data, null, 2));
  fs.rmSync(path.join(SESSIONS_DIR, `${slug}.json`), { force: true });
  sessions.delete(slug);
  broadcast('*');
  return null;
}

/** Archive found for this Claude conversation (the most recent), or null. */
export function archiveOf(sessionId) {
  if (!sessionId || !fs.existsSync(ARCHIVE_DIR)) return null;
  let found = null;
  for (const f of fs.readdirSync(ARCHIVE_DIR)) {
    if (!f.endsWith('.json')) continue;
    try {
      const data = JSON.parse(fs.readFileSync(path.join(ARCHIVE_DIR, f), 'utf8'));
      if (data.sessionId === sessionId && (!found || String(data.archivedAt) > String(found.archivedAt))) found = data;
    } catch { /* unreadable file: ignored */ }
  }
  return found;
}

/** Sessions ended for longer than the set delay: archived (checked every hour and at startup). */
export function autoArchive() {
  const days = Number(readOptions().archiveAfterDays) || 0;
  if (days <= 0) return;
  const limit = Date.now() - days * 86400_000;
  for (const [slug, { data, receivedAt }] of sessions) {
    if (data.status !== 'done' || drivers.has(slug)) continue;
    const since = Date.parse(data.endedAt || data.updatedAt || receivedAt);
    if (Number.isFinite(since) && since < limit) archiveSession(slug).catch(() => {});
  }
}
