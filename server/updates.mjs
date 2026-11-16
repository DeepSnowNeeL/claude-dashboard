// "Not up to date" banner: after a `git pull`, the page serves the new files on F5, but the engine (and the page server
// itself) keep running the code they started with. Each one knows its starting commit; we compare it with the commit on
// disk and only report it when files it runs changed in between (a commit that only touches public/ needs an F5).
import fs from 'node:fs';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/** Commit checked out in the repo, read from .git without starting git (null outside a git checkout). */
export function headCommit(root = ROOT) {
  try {
    let gitDir = path.join(root, '.git');
    if (fs.statSync(gitDir).isFile()) gitDir = path.resolve(root, fs.readFileSync(gitDir, 'utf8').match(/gitdir: (.+)/)[1].trim()); // worktree
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const ref = head.match(/^ref: (.+)$/)?.[1];
    if (!ref) return head;
    // A worktree keeps its refs in the common folder
    const common = fs.existsSync(path.join(gitDir, 'commondir')) ? path.resolve(gitDir, fs.readFileSync(path.join(gitDir, 'commondir'), 'utf8').trim()) : gitDir;
    for (const dir of [gitDir, common]) { try { return fs.readFileSync(path.join(dir, ref), 'utf8').trim(); } catch { /* packed */ } }
    const packed = fs.readFileSync(path.join(common, 'packed-refs'), 'utf8');
    return packed.split('\n').find(l => l.endsWith(` ${ref}`))?.split(' ')[0] || null;
  } catch { return null; }
}

/** Files each process runs (relative paths). A change in them needs a restart, not an F5. */
const ENGINE_FILES = /^(engine\.mjs|driver\.mjs|driver\/|engine\/|trackers\.mjs|trackers\/|projects\.mjs|common\.mjs|migration\.mjs|instructions\.|plugin\/|public\/i18n\/|package(-lock)?\.json)/;
const PAGE_FILES = /^(server\.mjs|server\/|access\.mjs|projects\.mjs|trackers\.mjs|common\.mjs|migration\.mjs|public\/i18n\/|package(-lock)?\.json)/;

const diffCache = new Map(); // "from..to" → changed files
function changedFiles(from, to) {
  const k = `${from}..${to}`;
  if (diffCache.has(k)) return Promise.resolve(diffCache.get(k));
  return new Promise(resolve => execFile('git', ['-C', ROOT, 'diff', '--name-only', from, to], { timeout: 10000, windowsHide: true }, (e, out) => {
    const files = e ? null : out.split('\n').filter(Boolean); // null: unknown commit (history rewritten…), counted as changed
    diffCache.set(k, files);
    resolve(files);
  }));
}
async function outdated(started, files) {
  const now = headCommit();
  if (!started || !now || started === now) return false;
  const changed = await changedFiles(started, now);
  return !changed || changed.some(f => files.test(f));
}

export const PAGE_COMMIT = headCommit(); // commit the page server started with

/**
 * `{ engine, page, head }`: true when that process runs older code than the files on disk (`engineCommit` null = old
 * engine); `head`, the commit on disk.
 */
export async function updateStatus(engineCommit) {
  return {
    head: headCommit(),
    engine: engineCommit === null ? true : await outdated(engineCommit, ENGINE_FILES),
    page: await outdated(PAGE_COMMIT, PAGE_FILES),
  };
}
